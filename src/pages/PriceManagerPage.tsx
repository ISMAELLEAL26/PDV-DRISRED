import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency } from '@/lib/format';
import type { Product, Category } from '@/lib/types';
import Button from '@/components/Button';
import { Field, Input, Select } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import { Tags, Save, TrendingUp, ScanLine } from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';

export default function PriceManagerPage() {
  const { } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [edits, setEdits] = useState<Record<string, { cost_price: string; sale_price: string; price_2: string; price_3: string; tax_rate: string; ieps_rate: string }>>({});
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: pData }, { data: cData }] = await Promise.all([
      supabase.from('products').select('*, category:categories(*)').is('deleted_at', null).order('name'),
      supabase.from('categories').select('*').order('name'),
    ]);
    setProducts((pData as Product[]) ?? []);
    setCategories((cData as Category[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (filterCat && p.category_id !== filterCat) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q) || (p.barcode_2 ?? '').toLowerCase().includes(q);
    });
  }, [products, search, filterCat]);

  const getField = (p: Product, field: 'cost_price' | 'sale_price' | 'price_2' | 'price_3' | 'tax_rate' | 'ieps_rate'): string => {
    const edit = edits[p.id];
    if (edit && edit[field] != null) return edit[field];
    return String(p[field] ?? 0);
  };

  const setField = (p: Product, field: 'cost_price' | 'sale_price' | 'price_2' | 'price_3' | 'tax_rate' | 'ieps_rate', value: string) => {
    setEdits((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] ?? {}), [field]: value } }));
  };

  const margin = (p: Product): number => {
    const cost = parseFloat(getField(p, 'cost_price')) || 0;
    const sale = parseFloat(getField(p, 'sale_price')) || 0;
    const taxRate = parseFloat(getField(p, 'tax_rate')) || 0;
    const iepsRate = parseFloat(getField(p, 'ieps_rate')) || 0;
    if (cost <= 0) return 0;
    const totalTax = taxRate + iepsRate;
    const priceNoTax = totalTax > 0 ? sale / (1 + totalTax / 100) : sale;
    return ((priceNoTax - cost) / cost) * 100;
  };

  const dirtyCount = Object.keys(edits).filter((id) => {
    const p = products.find((x) => x.id === id);
    if (!p) return false;
    const e = edits[id];
    return String(e.cost_price) !== String(p.cost_price) ||
      String(e.sale_price) !== String(p.sale_price) ||
      String(e.price_2) !== String(p.price_2) ||
      String(e.price_3) !== String(p.price_3) ||
      String(e.tax_rate) !== String(p.tax_rate) ||
      String(e.ieps_rate) !== String(p.ieps_rate ?? 0);
  }).length;

  const saveAll = async () => {
    const toUpdate = filtered
      .filter((p) => edits[p.id])
      .map((p) => ({
        id: p.id,
        cost_price: parseFloat(getField(p, 'cost_price')) || 0,
        sale_price: parseFloat(getField(p, 'sale_price')) || 0,
        price_2: parseFloat(getField(p, 'price_2')) || 0,
        price_3: parseFloat(getField(p, 'price_3')) || 0,
        tax_rate: parseFloat(getField(p, 'tax_rate')) || 0,
        ieps_rate: parseFloat(getField(p, 'ieps_rate')) || 0,
      }));
    if (toUpdate.length === 0) { setSavedMsg('No hay cambios pendientes.'); return; }
    setSaving(true); setSavedMsg(null);
    let errors = 0;
    for (const u of toUpdate) {
      const { error } = await supabase.from('products').update({
        cost_price: u.cost_price,
        sale_price: u.sale_price,
        price_2: u.price_2,
        price_3: u.price_3,
        tax_rate: u.tax_rate,
        ieps_rate: u.ieps_rate,
      }).eq('id', u.id);
      if (error) { console.error(error); errors++; }
    }
    setSaving(false);
    setEdits({});
    if (errors === 0) setSavedMsg(`${toUpdate.length} producto(s) actualizado(s).`);
    else setSavedMsg(`${toUpdate.length - errors} guardado(s), ${errors} con error.`);
    load();
  };

  const applyGlobalMargin = (percentage: number) => {
    if (isNaN(percentage)) return;
    const newEdits: typeof edits = {};
    filtered.forEach((p) => {
      const cost = parseFloat(getField(p, 'cost_price')) || 0;
      const taxRate = parseFloat(getField(p, 'tax_rate')) || 0;
      const iepsRate = parseFloat(getField(p, 'ieps_rate')) || 0;
      const totalTax = taxRate + iepsRate;
      const priceNoTax = cost * (1 + percentage / 100);
      const newSale = totalTax > 0 ? priceNoTax * (1 + totalTax / 100) : priceNoTax;
      newEdits[p.id] = {
        ...(edits[p.id] ?? {}),
        cost_price: getField(p, 'cost_price'),
        sale_price: newSale.toFixed(2),
        price_2: getField(p, 'price_2'),
        price_3: getField(p, 'price_3'),
        tax_rate: getField(p, 'tax_rate'),
        ieps_rate: getField(p, 'ieps_rate'),
      };
    });
    setEdits((prev) => ({ ...prev, ...newEdits }));
  };

  const [globalMargin, setGlobalMargin] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader
        title="Administrador de Precios"
        subtitle="Actualiza costos, márgenes y precios de venta masivamente"
        actions={
          <div className="flex gap-2">
            {dirtyCount > 0 && <Badge variant="warning">{dirtyCount} cambio(s)</Badge>}
            <Button onClick={saveAll} disabled={saving}><Save size={16} /> {saving ? 'Guardando...' : 'Guardar cambios'}</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} className="flex-1" />
        <button type="button" onClick={() => setScannerOpen(true)} title="Escanear código con la cámara" className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-blue-50 hover:text-blue-700"><ScanLine size={16} /> Escanear</button>
        <Select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="sm:w-56">
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-emerald-600" />
          <Input
            type="number"
            step="1"
            className="w-28"
            value={globalMargin}
            onChange={(e) => setGlobalMargin(e.target.value)}
            placeholder="% margen"
          />
          <Button variant="secondary" onClick={() => applyGlobalMargin(parseFloat(globalMargin) || 0)}>Aplicar a todos</Button>
        </div>
      </div>

      {savedMsg && (
        <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{savedMsg}</div>
      )}

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState title="Sin productos" description="No hay productos para los filtros seleccionados." icon={<Tags size={48} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3 text-right">Costo</th>
                  <th className="px-4 py-3 text-right">Precio 1</th>
                  <th className="px-4 py-3 text-right">Precio 2</th>
                  <th className="px-4 py-3 text-right">Precio 3</th>
                  <th className="px-4 py-3 text-right">IVA %</th>
                  <th className="px-4 py-3 text-right">IEPS %</th>
                  <th className="px-4 py-3 text-right">Margen real</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const m = margin(p);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{p.name}</div>
                        <div className="text-xs text-slate-400">CB1: {p.barcode ?? '—'} · SKU: {p.sku ?? '—'}</div>
                      </td>
                      <td className="px-4 py-2">
                        <Input type="number" step="0.01" className="w-24 text-right" value={getField(p, 'cost_price')} onChange={(e) => setField(p, 'cost_price', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <Input type="number" step="0.01" className="w-24 text-right" value={getField(p, 'sale_price')} onChange={(e) => setField(p, 'sale_price', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <Input type="number" step="0.01" className="w-24 text-right" value={getField(p, 'price_2')} onChange={(e) => setField(p, 'price_2', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <Input type="number" step="0.01" className="w-24 text-right" value={getField(p, 'price_3')} onChange={(e) => setField(p, 'price_3', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <Input type="number" step="0.01" className="w-20 text-right" value={getField(p, 'tax_rate')} onChange={(e) => setField(p, 'tax_rate', e.target.value)} />
                      </td>
                      <td className="px-4 py-2">
                        <Input type="number" step="0.01" className="w-20 text-right" value={getField(p, 'ieps_rate')} onChange={(e) => setField(p, 'ieps_rate', e.target.value)} />
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${m > 0 ? 'text-emerald-600' : m < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                        {m.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetect={(code) => setSearch(code)}
        title="Escanear producto"
      />
    </div>
  );
}
