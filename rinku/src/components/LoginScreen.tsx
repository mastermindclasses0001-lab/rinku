import React, { useState } from 'react';
import { Building2, Lock, Mail, ArrowRight, ShieldCheck, Layers, Sun, Moon, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, setStoredToken } from '../lib/api';

const DEMO_ACCOUNTS = [
  { label: 'Owner (Rinku 1, 2 & 3) / मालिक', email: 'owner@vanguard.demo', pass: 'Owner@123', role: 'Owner / मालिक' },
  { label: 'Super Admin / सुपर एडमिन (HQ)', email: 'superadmin@titangrid.erp', pass: 'Admin@123', role: 'Super Admin' },
  { label: 'Branch Manager (Rinku 1) / प्रबंधक', email: 'manager@vanguard.demo', pass: 'Manager@123', role: 'Manager / प्रबंधक' },
  { label: 'Salesman / POS (PIN: 4821) / सेल्समैन', email: 'sales@vanguard.demo', pass: 'Sales@123', role: 'Salesman / सेल्समैन' },
  { label: 'Tenant 2 Owner / अलग बिजनेस (Apex)', email: 'owner@apex.demo', pass: 'Apex@123', role: 'Isolated Tenant' },
];

export const LoginScreen: React.FC = () => {
  const { login, theme, toggleTheme, refreshContext, notify } = useAuth();
  const [email, setEmail] = useState('owner@vanguard.demo');
  const [password, setPassword] = useState('Owner@123');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showWizard, setShowWizard] = useState(false);

  const [wizard, setWizard] = useState({
    businessName: '',
    legalName: '',
    gstin: '',
    address: '',
    phone: '',
    ownerName: '',
    ownerEmail: '',
    ownerPassword: '',
    branchName: 'Main Shop',
    branchCity: 'Ranchi',
    branchState: 'Jharkhand',
    stateCode: '20',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWizardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiFetch<{ token: string }>('/api/auth/setup-wizard', {
        method: 'POST',
        body: JSON.stringify(wizard),
      });
      setStoredToken(res.token);
      await refreshContext();
      notify('success', `Business "${wizard.businessName}" provisioned with isolated database workspace!`);
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#090B10] text-slate-900 dark:text-slate-100 flex flex-col justify-between p-6 md:p-10">
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/15 border border-sky-500/40 flex items-center justify-center text-sky-400">
            <Layers className="w-5 h-5" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap">TitanGrid Retail ERP</span>
        </div>
        <button
          onClick={toggleTheme}
          className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#11151E] text-xs font-medium flex items-center gap-2 hover:border-sky-500/40 transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
          <span>{theme === 'dark' ? 'Light Mode / लाइट' : 'Dark Mode / डार्क'}</span>
        </button>
      </div>

      <div className="max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 my-8 items-stretch">
        {/* Left Architecture Overview */}
        <div className="lg:col-span-7 flex flex-col justify-between bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-8">
          <div>
            <p className="text-xs font-mono text-sky-500 tracking-wide mb-3">MULTI-TENANT RETAIL ERP · Rinku 1, Rinku 2 & Rinku 3</p>
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-balance mb-4">
              Enterprise Operations for Tiles, Paint, Sanitaryware & Hardware.
              <span className="block text-xl md:text-2xl font-semibold text-sky-400 mt-2">
                टाइल्स, पेंट, सैनिटरी और हार्डवेयर दुकानों का पूरा डिजिटल प्रबंधन।
              </span>
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-sm md:text-base leading-relaxed max-w-2xl mb-8">
              Unified multi-branch stock valuation, GST CGST/SGST/IGST POS billing, biometric face liveness attendance, transactional P&L ledgers, 9 AM WhatsApp credit collection, and Gemini AI Brain.
              <span className="block mt-1 text-xs md:text-sm text-slate-500 dark:text-slate-400">
                तीनों दुकानों (Rinku 1, 2, 3) का स्टॉक, जीएसटी बिलिंग, फेस हाजिरी, लाभ-हानि खाता और व्हाट्सऐप उधार रिमाइंडर।
              </span>
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
              <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#171C28]">
                <img src="/src/assets/images/tile_marble_slab_1794811964688.jpg" alt="Porcelain Tiles" className="w-full h-24 object-cover" />
                <div className="p-2 text-xs font-medium">Tiles · Box / Sq Ft (टाइल्स)</div>
              </div>
              <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#171C28]">
                <img src="/src/assets/images/paint_bucket_studio_1794811965564.jpg" alt="Paints" className="w-full h-24 object-cover" />
                <div className="p-2 text-xs font-medium">Paint · Shade & Lot (पेंट)</div>
              </div>
              <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#171C28]">
                <img src="/src/assets/images/sanitary_faucet_brass_1794811965032.jpg" alt="Sanitaryware" className="w-full h-24 object-cover" />
                <div className="p-2 text-xs font-medium">Sanitaryware (सैनिटरी)</div>
              </div>
              <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#171C28]">
                <img src="/src/assets/images/hardware_lockset_steel_1794811966531.jpg" alt="Hardware" className="w-full h-24 object-cover" />
                <div className="p-2 text-xs font-medium">Hardware (हार्डवेयर)</div>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-200 dark:border-white/10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">DEMO SANDBOX CREDENTIALS / डेमो लॉगिन अकाउंट्स</span>
              <span className="text-xs font-mono text-amber-500">DEMO ACTIVE / डेमो सक्रिय</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setShowWizard(false);
                    setEmail(acc.email);
                    setPassword(acc.pass);
                  }}
                  className="text-left px-3 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 hover:border-sky-500/50 bg-slate-50 dark:bg-[#171C28] transition-colors flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{acc.label}</div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">{acc.email}</div>
                  </div>
                  <span className="text-[11px] font-mono text-sky-500 shrink-0">{acc.role}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Sign In / New Tenant Setup Card */}
        <div className="lg:col-span-5 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-8 flex flex-col justify-between">
          {!showWizard ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-emerald-500 mb-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>TENANT-ISOLATED SESSION / सुरक्षित बिजनेस लॉगिन</span>
                </div>
                <h2 className="font-display text-2xl font-bold">Sign in to Workspace / लॉगिन करें</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Enter your organization credentials or select a demo role on the left. / ईमेल-पासवर्ड भरें या बाईं तरफ से डेमो खाता चुनें।
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">Work Email / कार्य ईमेल</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-sm focus:outline-none focus:border-sky-500"
                    placeholder="owner@business.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">Password / पासवर्ड</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-sm focus:outline-none focus:border-sky-500"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 px-4 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <span>{submitting ? 'Authenticating... / लॉगिन हो रहा है...' : 'Access ERP Console / ईआरपी कंसोल खोलें'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="pt-4 border-t border-slate-200 dark:border-white/10 flex items-center justify-between">
                <span className="text-xs text-slate-500">New retail business? / नया बिजनेस?</span>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setShowWizard(true);
                  }}
                  className="text-xs font-semibold text-sky-500 hover:text-sky-400 flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Setup Wizard / नया खाता बनाएं
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleWizardSubmit} className="space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-display text-xl font-bold flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-sky-500" />
                  New Business / नया बिजनेस जोड़ें
                </h2>
                <button type="button" onClick={() => setShowWizard(false)} className="text-xs text-slate-400 hover:text-slate-200">
                  Back / वापस लॉगिन
                </button>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Provision a clean, non-demo white-label tenant workspace with your own branches and credentials. / अपनी नई दुकान व लॉगिन के साथ नया खाता बनाएं।
              </p>

              {error && <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">{error}</div>}

              <div className="grid grid-cols-2 gap-2.5">
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Business Trade Name / व्यापार का नाम *</label>
                  <input
                    required
                    placeholder="e.g. Rinku Tiles & Hardware"
                    value={wizard.businessName}
                    onChange={(e) => setWizard({ ...wizard, businessName: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">GSTIN / जीएसटी नंबर</label>
                  <input
                    placeholder="20XXXXX..."
                    value={wizard.gstin}
                    onChange={(e) => setWizard({ ...wizard, gstin: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Phone / फोन नंबर</label>
                  <input
                    placeholder="+91 98..."
                    value={wizard.phone}
                    onChange={(e) => setWizard({ ...wizard, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Main Shop Name / मुख्य दुकान *</label>
                  <input
                    required
                    placeholder="Main Shop"
                    value={wizard.branchName}
                    onChange={(e) => setWizard({ ...wizard, branchName: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">City / शहर *</label>
                  <input
                    required
                    placeholder="Ranchi"
                    value={wizard.branchCity}
                    onChange={(e) => setWizard({ ...wizard, branchCity: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">State / राज्य</label>
                  <input
                    placeholder="Jharkhand"
                    value={wizard.branchState}
                    onChange={(e) => setWizard({ ...wizard, branchState: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">State Code / राज्य कोड</label>
                  <input
                    placeholder="20"
                    value={wizard.stateCode}
                    onChange={(e) => setWizard({ ...wizard, stateCode: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Owner Full Name / मालिक का पूरा नाम *</label>
                  <input
                    required
                    placeholder="Full Name"
                    value={wizard.ownerName}
                    onChange={(e) => setWizard({ ...wizard, ownerName: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Owner Login Email / ईमेल *</label>
                  <input
                    required
                    type="email"
                    placeholder="owner@shop.in"
                    value={wizard.ownerEmail}
                    onChange={(e) => setWizard({ ...wizard, ownerEmail: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Password / पासवर्ड *</label>
                  <input
                    required
                    type="password"
                    placeholder="••••••"
                    value={wizard.ownerPassword}
                    onChange={(e) => setWizard({ ...wizard, ownerPassword: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors"
              >
                {submitting ? 'Provisioning... / खाता बन रहा है...' : 'Create Clean Workspace / नया खाता शुरू करें'}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
        <span>TitanGrid Jharkhand Multi-Shop ERP · Rinku 1, Rinku 2 & Rinku 3 · सुरक्षित मल्टी-शॉप सिस्टम</span>
        <span>Supports INR / GST CGST/SGST/IGST · Excel & PDF (जीएसटी, एक्सेल व पीडीएफ सपोर्ट)</span>
      </div>
    </div>
  );
};
