import React, { useEffect, useState } from 'react';
import { Shield, Key, CheckCircle2, AlertCircle, Download, Plus, Building, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiDownloadFile, apiFetch } from '../lib/api';

export const SettingsSuperAdminModule: React.FC<{ mode: 'settings' | 'super_admin' }> = ({ mode }) => {
  const { tenant, session, theme, toggleTheme, refreshContext, switchSuperTenant, notify } = useAuth();
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);

  // Business config form
  const [bizForm, setBizForm] = useState({
    name: tenant?.name || '',
    legalName: tenant?.legal_name || '',
    gstin: tenant?.gstin || '',
    address: tenant?.address || '',
    phone: tenant?.phone || '',
    currency: tenant?.currency || 'INR',
    currencySymbol: tenant?.currency_symbol || '₹',
    invoiceFooter: tenant?.branding?.invoiceFooter || '',
    maxCashierDiscountPct: tenant?.config?.maxCashierDiscountPct ?? 10,
    allowNegativeStock: Boolean(tenant?.config?.allowNegativeStock),
  });

  // Integration edit buffers
  const [fbCfg, setFbCfg] = useState({ projectId: '', apiKey: '', authDomain: '', storageBucket: '', messagingSenderId: '', appId: '' });
  const [waCfg, setWaCfg] = useState({ phoneNumberId: '', wabaId: '', accessToken: '', appId: '', appSecret: '', verifyToken: '', webhookUrl: '', apiVersion: 'v21.0' });
  const [aiCfg, setAiCfg] = useState({ provider: 'gemini', model: 'gemini-4-hydrogen', systemInstruction: '' });

  // New Tenant form (Super Admin)
  const [newTen, setNewTen] = useState({ name: '', gstin: '', plan: 'enterprise', ownerName: '', ownerEmail: '', ownerPassword: '', branchName: 'HQ Showroom', branchCity: 'Delhi' });

  const loadData = async () => {
    if (mode === 'super_admin') {
      const t = await apiFetch<any[]>('/api/super-admin/tenants');
      setTenants(t);
    } else {
      const [ints, aud] = await Promise.all([apiFetch<any[]>('/api/settings/integrations'), apiFetch<any[]>('/api/security/audit-logs')]);
      setIntegrations(ints);
      setAuditLogs(aud);
      const fb = ints.find((i) => i.provider === 'firebase')?.config;
      const wa = ints.find((i) => i.provider === 'meta_whatsapp')?.config;
      const ai = ints.find((i) => i.provider === 'ai_provider')?.config;
      if (fb) setFbCfg((p) => ({ ...p, ...fb }));
      if (wa) setWaCfg((p) => ({ ...p, ...wa }));
      if (ai) setAiCfg((p) => ({ ...p, ...ai }));
    }
  };

  useEffect(() => {
    loadData();
  }, [mode, tenant?.id]);

  const saveIntegration = async (provider: string, config: Record<string, unknown>) => {
    await apiFetch(`/api/settings/integrations/${provider}`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    });
    notify('success', `${provider.toUpperCase()} credentials encrypted & saved in server vault`);
    loadData();
  };

  const testIntegration = async (provider: string) => {
    const res = await apiFetch<{ ok: boolean; message: string }>(`/api/settings/integrations/${provider}/test`, { method: 'POST' });
    notify(res.ok ? 'success' : 'info', res.message);
    loadData();
  };

  const removeIntegration = async (provider: string) => {
    await apiFetch(`/api/settings/integrations/${provider}`, { method: 'DELETE' });
    notify('info', `${provider} configuration cleared`);
    loadData();
  };

  if (mode === 'super_admin') {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5">
          <h1 className="font-display text-xl font-bold flex items-center gap-2">
            <Shield className="w-5 h-5 text-sky-400" /> Super Admin — White-Label Tenant Control Plane
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Provision independent customer businesses with strict database isolation, subscription plans, and zero code changes.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Provision New Tenant */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/api/super-admin/tenants', { method: 'POST', body: JSON.stringify(newTen) });
              notify('success', `Tenant "${newTen.name}" provisioned!`);
              setNewTen({ name: '', gstin: '', plan: 'enterprise', ownerName: '', ownerEmail: '', ownerPassword: '', branchName: 'HQ Showroom', branchCity: 'Delhi' });
              loadData();
            }}
            className="lg:col-span-4 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3 text-xs"
          >
            <h3 className="font-display font-bold text-base flex items-center gap-1.5"><Plus className="w-4 h-4 text-emerald-400" /> Onboard New Business</h3>
            <input required placeholder="Business Name *" value={newTen.name} onChange={(e) => setNewTen({ ...newTen, name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="GSTIN" value={newTen.gstin} onChange={(e) => setNewTen({ ...newTen, gstin: e.target.value })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              <select value={newTen.plan} onChange={(e) => setNewTen({ ...newTen, plan: e.target.value })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                <option value="starter">Starter Plan</option>
                <option value="pro">Pro Multi-Branch</option>
                <option value="enterprise">Enterprise AI</option>
              </select>
            </div>
            <input required placeholder="HQ Branch Name *" value={newTen.branchName} onChange={(e) => setNewTen({ ...newTen, branchName: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <input required placeholder="City *" value={newTen.branchCity} onChange={(e) => setNewTen({ ...newTen, branchCity: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <input required placeholder="Owner Full Name *" value={newTen.ownerName} onChange={(e) => setNewTen({ ...newTen, ownerName: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <input required type="email" placeholder="Owner Email *" value={newTen.ownerEmail} onChange={(e) => setNewTen({ ...newTen, ownerEmail: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <input required type="password" placeholder="Initial Password *" value={newTen.ownerPassword} onChange={(e) => setNewTen({ ...newTen, ownerPassword: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <button type="submit" className="w-full py-2.5 rounded-lg bg-sky-500 text-slate-950 font-semibold">Provision Isolated Tenant</button>
          </form>

          {/* Tenant Directory */}
          <div className="lg:col-span-8 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-[#171C28] text-slate-500 text-left">
                <tr>
                  <th className="p-3">Business Tenant</th>
                  <th className="p-3">Plan</th>
                  <th className="p-3 text-right">Branches / Users</th>
                  <th className="p-3 text-right">GMV</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {tenants.map((t) => (
                  <tr key={t.id}>
                    <td className="p-3">
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-[11px] font-mono text-slate-500">{t.slug} · {t.gstin || 'No GSTIN'}</div>
                    </td>
                    <td className="p-3 font-mono uppercase">{t.plan}</td>
                    <td className="p-3 text-right font-mono">{t.branch_count} / {t.user_count}</td>
                    <td className="p-3 text-right font-mono">₹{Number(t.total_gmv).toLocaleString()}</td>
                    <td className="p-3 font-mono">
                      <span className={t.status === 'active' ? 'text-emerald-400' : 'text-red-400'}>{t.status.toUpperCase()}</span>
                    </td>
                    <td className="p-3 text-right space-x-1.5">
                      <button
                        onClick={() => switchSuperTenant(t.id)}
                        className="px-2.5 py-1 rounded bg-sky-500/15 text-sky-400 font-semibold"
                      >
                        Inspect
                      </button>
                      <button
                        onClick={async () => {
                          await apiFetch(`/api/super-admin/tenants/${t.id}/status`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: t.status === 'active' ? 'suspended' : 'active' }),
                          });
                          loadData();
                        }}
                        className="px-2.5 py-1 rounded border border-white/10"
                      >
                        {t.status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // SETTINGS & CONFIGURATION CENTER
  const statusOf = (p: string) => integrations.find((i) => i.provider === p)?.status || 'not_configured';

  return (
    <div className="space-y-6">
      {/* Business & Theme Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await apiFetch('/api/settings/tenant', {
              method: 'PATCH',
              body: JSON.stringify({
                name: bizForm.name,
                legalName: bizForm.legalName,
                gstin: bizForm.gstin,
                address: bizForm.address,
                phone: bizForm.phone,
                currency: bizForm.currency,
                currencySymbol: bizForm.currencySymbol,
                branding: { invoiceFooter: bizForm.invoiceFooter },
                config: {
                  maxCashierDiscountPct: Number(bizForm.maxCashierDiscountPct),
                  allowNegativeStock: bizForm.allowNegativeStock,
                },
              }),
            });
            await refreshContext();
            notify('success', 'Business configuration updated');
          }}
          className="lg:col-span-7 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3 text-xs"
        >
          <h2 className="font-display font-bold text-base flex items-center gap-2"><Building className="w-4 h-4 text-sky-400" /> F. Business, GST & Invoice Settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={bizForm.name} onChange={(e) => setBizForm({ ...bizForm, name: e.target.value })} placeholder="Trade Name" className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <input value={bizForm.gstin} onChange={(e) => setBizForm({ ...bizForm, gstin: e.target.value })} placeholder="GSTIN" className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            <input value={bizForm.currency} onChange={(e) => setBizForm({ ...bizForm, currency: e.target.value })} placeholder="Currency (INR/USD)" className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            <input type="number" value={bizForm.maxCashierDiscountPct} onChange={(e) => setBizForm({ ...bizForm, maxCashierDiscountPct: Number(e.target.value) })} placeholder="Max Cashier Discount %" className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          </div>
          <input value={bizForm.address} onChange={(e) => setBizForm({ ...bizForm, address: e.target.value })} placeholder="Registered Address" className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
          <input value={bizForm.invoiceFooter} onChange={(e) => setBizForm({ ...bizForm, invoiceFooter: e.target.value })} placeholder="Invoice Terms / Footer" className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={bizForm.allowNegativeStock} onChange={(e) => setBizForm({ ...bizForm, allowNegativeStock: e.target.checked })} />
              <span>Allow negative stock billing (not recommended)</span>
            </label>
            <button type="submit" className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold">Save Business Settings</button>
          </div>
        </form>

        {/* Theme & Backup */}
        <div className="lg:col-span-5 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4 text-xs">
          <h2 className="font-display font-bold text-base">D / E / G. Theme, Deployment & Backup</h2>
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-[#171C28]">
            <span>Active Interface Theme</span>
            <button onClick={toggleTheme} className="px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-400 font-semibold">
              Switch to {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#171C28] space-y-1 font-mono text-[11px]">
            <div>App URL: {window.location.origin}</div>
            <div>DB Engine: SQLite WAL (Cloud Run Postgres blueprint ready)</div>
            <div>Role: {session?.role.toUpperCase()}</div>
          </div>
          <button
            onClick={() => apiDownloadFile('/api/security/backup', `titangrid_backup_${tenant?.slug}.json`)}
            className="w-full py-2.5 rounded-lg bg-emerald-500 text-slate-950 font-semibold flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Download Full Tenant Backup (.JSON)
          </button>
        </div>
      </div>

      {/* Integration Vault Panels (Masked Secrets) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
        {/* A. Firebase */}
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold text-sm">A. Firebase Configuration</h3>
            <span className={`font-mono text-[11px] ${statusOf('firebase') === 'configured' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {statusOf('firebase').toUpperCase()}
            </span>
          </div>
          <input placeholder="Project ID" value={fbCfg.projectId} onChange={(e) => setFbCfg({ ...fbCfg, projectId: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          <input placeholder="API Key (Masked in UI)" value={fbCfg.apiKey} onChange={(e) => setFbCfg({ ...fbCfg, apiKey: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          <input placeholder="Auth Domain" value={fbCfg.authDomain} onChange={(e) => setFbCfg({ ...fbCfg, authDomain: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          <input placeholder="Storage Bucket" value={fbCfg.storageBucket} onChange={(e) => setFbCfg({ ...fbCfg, storageBucket: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          <div className="flex gap-2 pt-1">
            <button onClick={() => saveIntegration('firebase', fbCfg)} className="flex-1 py-2 rounded bg-sky-500 text-slate-950 font-semibold">Save</button>
            <button onClick={() => testIntegration('firebase')} className="px-3 py-2 rounded border border-white/10">Test</button>
            <button onClick={() => removeIntegration('firebase')} className="px-3 py-2 rounded border border-red-500/30 text-red-400">Clear</button>
          </div>
        </div>

        {/* B. Meta WhatsApp */}
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold text-sm">B. Meta WhatsApp Cloud</h3>
            <span className={`font-mono text-[11px] ${statusOf('meta_whatsapp') === 'configured' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {statusOf('meta_whatsapp').toUpperCase()}
            </span>
          </div>
          <input placeholder="Phone Number ID" value={waCfg.phoneNumberId} onChange={(e) => setWaCfg({ ...waCfg, phoneNumberId: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          <input placeholder="WABA Account ID" value={waCfg.wabaId} onChange={(e) => setWaCfg({ ...waCfg, wabaId: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          <input placeholder="Permanent Access Token (Masked)" value={waCfg.accessToken} onChange={(e) => setWaCfg({ ...waCfg, accessToken: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          <input placeholder="Verify Token" value={waCfg.verifyToken} onChange={(e) => setWaCfg({ ...waCfg, verifyToken: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          <div className="flex gap-2 pt-1">
            <button onClick={() => saveIntegration('meta_whatsapp', waCfg)} className="flex-1 py-2 rounded bg-sky-500 text-slate-950 font-semibold">Save</button>
            <button onClick={() => testIntegration('meta_whatsapp')} className="px-3 py-2 rounded border border-white/10">Test</button>
            <button onClick={() => removeIntegration('meta_whatsapp')} className="px-3 py-2 rounded border border-red-500/30 text-red-400">Clear</button>
          </div>
        </div>

        {/* C. AI Provider Adapter */}
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold text-sm">C. AI Provider Adapter</h3>
            <span className={`font-mono text-[11px] ${statusOf('ai_provider') === 'configured' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {statusOf('ai_provider').toUpperCase()}
            </span>
          </div>
          <select value={aiCfg.provider} onChange={(e) => setAiCfg({ ...aiCfg, provider: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10">
            <option value="gemini">Google Gemini (Server-Side Secrets)</option>
            <option value="openai_compatible">Custom Adapter (Configurable)</option>
          </select>
          <input placeholder="Model Name (gemini-4-hydrogen)" value={aiCfg.model} onChange={(e) => setAiCfg({ ...aiCfg, model: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          <textarea rows={3} placeholder="System Instructions..." value={aiCfg.systemInstruction} onChange={(e) => setAiCfg({ ...aiCfg, systemInstruction: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10" />
          <div className="flex gap-2 pt-1">
            <button onClick={() => saveIntegration('ai_provider', aiCfg)} className="flex-1 py-2 rounded bg-sky-500 text-slate-950 font-semibold">Save</button>
            <button onClick={() => testIntegration('ai_provider')} className="px-3 py-2 rounded border border-white/10">Test</button>
          </div>
        </div>
      </div>

      {/* Security Audit Log */}
      <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-white/10 flex items-center justify-between text-sm font-semibold">
          <span className="flex items-center gap-2"><Key className="w-4 h-4 text-sky-400" /> Security & Financial Audit Trail</span>
          <span className="text-xs font-mono text-slate-500">Immutable Tenant Log</span>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-[#171C28] text-slate-500 text-left">
              <tr>
                <th className="p-3">Timestamp</th>
                <th className="p-3">Actor</th>
                <th className="p-3">Action</th>
                <th className="p-3">Entity</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-mono text-[11px]">
              {auditLogs.map((a) => (
                <tr key={a.id}>
                  <td className="p-3 text-slate-500">{String(a.created_at).slice(0, 19)}</td>
                  <td className="p-3">{a.user_name}</td>
                  <td className="p-3 text-sky-400">{a.action}</td>
                  <td className="p-3">{a.entity_type}</td>
                  <td className="p-3 text-slate-400 truncate max-w-xs">{a.details_json}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
