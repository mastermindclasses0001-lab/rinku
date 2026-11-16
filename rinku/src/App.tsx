import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { Layout } from './components/Layout';
import { DashboardModule } from './modules/DashboardModule';
import { PosModule } from './modules/PosModule';
import { InventoryModule } from './modules/InventoryModule';
import { AccountsModule } from './modules/AccountsModule';
import { CrmWhatsappModule } from './modules/CrmWhatsappModule';
import { AttendanceStaffModule } from './modules/AttendanceStaffModule';
import { AiBrainModule } from './modules/AiBrainModule';
import { TargetsReportsModule } from './modules/TargetsReportsModule';
import { SettingsSuperAdminModule } from './modules/SettingsSuperAdminModule';

const ErpRouter: React.FC = () => {
  const { session, loading, activeSection } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090B10] text-slate-300 flex items-center justify-center text-sm font-mono">
        Loading TitanGrid Retail ERP Workspace...
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <Layout>
      {activeSection === 'dashboard' && <DashboardModule />}
      {activeSection === 'pos' && <PosModule />}
      {activeSection === 'inventory' && <InventoryModule />}
      {activeSection === 'accounts' && <AccountsModule />}
      {activeSection === 'crm' && <CrmWhatsappModule />}
      {activeSection === 'staff' && <AttendanceStaffModule />}
      {activeSection === 'ai_brain' && <AiBrainModule />}
      {activeSection === 'reports' && <TargetsReportsModule />}
      {activeSection === 'settings' && <SettingsSuperAdminModule mode="settings" />}
      {activeSection === 'super_admin' && <SettingsSuperAdminModule mode="super_admin" />}
    </Layout>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <ErpRouter />
    </AuthProvider>
  );
}
