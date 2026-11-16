import React, { useEffect, useState } from 'react';
import { Shield, Key, CheckCircle2, AlertCircle, Download, Plus, Building, RefreshCw, FileArchive } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiDownloadFile, apiFetch } from '../lib/api';

export const SettingsSuperAdminModule: React.FC<{ mode: 'settings' | 'super_admin' }> = ({ mode }) => {
  const { tenant, branches, session, theme, toggleTheme, refreshContext, switchSuperTenant, notify } = useAuth();
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

  // Editable branches draft map (Rinku 1, Rinku 2, Rinku 3...)
  const [branchDrafts, setBranchDrafts] = useState<Record<string, {
    name: string;
    code: string;
    address: string;
    city: string;
    state: string;
    stateCode: string;
    gstin: string;
    phone: string;
  }>>({});
  const [savingBranchId, setSavingBranchId] = useState<string | null>(null);

  useEffect(() => {
    if (tenant) {
      setBizForm({
        name: tenant.name || '',
        legalName: tenant.legal_name || '',
        gstin: tenant.gstin || '',
        address: tenant.address || '',
        phone: tenant.phone || '',
        currency: tenant.currency || 'INR',
        currencySymbol: tenant.currency_symbol || '₹',
        invoiceFooter: tenant.branding?.invoiceFooter || '',
        maxCashierDiscountPct: tenant.config?.maxCashierDiscountPct ?? 10,
        allowNegativeStock: Boolean(tenant.config?.allowNegativeStock),
      });
    }
  }, [tenant]);

  useEffect(() => {
    const map: Record<string, any> = {};
    for (const b of branches) {
      map[b.id] = {
        name: b.name || '',
        code: b.code || '',
        address: b.address || '',
        city: b.city || 'Ranchi',
        state: b.state || 'Jharkhand',
        stateCode: b.state_code || '20',
        gstin: b.gstin || '',
        phone: b.phone || '',
      };
    }
    setBranchDrafts(map);
  }, [branches]);

  // Integration edit buffers
  const [fbCfg, setFbCfg] = useState({ projectId: '', apiKey: '', authDomain: '', storageBucket: '', messagingSenderId: '', appId: '' });
  const [waCfg, setWaCfg] = useState({ phoneNumberId: '', wabaId: '', accessToken: '', appId: '', appSecret: '', verifyToken: '', webhookUrl: '', apiVersion: 'v21.0' });
  const [aiCfg, setAiCfg] = useState({ provider: 'gemini', model: 'gemini-4-hydrogen', systemInstruction: '' });

  // New Tenant form (Super Admin)
  const [newTen, setNewTen] = useState({
    name: '',
    gstin: '',
    plan: 'enterprise',
    ownerName: '',
    ownerEmail: '',
    ownerPassword: '',
    branchName: 'Main Shop',
    branchCity: 'Ranchi',
    branchState: 'Jharkhand',
    stateCode: '20',
  });

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
            <Shield className="w-5 h-5 text-sky-400" /> Super Admin / सुपर एडमिन कंट्रोल पैनल
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Provision independent customer businesses with strict database isolation. / अलग-अलग बिजनेस और डेटा अलगाव प्रबंधन।
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Provision New Tenant */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/api/super-admin/tenants', { method: 'POST', body: JSON.stringify(newTen) });
              notify('success', `Tenant "${newTen.name}" provisioned!`);
              setNewTen({
                name: '',
                gstin: '',
                plan: 'enterprise',
                ownerName: '',
                ownerEmail: '',
                ownerPassword: '',
                branchName: 'Main Shop',
                branchCity: 'Ranchi',
                branchState: 'Jharkhand',
                stateCode: '20',
              });
              loadData();
            }}
            className="lg:col-span-4 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3 text-xs"
          >
            <h3 className="font-display font-bold text-base flex items-center gap-1.5"><Plus className="w-4 h-4 text-emerald-400" /> Onboard New Business / नया बिजनेस जोड़ें</h3>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Business Name / बिजनेस का नाम *</label>
              <input required placeholder="e.g. Ranchi Granite Hub" value={newTen.name} onChange={(e) => setNewTen({ ...newTen, name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">GSTIN / जीएसटी नंबर</label>
                <input placeholder="20XXXXX..." value={newTen.gstin} onChange={(e) => setNewTen({ ...newTen, gstin: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Plan / प्लान</label>
                <select value={newTen.plan} onChange={(e) => setNewTen({ ...newTen, plan: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                  <option value="starter">Starter Plan</option>
                  <option value="pro">Pro Multi-Branch</option>
                  <option value="enterprise">Enterprise AI</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Main Shop Name / मुख्य दुकान *</label>
                <input required placeholder="Main Shop" value={newTen.branchName} onChange={(e) => setNewTen({ ...newTen, branchName: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">City / शहर *</label>
                <input required placeholder="Ranchi" value={newTen.branchCity} onChange={(e) => setNewTen({ ...newTen, branchCity: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">State / राज्य</label>
                <input placeholder="Jharkhand" value={newTen.branchState} onChange={(e) => setNewTen({ ...newTen, branchState: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">State Code / राज्य कोड</label>
                <input placeholder="20" value={newTen.stateCode} onChange={(e) => setNewTen({ ...newTen, stateCode: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Owner Name / मालिक का नाम *</label>
              <input required placeholder="Full Name" value={newTen.ownerName} onChange={(e) => setNewTen({ ...newTen, ownerName: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Owner Email / ईमेल *</label>
              <input required type="email" placeholder="owner@shop.in" value={newTen.ownerEmail} onChange={(e) => setNewTen({ ...newTen, ownerEmail: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Password / पासवर्ड *</label>
              <input required type="password" placeholder="••••••" value={newTen.ownerPassword} onChange={(e) => setNewTen({ ...newTen, ownerPassword: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            </div>
            <button type="submit" className="w-full py-2.5 rounded-lg bg-sky-500 text-slate-950 font-semibold">Provision Business / बिजनेस शुरू करें</button>
          </form>

          {/* Tenant Directory */}
          <div className="lg:col-span-8 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-[#171C28] text-slate-500 text-left">
                <tr>
                  <th className="p-3">Business / बिजनेस</th>
                  <th className="p-3">Plan / प्लान</th>
                  <th className="p-3 text-right">Shops / Users (दुकान/स्टाफ)</th>
                  <th className="p-3 text-right">GMV / कुल बिक्री</th>
                  <th className="p-3">Status / स्थिति</th>
                  <th className="p-3 text-right">Controls / नियंत्रण</th>
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
                        Inspect / देखें
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
                        {t.status === 'active' ? 'Suspend / रोकें' : 'Activate / चालू करें'}
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
          <h2 className="font-display font-bold text-base flex items-center gap-2"><Building className="w-4 h-4 text-sky-400" /> F. Business, GST & Invoice Settings / बिजनेस और जीएसटी सेटिंग्स</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Trade Name / दुकान या फर्म का नाम</label>
              <input value={bizForm.name} onChange={(e) => setBizForm({ ...bizForm, name: e.target.value })} placeholder="Shop / Business Name" className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Legal Firm Name / कानूनी फर्म का नाम</label>
              <input value={bizForm.legalName} onChange={(e) => setBizForm({ ...bizForm, legalName: e.target.value })} placeholder="Legal Entity Name" className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">GSTIN / जीएसटी नंबर</label>
              <input value={bizForm.gstin} onChange={(e) => setBizForm({ ...bizForm, gstin: e.target.value })} placeholder="20AABCR..." className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Phone Number / फोन नंबर</label>
              <input value={bizForm.phone} onChange={(e) => setBizForm({ ...bizForm, phone: e.target.value })} placeholder="+91 ..." className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Currency / मुद्रा</label>
              <input value={bizForm.currency} onChange={(e) => setBizForm({ ...bizForm, currency: e.target.value })} placeholder="INR" className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Max Cashier Discount (%) / अधिकतम छूट %</label>
              <input type="number" value={bizForm.maxCashierDiscountPct} onChange={(e) => setBizForm({ ...bizForm, maxCashierDiscountPct: Number(e.target.value) })} placeholder="10" className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Registered Business Address / मुख्य पता</label>
            <input value={bizForm.address} onChange={(e) => setBizForm({ ...bizForm, address: e.target.value })} placeholder="Main Road, Ranchi, Jharkhand" className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Invoice Terms / Footer / बिल के नियम</label>
            <input value={bizForm.invoiceFooter} onChange={(e) => setBizForm({ ...bizForm, invoiceFooter: e.target.value })} placeholder="Thank you for visiting..." className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
          </div>
          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={bizForm.allowNegativeStock} onChange={(e) => setBizForm({ ...bizForm, allowNegativeStock: e.target.checked })} />
              <span>Allow negative stock billing / बिना स्टॉक बिलिंग</span>
            </label>
            <button type="submit" className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold">Save Settings / सेटिंग्स सेव करें</button>
          </div>
        </form>

        {/* Theme & Backup */}
        <div className="lg:col-span-5 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4 text-xs">
          <h2 className="font-display font-bold text-base">D / E / G. Theme & Backup / थीम व बैकअप</h2>
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-[#171C28]">
            <span>Active Theme / सक्रिय थीम</span>
            <button onClick={toggleTheme} className="px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-400 font-semibold">
              {theme === 'dark' ? 'Light Mode / लाइट थीम' : 'Dark Mode / डार्क थीम'}
            </button>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#171C28] space-y-1 font-mono text-[11px]">
            <div>App URL: {window.location.origin}</div>
            <div>DB Engine: SQLite WAL (Cloud Run Postgres blueprint ready)</div>
            <div>Role: {session?.role.toUpperCase()}</div>
          </div>
          <button
            onClick={async () => {
              try {
                await apiDownloadFile('/api/security/backup', `titangrid_backup_${tenant?.slug || 'erp'}.json`);
                notify('success', 'Full backup (.JSON) downloaded / बैकअप डाउनलोड हो गया');
              } catch (err: any) {
                notify('error', err.message || 'Backup export failed');
              }
            }}
            className="w-full py-2.5 rounded-lg bg-emerald-500 text-slate-950 font-semibold flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Download Backup (.JSON) / पूरा बैकअप डाउनलोड करें
          </button>
          {(session?.role === 'super_admin' || session?.role === 'owner') && (
            <div className="pt-2 border-t border-slate-200 dark:border-white/10 space-y-2">
              <button
                onClick={async () => {
                  try {
                    const today = new Date().toISOString().slice(0, 10);
                    await apiDownloadFile('/api/security/export-source', `rinku_erp_source_${today}.zip`);
                    notify('success', 'Clean Source Code (.ZIP) downloaded / सोर्स कोड ZIP डाउनलोड हो गया');
                  } catch (err: any) {
                    notify('error', err.message || 'Source ZIP download failed');
                  }
                }}
                className="w-full py-2.5 rounded-lg bg-sky-500 text-slate-950 font-semibold flex items-center justify-center gap-2 hover:bg-sky-400 transition-colors"
              >
                <FileArchive className="w-4 h-4" /> Download Source Code (.ZIP) / प्रोजेक्ट कोड ZIP डाउनलोड करें
              </button>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Clean GitHub-ready ZIP (~400 KB, without node_modules, .env, or database). / GitHub पर सीधे अपलोड करने के लिए साफ कोड ZIP।
              </p>
            </div>
          )}
        </div>
      </div>

      {/* All Shops / Branches Editable Settings (Rinku 1, Rinku 2, Rinku 3) */}
      <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display font-bold text-base flex items-center gap-2">
              <Building className="w-4 h-4 text-emerald-400" />
              All Shops / Branches Settings / तीनों दुकानों का नाम व पता ({branches.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Edit name, address, city, GSTIN & phone for each branch (Rinku 1, Rinku 2, Rinku 3). / हर दुकान का नाम, पता, शहर व फोन नंबर यहाँ से बदलें।
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
          {branches.map((b) => {
            const draft = branchDrafts[b.id] || {
              name: b.name || '',
              code: b.code || '',
              address: b.address || '',
              city: b.city || '',
              state: b.state || 'Jharkhand',
              stateCode: b.state_code || '20',
              gstin: b.gstin || '',
              phone: b.phone || '',
            };
            const updateDraft = (field: string, value: string) => {
              setBranchDrafts((prev) => ({
                ...prev,
                [b.id]: { ...draft, [field]: value },
              }));
            };
            return (
              <form
                key={b.id}
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSavingBranchId(b.id);
                  try {
                    await apiFetch(`/api/branches/${b.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify(draft),
                    });
                    await refreshContext();
                    notify('success', `Shop "${draft.name}" updated / दुकान अपडेट हो गई`);
                  } catch (err: any) {
                    notify('error', err.message);
                  } finally {
                    setSavingBranchId(null);
                  }
                }}
                className="bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-2.5"
              >
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <span className="font-display font-bold text-sm text-sky-400">{b.name}</span>
                  <span className="font-mono text-[10px] text-slate-400">{b.is_headquarters === 1 ? 'HQ / मुख्य' : b.code}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Shop Name / दुकान नाम</label>
                    <input required value={draft.name} onChange={(e) => updateDraft('name', e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-[#11151E] border border-white/10" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Shop Code / कोड</label>
                    <input value={draft.code} onChange={(e) => updateDraft('code', e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-[#11151E] border border-white/10 font-mono" />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Address / पूरा पता</label>
                  <input value={draft.address} onChange={(e) => updateDraft('address', e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-[#11151E] border border-white/10" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">City / शहर</label>
                    <input value={draft.city} onChange={(e) => updateDraft('city', e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-[#11151E] border border-white/10" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">State / राज्य</label>
                    <input value={draft.state} onChange={(e) => updateDraft('state', e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-[#11151E] border border-white/10" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Code / कोड</label>
                    <input value={draft.stateCode} onChange={(e) => updateDraft('stateCode', e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-[#11151E] border border-white/10 font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Branch GSTIN / जीएसटी</label>
                    <input value={draft.gstin} onChange={(e) => updateDraft('gstin', e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-[#11151E] border border-white/10 font-mono" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Phone / फोन नंबर</label>
                    <input value={draft.phone} onChange={(e) => updateDraft('phone', e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-[#11151E] border border-white/10 font-mono" />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={savingBranchId === b.id}
                  className="w-full py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold disabled:opacity-50"
                >
                  {savingBranchId === b.id ? 'Saving... / सेव हो रहा है...' : 'Save Shop / दुकान सेव करें'}
                </button>
              </form>
            );
          })}
        </div>
      </div>

      {/* Integration Vault Panels (Masked Secrets) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
        {/* A. Firebase */}
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold text-sm">A. Firebase / फायरबेस</h3>
            <span className={`font-mono text-[11px] ${statusOf('firebase') === 'configured' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {statusOf('firebase').toUpperCase()}
            </span>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Firebase Project ID / प्रोजेक्ट आईडी</label>
            <input placeholder="my-firebase-project" value={fbCfg.projectId} onChange={(e) => setFbCfg({ ...fbCfg, projectId: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">API Key (Masked in UI) / एपीआई की</label>
            <input placeholder="AIza..." value={fbCfg.apiKey} onChange={(e) => setFbCfg({ ...fbCfg, apiKey: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Auth Domain / ऑथ डोमेन</label>
            <input placeholder="project.firebaseapp.com" value={fbCfg.authDomain} onChange={(e) => setFbCfg({ ...fbCfg, authDomain: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Storage Bucket / स्टोरेज बकेट</label>
            <input placeholder="project.appspot.com" value={fbCfg.storageBucket} onChange={(e) => setFbCfg({ ...fbCfg, storageBucket: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => saveIntegration('firebase', fbCfg)} className="flex-1 py-2 rounded bg-sky-500 text-slate-950 font-semibold">Save / सेव</button>
            <button onClick={() => testIntegration('firebase')} className="px-3 py-2 rounded border border-white/10">Test / जांचें</button>
            <button onClick={() => removeIntegration('firebase')} className="px-3 py-2 rounded border border-red-500/30 text-red-400">Clear / हटाएं</button>
          </div>
        </div>

        {/* B. Meta WhatsApp */}
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold text-sm">B. Meta WhatsApp / व्हाट्सऐप API</h3>
            <span className={`font-mono text-[11px] ${statusOf('meta_whatsapp') === 'configured' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {statusOf('meta_whatsapp').toUpperCase()}
            </span>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Phone Number ID / फोन नंबर आईडी</label>
            <input placeholder="1234567890" value={waCfg.phoneNumberId} onChange={(e) => setWaCfg({ ...waCfg, phoneNumberId: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">WABA Account ID / खाता आईडी</label>
            <input placeholder="WABA ID" value={waCfg.wabaId} onChange={(e) => setWaCfg({ ...waCfg, wabaId: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Permanent Access Token (Masked) / टोकन</label>
            <input placeholder="EAAG..." value={waCfg.accessToken} onChange={(e) => setWaCfg({ ...waCfg, accessToken: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Webhook Verify Token / वेरीफाई टोकन</label>
            <input placeholder="verify-token" value={waCfg.verifyToken} onChange={(e) => setWaCfg({ ...waCfg, verifyToken: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => saveIntegration('meta_whatsapp', waCfg)} className="flex-1 py-2 rounded bg-sky-500 text-slate-950 font-semibold">Save / सेव</button>
            <button onClick={() => testIntegration('meta_whatsapp')} className="px-3 py-2 rounded border border-white/10">Test / जांचें</button>
            <button onClick={() => removeIntegration('meta_whatsapp')} className="px-3 py-2 rounded border border-red-500/30 text-red-400">Clear / हटाएं</button>
          </div>
        </div>

        {/* C. AI Provider Adapter */}
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold text-sm">C. AI Provider / एआई सेटिंग्स</h3>
            <span className={`font-mono text-[11px] ${statusOf('ai_provider') === 'configured' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {statusOf('ai_provider').toUpperCase()}
            </span>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">AI Provider / एआई सेवा</label>
            <select value={aiCfg.provider} onChange={(e) => setAiCfg({ ...aiCfg, provider: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10">
              <option value="gemini">Google Gemini (Server-Side Secrets)</option>
              <option value="openai_compatible">Custom Adapter (Configurable)</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Model Name / मॉडल नाम</label>
            <input placeholder="gemini-4-hydrogen" value={aiCfg.model} onChange={(e) => setAiCfg({ ...aiCfg, model: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">System Instructions / एआई निर्देश</label>
            <textarea rows={3} placeholder="AI instructions..." value={aiCfg.systemInstruction} onChange={(e) => setAiCfg({ ...aiCfg, systemInstruction: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => saveIntegration('ai_provider', aiCfg)} className="flex-1 py-2 rounded bg-sky-500 text-slate-950 font-semibold">Save / सेव</button>
            <button onClick={() => testIntegration('ai_provider')} className="px-3 py-2 rounded border border-white/10">Test / जांचें</button>
          </div>
        </div>
      </div>

      {/* Security Audit Log */}
      <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-white/10 flex items-center justify-between text-sm font-semibold">
          <span className="flex items-center gap-2"><Key className="w-4 h-4 text-sky-400" /> Security & Financial Audit Trail / सुरक्षा ऑडिट लॉग</span>
          <span className="text-xs font-mono text-slate-500">Immutable Log / सुरक्षित रिकॉर्ड</span>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-[#171C28] text-slate-500 text-left">
              <tr>
                <th className="p-3">Timestamp / समय</th>
                <th className="p-3">Actor / उपयोगकर्ता</th>
                <th className="p-3">Action / कार्य</th>
                <th className="p-3">Entity / विभाग</th>
                <th className="p-3">Details / विवरण</th>
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
