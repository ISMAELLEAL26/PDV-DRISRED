import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency, startOfMonthISO, todayISO } from '@/lib/format';
import { PageHeader, Card, Spinner, StatCard, Badge } from '@/components/ui';
import { Input, Select } from '@/components/Field';
import { TrendingUp, Package, Award, Store, BarChart3, AlertTriangle } from 'lucide-react';

interface BranchSale {
  branch_id: string;
  branch_name: string;
  total: number;
  count: number;
}

interface ProductTop {
  product_name: string;
  qty: number;
  total: number;
}

export default function AdvancedStatsPage() {
  const { branches } = useAuth();
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [branchSales, setBranchSales] = useState<BranchSale[]>([]);
  const [topProducts, setTopProducts] = useState<ProductTop[]>([]);
  const [lowStock, setLowStock] = useState<{ name: string; quantity: number; min_stock: number; branch: string }[]>([]);
  const [salesByDay, setSalesByDay] = useState<{ day: string; total: number }[]>([]);
  const [paymentBreakdown, setPaymentBreakdown] = useState<{ method: string; total: number; count: number }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const start = `${from}T00:00:00`;
    const end = `${to}T23:59:59`;

    const { data: sales } = await supabase
      .from('sales')
      .select('total, payment_method, branch_id, created_at')
      .eq('status', 'completada')
      .gte('created_at', start)
      .lte('created_at', end);

    const salesRows = (sales as { total: number; payment_method: string; branch_id: string; created_at: string }[]) ?? [];

    // By branch
    const byBranch = new Map<string, BranchSale>();
    salesRows.forEach((s) => {
      const existing = byBranch.get(s.branch_id) ?? { branch_id: s.branch_id, branch_name: 'Sucursal', total: 0, count: 0 };
      existing.total += Number(s.total);
      existing.count += 1;
      byBranch.set(s.branch_id, existing);
    });
    const branchList = Array.from(byBranch.values());
    branchList.forEach((b) => {
      const found = branches.find((br) => br.id === b.branch_id);
      b.branch_name = found?.name ?? 'Sucursal';
    });
    branchList.sort((a, b) => b.total - a.total);
    setBranchSales(branchList);

    // Top products
    const { data: items } = await supabase
      .from('sale_items')
      .select('product_name, quantity, line_total, sale_id')
      .gte('created_at', start) // sale_items may not have created_at; fallback below
      .lte('created_at', end);
    let itemRows = (items as { product_name: string; quantity: number; line_total: number; sale_id: string }[]) ?? [];
    if (!items) {
      // fallback: join via sales ids
      const saleIds = salesRows.map((s) => (s as { id?: string }).id).filter(Boolean) as string[];
      if (saleIds.length > 0) {
        const { data: items2 } = await supabase.from('sale_items').select('product_name, quantity, line_total, sale_id').in('sale_id', saleIds);
        itemRows = (items2 as { product_name: string; quantity: number; line_total: number; sale_id: string }[]) ?? [];
      }
    }
    const prodMap = new Map<string, ProductTop>();
    itemRows.forEach((it) => {
      const existing = prodMap.get(it.product_name) ?? { product_name: it.product_name, qty: 0, total: 0 };
      existing.qty += Number(it.quantity);
      existing.total += Number(it.line_total);
      prodMap.set(it.product_name, existing);
    });
    setTopProducts(Array.from(prodMap.values()).sort((a, b) => b.total - a.total).slice(0, 10));

    // Low stock
    const { data: stock } = await supabase
      .from('product_stock')
      .select('quantity, min_stock, product_id, branch_id')
      .lte('quantity', 5);
    const { data: prods } = await supabase.from('products').select('id, name');
    const prodNames = new Map<string, string>();
    (prods as { id: string; name: string }[] ?? []).forEach((p) => prodNames.set(p.id, p.name));
    const lowList = ((stock as { quantity: number; min_stock: number; product_id: string; branch_id: string }[]) ?? [])
      .map((s) => ({
        name: prodNames.get(s.product_id) ?? 'Producto',
        quantity: Number(s.quantity),
        min_stock: Number(s.min_stock),
        branch: branches.find((b) => b.id === s.branch_id)?.name ?? 'Sucursal',
      }))
      .sort((a, b) => a.quantity - b.quantity)
      .slice(0, 15);
    setLowStock(lowList);

    // Sales by day
    const byDay = new Map<string, number>();
    salesRows.forEach((s) => {
      const day = s.created_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + Number(s.total));
    });
    const dayList = Array.from(byDay.entries()).map(([day, total]) => ({ day, total })).sort((a, b) => a.day.localeCompare(b.day));
    setSalesByDay(dayList);

    // Payment breakdown
    const byPay = new Map<string, { method: string; total: number; count: number }>();
    salesRows.forEach((s) => {
      const existing = byPay.get(s.payment_method) ?? { method: s.payment_method, total: 0, count: 0 };
      existing.total += Number(s.total);
      existing.count += 1;
      byPay.set(s.payment_method, existing);
    });
    setPaymentBreakdown(Array.from(byPay.values()));

    setLoading(false);
  }, [from, to, branches]);

  useEffect(() => { load(); }, [load]);

  const maxDayTotal = useMemo(() => Math.max(1, ...salesByDay.map((d) => d.total)), [salesByDay]);
  const grandTotal = branchSales.reduce((s, b) => s + b.total, 0);
  const grandCount = branchSales.reduce((s, b) => s + b.count, 0);

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader title="Estadísticas Avanzadas" subtitle="Análisis comparativo entre sucursales" />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Desde</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Hasta</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ventas totales" value={formatCurrency(grandTotal)} icon={<TrendingUp size={18} />} accent="emerald" />
        <StatCard label="Transacciones" value={String(grandCount)} icon={<BarChart3 size={18} />} accent="blue" />
        <StatCard label="Ticket promedio" value={formatCurrency(grandCount > 0 ? grandTotal / grandCount : 0)} icon={<Award size={18} />} accent="violet" />
        <StatCard label="Sucursales activas" value={String(branchSales.length)} icon={<Store size={18} />} accent="amber" />
      </div>

      {/* Branch comparison */}
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Comparativa por sucursal</h3>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {branchSales.map((b) => {
          const pct = grandTotal > 0 ? (b.total / grandTotal) * 100 : 0;
          return (
            <Card key={b.branch_id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-800">{b.branch_name}</div>
                <Badge variant="info">{b.count} ventas</Badge>
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-600">{formatCurrency(b.total)}</div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-xs text-slate-400">{pct.toFixed(1)}% del total</div>
            </Card>
          );
        })}
        {branchSales.length === 0 && <Card className="p-6 text-center text-sm text-slate-400">Sin datos en el periodo</Card>}
      </div>

      {/* Sales by day chart */}
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Ventas por día</h3>
      <Card className="mb-6 p-4">
        {salesByDay.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">Sin datos</div>
        ) : (
          <div className="space-y-2">
            {salesByDay.map((d) => (
              <div key={d.day} className="flex items-center gap-3">
                <div className="w-24 text-xs text-slate-500">{d.day}</div>
                <div className="flex-1 h-6 rounded bg-slate-100 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 flex items-center justify-end px-2" style={{ width: `${(d.total / maxDayTotal) * 100}%` }}>
                    <span className="text-[10px] font-semibold text-white">{formatCurrency(d.total)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Top products */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Top 10 productos</h3>
          <Card className="overflow-hidden">
            {topProducts.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">Sin datos</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {topProducts.map((p, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                      <div>
                        <div className="text-sm font-medium text-slate-700">{p.product_name}</div>
                        <div className="text-xs text-slate-400">{p.qty} unidades</div>
                      </div>
                    </div>
                    <div className="text-sm font-bold text-slate-800">{formatCurrency(p.total)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Low stock */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Inventario bajo</h3>
          <Card className="overflow-hidden">
            {lowStock.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">Todo el inventario está bien</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {lowStock.map((p, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <AlertTriangle size={16} className={p.quantity <= 0 ? 'text-red-500' : 'text-amber-500'} />
                      <div>
                        <div className="text-sm font-medium text-slate-700">{p.name}</div>
                        <div className="text-xs text-slate-400">{p.branch}</div>
                      </div>
                    </div>
                    <Badge variant={p.quantity <= 0 ? 'danger' : 'warning'}>{p.quantity} unidades</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Payment breakdown */}
      <h3 className="mb-3 mt-6 text-sm font-semibold text-slate-700">Métodos de pago</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {paymentBreakdown.map((p) => (
          <StatCard key={p.method} label={p.method.charAt(0).toUpperCase() + p.method.slice(1)} value={formatCurrency(p.total)} icon={<Package size={18} />} accent="emerald" hint={`${p.count} transacciones`} />
        ))}
        {paymentBreakdown.length === 0 && <Card className="p-6 text-center text-sm text-slate-400">Sin datos</Card>}
      </div>
    </div>
  );
}
