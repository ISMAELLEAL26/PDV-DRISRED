import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { DeviceModeProvider } from '@/lib/deviceMode';
import Layout, { type ModuleKey } from '@/components/Layout';
import AuthPage from '@/pages/AuthPage';
import POSPage from '@/pages/POSPage';
import ProductsPage from '@/pages/ProductsPage';
import CustomersPage from '@/pages/CustomersPage';
import UsersPage from '@/pages/UsersPage';
import CashPage from '@/pages/CashPage';
import PurchasesPage from '@/pages/PurchasesPage';
import AttendancePage from '@/pages/AttendancePage';
import ReportsPage from '@/pages/ReportsPage';
import AdvancedStatsPage from '@/pages/AdvancedStatsPage';
import QueriesPage from '@/pages/QueriesPage';
import SettingsPage from '@/pages/SettingsPage';
import AuthorizationCenterPage from '@/pages/AuthorizationCenterPage';
import InventoryHistoryPage from '@/pages/InventoryHistoryPage';
import SuppliersPage from '@/pages/SuppliersPage';
import { Spinner } from '@/components/ui';
import { Store } from 'lucide-react';

const MODULE_PERMISSIONS: Record<ModuleKey, string> = {
  'pos': 'sales',
  'products': 'products',
  'customers': 'customers',
  'users': 'settings',
  'cash': 'cash_balance',
  'purchases': 'purchases',
  'supplier-orders': 'purchases',
  'attendance': 'attendance',
  'reports': 'reports',
  'advanced-stats': 'queries',
  'queries': 'queries',
  'authorizations': 'settings',
  'inventory-history': 'reports',
  'suppliers': 'purchases',
  'settings': 'settings',
};

const ACTIVE_TAB_KEY = 'pos_active_tab';

function AppContent() {
  const { session, profile, loading, signOut, branches, currentBranch, setCurrentBranchId, hasPermission, canSwitchBranch } = useAuth();
  const [active, setActive] = useState<ModuleKey>(() => {
    const saved = localStorage.getItem(ACTIVE_TAB_KEY) as ModuleKey | null;
    return saved ?? 'pos';
  });

  const handleNavigate = useCallback((tab: ModuleKey) => {
    setActive(tab);
    localStorage.setItem(ACTIVE_TAB_KEY, tab);
  }, []);

  useEffect(() => {
    const onAppNavigate = (e: Event) => {
      const tab = (e as CustomEvent<ModuleKey>).detail;
      if (tab) handleNavigate(tab);
    };
    window.addEventListener('app-navigate', onAppNavigate as EventListener);
    return () => window.removeEventListener('app-navigate', onAppNavigate as EventListener);
  }, [handleNavigate]);

  useEffect(() => {
    const requiredPerm = MODULE_PERMISSIONS[active];
    if (profile && requiredPerm && !hasPermission(requiredPerm)) {
      const fallback: ModuleKey = hasPermission('sales') ? 'pos' : (Object.keys(MODULE_PERMISSIONS).find((k) => hasPermission(MODULE_PERMISSIONS[k as ModuleKey])) as ModuleKey | undefined) ?? 'pos';
      setActive(fallback);
      localStorage.setItem(ACTIVE_TAB_KEY, fallback);
    }
  }, [active, profile, hasPermission]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Spinner size={40} />
      </div>
    );
  }

  if (!session) return <AuthPage />;

  if (profile && profile.active === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Cuenta pendiente de activación</h1>
          <p className="mb-6 text-sm text-slate-600">
            Tu cuenta está registrada, pero un administrador debe activarla antes de que puedas usar el sistema.
          </p>
          <button
            onClick={signOut}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
          >
            Salir
          </button>
        </div>
      </div>
    );
  }

  if (!currentBranch) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 text-center"><Store size={32} className="mx-auto mb-3 text-emerald-600" /><h1 className="text-xl font-bold text-slate-800">{canSwitchBranch ? 'Selecciona tu sucursal' : 'Sin sucursal autorizada'}</h1><p className="mt-1 text-sm text-slate-500">{canSwitchBranch ? 'Elige dónde vas a trabajar en este turno.' : 'El administrador debe asignarte una sucursal para poder trabajar.'}</p></div>
          {canSwitchBranch && <div className="space-y-2">{branches.map((branch) => <button key={branch.id} onClick={() => setCurrentBranchId(branch.id)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-emerald-400 hover:bg-emerald-50"><span className="font-medium text-slate-700">{branch.name}</span><span className="text-sm text-emerald-600">Entrar</span></button>)}</div>}
          {branches.length === 0 && <p className="text-center text-sm text-amber-700">No hay sucursales autorizadas disponibles.</p>}
          <button onClick={signOut} className="mt-6 w-full rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cerrar sesión</button>
        </div>
      </div>
    );
  }

  const pages: Record<ModuleKey, React.ReactNode> = {
    'pos': <POSPage />,
    'products': <ProductsPage />,
    'customers': <CustomersPage />,
    'users': <UsersPage />,
    'cash': <CashPage />,
    'purchases': <PurchasesPage initialTab="purchases" />,
    'supplier-orders': <PurchasesPage initialTab="orders" />,
    'attendance': <AttendancePage />,
    'reports': <ReportsPage />,
    'advanced-stats': <AdvancedStatsPage />,
    'queries': <QueriesPage />,
    'authorizations': <AuthorizationCenterPage />,
    'inventory-history': <InventoryHistoryPage />,
    'suppliers': <SuppliersPage />,
    'settings': <SettingsPage />,
  };

  return (
    <Layout active={active} onNavigate={handleNavigate}>
      {pages[active]}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DeviceModeProvider>
        <AppContent />
      </DeviceModeProvider>
    </AuthProvider>
  );
}
