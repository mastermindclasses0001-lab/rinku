import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const WHITELIST_ROOT_FILES = new Set([
  '.env.example',
  '.gitignore',
  'BUILD_PROGRESS.md',
  'MASTER_TODO.md',
  'bun.lock',
  'index.html',
  'metadata.json',
  'package.json',
  'server.ts',
  'tsconfig.json',
  'vercel.json',
  'vite.config.ts',
]);

const WHITELIST_ROOT_DIRS = ['src', 'backend', 'docs', 'scripts', 'public'];

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'data',
  '__pycache__',
  '.git',
  'coverage',
]);

function shouldSkipPath(relPosix: string, name: string, isDir: boolean): boolean {
  if (isDir) {
    if (EXCLUDED_DIRS.has(name)) return true;
    if (relPosix === 'public/assets/aistudio' || relPosix.startsWith('public/assets/aistudio/')) return true;
    return false;
  }
  if (name === '.DS_Store') return true;
  if (name.startsWith('.env') && name !== '.env.example') return true;
  if (/\.(db|db-wal|db-shm|sqlite|sqlite3|pyc|pyo|log)$/i.test(name)) return true;
  return false;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

interface ZipEntryRecord {
  nameBuf: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  dosTime: number;
  dosDate: number;
  localOffset: number;
}

function collectCleanSourceFiles(rootDir: string): Array<{ relPath: string; absPath: string; mtime: Date }> {
  const results: Array<{ relPath: string; absPath: string; mtime: Date }> = [];

  for (const fileName of WHITELIST_ROOT_FILES) {
    const abs = path.join(rootDir, fileName);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.lstatSync(abs);
    if (stat.isFile() && !stat.isSymbolicLink()) {
      results.push({ relPath: fileName, absPath: abs, mtime: stat.mtime });
    }
  }

  const walk = (absDir: string, relPrefix: string) => {
    const entries = fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relPosix = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const absChild = path.join(absDir, entry.name);
      if (shouldSkipPath(relPosix, entry.name, entry.isDirectory())) continue;
      if (entry.isDirectory()) {
        walk(absChild, relPosix);
      } else if (entry.isFile()) {
        const stat = fs.statSync(absChild);
        results.push({ relPath: relPosix, absPath: absChild, mtime: stat.mtime });
      }
    }
  };

  for (const dirName of WHITELIST_ROOT_DIRS) {
    const abs = path.join(rootDir, dirName);
    if (fs.existsSync(abs) && fs.lstatSync(abs).isDirectory()) {
      walk(abs, dirName);
    }
  }

  return results;
}

export function buildCleanSourceZip(rootDir: string = process.cwd()): { buffer: Buffer; fileCount: number } {
  const files = collectCleanSourceFiles(rootDir);
  const localChunks: Buffer[] = [];
  const centralRecords: ZipEntryRecord[] = [];
  let offset = 0;

  for (const item of files) {
    const raw = fs.readFileSync(item.absPath);
    const compressed = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = compressed.length < raw.length;
    const payload = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const nameBuf = Buffer.from(item.relPath, 'utf8');
    const { dosTime, dosDate } = toDosDateTime(item.mtime);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    centralRecords.push({
      nameBuf,
      method,
      crc,
      compressedSize: payload.length,
      uncompressedSize: raw.length,
      dosTime,
      dosDate,
      localOffset: offset,
    });

    localChunks.push(localHeader, payload);
    offset += localHeader.length + payload.length;
  }

  const centralStart = offset;
  const centralChunks: Buffer[] = [];
  let centralSize = 0;

  for (const rec of centralRecords) {
    const cd = Buffer.alloc(46 + rec.nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8); // UTF-8 flag
    cd.writeUInt16LE(rec.method, 10);
    cd.writeUInt16LE(rec.dosTime, 12);
    cd.writeUInt16LE(rec.dosDate, 14);
    cd.writeUInt32LE(rec.crc, 16);
    cd.writeUInt32LE(rec.compressedSize, 20);
    cd.writeUInt32LE(rec.uncompressedSize, 24);
    cd.writeUInt16LE(rec.nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(rec.localOffset, 42);
    rec.nameBuf.copy(cd, 46);
    centralChunks.push(cd);
    centralSize += cd.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralRecords.length, 8);
  eocd.writeUInt16LE(centralRecords.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return {
    buffer: Buffer.concat([...localChunks, ...centralChunks, eocd]),
    fileCount: files.length,
  };
}
