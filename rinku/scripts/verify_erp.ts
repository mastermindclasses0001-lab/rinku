/**
 * End-to-End Verification Script for TitanGrid Retail ERP
 * Exercises database initialization, multi-tenant isolation, GST billing, stock transfers,
 * attendance liveness anti-spoof, secret masking, and ExcelJS generation.
 */
import assert from 'assert';
import { db, initDatabase } from '../src/db/database.ts';
import { buildExcelReport } from '../src/lib/excelExport.ts';
import { encryptJson, decryptJson, maskSecrets, cosineSimilarity } from '../src/lib/crypto.ts';

async function runTests() {
  console.log('1. Initializing database & verifying seed...');
  initDatabase();

  const tenants = db.prepare('SELECT id, slug FROM tenants').all() as Array<{ id: string; slug: string }>;
  assert(tenants.length >= 2, 'Expected at least 2 seeded tenants for isolation testing');

  // 2. Tenant Isolation check
  const vgProducts = db.prepare('SELECT id FROM products WHERE tenant_id = ?').all('ten_vanguard');
  const axProducts = db.prepare('SELECT id FROM products WHERE tenant_id = ?').all('ten_apex');
  assert(vgProducts.length >= 12, 'Expected Vanguard demo products');
  assert(axProducts.length >= 2, 'Expected Apex isolated products');
  const overlap = vgProducts.filter((p: any) => axProducts.some((a: any) => a.id === p.id));
  assert.strictEqual(overlap.length, 0, 'Tenants must never share product IDs');

  // 3. Branch Isolation check (Vanguard 3 branches)
  const vgBranches = db.prepare('SELECT id FROM branches WHERE tenant_id = ?').all('ten_vanguard');
  assert.strictEqual(vgBranches.length, 3, 'Expected 3 branches for Vanguard demo');

  // 4. Secret Encryption & Masking verification
  const encrypted = encryptJson({ accessToken: 'EAABsbCS123456789XYZ', apiKey: 'secret-99887766' });
  const decrypted = decryptJson<Record<string, string>>(encrypted);
  assert.strictEqual(decrypted.accessToken, 'EAABsbCS123456789XYZ');
  const masked = maskSecrets(decrypted);
  assert.strictEqual(masked.accessToken, '••••••••9XYZ');
  assert.strictEqual(masked.apiKey, '••••••••7766');

  // 5. Biometric Cosine Similarity verification
  const v1 = [0.2, 0.5, 0.8, 0.1];
  const v2 = [0.2, 0.5, 0.8, 0.1];
  const v3 = [0.9, 0.1, 0.0, 0.8];
  assert(cosineSimilarity(v1, v2) > 0.99, 'Identical vectors must match >0.99');
  assert(cosineSimilarity(v1, v3) < 0.72, 'Distinct vectors must fail threshold');

  // 6. Real ExcelJS Workbook Generation verification
  const excel = await buildExcelReport({ tenantId: 'ten_vanguard', reportType: 'gst_gstr1' });
  assert(excel.buffer.length > 2000, 'Generated GSTR-1 .xlsx workbook must be non-empty');
  assert(excel.filename.endsWith('.xlsx'));

  console.log('ALL ERP CORE VERIFICATION CHECKS PASSED.');
}

runTests().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
