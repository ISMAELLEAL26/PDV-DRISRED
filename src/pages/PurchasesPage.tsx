import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency, formatDateTime, generateFolio } from '@/lib/format';
import type { Product, Purchase, PurchaseItem, Supplier, SupplierOrder, SupplierOrderItem } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Select } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import { ClipboardCheck, ClipboardList, Eye, Plus, Receipt, Trash2 } from 'lucide-react';
import { sendBusinessEmail } from '@/services/emailService';

type Tab = 'purchases' | 'orders';
type PurchaseUnit = 'pieza' | 'caja';
type TaxType = 'sin_impuesto' | 'iva_16' | 'ieps_8' | 'iva_16_ieps_8';
interface LineItem { product_id: string; product_name: string; purchase_unit: PurchaseUnit; box_count: string; pieces_per_box: string; piece_quantity: string; tax_type: TaxType; includes_tax: boolean; price_input: string; }

const blankLine = (): LineItem => ({ product_id: '', product_name: '', purchase_unit: 'pieza', box_count: '1', pieces_per_box: '1', piece_quantity: '1', tax_type: 'sin_impuesto', includes_tax: true, price_input: '0' });
const taxRate = (type: TaxType): number => ({ sin_impuesto: 0, iva_16: 16, ieps_8: 8, iva_16_ieps_8: 24 }[type]);
const taxLabel = (type: TaxType): string => ({ sin_impuesto: 'Sin impuesto', iva_16: 'IVA 16%', ieps_8: 'IEPS 8%', iva_16_ieps_8: 'IVA 16% + IEPS 8%' }[type]);

function calculateLine(line: LineItem) {
  const pieces = line.purchase_unit === 'caja' ? Math.max(0, Number(line.box_count) || 0) * Math.max(0, Number(line.pieces_per_box) || 0) : Math.max(0, Number(line.piece_quantity) || 0);
  const input = Math.max(0, Number(line.price_input) || 0);
  const rate = taxRate(line.tax_type) / 100;
  const after = line.includes_tax ? input : input * (1 + rate);
  const before = line.includes_tax && rate > 0 ? input / (1 + rate) : input;
  return { pieces, before, after, tax: after - before, beforeTotal: before * pieces, afterTotal: after * pieces, taxTotal: (after - before) * pieces };
}

