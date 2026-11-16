const TOKEN_KEY = 'titangrid_token';
const TENANT_OVERRIDE_KEY = 'titangrid_super_tenant';

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

  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) errMsg = data.error;
    } catch { /* ignore */ }
    throw new Error(errMsg);
  }
  return res.json() as Promise<T>;
}

export async function apiDownloadFile(path: string, fallbackFilename: string) {
  const token = getStoredToken();
  const tenantOverride = getSuperTenantOverride();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (tenantOverride) headers['x-tenant-id'] = tenantOverride;

  const res = await fetch(path, { headers });
  if (!res.ok) {
    throw new Error(`Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition');
  const match = disp?.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : fallbackFilename;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
