import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency, formatDateTime } from '@/lib/format';
import type { Sale } from '@/lib/types';
import { PageHeader, Card, EmptyState, Spinner, Badge, SearchInput } from '@/components/ui';
import { Select } from '@/components/Field';
import { Eye, Store, Search, RefreshCw } from 'lucide-react';
import Modal from '@/components/Modal';
import { sanitizeFilterValue } from '@/lib/search';

function paymentLabel(method: string): string {
  const labels: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', vale: 'Vale', cheque: 'Cheque', credito: 'Crédito', monedero_electronico: 'Monedero electrónico' };
  return labels[method] ?? method.replace(/_/g, ' ');
}

interface MonitorRegister {
  id: string;
  folio: string | null;
  opening_amount: number;
  opened_at: string;
  branch?: { name: string } | null;
  user?: { full_name: string; avatar_url: string | null } | null;
  cash_box?: { name: string } | null;
}

export default function QueriesPage() {
  const { branches, hasPermission } = useAuth();
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [results, setResults] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [viewItems, setViewItems] = useState<{ product_name: string; quantity: number; unit_price: number; line_total: number }[] | null>(null);
  const [view, setView] = useState<'sales' | 'cash'>('sales');
  const [openRegisters, setOpenRegisters] = useState<MonitorRegister[]>([]);
  const [monitorLoading, setMonitorLoading] = useState(false);

  const runQuery = useCallback(async () => {
    setLoading(true); setSearched(true);
    let query = supabase
      .from('sales')
      .select('*, customer:customers(*), branch:branches(*)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (branchFilter !== 'all') query = query.eq('branch_id', branchFilter);
    if (search.trim()) {
      const q = sanitizeFilterValue(search);
      if (q) query = query.or(`folio.ilike.%${q}%,customer.name.ilike.%${q}%`);
    }
    const { data } = await query;
    setResults((data as Sale[]) ?? []);
    setLoading(false);
  }, [search, branchFilter]);

  const loadMonitor = useCallback(async () => {
    setMonitorLoading(true);
    const { data, error } = await supabase
      .from('cash_registers')
      .select('id, folio, opening_amount, opened_at, branch:branches(name), user:profiles(full_name, avatar_url), cash_box:cash_boxes(name)')
      .eq('status', 'abierta')
      .order('opened_at', { ascending: false });
    if (error) console.error('cash monitor load failed', error);
    setOpenRegisters((data as unknown as MonitorRegister[]) ?? []);
    setMonitorLoading(false);
  }, []);

  useEffect(() => {
    if (view !== 'cash' || !hasPermission('queries')) return;
    loadMonitor();
    const timer = window.setInterval(loadMonitor, 15000);
    return () => window.clearInterval(timer);
  }, [view, hasPermission, loadMonitor]);

  const viewSale = async (saleId: string) => {
    const { data } = await supabase.from('sale_items').select('product_name, quantity, unit_price, line_total').eq('sale_id', saleId);
    setViewItems((data as { product_name: string; quantity: number; unit_price: number; line_total: number }[]) ?? []);
  };

  return (
    <div className="p-6">
      <PageHeader title="Consultas" subtitle="Ventas y monitoreo autorizado de cajas" />
      <div className="mb-4 flex gap-2">
        <button onClick={() => setView('sales')} className={`rounded-lg px-4 py-2 text-sm font-medium ${view === 'sales' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>Consultas de ventas</button>
        {hasPermission('queries') && <button onClick={() => setView('cash')} className={`rounded-lg px-4 py-2 text-sm font-medium ${view === 'cash' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>Monitoreo de cajas</button>}
      </div>

      {view === 'cash' ? (
        <Card>
          <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-slate-800">Cajas operando</h2><p className="text-sm text-slate-500">Actualización automática cada 15 segundos</p></div><button onClick={loadMonitor} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Actualizar cajas"><RefreshCw size={16} /></button></div>
          {monitorLoading ? <Spinner size={32} /> : openRegisters.length === 0 ? <EmptyState title="No hay cajas abiertas" description="Las cajas disponibles aparecerán aquí cuando inicien turno." icon={<Store size={48} />} /> : <div className="grid gap-3 md:grid-cols-2">{openRegisters.map((register) => <div key={register.id} className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4"><div className="flex items-center gap-3">{register.user?.avatar_url ? <img src={register.user.avatar_url} alt={register.user.full_name} className="h-10 w-10 rounded-full object-cover" /> : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 font-bold text-white">{(register.user?.full_name ?? 'C').slice(0, 1)}</div>}<div><div className="font-semibold text-slate-800">{register.cash_box?.name ?? 'Caja'}</div><div className="text-sm text-slate-600">{register.user?.full_name ?? 'Usuario'} · {register.branch?.name ?? 'Sucursal'}</div></div></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><span className="text-slate-500">Folio</span><div className="font-medium">{register.folio ?? '—'}</div></div><div><span className="text-slate-500">Fondo</span><div className="font-medium">{formatCurrency(Number(register.opening_amount))}</div></div></div></div>)}</div>}
        </Card>
      ) : (
      <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SearchInput value={search} onChange={setSearch} placeholder="Folio o nombre del cliente..." className="flex-1" />
        <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="sm:w-56">
          <option value="all">Todas las sucursales</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <button
          onClick={runQuery}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Search size={16} /> Buscar
        </button>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <Spinner size={32} />
        ) : results.length === 0 ? (
          <EmptyState
            title={searched ? "Sin resultados" : "Realiza una búsqueda"}
            description={searched ? "No se encontraron ventas con esos criterios." : "Busca por folio o cliente para ver las ventas."}
            icon={<Store size={48} />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Folio</th>
                  <th className="px-4 py-3">Sucursal</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Pago</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-700">{s.folio ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{s.branch?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(s.created_at)}</td>
                    <td className="px-4 py-3 text-slate-600">{s.customer?.name ?? 'General'}</td>
                    <td className="px-4 py-3"><Badge variant={s.payment_method === 'efectivo' ? 'success' : 'info'}>{paymentLabel(s.payment_method)}</Badge></td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800">{formatCurrency(s.total)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => viewSale(s.id)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"><Eye size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </>
      )}

      <Modal open={!!viewItems} onClose={() => setViewItems(null)} title="Detalle de venta" size="md">
        <div className="rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-2">Producto</th><th className="px-3 py-2 text-right">Cant.</th><th className="px-3 py-2 text-right">Precio</th><th className="px-3 py-2 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {viewItems?.map((it, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-slate-700">{it.product_name}</td>
                  <td className="px-3 py-2 text-right">{it.quantity}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(it.unit_price)}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatCurrency(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}