export default function PurchasesPage({ initialTab = 'purchases' }: { initialTab?: Tab }) {
  const { user, currentBranch } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [viewItem, setViewItem] = useState<Purchase | SupplierOrder | null>(null);
  const [viewItems, setViewItems] = useState<PurchaseItem[] | SupplierOrderItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([blankLine()]);

  const load = useCallback(async () => {
    if (!currentBranch) return;
    setLoading(true);
    const [{ data: purchaseRows }, { data: orderRows }, { data: supplierRows }, { data: productRows }] = await Promise.all([
      supabase.from('purchases').select('*, supplier:suppliers(*)').eq('branch_id', currentBranch.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('supplier_orders').select('*, supplier:suppliers(*)').eq('branch_id', currentBranch.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('*').eq('active', true).order('name'),
    ]);
    setPurchases((purchaseRows as Purchase[]) ?? []); setOrders((orderRows as SupplierOrder[]) ?? []); setSuppliers((supplierRows as Supplier[]) ?? []); setProducts((productRows as Product[]) ?? []); setLoading(false);
  }, [currentBranch]);
  useEffect(() => { void load(); }, [load]);

  const filteredPurchases = useMemo(() => { const q = search.trim().toLowerCase(); return q ? purchases.filter((item) => `${item.folio ?? ''} ${item.supplier?.name ?? ''}`.toLowerCase().includes(q)) : purchases; }, [purchases, search]);
  const filteredOrders = useMemo(() => { const q = search.trim().toLowerCase(); return q ? orders.filter((item) => `${item.folio ?? ''} ${item.supplier?.name ?? ''}`.toLowerCase().includes(q)) : orders; }, [orders, search]);
  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId);
  const totals = lineItems.reduce((summary, line) => { const value = calculateLine(line); return { before: summary.before + value.beforeTotal, after: summary.after + value.afterTotal, tax: summary.tax + value.taxTotal }; }, { before: 0, after: 0, tax: 0 });

  const openNew = (type: Tab) => { setTab(type); setSupplierId(''); setLineItems([blankLine()]); setError(null); setOpen(true); };
  const addLine = () => setLineItems((previous) => [...previous, blankLine()]);
  const removeLine = (index: number) => setLineItems((previous) => previous.filter((_, current) => current !== index));
  const updateLine = (index: number, key: keyof LineItem, value: string | boolean) => setLineItems((previous) => previous.map((line, current) => {
    if (current !== index) return line;
    if (key === 'product_id' && typeof value === 'string') { const product = products.find((item) => item.id === value); return { ...line, product_id: value, product_name: product?.name ?? '', price_input: String(product?.cost_price ?? 0), tax_type: product?.tax_rate === 16 && product.ieps_rate === 8 ? 'iva_16_ieps_8' : product?.tax_rate === 16 ? 'iva_16' : product?.ieps_rate === 8 ? 'ieps_8' : 'sin_impuesto' }; }
    return { ...line, [key]: value };
  }));

  const save = async () => {
    if (!user || !currentBranch) return;
    if (!supplierId) { setError('Selecciona un proveedor.'); return; }
    if (lineItems.some((line) => !line.product_id || calculateLine(line).pieces <= 0)) { setError('Completa el producto y una cantidad válida en cada renglón.'); return; }
    setSaving(true); setError(null);
    const itemPayload = lineItems.map((line) => { const value = calculateLine(line); return { product_id: line.product_id, product_name: line.product_name, quantity: value.pieces, unit_cost: value.after, line_total: value.afterTotal, purchase_unit: line.purchase_unit, box_count: line.purchase_unit === 'caja' ? Number(line.box_count) : 0, pieces_per_box: line.purchase_unit === 'caja' ? Number(line.pieces_per_box) : 1, piece_quantity: value.pieces, tax_type: line.tax_type, includes_tax: line.includes_tax, unit_cost_before_tax: value.before, unit_cost_after_tax: value.after, line_subtotal_before_tax: value.beforeTotal, line_subtotal_after_tax: value.afterTotal, tax_amount: value.taxTotal }; });
    const folio = generateFolio(tab === 'purchases' ? 'C' : 'P');
    const common = { branch_id: currentBranch.id, supplier_id: supplierId, user_id: user.id, folio, subtotal_before_tax: totals.before, subtotal_after_tax: totals.after, tax_total: totals.tax, total: totals.after, status: tab === 'purchases' ? 'recibida' : 'pendiente' };
    if (tab === 'purchases') {
      const { data, error: purchaseError } = await supabase.from('purchases').insert(common).select().maybeSingle();
      if (purchaseError || !data) { console.error(purchaseError); setError('No se pudo guardar la compra.'); setSaving(false); return; }
      const { error: itemError } = await supabase.from('purchase_items').insert(itemPayload.map((item) => ({ ...item, purchase_id: data.id })));
      if (itemError) { console.error(itemError); setError('La compra se guardó, pero no se pudieron guardar sus productos.'); setSaving(false); return; }
      for (const item of itemPayload) { const { data: stock } = await supabase.from('product_stock').select('id, quantity').eq('product_id', item.product_id).eq('branch_id', currentBranch.id).maybeSingle(); if (stock) await supabase.from('product_stock').update({ quantity: Number(stock.quantity) + item.quantity }).eq('id', stock.id); else await supabase.from('product_stock').insert({ product_id: item.product_id, branch_id: currentBranch.id, quantity: item.quantity, min_stock: 0 }); }
    } else {
      const { data, error: orderError } = await supabase.from('supplier_orders').insert(common).select().maybeSingle();
      if (orderError || !data) { console.error(orderError); setError('No se pudo guardar el pedido.'); setSaving(false); return; }
      const { error: itemError } = await supabase.from('supplier_order_items').insert(itemPayload.map((item) => ({ ...item, supplier_order_id: data.id })));
      if (itemError) { console.error(itemError); setError('El pedido se guardó, pero no se pudieron guardar sus productos.'); setSaving(false); return; }
    }
    setSaving(false); setOpen(false); await load();
    sendBusinessEmail('PURCHASE_ORDER', { folio, branchName: currentBranch.name, supplierName: selectedSupplier?.name ?? '—', total: formatCurrency(totals.after), report: `${tab === 'purchases' ? 'Compra' : 'Pedido'} ${folio} a ${selectedSupplier?.name ?? '—'} por ${formatCurrency(totals.after)}` }).catch(() => {});
  };

  const view = async (item: Purchase | SupplierOrder, type: Tab) => { setViewItem(item); const { data } = type === 'purchases' ? await supabase.from('purchase_items').select('*').eq('purchase_id', item.id) : await supabase.from('supplier_order_items').select('*').eq('supplier_order_id', item.id); setViewItems((data as PurchaseItem[] | SupplierOrderItem[]) ?? []); };
  const updateOrderStatus = async (order: SupplierOrder, status: string) => { await supabase.from('supplier_orders').update({ status }).eq('id', order.id); await load(); };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;
  return <div className="p-6"><PageHeader title="Compras y Pedidos" subtitle="Órdenes por cajas o piezas con desglose de impuestos" /><div className="mb-4 flex flex-wrap gap-2"><button onClick={() => setTab('purchases')} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'purchases' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}><ClipboardList className="mr-2 inline" size={16} />Compras</button><button onClick={() => setTab('orders')} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'orders' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}><ClipboardCheck className="mr-2 inline" size={16} />Pedidos a Proveedor</button><div className="flex-1" /><Button onClick={() => openNew(tab)}><Plus size={16} /> {tab === 'purchases' ? 'Nueva compra' : 'Nuevo pedido'}</Button></div><div className="mb-4"><SearchInput value={search} onChange={setSearch} /></div>{tab === 'purchases' ? <PurchaseTable items={filteredPurchases} onView={(item) => void view(item, 'purchases')} /> : <OrderTable items={filteredOrders} onView={(item) => void view(item, 'orders')} onStatus={updateOrderStatus} />}
    <Modal open={open} onClose={() => setOpen(false)} title={tab === 'purchases' ? 'Nueva compra' : 'Nuevo pedido a proveedor'} size="xl"><div className="space-y-4"><Field label="Proveedor *"><Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Selecciona...</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.commercial_name || supplier.name}</option>)}</Select></Field>{selectedSupplier && <div className="grid grid-cols-2 gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm md:grid-cols-4"><div><span className="text-blue-600">Crédito</span><p className="font-semibold text-slate-700">{selectedSupplier.credit_enabled ? `${selectedSupplier.credit_term_days} días` : 'No'}</p></div><div><span className="text-blue-600">Límite</span><p className="font-semibold text-slate-700">{formatCurrency(selectedSupplier.credit_limit)}</p></div><div><span className="text-blue-600">Entrega</span><p className="font-semibold text-slate-700">{selectedSupplier.delivery_days || '—'}</p></div><div><span className="text-blue-600">Saldo actual</span><p className="font-semibold text-amber-700">{formatCurrency(selectedSupplier.balance_due)}</p></div></div>}<div className="flex items-center justify-between"><div><h3 className="font-semibold text-slate-800">Productos de la orden</h3><p className="text-xs text-slate-500">Captura cajas o piezas y define cómo se recibe el impuesto.</p></div><Button size="sm" variant="secondary" onClick={addLine}><Plus size={14} /> Agregar producto</Button></div><div className="space-y-3">{lineItems.map((line, index) => <PurchaseLine key={index} line={line} index={index} products={products} onChange={updateLine} onRemove={() => removeLine(index)} />)}</div><div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 text-sm md:grid-cols-4"><Summary label="Subtotal sin impuesto" value={totals.before} /><Summary label="Subtotal con impuesto" value={totals.after} /><Summary label="Impuestos cobrados" value={totals.tax} /><Summary label="Total general" value={totals.after} strong /></div>{error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Guardando...' : 'Guardar orden'}</Button></div></div></Modal>
    <Modal open={viewItem !== null} onClose={() => setViewItem(null)} title="Detalle de compra" size="xl">{viewItem && <div className="space-y-4"><div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4"><div><span className="text-slate-500">Folio</span><p className="font-semibold">{viewItem.folio || '—'}</p></div><div><span className="text-slate-500">Proveedor</span><p className="font-semibold">{viewItem.supplier?.name || '—'}</p></div><div><span className="text-slate-500">Fecha</span><p className="font-semibold">{formatDateTime(viewItem.created_at)}</p></div><div><span className="text-slate-500">Total</span><p className="font-bold text-emerald-600">{formatCurrency(viewItem.total)}</p></div></div><div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Producto</th><th className="px-3 py-2">Presentación</th><th className="px-3 py-2">Impuesto</th><th className="px-3 py-2 text-right">Sin impuesto</th><th className="px-3 py-2 text-right">Con impuesto</th></tr></thead><tbody className="divide-y divide-slate-100">{viewItems.map((item) => <tr key={item.id}><td className="px-3 py-2 font-medium">{item.product_name}</td><td className="px-3 py-2">{item.purchase_unit === 'caja' ? `${item.box_count} cajas × ${item.pieces_per_box}` : `${item.piece_quantity ?? item.quantity} piezas`}</td><td className="px-3 py-2">{taxLabel((item.tax_type as TaxType) || 'sin_impuesto')} · {item.includes_tax ? 'Incluido' : 'No incluido'}</td><td className="px-3 py-2 text-right">{formatCurrency(item.line_subtotal_before_tax ?? item.line_total)}</td><td className="px-3 py-2 text-right font-semibold">{formatCurrency(item.line_subtotal_after_tax ?? item.line_total)}</td></tr>)}</tbody></table></div></div>}</Modal>
  </div>;
}

