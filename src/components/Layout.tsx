import { type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useDeviceMode } from '@/lib/deviceMode';
import {
  ShoppingCart, Package, Users, UserCog, Clock, BarChart3, TrendingUp,
  Wallet, ClipboardList, Settings, LogOut, Store, ChevronDown,
  ClipboardCheck, Smartphone, Monitor, Menu, Maximize, Minimize,
  ShieldCheck, History, Truck,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { PROGRAM_LOGO } from '@/lib/branding';
import { supabase } from '@/lib/supabase';

export type ModuleKey =
  | 'pos' | 'products' | 'customers' | 'users' | 'attendance'
  | 'reports' | 'advanced-stats' | 'cash' | 'purchases' | 'supplier-orders'
  | 'queries' | 'settings' | 'authorizations' | 'inventory-history' | 'suppliers';

interface NavItem {
  key: ModuleKey;
  label: string;
  icon: ReactNode;
  permission: string;
}

const navItems: NavItem[] = [
  { key: 'pos', label: 'Punto de Venta', icon: <ShoppingCart size={18} />, permission: 'sales' },
  { key: 'products', label: 'Productos', icon: <Package size={18} />, permission: 'products' },
  { key: 'customers', label: 'Clientes', icon: <Users size={18} />, permission: 'customers' },
  { key: 'purchases', label: 'Compras', icon: <ClipboardList size={18} />, permission: 'purchases' },
  { key: 'supplier-orders', label: 'Pedidos a Proveedor', icon: <ClipboardCheck size={18} />, permission: 'purchases' },
  { key: 'suppliers', label: 'Proveedores', icon: <Truck size={18} />, permission: 'purchases' },
  { key: 'cash', label: 'Arqueo de Cajas', icon: <Wallet size={18} />, permission: 'cash_balance' },
  { key: 'attendance', label: 'Asistencia', icon: <Clock size={18} />, permission: 'attendance' },
  { key: 'users', label: 'Usuarios y Roles', icon: <UserCog size={18} />, permission: 'settings' },
  { key: 'reports', label: 'Reportes', icon: <BarChart3 size={18} />, permission: 'reports' },
  { key: 'advanced-stats', label: 'Estadísticas Avanzadas', icon: <TrendingUp size={18} />, permission: 'queries' },
  { key: 'queries', label: 'Consultas', icon: <Store size={18} />, permission: 'queries' },
  { key: 'authorizations', label: 'Centro de Autorizaciones', icon: <ShieldCheck size={18} />, permission: 'settings' },
  { key: 'inventory-history', label: 'Historial de Inventarios', icon: <History size={18} />, permission: 'reports' },
  { key: 'settings', label: 'Configuración', icon: <Settings size={18} />, permission: 'settings' },
];

interface LayoutProps {
  active: ModuleKey;
  onNavigate: (k: ModuleKey) => void;
  children: ReactNode;
}

export default function Layout({ active, onNavigate, children }: LayoutProps) {
  const { user, profile, branches, currentBranch, setCurrentBranchId, signOut, hasPermission, canSwitchBranch } = useAuth();
  const { mode, isMobile, setMode } = useDeviceMode();
  const [branchOpen, setBranchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeBoxName, setActiveBoxName] = useState<string | null>(null);
  const [hasOpenTurn, setHasOpenTurn] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) { setActiveBoxName(null); setHasOpenTurn(false); return; }
    let cancelled = false;
    const channel = supabase
      .channel('layout-active-turn')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_registers', filter: `user_id=eq.${user.id}` }, () => { loadActiveTurn(); })
      .subscribe();
    async function loadActiveTurn() {
      const { data } = await supabase
        .from('cash_registers')
        .select('id, status, cash_box_id')
        .eq('user_id', user!.id)
        .eq('status', 'abierta')
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { id: string; status: string; cash_box_id: string | null } | null;
      const hasTurn = !!row;
      setHasOpenTurn(hasTurn);
      if (row?.cash_box_id) {
        const { data: box } = await supabase
          .from('cash_boxes')
          .select('name')
          .eq('id', row.cash_box_id)
          .maybeSingle();
        if (!cancelled) setActiveBoxName((box as { name: string } | null)?.name ?? null);
      } else {
        setActiveBoxName(null);
      }
    }
    loadActiveTurn();
    const onTurnChanged = () => loadActiveTurn();
    window.addEventListener('cash-turn-changed', onTurnChanged);
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.removeEventListener('cash-turn-changed', onTurnChanged);
    };
  }, [user]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setFullscreenError('El navegador bloqueó la pantalla completa. Usa el menú del navegador para activarla.');
    }
  };

  const initials = (profile?.full_name ?? '?')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] transform bg-white text-slate-700 shadow-xl transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          <img
            src={PROGRAM_LOGO}
            alt="DRISRED Operadora"
            className="h-11 max-w-[70%] object-contain"
          />
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Cerrar menú"
          >
            <ChevronDown size={20} className="rotate-90" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems.filter((item) => hasPermission(item.permission)).map((item) => (
            <button
              key={item.key}
              onClick={() => { onNavigate(item.key); setMobileOpen(false); }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition ${
                active === item.key
                  ? 'bg-blue-50 text-[#0b347d] shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-[#0b347d]'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <div className="mb-2 px-3 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">Versión: VERSION-LEAL-2601</div>
          <button
            onClick={() => signOut()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-[#0b347d] transition"
          >
            <LogOut size={18} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-[2px]"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setMobileOpen(true)}
              className="flex-shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              aria-label="Abrir menú"
            >
              <Menu size={20} />
            </button>
            <img
              src={PROGRAM_LOGO}
              alt="DRISRED Operadora"
              className="h-7 w-24 flex-shrink-0 object-contain lg:hidden"
            />
            {/* Branch selector */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => canSwitchBranch && !hasOpenTurn && setBranchOpen((o) => !o)}
                disabled={!canSwitchBranch || hasOpenTurn}
                title={hasOpenTurn ? 'Cierra tu turno (corte de caja) para cambiar de sucursal' : ''}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-medium text-slate-700 transition disabled:cursor-not-allowed disabled:opacity-60 hover:bg-slate-50"
              >
                <Store size={16} className="text-emerald-600" />
                <span className="max-w-[100px] truncate">{currentBranch?.name ?? 'Sucursal'}</span>
                {canSwitchBranch && !hasOpenTurn && <ChevronDown size={14} className="text-slate-400" />}
              </button>
              {canSwitchBranch && !hasOpenTurn && branchOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBranchOpen(false)} />
                  <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    {branches.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => { setCurrentBranchId(b.id); setBranchOpen(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm transition ${
                          b.id === currentBranch?.id
                            ? 'bg-emerald-50 text-emerald-700 font-medium'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Store size={14} />
                        {b.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* Active cash box label */}
            {hasPermission('sales') && (
              activeBoxName ? (
                <span className="hidden items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-sm sm:inline-flex">
                  <Wallet size={14} /> {isMobile ? activeBoxName : `CAJA: ${activeBoxName}`}
                </span>
              ) : (
                <span className="hidden items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 sm:inline-flex">
                  <Wallet size={14} /> Sin caja
                </span>
              )
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            {active === 'pos' && (
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Salir de pantalla completa (Esc)' : 'Mostrar punto de venta en pantalla completa'}
                aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Mostrar punto de venta en pantalla completa'}
                className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              >
                {isFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
              </button>
            )}
            {/* Device mode toggle */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                onClick={() => setMode('mobile')}
                title="Modo tableta/móvil"
                aria-label="Modo tableta/móvil"
                className={`rounded-md p-1.5 transition ${
                  mode === 'mobile' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Smartphone size={16} />
              </button>
              <button
                onClick={() => setMode('desktop')}
                title="Modo PC horizontal"
                aria-label="Modo PC horizontal"
                className={`rounded-md p-1.5 transition ${
                  mode === 'desktop' || (mode === 'auto' && !isMobile) ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Monitor size={16} />
              </button>
              <button
                onClick={() => setMode('vertical')}
                title="Modo PC vertical: publicidad abajo"
                aria-label="Modo PC vertical: publicidad abajo"
                className={`rounded-md p-1.5 transition ${
                  mode === 'vertical' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Monitor size={16} className="rotate-90" />
              </button>
            </div>
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-slate-700">{profile?.full_name}</div>
              <div className="text-xs text-slate-400">{profile?.role?.name ?? '—'}</div>
            </div>
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
              {initials}
            </div>
          </div>
        </header>
        {fullscreenError && active === 'pos' && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            <span>{fullscreenError}</span>
            <button onClick={() => setFullscreenError(null)} className="font-semibold hover:underline">Cerrar</button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
