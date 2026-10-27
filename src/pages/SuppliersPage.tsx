import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Purchase, Supplier } from '@/lib/types';
import { PROGRAM_LOGO } from '@/lib/branding';
import { formatCurrency, formatDateTime } from '@/lib/format';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Textarea, Select } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner } from '@/components/ui';
import { Pencil, Plus, Receipt, Route, Truck, Trash2 } from 'lucide-react';

type FormState = {
  name: string;
  legal_name: string;
  commercial_name: string;
  contact_name: string;
  phone: string;
  phone_secondary: string;
  email: string;
  address: string;
  rfc: string;
  visit_days: string;
  delivery_days: string;
  distribution_route: string;
  credit_enabled: boolean;
  credit_limit: number;
  credit_term_days: number;
  balance_due: string;
};

const blankForm = (): FormState => ({
  name: '', legal_name: '', commercial_name: '', contact_name: '', phone: '', phone_secondary: '', email: '', address: '', rfc: '',
  visit_days: '', delivery_days: '', distribution_route: '', credit_enabled: false, credit_limit: 0, credit_term_days: 0, balance_due: '0',
});

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState>(blankForm());
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: supplierRows }, { data: purchaseRows }] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('purchases').select('*, supplier:suppliers(*)').order('created_at', { ascending: false }).limit(500),
    ]);
    setSuppliers((supplierRows as Supplier[]) ?? []);
    setPurchases((purchaseRows as Purchase[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return suppliers;
    return suppliers.filter((supplier) => [supplier.name, supplier.legal_name, supplier.commercial_name, supplier.rfc, supplier.phone].some((value) => (value ?? '').toLowerCase().includes(query)));
  }, [search, suppliers]);

  const openNew = () => { setEditing(null); setForm(blankForm()); setError(null); setFormOpen(true); };
  const openEdit = (supplier: Supplier) => {
    setEditing(supplier);
    setForm({
      name: supplier.name,
      legal_name: supplier.legal_name ?? '',
      commercial_name: supplier.commercial_name ?? '',
      contact_name: supplier.contact_name ?? '',
      phone: supplier.phone ?? '',
      phone_secondary: supplier.phone_secondary ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      rfc: supplier.rfc ?? '',
      visit_days: supplier.visit_days ?? '',
      delivery_days: supplier.delivery_days ?? '',
      distribution_route: supplier.distribution_route ?? '',
      credit_enabled: supplier.credit_enabled,
      credit_limit: Number(supplier.credit_limit ?? 0),
      credit_term_days: Number(supplier.credit_term_days ?? 0),
      balance_due: String(supplier.balance_due ?? 0),
    });
    setError(null);
    setFormOpen(true);
  };
  const setValue = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((previous) => ({ ...previous, [key]: value }));

  const save = async () => {
    if (!form.name.trim()) { setError('El nombre comercial es obligatorio.'); return; }
    setSaving(true); setError(null);
    const payload = {
      name: form.name.trim(), legal_name: form.legal_name.trim() || null, commercial_name: form.commercial_name.trim() || form.name.trim(),
      contact_name: form.contact_name.trim() || null, phone: form.phone.trim() || null, phone_secondary: form.phone_secondary.trim() || null,
      email: form.email.trim() || null, address: form.address.trim() || null, rfc: form.rfc.trim().toUpperCase() || null,
      visit_days: form.visit_days.trim() || null, delivery_days: form.delivery_days.trim() || null, distribution_route: form.distribution_route.trim() || null,
      credit_enabled: form.credit_enabled, credit_limit: Math.max(0, Number(form.credit_limit) || 0), credit_term_days: Math.max(0, Number(form.credit_term_days) || 0),
      balance_due: Math.max(0, Number(form.balance_due) || 0),
    };
    const result = editing ? await supabase.from('suppliers').update(payload).eq('id', editing.id) : await supabase.from('suppliers').insert(payload);
    if (result.error) { console.error(result.error); setError('No se pudo guardar el proveedor.'); setSaving(false); return; }
    setSaving(false); setEditing(null); setFormOpen(false); await load();
  };

  const remove = async (supplier: Supplier) => {
    if (!window.confirm(`¿Eliminar a ${supplier.name}?`)) return;
    const { error: removeError } = await supabase.from('suppliers').delete().eq('id', supplier.id);
    if (removeError) { setError('No se puede eliminar un proveedor que tiene productos o compras relacionados.'); return; }
    await load();
  };

  const supplierPurchases = selected ? purchases.filter((purchase) => purchase.supplier_id === selected.id) : [];

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader title="Módulo de Proveedores" subtitle="Catálogo, condiciones comerciales e historial de compras" actions={<Button onClick={openNew}><Plus size={16} /> Nuevo proveedor</Button>} />
      <div className="mb-4"><SearchInput value={search} onChange={setSearch} /></div>
      {filtered.length === 0 ? <Card><EmptyState title="Sin proveedores" description="Registra proveedores para usarlos en tus órdenes de compra." icon={<Truck size={48} />} /></Card> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filtered.map((supplier) => (
            <Card key={supplier.id} className="overflow-hidden transition hover:shadow-md">
              <div className="flex items-start justify-between border-b border-slate-100 p-5">
                <div className="flex min-w-0 items-start gap-3"><img src={PROGRAM_LOGO} alt="Logotipo de la tienda" className="h-10 w-20 object-contain" /><div className="min-w-0"><h2 className="truncate text-base font-bold text-slate-800">{supplier.commercial_name || supplier.name}</h2><p className="truncate text-sm text-slate-500">{supplier.legal_name || 'Sin razón social'} · RFC {supplier.rfc || '—'}</p></div></div>
                <div className="flex gap-1"><button onClick={() => setSelected(supplier)} className="rounded-lg p-2 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="Ver historial"><Receipt size={16} /></button><button onClick={() => openEdit(supplier)} className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" title="Editar"><Pencil size={16} /></button><button onClick={() => void remove(supplier)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Eliminar"><Trash2 size={16} /></button></div>
              </div>
              <div className="grid grid-cols-2 gap-3 p-5 text-sm"><div><span className="text-slate-400">Contacto</span><p className="font-medium text-slate-700">{supplier.contact_name || '—'}</p></div><div><span className="text-slate-400">Teléfonos</span><p className="font-medium text-slate-700">{[supplier.phone, supplier.phone_secondary].filter(Boolean).join(' / ') || '—'}</p></div><div><span className="text-slate-400">Entrega</span><p className="font-medium text-slate-700">{supplier.delivery_days || '—'}</p></div><div><span className="text-slate-400">Ruta</span><p className="flex items-center gap-1 font-medium text-slate-700"><Route size={14} />{supplier.distribution_route || '—'}</p></div></div>
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-3"><div><span className="text-xs text-slate-500">Crédito</span><p className="font-semibold text-slate-700">{supplier.credit_enabled ? `${supplier.credit_term_days} días · ${formatCurrency(supplier.credit_limit)}` : 'No maneja crédito'}</p></div><div className="text-right"><span className="text-xs text-slate-500">Saldo pendiente</span><p className={`font-bold ${Number(supplier.balance_due) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{formatCurrency(supplier.balance_due)}</p></div></div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Editar proveedor' : 'Nuevo proveedor'} size="lg">
        <SupplierForm form={form} setValue={setValue} error={error} saving={saving} onCancel={() => setFormOpen(false)} onSave={() => void save()} />
      </Modal>
      <Modal open={selected !== null} onClose={() => setSelected(null)} title="Historial del proveedor" size="lg">
        {selected && <div className="space-y-4"><div className="flex items-center gap-3 border-b border-slate-100 pb-4"><img src={PROGRAM_LOGO} alt="Logotipo de la tienda" className="h-10 w-20 object-contain" /><div><h2 className="font-bold text-slate-800">{selected.commercial_name || selected.name}</h2><p className="text-sm text-slate-500">{selected.address || 'Domicilio no registrado'}</p></div></div><div className="grid grid-cols-3 gap-3"><div className="rounded-lg bg-slate-50 p-3 text-center"><p className="text-xs text-slate-500">Compras</p><p className="text-lg font-bold text-slate-800">{supplierPurchases.length}</p></div><div className="rounded-lg bg-slate-50 p-3 text-center"><p className="text-xs text-slate-500">Acumulado</p><p className="text-lg font-bold text-slate-800">{formatCurrency(supplierPurchases.reduce((sum, item) => sum + Number(item.total), 0))}</p></div><div className="rounded-lg bg-amber-50 p-3 text-center"><p className="text-xs text-amber-700">Saldo</p><p className="text-lg font-bold text-amber-700">{formatCurrency(selected.balance_due)}</p></div></div>{supplierPurchases.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Todavía no hay compras registradas.</p> : <div className="overflow-hidden rounded-lg border border-slate-200"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Folio</th><th className="px-3 py-2">Fecha</th><th className="px-3 py-2 text-right">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{supplierPurchases.map((purchase) => <tr key={purchase.id}><td className="px-3 py-2 font-medium">{purchase.folio || '—'}</td><td className="px-3 py-2 text-slate-500">{formatDateTime(purchase.created_at)}</td><td className="px-3 py-2 text-right font-semibold">{formatCurrency(purchase.total)}</td></tr>)}</tbody></table></div>}</div>}
      </Modal>
    </div>
  );
}

function SupplierForm({ form, setValue, error, saving, onCancel, onSave }: { form: FormState; setValue: <K extends keyof FormState>(key: K, value: FormState[K]) => void; error: string | null; saving: boolean; onCancel: () => void; onSave: () => void }) {
  return <div className="space-y-4"><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Field label="Nombre comercial *"><Input value={form.name} onChange={(e) => setValue('name', e.target.value)} /></Field><Field label="Razón social"><Input value={form.legal_name} onChange={(e) => setValue('legal_name', e.target.value)} /></Field><Field label="RFC"><Input value={form.rfc} onChange={(e) => setValue('rfc', e.target.value)} /></Field><Field label="Persona de contacto"><Input value={form.contact_name} onChange={(e) => setValue('contact_name', e.target.value)} /></Field></div><Field label="Domicilio completo"><Textarea rows={2} value={form.address} onChange={(e) => setValue('address', e.target.value)} /></Field><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Field label="Teléfono principal"><Input value={form.phone} onChange={(e) => setValue('phone', e.target.value)} /></Field><Field label="Teléfono secundario"><Input value={form.phone_secondary} onChange={(e) => setValue('phone_secondary', e.target.value)} /></Field><Field label="Días de visita de preventa"><Input value={form.visit_days} onChange={(e) => setValue('visit_days', e.target.value)} placeholder="Lunes y jueves" /></Field><Field label="Días de entrega"><Input value={form.delivery_days} onChange={(e) => setValue('delivery_days', e.target.value)} placeholder="Martes y viernes" /></Field></div><Field label="Ruta de distribución o reparto"><Input value={form.distribution_route} onChange={(e) => setValue('distribution_route', e.target.value)} /></Field><div className="rounded-xl border border-slate-200 p-4"><div className="mb-3 flex items-center justify-between"><div><p className="font-semibold text-slate-800">Condiciones comerciales</p><p className="text-xs text-slate-500">Estos datos aparecerán al preparar una orden.</p></div><Select value={form.credit_enabled ? 'si' : 'no'} onChange={(e) => setValue('credit_enabled', e.target.value === 'si')}><option value="no">No maneja crédito</option><option value="si">Sí maneja crédito</option></Select></div>{form.credit_enabled && <div className="grid grid-cols-2 gap-4"><Field label="Límite de crédito"><Input type="number" min="0" step="0.01" value={String(form.credit_limit)} onChange={(e) => setValue('credit_limit', Number(e.target.value))} /></Field><Field label="Plazo en días"><Input type="number" min="0" value={String(form.credit_term_days)} onChange={(e) => setValue('credit_term_days', Number(e.target.value))} /></Field></div>}<Field label="Saldo pendiente actual"><Input type="number" min="0" step="0.01" value={form.balance_due} onChange={(e) => setValue('balance_due', e.target.value)} /></Field></div>{error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onCancel}>Cancelar</Button><Button onClick={onSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar proveedor'}</Button></div></div>;
}
