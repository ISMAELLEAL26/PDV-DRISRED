import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency, formatDateTime } from '@/lib/format';
import type { Product } from '@/lib/types';
import Button from '@/components/Button';
import { SearchInput, PageHeader, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import { RotateCcw, Trash2, Package } from 'lucide-react';

export default function DeletedProductsPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('products')
      .select('*, category:categories(*)')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    setProducts((data as Product[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q));
  }, [products, search]);

  const restore = async (p: Product) => {
    if (!confirm(`¿Restaurar el producto "${p.name}"? Volverá al catálogo activo.`)) return;
    setRestoring(p.id);
    const { error } = await supabase.from('products').update({ deleted_at: null, deleted_by: null, active: true }).eq('id', p.id);
    if (error) { console.error(error); setRestoring(null); return; }
    setRestoring(null);
    load();
  };

  const emptyTrash = async () => {
    if (products.length === 0 || emptying) return;
    const confirmed = confirm(`¿Vaciar toda la papelera? Se eliminarán definitivamente ${products.length} producto(s) y esta acción no se puede deshacer.`);
    if (!confirmed) return;
    setEmptying(true);
    setMessage(null);
    const { data: deletedCount, error } = await supabase.rpc('empty_deleted_products');
    if (error) {
      console.error('empty product trash failed', error);
      setMessage('No se pudo vaciar la papelera. Solo un administrador puede hacerlo.');
    } else {
      setProducts([]);
      setMessage(`${deletedCount ?? products.length} producto(s) eliminado(s) definitivamente.`);
    }
    setEmptying(false);
  };

  const permanentDelete = async (p: Product) => {
    if (!confirm(`¿ELIMINAR DEFINITIVAMENTE "${p.name}"? Esta acción no se puede deshacer.`)) return;
    setRestoring(p.id);
    const { error } = await supabase.from('products').delete().eq('id', p.id);
    if (error) { console.error(error); setRestoring(null); return; }
    setRestoring(null);
    load();
  };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader
        title="Papelera de Productos"
        subtitle={`${products.length} producto(s) eliminado(s) — restaura o elimina definitivamente`}
        actions={
          <Button variant="danger" onClick={emptyTrash} disabled={emptying || products.length === 0}>
            <Trash2 size={16} /> {emptying ? 'Vaciando...' : 'Vaciar papelera'}
          </Button>
        }
      />

      {message && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>}

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} className="sm:max-w-md" />
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState title="Papelera vacía" description="Los productos eliminados aparecerán aquí." icon={<Trash2 size={48} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3 text-right">Costo</th>
                  <th className="px-4 py-3 text-right">Precio</th>
                  <th className="px-4 py-3">Eliminado</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100">
                          <Package size={14} className="text-slate-400" />
                        </div>
                        <div>
                          <div className="font-medium text-slate-700">{p.name}</div>
                          <div className="text-xs text-slate-400">{p.department ?? '—'} · {p.unit}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.sku ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(p.cost_price)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-700">{formatCurrency(p.sale_price)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(p.deleted_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-2">
                        <Button variant="secondary" onClick={() => restore(p)} disabled={restoring === p.id}>
                          <RotateCcw size={14} /> Restaurar
                        </Button>
                        <Button variant="danger" onClick={() => permanentDelete(p)} disabled={restoring === p.id}>
                          <Trash2 size={14} /> Eliminar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
