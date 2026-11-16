import React, { useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  Landmark,
  Users,
  UserCheck,
  BrainCircuit,
  FileSpreadsheet,
  Settings,
  Shield,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
  Building2,
  Layers,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { NavSection } from '../types/erp';

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard / डैशबोर्ड', icon: LayoutDashboard },
  { id: 'pos', label: 'POS Billing / बिलिंग', icon: ShoppingCart },
  { id: 'inventory', label: 'Branches & Stock / स्टॉक', icon: Boxes },
  { id: 'accounts', label: 'Accounts & P&L / खाता', icon: Landmark, roles: ['super_admin', 'owner', 'branch_manager', 'accountant'] },
  { id: 'crm', label: 'CRM & WhatsApp / ग्राहक', icon: Users },
  { id: 'staff', label: 'Staff & Attend. / हाजिरी', icon: UserCheck },
  { id: 'ai_brain', label: 'AI Brain / एआई मदद', icon: BrainCircuit },
  { id: 'reports', label: 'Reports / रिपोर्ट व टारगेट', icon: FileSpreadsheet, roles: ['super_admin', 'owner', 'branch_manager', 'accountant'] },
  { id: 'settings', label: 'Settings / सेटिंग्स', icon: Settings, roles: ['super_admin', 'owner'] },
  { id: 'super_admin', label: 'Super Admin / एडमिन', icon: Shield, roles: ['super_admin'] },
];

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, tenant, branches, activeBranchId, setActiveBranchId, activeSection, setActiveSection, theme, toggleTheme, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const allowedNav = NAV_ITEMS.filter((item) => !item.roles || (session && item.roles.includes(session.role)));
  const currentNav = allowedNav.find((n) => n.id === activeSection) || allowedNav[0];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#090B10] text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-slate-200 dark:border-white/10 bg-white dark:bg-[#0D1017] sticky top-0 h-screen">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/40 flex items-center justify-center text-sky-400 shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-bold truncate">{tenant?.name || 'TitanGrid ERP'}</div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
              {tenant?.is_demo ? 'DEMO DATA / डेमो डेटा' : 'LIVE / लाइव सिस्टम'}
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {allowedNav.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-white/10 space-y-2">
          <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-[#141923] border border-slate-200 dark:border-white/5">
            <div className="text-xs font-semibold truncate">{session?.fullName}</div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
              {session?.role.replace('_', ' ').toUpperCase()}
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out / लॉग आउट</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        {/* Top Bar (Clean 3-zone contract) */}
        <header className="sticky top-0 z-30 bg-white/90 dark:bg-[#0D1017]/90 backdrop-blur-md border-b border-slate-200 dark:border-white/10 px-4 md:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="font-display font-semibold truncate">{currentNav?.label}</span>
              <span className="hidden sm:inline text-slate-400">/</span>
              <span className="hidden sm:inline text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                {tenant?.gstin || tenant?.slug}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Branch Filter Selector */}
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5">
              <Building2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <select
                value={activeBranchId}
                onChange={(e) => setActiveBranchId(e.target.value)}
                className="bg-transparent text-xs font-medium focus:outline-none max-w-[190px] truncate"
              >
                <option value="all" className="bg-white dark:bg-[#11151E]">All Shops / सभी दुकानें ({branches.length})</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id} className="bg-white dark:bg-[#11151E]">
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>

            {tenant?.is_demo === 1 && (
              <span className="hidden md:inline-block text-[11px] font-mono text-amber-400 border border-amber-500/30 bg-amber-500/10 px-2 py-1 rounded">
                DEMO DATA / डेमो
              </span>
            )}

            <button
              onClick={toggleTheme}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#171C28] hover:border-sky-500/40 transition-colors"
              title="Toggle Dark / Light Theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>
          </div>
        </header>

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 md:p-6 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>

      {/* Mobile Bottom Thumb-Zone Navigation (<= 15% height, >=44px targets) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 dark:bg-[#0D1017]/95 backdrop-blur-md border-t border-slate-200 dark:border-white/10 grid grid-cols-5 items-center px-1">
        {[
          { id: 'dashboard' as NavSection, label: 'Home / होम', icon: LayoutDashboard },
          { id: 'pos' as NavSection, label: 'POS / बिल', icon: ShoppingCart },
          { id: 'inventory' as NavSection, label: 'Stock / स्टॉक', icon: Boxes },
          { id: 'staff' as NavSection, label: 'Attend / हाजिरी', icon: UserCheck },
          { id: 'crm' as NavSection, label: 'Dues / उधार', icon: Users },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                active ? 'text-sky-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Mobile Full Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex">
          <div className="w-72 bg-white dark:bg-[#0D1017] h-full p-4 flex flex-col border-r border-white/10">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-white/10">
              <span className="font-display font-bold">{tenant?.name}</span>
              <button onClick={() => setMobileMenuOpen(false)} className="min-w-[44px] min-h-[44px] flex items-center justify-center">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 py-3 space-y-1 overflow-y-auto">
              {allowedNav.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveSection(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full min-h-[44px] flex items-center gap-3 px-3 rounded-lg text-sm font-medium ${
                      activeSection === item.id ? 'bg-sky-500/15 text-sky-400' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={logout} className="min-h-[44px] flex items-center gap-2 px-3 text-sm text-red-400 font-medium">
              <LogOut className="w-4 h-4" />
              <span>Sign Out / लॉग आउट</span>
            </button>
          </div>
          <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}
    </div>
  );
};