function PurchaseLine({ line, index, products, onChange, onRemove }: { line: LineItem; index: number; products: Product[]; onChange: (index: number, key: keyof LineItem, value: string | boolean) => void; onRemove: () => void }) { const result = calculateLine(line); return <div className="rounded-xl border border-slate-200 p-3"><div className="grid grid-cols-1 gap-2 md:grid-cols-12"><Select value={line.product_id} onChange={(event) => onChange(index, 'product_id', event.target.value)} className="md:col-span-3"><option value="">Producto...</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Select><Select value={line.purchase_unit} onChange={(event) => onChange(index, 'purchase_unit', event.target.value)} className="md:col-span-2"><option value="pieza">Por pieza</option><option value="caja">Por caja</option></Select>{line.purchase_unit === 'caja' ? <><Input type="number" min="0" step="0.001" value={line.box_count} onChange={(event) => onChange(index, 'box_count', event.target.value)} placeholder="Cajas" className="md:col-span-1" /><Input type="number" min="1" step="0.001" value={line.pieces_per_box} onChange={(event) => onChange(index, 'pieces_per_box', event.target.value)} placeholder="Pzas/caja" className="md:col-span-2" /></> : <Input type="number" min="0" step="0.001" value={line.piece_quantity} onChange={(event) => onChange(index, 'piece_quantity', event.target.value)} placeholder="Piezas" className="md:col-span-2" />}<Select value={line.tax_type} onChange={(event) => onChange(index, 'tax_type', event.target.value)} className="md:col-span-2"><option value="sin_impuesto">Sin impuesto</option><option value="iva_16">IVA 16%</option><option value="ieps_8">IEPS 8%</option><option value="iva_16_ieps_8">IVA 16% + IEPS 8%</option></Select><Select value={line.includes_tax ? 'si' : 'no'} onChange={(event) => onChange(index, 'includes_tax', event.target.value === 'si')} className="md:col-span-2"><option value="si">Precio incluye impuesto</option><option value="no">Precio sin impuesto</option></Select><Input type="number" min="0" step="0.01" value={line.price_input} onChange={(event) => onChange(index, 'price_input', event.target.value)} placeholder={line.includes_tax ? 'Precio final' : 'Precio sin impuesto'} className="md:col-span-2" /><button onClick={onRemove} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 md:col-span-1" title="Quitar"><Trash2 size={16} /></button></div><div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500"><span>{result.pieces} piezas totales</span><span>Precio sin impuesto: <strong className="text-slate-700">{formatCurrency(result.before)}</strong></span><span>Precio con impuesto: <strong className="text-slate-700">{formatCurrency(result.after)}</strong></span><span>Subtotal sin impuesto: <strong className="text-slate-700">{formatCurrency(result.beforeTotal)}</strong></span><span>Subtotal con impuesto: <strong className="text-emerald-700">{formatCurrency(result.afterTotal)}</strong></span></div></div>; }
function Summary({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) { return <div><span className="text-slate-500">{label}</span><p className={strong ? 'text-lg font-bold text-emerald-700' : 'font-bold text-slate-800'}>{formatCurrency(value)}</p></div>; }
function PurchaseTable({ items, onView }: { items: Purchase[]; onView: (item: Purchase) => void }) { return <Card className="overflow-hidden">{items.length === 0 ? <EmptyState title="Sin compras" description="Registra tu primera compra a proveedor." icon={<ClipboardList size={48} />} /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Folio</th><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3">Fecha</th><th className="px-4 py-3 text-right">Sin impuesto</th><th className="px-4 py-3 text-right">Impuestos</th><th className="px-4 py-3 text-right">Total</th><th /></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id}><td className="px-4 py-3 font-medium">{item.folio || '—'}</td><td className="px-4 py-3">{item.supplier?.commercial_name || item.supplier?.name || '—'}</td><td className="px-4 py-3 text-slate-500">{formatDateTime(item.created_at)}</td><td className="px-4 py-3 text-right">{formatCurrency(item.subtotal_before_tax)}</td><td className="px-4 py-3 text-right">{formatCurrency(item.tax_total)}</td><td className="px-4 py-3 text-right font-bold">{formatCurrency(item.total)}</td><td className="px-4 py-3 text-right"><button onClick={() => onView(item)} className="rounded p-1.5 text-slate-400 hover:text-emerald-600"><Eye size={15} /></button></td></tr>)}</tbody></table></div>}</Card>; }
function OrderTable({ items, onView, onStatus }: { items: SupplierOrder[]; onView: (item: SupplierOrder) => void; onStatus: (item: SupplierOrder, status: string) => void }) { return <Card className="overflow-hidden">{items.length === 0 ? <EmptyState title="Sin pedidos" description="Crea tu primer pedido a proveedor." icon={<ClipboardCheck size={48} />} /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Folio</th><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3">Fecha</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3">Estado</th><th /></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id}><td className="px-4 py-3 font-medium">{item.folio || '—'}</td><td className="px-4 py-3">{item.supplier?.commercial_name || item.supplier?.name || '—'}</td><td className="px-4 py-3 text-slate-500">{formatDateTime(item.created_at)}</td><td className="px-4 py-3 text-right font-bold">{formatCurrency(item.total)}</td><td className="px-4 py-3"><Select value={item.status} onChange={(event) => onStatus(item, event.target.value)} className="w-32 py-1 text-xs"><option value="pendiente">Pendiente</option><option value="enviado">Enviado</option><option value="recibido">Recibido</option><option value="cancelado">Cancelado</option></Select></td><td className="px-4 py-3 text-right"><button onClick={() => onView(item)} className="rounded p-1.5 text-slate-400 hover:text-emerald-600"><Eye size={15} /></button></td></tr>)}</tbody></table></div>}</Card>; }
