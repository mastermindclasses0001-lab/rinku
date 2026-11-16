const TOKEN_KEY = 'titangrid_token';
const TENANT_OVERRIDE_KEY = 'titangrid_super_tenant';

const DEFAULT_RENDER_API = 'https://titangrid-backend.onrender.com';

export function getApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app')) {
    return DEFAULT_RENDER_API;
  }
  return '';
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getApiBaseUrl();
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getSuperTenantOverride(): string | null {
  return localStorage.getItem(TENANT_OVERRIDE_KEY);
}

export function setSuperTenantOverride(tenantId: string | null) {
  if (tenantId) localStorage.setItem(TENANT_OVERRIDE_KEY, tenantId);
  else localStorage.removeItem(TENANT_OVERRIDE_KEY);
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const tenantOverride = getSuperTenantOverride();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (tenantOverride) headers['x-tenant-id'] = tenantOverride;

  const res = await fetch(resolveApiUrl(path), { ...options, headers });
  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) errMsg = String(data.error);
      else if (data?.detail) {
        errMsg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
      }
    } catch { /* ignore */ }
    throw new Error(errMsg);
  }
  return res.json() as Promise<T>;
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 15000);
}

export async function apiDownloadFile(path: string, fallbackFilename: string) {
  const token = getStoredToken();
  const tenantOverride = getSuperTenantOverride();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (tenantOverride) headers['x-tenant-id'] = tenantOverride;

  const res = await fetch(resolveApiUrl(path), { headers });
  if (!res.ok) {
    let errMsg = `Export failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) errMsg = String(data.error);
      else if (data?.detail) errMsg = String(data.detail);
    } catch { /* ignore */ }
    throw new Error(errMsg);
  }
  const buf = await res.arrayBuffer();
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
  const blob = new Blob([buf], { type: contentType });
  const disp = res.headers.get('Content-Disposition');
  const match = disp?.match(/filename="?([^";]+)"?/i);
  const filename = match ? match[1] : fallbackFilename;

  triggerBlobDownload(blob, filename);
}
