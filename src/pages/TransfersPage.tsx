import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { Product, Branch, Transfer, TransferItem } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Select, Textarea } from '@/components/Field';
import { PageHeader, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import { generateFolio } from '@/lib/format';
import { ArrowLeftRight, Plus, Trash2, Send, CheckCheck } from 'lucide-react';

export default function TransfersPage() {
  const { branches, currentBranch, user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [destBranch, setDestBranch] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ product_id: string; quantity: string }[]>([{ product_id: '', quantity: '' }]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: pData }, { data: tData }] = await Promise.all([
      supabase.from('products').select('*').is('deleted_at', null).order('name'),
      supabase.from('transfers').select('*, origin_branch:branches!origin_branch_id(*), destination_branch:branches!destination_branch_id(*), transfer_items(*, product:products(*))').order('created_at', { ascending: false }).limit(100),
    ]);
    setProducts((pData as Product[]) ?? []);
    setTransfers((tData as Transfer[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const addItem = () => setItems([...items, { product_id: '', quantity: '' }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: 'product_id' | 'quantity', value: string) => {
    setItems(items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const createTransfer = async () => {
    if (!currentBranch || !destBranch) { setError('Selecciona la sucursal destino'); return; }
    if (destBranch === currentBranch.id) { setError('La sucursal destino debe ser distinta a la origen'); return; }
    const validItems = items.filter((it) => it.product_id && parseFloat(it.quantity) > 0);
    if (validItems.length === 0) { setError('Agrega al menos un producto con cantidad válida'); return; }
    setSaving(true); setError(null);
    const folio = generateFolio('TR');
    const { data, error: tErr } = await supabase.from('transfers').insert({
      folio,
      origin_branch_id: currentBranch.id,
      destination_branch_id: destBranch,
      status: 'pendiente',
      user_id: user?.id ?? null,
      notes: notes || null,
    }).select().single();
    if (tErr) { console.error(tErr); setError('No se pudo crear el traspaso.'); setSaving(false); return; }
    const transferId = (data as Transfer).id;
    const itemRows = validItems.map((it) => ({
      transfer_id: transferId,
      product_id: it.product_id,
      quantity: parseFloat(it.quantity),
    }));
    const { error: iErr } = await supabase.from('transfer_items').insert(itemRows);
    if (iErr) { console.error(iErr); setError('El traspaso se creó pero no se pudieron guardar los productos.'); setSaving(false); return; }
    // Decrement stock at origin
    for (const it of validItems) {
      const { data: stock } = await supabase.from('product_stock').select('*').eq('product_id', it.product_id).eq('branch_id', currentBranch.id).maybeSingle();
      const s = stock as { id: string; quantity: number } | null;
      if (s) {
        await supabase.from('product_stock').update({ quantity: Math.max(0, Number(s.quantity) - parseFloat(it.quantity)) }).eq('id', s.id);
      }
    }
    setSaving(false);
    setOpen(false);
    setDestBranch(''); setNotes(''); setItems([{ product_id: '', quantity: '' }]);
    load();
  };

  const receiveTransfer = async (t: Transfer) => {
    if (!confirm(`¿Confirmas recepción del traspaso ${t.folio ?? ''}? Se sumará el stock a tu sucursal.`)) return;
    if (!currentBranch) return;
    setSaving(true); setError(null);
    for (const item of t.transfer_items ?? []) {
      const { data: stock } = await supabase.from('product_stock').select('*').eq('product_id', item.product_id).eq('branch_id', currentBranch.id).maybeSingle();
      const s = stock as { id: string; quantity: number } | null;
      if (s) {
        await supabase.from('product_stock').update({ quantity: Number(s.quantity) + Number(item.quantity) }).eq('id', s.id);
      } else {
        await supabase.from('product_stock').insert({ product_id: item.product_id, branch_id: currentBranch.id, quantity: Number(item.quantity), min_stock: 0 });
      }
    }
    await supabase.from('transfers').update({ status: 'recibido', received_at: new Date().toISOString() }).eq('id', t.id);
    setSaving(false);
    load();
  };

  const statusBadge = (status: string) => {
    if (status === 'recibido') return <Badge variant="success">Recibido</Badge>;
    if (status === 'pendiente') return <Badge variant="warning">Pendiente</Badge>;
    if (status === 'cancelado') return <Badge variant="danger">Cancelado</Badge>;
    return <Badge variant="info">{status}</Badge>;
  };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader
        title="Traspasos entre Sucursales"
        subtitle="Envía y recibe mercancía entre almacenes"
        actions={<Button onClick={() => setOpen(true)}><Plus size={16} /> Nuevo traspaso</Button>}
      />

      <Card className="overflow-hidden">
        {transfers.length === 0 ? (
          <EmptyState title="Sin traspasos" description="Crea tu primer traspaso entre sucursales." icon={<ArrowLeftRight size={48} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Folio</th>
                  <th className="px-4 py-3">Origen</th>
                  <th className="px-4 py-3">Destino</th>
                  <th className="px-4 py-3">Productos</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-700">{t.folio ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{t.origin_branch?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{t.destination_branch?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{t.transfer_items?.length ?? 0}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(t.created_at)}</td>
                    <td className="px-4 py-3 text-center">{statusBadge(t.status)}</td>
                    <td className="px-4 py-3 text-right">
                      {t.status === 'pendiente' && t.destination_branch_id === currentBranch?.id && (
                        <Button variant="secondary" onClick={() => receiveTransfer(t)} disabled={saving}>
                          <CheckCheck size={15} /> Recibir
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo traspaso" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Sucursal origen">
              <Input value={currentBranch?.name ?? ''} disabled />
            </Field>
            <Field label="Sucursal destino *">
              <Select value={destBranch} onChange={(e) => setDestBranch(e.target.value)}>
                <option value="">Selecciona sucursal</option>
                {branches.filter((b) => b.id !== currentBranch?.id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Productos a transferir</span>
              <Button variant="secondary" onClick={addItem}><Plus size={14} /> Agregar</Button>
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select value={it.product_id} onChange={(e) => updateItem(idx, 'product_id', e.target.value)} className="flex-1">
                    <option value="">Selecciona producto</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    className="w-28"
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                    placeholder="Cantidad"
                  />
                  <button onClick={() => removeItem(idx)} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <Field label="Notas">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas internas opcionales" />
          </Field>

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={createTransfer} disabled={saving}><Send size={16} /> {saving ? 'Enviando...' : 'Enviar traspaso'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
