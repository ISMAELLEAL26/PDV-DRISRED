import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Customer } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Textarea } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import { Users, Plus, Pencil, Trash2, Phone, Mail, MapPin } from 'lucide-react';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<Partial<Customer>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('customers').select('*').order('name');
    if (error) { console.error(error); }
    setCustomers((data as Customer[]) ?? []);

    const { data: sales } = await supabase.from('sales').select('customer_id, total');
    const t: Record<string, number> = {};
    (sales ?? []).forEach((s: { customer_id: string | null; total: number }) => {
      if (s.customer_id) t[s.customer_id] = (t[s.customer_id] ?? 0) + Number(s.total);
    });
    setTotals(t);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.phone ?? '').includes(q) ||
      (c.rfc ?? '').toLowerCase().includes(q)
    );
  }, [customers, search]);

  const openNew = () => { setEditing(null); setForm({}); setError(null); setOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm({ ...c }); setError(null); setOpen(true); };

  const save = async () => {
    setSaving(true); setError(null);
    if (!form.name?.trim()) { setError('El nombre es obligatorio'); setSaving(false); return; }
    const payload = {
      name: form.name.trim(),
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      rfc: form.rfc || null,
    };
    if (editing) {
      const { error: e } = await supabase.from('customers').update(payload).eq('id', editing.id);
      if (e) { console.error(e); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setSaving(false); return; }
    } else {
      const { error: e } = await supabase.from('customers').insert(payload);
      if (e) { console.error(e); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setSaving(false); return; }
    }
    setSaving(false); setOpen(false); load();
  };

  const remove = async (c: Customer) => {
    if (!confirm(`¿Eliminar al cliente "${c.name}"?`)) return;
    await supabase.from('customers').delete().eq('id', c.id);
    load();
  };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader
        title="Clientes"
        subtitle={`${customers.length} clientes registrados`}
        actions={<Button onClick={openNew}><Plus size={16} /> Nuevo cliente</Button>}
      />
      <div className="mb-4"><SearchInput value={search} onChange={setSearch} /></div>

      {filtered.length === 0 ? (
        <Card><EmptyState title="Sin clientes" description="Registra tu primer cliente." icon={<Users size={48} />} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">{c.name}</div>
                    {c.rfc && <div className="text-xs text-slate-400">RFC: {c.rfc}</div>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(c)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"><Pencil size={14} /></button>
                  <button onClick={() => remove(c)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-500">
                {c.phone && <div className="flex items-center gap-1.5"><Phone size={12} /> {c.phone}</div>}
                {c.email && <div className="flex items-center gap-1.5"><Mail size={12} /> {c.email}</div>}
                {c.address && <div className="flex items-center gap-1.5"><MapPin size={12} /> {c.address}</div>}
                <div className="pt-1 text-slate-400">Cliente desde {formatDate(c.created_at)}</div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-xs text-slate-500">Total comprado</span>
                <Badge variant="success">{formatCurrency(totals[c.id] ?? 0)}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar cliente' : 'Nuevo cliente'} size="md">
        <div className="space-y-4">
          <Field label="Nombre *"><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Teléfono"><Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="RFC"><Input value={form.rfc ?? ''} onChange={(e) => setForm({ ...form, rfc: e.target.value })} /></Field>
          </div>
          <Field label="Correo"><Input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Dirección"><Textarea rows={2} value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
