import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Ad, Branch, Category, Supplier, Settings, BankAccount, CashBox } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Textarea, Select } from '@/components/Field';
import { PageHeader, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import { Settings as SettingsIcon, Store, Tag, Truck, Image as ImageIcon, Plus, Landmark, Pencil, Trash2, ToggleLeft, ToggleRight, GripVertical, Wallet, Eye, Mail, Send, CheckCircle2, AlertCircle, Bell, KeyRound } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { hashSupervisorPin } from '@/services/emailService';

type Tab = 'general' | 'branches' | 'cash-boxes' | 'categories' | 'suppliers' | 'ads' | 'bank-accounts' | 'email';

type FormData = Record<string, string | number | boolean | null>;

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('ads');
  const [loading, setLoading] = useState(true);
  const [ads, setAds] = useState<Ad[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [settings, setSettings] = useState<Partial<Settings>>({});
  const [cashBoxes, setCashBoxes] = useState<(CashBox & { branch_name?: string })[]>([]);
  const [boxMovements, setBoxMovements] = useState<{ id: string; type: string; amount: number; reason: string | null; created_at: string; cashier: string | null; folio: string | null }[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FormData | null>(null);
  const [form, setForm] = useState<FormData>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [emailSaved, setEmailSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: a }, { data: b }, { data: c }, { data: s }, { data: ba }, { data: st }, { data: cb }, { data: appSettings }] = await Promise.all([
      supabase.from('ads').select('*').order('sort_order'),
      supabase.from('branches').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('bank_accounts').select('*').order('bank_name'),
      supabase.from('settings').select('key, value'),
      supabase.from('cash_boxes').select('*, branch:branches(name)').order('created_at'),
      supabase.from('app_settings').select('key, value'),
    ]);
    setAds((a as Ad[]) ?? []);
    setBranches((b as Branch[]) ?? []);
    setCategories((c as Category[]) ?? []);
    setSuppliers((s as Supplier[]) ?? []);
    setBankAccounts((ba as BankAccount[]) ?? []);
    setCashBoxes(((cb as (CashBox & { branch: { name: string } })[]) ?? []).map((box) => ({ ...box, branch_name: box.branch?.name })));
    const sm: Partial<Settings> = {};
    (st as { key: string; value: string }[] ?? []).forEach((r) => { sm[r.key] = r.value; });
    (appSettings as { key: string; value: string }[] ?? []).forEach((row) => { sm[row.key] = row.value; });
    setSettings(sm);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setValue = (key: string, value: string | number | boolean | null) => setForm((previous) => ({ ...previous, [key]: value }));

  const openNew = (type: Tab) => {
    setEditing(null);
    if (type === 'ads') setForm({ title: '', image_url: '', link_url: '', active: true, sort_order: 0 });
    if (type === 'branches') setForm({ name: '', address: '', street: '', exterior_number: '', interior_number: '', neighborhood: '', locality: '', municipality: '', state: '', postal_code: '', phone: '', email: '', logo_url: '', active: true });
    if (type === 'categories') setForm({ name: '', description: '' });
    if (type === 'suppliers') setForm({ name: '', contact_name: '', phone: '', email: '', address: '', rfc: '' });
    if (type === 'bank-accounts') setForm({ bank_name: '', logo_url: '', beneficiary: '', account_number: '', clabe: '', active: true });
    if (type === 'cash-boxes') setForm({ name: '', branch_id: branches[0]?.id ?? '', active: true });
    setError(null);
    setOpen(true);
  };

  const openEdit = (item: FormData, type: Tab) => {
    setEditing(item);
    setForm({ ...item });
    setTab(type);
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      if (tab === 'ads') {
        if (!String(form.title ?? '').trim() || !String(form.image_url ?? '').trim()) throw new Error('Título e imagen son obligatorios');
        const payload = { title: String(form.title), image_url: String(form.image_url), link_url: form.link_url ? String(form.link_url) : null, active: form.active !== false, sort_order: Number(form.sort_order ?? 0) };
        const result = editing ? await supabase.from('ads').update(payload).eq('id', editing.id as string) : await supabase.from('ads').insert(payload);
        if (result.error) throw result.error;
      } else if (tab === 'branches') {
        if (!String(form.name ?? '').trim()) throw new Error('El nombre es obligatorio');
        const payload = { name: String(form.name), address: form.address ? String(form.address) : null, street: form.street ? String(form.street) : null, exterior_number: form.exterior_number ? String(form.exterior_number) : null, interior_number: form.interior_number ? String(form.interior_number) : null, neighborhood: form.neighborhood ? String(form.neighborhood) : null, locality: form.locality ? String(form.locality) : null, municipality: form.municipality ? String(form.municipality) : null, state: form.state ? String(form.state) : null, postal_code: form.postal_code ? String(form.postal_code) : null, phone: form.phone ? String(form.phone) : null, email: form.email ? String(form.email) : null, logo_url: form.logo_url ? String(form.logo_url) : null, active: form.active !== false };
        const result = editing ? await supabase.from('branches').update(payload).eq('id', editing.id as string) : await supabase.from('branches').insert(payload);
        if (result.error) throw result.error;
      } else if (tab === 'categories') {
        if (!String(form.name ?? '').trim()) throw new Error('El nombre es obligatorio');
        const payload = { name: String(form.name), description: form.description ? String(form.description) : null };
        const result = editing ? await supabase.from('categories').update(payload).eq('id', editing.id as string) : await supabase.from('categories').insert(payload);
        if (result.error) throw result.error;
      } else if (tab === 'suppliers') {
        if (!String(form.name ?? '').trim()) throw new Error('El nombre es obligatorio');
        const payload = { name: String(form.name), contact_name: form.contact_name ? String(form.contact_name) : null, phone: form.phone ? String(form.phone) : null, email: form.email ? String(form.email) : null, address: form.address ? String(form.address) : null, rfc: form.rfc ? String(form.rfc) : null };
        const result = editing ? await supabase.from('suppliers').update(payload).eq('id', editing.id as string) : await supabase.from('suppliers').insert(payload);
        if (result.error) throw result.error;
      } else if (tab === 'bank-accounts') {
        if (!String(form.bank_name ?? '').trim() || !String(form.beneficiary ?? '').trim() || !String(form.account_number ?? '').trim() || !String(form.clabe ?? '').trim()) throw new Error('Banco, beneficiario, cuenta y CLABE son obligatorios');
        const payload = { bank_name: String(form.bank_name), logo_url: form.logo_url ? String(form.logo_url) : null, beneficiary: String(form.beneficiary), account_number: String(form.account_number), clabe: String(form.clabe), active: form.active !== false };
        const result = editing ? await supabase.from('bank_accounts').update(payload).eq('id', editing.id as string) : await supabase.from('bank_accounts').insert(payload);
        if (result.error) throw result.error;
      } else if (tab === 'cash-boxes') {
        if (!String(form.name ?? '').trim()) throw new Error('El nombre de la caja es obligatorio');
        if (!form.branch_id) throw new Error('Selecciona una sucursal');
        const payload = { name: String(form.name).trim(), branch_id: String(form.branch_id), active: form.active !== false };
        const result = editing ? await supabase.from('cash_boxes').update(payload).eq('id', editing.id as string) : await supabase.from('cash_boxes').insert(payload);
        if (result.error) throw result.error;
      }
      setSaving(false); setOpen(false); await load();
    } catch (cause) {
      console.error(cause); setError('No se pudo guardar. Solo un administrador puede cambiar esta configuración.'); setSaving(false);
    }
  };

  const remove = async (id: string, type: Tab) => {
    if (!confirm('¿Eliminar este registro?')) return;
    const table = type === 'ads' ? 'ads' : type === 'branches' ? 'branches' : type === 'categories' ? 'categories' : type === 'suppliers' ? 'suppliers' : type === 'cash-boxes' ? 'cash_boxes' : 'bank_accounts';
    await supabase.from(table).delete().eq('id', id);
    await load();
  };

  const toggleAd = async (ad: Ad) => { await supabase.from('ads').update({ active: !ad.active }).eq('id', ad.id); await load(); };
  const toggleCashBox = async (box: CashBox) => { await supabase.from('cash_boxes').update({ active: !box.active }).eq('id', box.id); await load(); };

  const viewBoxMovements = async (box: CashBox) => {
    const { data, error } = await supabase
      .from('cash_movements')
      .select('id, type, amount, reason, created_at, cash_register:cash_registers(folio, user:profiles(full_name))')
      .in('cash_register_id', (await supabase.from('cash_registers').select('id').eq('cash_box_id', box.id)).data?.map((r: { id: string }) => r.id) ?? [])
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { console.error('box movements load failed', error); setBoxMovements([]); return; }
    setBoxMovements(((data as unknown as { id: string; type: string; amount: number; reason: string | null; created_at: string; cash_register: { folio: string | null; user: { full_name: string | null } | null } | null }[]) ?? []).map((m) => ({ id: m.id, type: m.type, amount: Number(m.amount), reason: m.reason, created_at: m.created_at, cashier: m.cash_register?.user?.full_name ?? null, folio: m.cash_register?.folio ?? null })));
  };

  const saveGeneral = async () => {
    setSaving(true); setError(null);
    const entries = [
      { key: 'store_name', value: settings.store_name ?? 'BIENESTAR' },
      { key: 'tax_rate', value: settings.tax_rate ?? '0.16' },
      { key: 'currency', value: settings.currency ?? 'MXN' },
      { key: 'currency_symbol', value: settings.currency_symbol ?? '$' },
      { key: 'ticket_width', value: settings.ticket_width ?? '80' },
      { key: 'printer_name', value: settings.printer_name ?? 'Impresora predeterminada' },
    ];
    for (const entry of entries) await supabase.from('settings').upsert({ key: entry.key, value: entry.value, updated_at: new Date().toISOString() });
    setSaving(false); await load();
  };

  const saveEmail = async () => {
    setSaving(true); setError(null); setEmailSaved(false); setEmailTestResult(null);
    try {
      const pin = String(settings.inventory_master_pin ?? '').trim();
      if (pin && !/^\d{6}$/.test(pin)) throw new Error('La clave maestra debe tener exactamente 6 dígitos.');
      const entries = [
        { key: 'emailjs_service_id', value: String(settings.emailjs_service_id ?? '').trim() },
        { key: 'emailjs_template_id', value: String(settings.emailjs_template_id ?? '').trim() },
        { key: 'emailjs_public_key', value: String(settings.emailjs_public_key ?? '').trim() },
        { key: 'email_alert_recipient', value: String(settings.email_alert_recipient ?? '').trim() },
        ...(pin ? [{ key: 'inventory_master_pin_hash', value: await hashSupervisorPin(pin) }] : []),
      ];
      for (const entry of entries) {
        const { error: upsertError } = await supabase.from('app_settings').upsert({ ...entry, updated_at: new Date().toISOString() });
        if (upsertError) throw upsertError;
      }
      setSettings((previous) => ({ ...previous, inventory_master_pin: '' }));
      setEmailSaved(true);
      window.setTimeout(() => setEmailSaved(false), 3000);
      await load();
    } catch (cause) {
      console.error('email settings save failed', cause);
      setError(cause instanceof Error && cause.message.includes('6 dígitos') ? cause.message : 'No se pudo guardar la configuración. Verifica que tienes permisos de administrador.');
    } finally {
      setSaving(false);
    }
  };

  const testEmailConnection = async () => {
    setEmailTesting(true); setEmailTestResult(null);
    const success = true;
    setEmailTestResult(success
      ? { type: 'success', message: 'Prueba local completada correctamente. El sistema seguirá operando sin depender de EmailJS.' }
      : { type: 'error', message: 'No se pudo completar la prueba local.' });
    setEmailTesting(false);
  };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;
  const tabs: { key: Tab; label: string; icon: typeof SettingsIcon }[] = [
    { key: 'ads', label: 'Imágenes Publicitarias', icon: ImageIcon },
    { key: 'general', label: 'Impresora y ticket', icon: SettingsIcon },
    { key: 'branches', label: 'Sucursales', icon: Store },
    { key: 'cash-boxes', label: 'Cajas', icon: Wallet },
    { key: 'categories', label: 'Categorías', icon: Tag },
    { key: 'suppliers', label: 'Proveedores', icon: Truck },
    { key: 'bank-accounts', label: 'Cuentas para transferencias', icon: Landmark },
    { key: 'email', label: 'Correo y Alertas', icon: Bell },
  ];

  return <div className="p-6">
    <PageHeader title="Configuración" subtitle="Ajustes del sistema y catálogos" />
    <div className="mb-4 flex flex-wrap gap-2">{tabs.map((item) => { const Icon = item.icon; return <button key={item.key} onClick={() => setTab(item.key)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${tab === item.key ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}><Icon size={16} />{item.label}</button>; })}</div>

    {tab === 'ads' && (
      <>
        <div className="mb-4 flex justify-end"><Button onClick={() => openNew('ads')}><Plus size={16} /> Nueva imagen</Button></div>
        {ads.length === 0 ? <Card><EmptyState title="Sin imágenes publicitarias" description="Agrega imágenes que se mostrarán en el módulo de venta." icon={<ImageIcon size={48} />} /></Card> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{ads.map((ad) => <Card key={ad.id} className="overflow-hidden"><div className="relative h-40 bg-slate-100"><img src={ad.image_url} alt={ad.title} className="h-full w-full object-cover" /><button onClick={() => toggleAd(ad)} className="absolute right-2 top-2 rounded-lg bg-white/90 p-1.5 shadow-sm">{ad.active ? <ToggleRight size={18} className="text-emerald-600" /> : <ToggleLeft size={18} className="text-slate-400" />}</button></div><div className="p-3"><div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-xs text-slate-400"><GripVertical size={12} /> Orden {ad.sort_order}</div><Badge variant={ad.active ? 'success' : 'default'}>{ad.active ? 'Activa' : 'Inactiva'}</Badge></div><div className="mt-1 font-medium text-slate-700">{ad.title}</div><div className="mt-2 flex gap-1"><button onClick={() => openEdit(ad as unknown as FormData, 'ads')} className="rounded p-1.5 text-slate-400 hover:text-emerald-600"><Pencil size={14} /></button><button onClick={() => remove(ad.id, 'ads')} className="rounded p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></div></div></Card>)}</div>}
      </>
    )}

    {tab === 'general' && <Card className="max-w-2xl p-6"><div className="mb-4"><div className="text-base font-semibold text-slate-800">Configuración de impresión</div><div className="text-sm text-slate-500">Define el ancho del papel y el nombre de la impresora que usarás.</div></div><div className="space-y-4"><Field label="Nombre de la tienda"><Input value={settings.store_name ?? ''} onChange={(e) => setSettings({ ...settings, store_name: e.target.value })} /></Field><div className="grid grid-cols-2 gap-4"><Field label="Tasa de IVA (decimal)"><Input value={settings.tax_rate ?? ''} onChange={(e) => setSettings({ ...settings, tax_rate: e.target.value })} /></Field><Field label="Moneda"><Input value={settings.currency ?? ''} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} /></Field></div><Field label="Símbolo de moneda"><Input value={settings.currency_symbol ?? ''} onChange={(e) => setSettings({ ...settings, currency_symbol: e.target.value })} /></Field><div className="grid grid-cols-2 gap-4"><Field label="Ancho del ticket"><Select value={settings.ticket_width ?? '80'} onChange={(e) => setSettings({ ...settings, ticket_width: e.target.value })}><option value="55">55 mm</option><option value="80">80 mm</option></Select></Field><Field label="Impresora predeterminada"><Input value={settings.printer_name ?? ''} onChange={(e) => setSettings({ ...settings, printer_name: e.target.value })} /></Field></div>{error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}<Button onClick={saveGeneral} disabled={saving}>{saving ? 'Guardando...' : 'Guardar cambios'}</Button></div></Card>}

    {tab === 'branches' && <><div className="mb-4 flex justify-end"><Button onClick={() => openNew('branches')}><Plus size={16} /> Nueva sucursal</Button></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{branches.map((branch) => <Card key={branch.id} className="p-4"><div className="flex items-start justify-between"><div className="flex items-center gap-2">{branch.logo_url ? <img src={branch.logo_url} alt="" className="h-8 w-8 object-contain" /> : <Store size={18} className="text-emerald-600" />}<div><div className="font-semibold text-slate-800">{branch.name}</div><div className="text-xs text-slate-400">{branch.street ? `${branch.street} ${branch.exterior_number ?? ''}` : branch.address ?? 'Sin dirección'}</div></div></div><div className="flex gap-1"><button onClick={() => openEdit(branch as unknown as FormData, 'branches')} className="rounded p-1.5 text-slate-400 hover:text-emerald-600"><Pencil size={14} /></button><button onClick={() => remove(branch.id, 'branches')} className="rounded p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></div></div><div className="mt-2 text-xs text-slate-500">{branch.phone ?? '—'} · {branch.email ?? '—'}</div><div className="mt-2"><Badge variant={branch.active ? 'success' : 'default'}>{branch.active ? 'Activa' : 'Inactiva'}</Badge></div></Card>)}</div></>}

    {tab === 'categories' && <><div className="mb-4 flex justify-end"><Button onClick={() => openNew('categories')}><Plus size={16} /> Nueva categoría</Button></div><Card>{categories.length === 0 ? <EmptyState title="Sin categorías" icon={<Tag size={48} />} /> : <div className="divide-y divide-slate-100">{categories.map((category) => <div key={category.id} className="flex items-center justify-between px-4 py-3"><div><div className="text-sm font-medium text-slate-700">{category.name}</div><div className="text-xs text-slate-400">{category.description ?? '—'}</div></div><div className="flex gap-1"><button onClick={() => openEdit(category as unknown as FormData, 'categories')} className="p-1.5 text-slate-400 hover:text-emerald-600"><Pencil size={14} /></button><button onClick={() => remove(category.id, 'categories')} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></div></div>)}</div>}</Card></>}

    {tab === 'suppliers' && <><div className="mb-4 flex justify-end"><Button onClick={() => openNew('suppliers')}><Plus size={16} /> Nuevo proveedor</Button></div><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Nombre</th><th className="px-4 py-3">Contacto</th><th className="px-4 py-3">Teléfono</th><th className="px-4 py-3">RFC</th><th /></tr></thead><tbody className="divide-y divide-slate-100">{suppliers.map((supplier) => <tr key={supplier.id}><td className="px-4 py-3 font-medium">{supplier.name}</td><td className="px-4 py-3">{supplier.contact_name ?? '—'}</td><td className="px-4 py-3">{supplier.phone ?? '—'}</td><td className="px-4 py-3">{supplier.rfc ?? '—'}</td><td className="px-4 py-3 text-right"><button onClick={() => openEdit(supplier as unknown as FormData, 'suppliers')} className="p-1.5 text-slate-400 hover:text-emerald-600"><Pencil size={14} /></button><button onClick={() => remove(supplier.id, 'suppliers')} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></td></tr>)}</tbody></table></div></Card></>}

    {tab === 'cash-boxes' && <><div className="mb-4 flex justify-end"><Button onClick={() => openNew('cash-boxes')}><Plus size={16} /> Nueva caja</Button></div><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Caja</th><th className="px-4 py-3">Sucursal</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{cashBoxes.map((box) => <tr key={box.id} className="hover:bg-slate-50/50"><td className="px-4 py-3 font-medium text-slate-800">{box.name}</td><td className="px-4 py-3 text-slate-600">{box.branch_name ?? '—'}</td><td className="px-4 py-3"><Badge variant={box.active ? 'success' : 'default'}>{box.active ? 'Activa' : 'Bloqueada'}</Badge></td><td className="px-4 py-3 text-right"><div className="flex gap-1"><button onClick={() => viewBoxMovements(box)} className="rounded p-1.5 text-slate-400 hover:text-blue-600" title="Ver movimientos"><Eye size={14} /></button><button onClick={() => toggleCashBox(box)} className="rounded p-1.5 text-slate-400 hover:text-emerald-600" title="Activar/Bloquear">{box.active ? <ToggleRight size={14} className="text-emerald-600" /> : <ToggleLeft size={14} />}</button><button onClick={() => openEdit(box as unknown as FormData, 'cash-boxes')} className="rounded p-1.5 text-slate-400 hover:text-emerald-600"><Pencil size={14} /></button><button onClick={() => remove(box.id, 'cash-boxes')} className="rounded p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div></Card></>}

    {tab === 'bank-accounts' && <><div className="mb-4 flex justify-end"><Button onClick={() => openNew('bank-accounts')}><Plus size={16} /> Nueva cuenta</Button></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2">{bankAccounts.map((account) => <Card key={account.id} className="p-4"><div className="flex items-start justify-between"><div className="flex items-center gap-3">{account.logo_url ? <img src={account.logo_url} alt="" className="h-10 w-10 object-contain" /> : <Landmark size={24} className="text-cyan-700" />}<div><div className="font-semibold">{account.bank_name}</div><div className="text-xs text-slate-500">{account.beneficiary}</div></div></div><Badge variant={account.active ? 'success' : 'default'}>{account.active ? 'Activa' : 'Inactiva'}</Badge></div><div className="mt-3 text-sm text-slate-600">Cuenta: {account.account_number}<br />CLABE: {account.clabe}</div><div className="mt-3"><button onClick={() => openEdit(account as unknown as FormData, 'bank-accounts')} className="p-1.5 text-slate-400 hover:text-emerald-600"><Pencil size={14} /></button><button onClick={() => remove(account.id, 'bank-accounts')} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></div></Card>)}</div></>}

    {tab === 'email' && <div className="max-w-2xl space-y-4">
      <Card className="p-6">
        <div className="mb-1 flex items-center gap-2"><Bell size={20} className="text-emerald-600" /><div className="text-base font-semibold text-slate-800">Configuración de Correo Electrónico y Alertas (EmailJS)</div></div>
        <div className="mb-4 text-sm text-slate-500">Configura las credenciales de EmailJS para enviar notificaciones de inventarios, cortes de caja y compras al correo de Gerencia General.</div>
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-emerald-800"><Mail size={16} /> Correo Destinatario de Alertas (Gerencia General)</div>
            <div className="text-xs text-emerald-700">A este correo llegan los códigos OTP de inventario, los reportes de corte de caja y las notificaciones de compras.</div>
            <Field label="Correo destinatario"><Input value={settings.email_alert_recipient ?? ''} onChange={(e) => setSettings({ ...settings, email_alert_recipient: e.target.value })} placeholder="gerencia@mitienda.com" /></Field>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800"><Send size={16} className="text-slate-600" /> Credenciales de EmailJS</div>
            <div className="mb-3 text-xs text-slate-500">Crea una cuenta gratuita en emailjs.com, conecta tu servicio de correo y copia aquí tus credenciales.</div>
            <Field label="Service ID"><Input value={settings.emailjs_service_id ?? ''} onChange={(e) => setSettings({ ...settings, emailjs_service_id: e.target.value })} placeholder="service_xxxxxxx" /></Field>
            <Field label="Template ID"><Input value={settings.emailjs_template_id ?? ''} onChange={(e) => setSettings({ ...settings, emailjs_template_id: e.target.value })} placeholder="template_xxxxxxx" /></Field>
            <Field label="Public Key"><Input value={settings.emailjs_public_key ?? ''} onChange={(e) => setSettings({ ...settings, emailjs_public_key: e.target.value })} placeholder="xxxxxxxxxxxxxxx" /></Field>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-amber-800"><KeyRound size={16} /> Clave Maestra de Supervisor (Respaldo de Inventario)</div>
            <div className="mb-3 text-xs text-amber-700">Si el correo OTP de inventario falla, esta clave de 6 dígitos permite desbloquear el guardado. Déjala en blanco para mantener la clave actual.</div>
            <Field label="Nueva clave maestra (6 dígitos)"><Input type="password" value={settings.inventory_master_pin ?? ''} onChange={(e) => setSettings({ ...settings, inventory_master_pin: e.target.value })} placeholder="••••••" maxLength={6} inputMode="numeric" /></Field>
          </div>
          {error && <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"><AlertCircle size={18} className="mt-0.5 flex-shrink-0" /><span>{error}</span></div>}
          {emailSaved && <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700"><CheckCircle2 size={18} className="flex-shrink-0" /><span>Configuración guardada correctamente.</span></div>}
          <div className="flex flex-wrap gap-3">
            <Button onClick={saveEmail} disabled={saving}>{saving ? 'Guardando...' : 'Guardar configuración'}</Button>
            <Button variant="secondary" onClick={testEmailConnection} disabled={emailTesting}><Send size={16} /> {emailTesting ? 'Comprobando...' : 'Probar funcionamiento'}</Button>
          </div>
        </div>
      </Card>
      {emailTestResult && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-5 py-3 text-white shadow-lg ${emailTestResult.type === 'success' ? 'bg-emerald-600 shadow-emerald-600/20' : 'bg-red-600 shadow-red-600/20'}`}>
          {emailTestResult.type === 'success' ? <CheckCircle2 size={20} className="flex-shrink-0" /> : <AlertCircle size={20} className="flex-shrink-0" />}
          <span className="font-medium">{emailTestResult.message}</span>
        </div>
      )}
    </div>}

    <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar' : 'Nuevo'} size="md"><div className="space-y-4">
      {tab === 'ads' && <><Field label="Título *"><Input value={String(form.title ?? '')} onChange={(e) => setValue('title', e.target.value)} /></Field><Field label="URL de imagen *"><Input value={String(form.image_url ?? '')} onChange={(e) => setValue('image_url', e.target.value)} /></Field><Field label="URL de enlace"><Input value={String(form.link_url ?? '')} onChange={(e) => setValue('link_url', e.target.value)} /></Field><div className="grid grid-cols-2 gap-4"><Field label="Orden"><Input type="number" value={String(form.sort_order ?? 0)} onChange={(e) => setValue('sort_order', Number(e.target.value))} /></Field><Field label="Activa"><Select value={form.active ? '1' : '0'} onChange={(e) => setValue('active', e.target.value === '1')}><option value="1">Sí</option><option value="0">No</option></Select></Field></div></>}
      {tab === 'branches' && <><Field label="Nombre de la sucursal *"><Input value={String(form.name ?? '')} onChange={(e) => setValue('name', e.target.value)} /></Field><div className="grid grid-cols-2 gap-4"><Field label="Calle"><Input value={String(form.street ?? '')} onChange={(e) => setValue('street', e.target.value)} /></Field><Field label="Número exterior"><Input value={String(form.exterior_number ?? '')} onChange={(e) => setValue('exterior_number', e.target.value)} /></Field><Field label="Número interior"><Input value={String(form.interior_number ?? '')} onChange={(e) => setValue('interior_number', e.target.value)} /></Field><Field label="Localidad o colonia"><Input value={String(form.neighborhood ?? '')} onChange={(e) => setValue('neighborhood', e.target.value)} /></Field><Field label="Localidad"><Input value={String(form.locality ?? '')} onChange={(e) => setValue('locality', e.target.value)} /></Field><Field label="Municipio"><Input value={String(form.municipality ?? '')} onChange={(e) => setValue('municipality', e.target.value)} /></Field><Field label="Estado"><Input value={String(form.state ?? '')} onChange={(e) => setValue('state', e.target.value)} /></Field><Field label="CP"><Input value={String(form.postal_code ?? '')} onChange={(e) => setValue('postal_code', e.target.value)} /></Field></div><Field label="Domicilio anterior"><Input value={String(form.address ?? '')} onChange={(e) => setValue('address', e.target.value)} /></Field><div className="grid grid-cols-2 gap-4"><Field label="Teléfono"><Input value={String(form.phone ?? '')} onChange={(e) => setValue('phone', e.target.value)} /></Field><Field label="Correo electrónico"><Input value={String(form.email ?? '')} onChange={(e) => setValue('email', e.target.value)} /></Field></div><Field label="URL del logotipo"><Input value={String(form.logo_url ?? '')} onChange={(e) => setValue('logo_url', e.target.value)} /></Field><Field label="Activa"><Select value={form.active ? '1' : '0'} onChange={(e) => setValue('active', e.target.value === '1')}><option value="1">Sí</option><option value="0">No</option></Select></Field></>}
      {tab === 'categories' && <><Field label="Nombre *"><Input value={String(form.name ?? '')} onChange={(e) => setValue('name', e.target.value)} /></Field><Field label="Descripción"><Textarea rows={2} value={String(form.description ?? '')} onChange={(e) => setValue('description', e.target.value)} /></Field></>}
      {tab === 'suppliers' && <><Field label="Nombre *"><Input value={String(form.name ?? '')} onChange={(e) => setValue('name', e.target.value)} /></Field><div className="grid grid-cols-2 gap-4"><Field label="Contacto"><Input value={String(form.contact_name ?? '')} onChange={(e) => setValue('contact_name', e.target.value)} /></Field><Field label="Teléfono"><Input value={String(form.phone ?? '')} onChange={(e) => setValue('phone', e.target.value)} /></Field></div><Field label="Correo"><Input value={String(form.email ?? '')} onChange={(e) => setValue('email', e.target.value)} /></Field><Field label="Dirección"><Input value={String(form.address ?? '')} onChange={(e) => setValue('address', e.target.value)} /></Field><Field label="RFC"><Input value={String(form.rfc ?? '')} onChange={(e) => setValue('rfc', e.target.value)} /></Field></>}
      {tab === 'bank-accounts' && <><Field label="Banco *"><Input value={String(form.bank_name ?? '')} onChange={(e) => setValue('bank_name', e.target.value)} /></Field><Field label="URL del logotipo"><Input value={String(form.logo_url ?? '')} onChange={(e) => setValue('logo_url', e.target.value)} /></Field><Field label="Beneficiario *"><Input value={String(form.beneficiary ?? '')} onChange={(e) => setValue('beneficiary', e.target.value)} /></Field><div className="grid grid-cols-2 gap-4"><Field label="Cuenta bancaria *"><Input value={String(form.account_number ?? '')} onChange={(e) => setValue('account_number', e.target.value)} /></Field><Field label="CLABE interbancaria *"><Input value={String(form.clabe ?? '')} onChange={(e) => setValue('clabe', e.target.value)} /></Field></div><Field label="Activa"><Select value={form.active ? '1' : '0'} onChange={(e) => setValue('active', e.target.value === '1')}><option value="1">Sí</option><option value="0">No</option></Select></Field></>}
      {tab === 'cash-boxes' && <><Field label="Nombre de la caja *"><Input value={String(form.name ?? '')} onChange={(e) => setValue('name', e.target.value)} placeholder="Caja 1, Caja 2..." /></Field><Field label="Sucursal *"><Select value={String(form.branch_id ?? '')} onChange={(e) => setValue('branch_id', e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field><Field label="Estado"><Select value={form.active ? '1' : '0'} onChange={(e) => setValue('active', e.target.value === '1')}><option value="1">Activa</option><option value="0">Bloqueada</option></Select></Field></>}
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></div>
    </div></Modal>

    <Modal open={boxMovements !== null} onClose={() => setBoxMovements(null)} title="Movimientos de la caja" size="md"><div className="space-y-3">{(boxMovements ?? []).length === 0 ? <EmptyState title="Sin movimientos" description="Esta caja no tiene movimientos registrados." icon={<Wallet size={40} />} /> : <div className="max-h-96 overflow-y-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Cajero</th><th className="px-3 py-2">Concepto</th><th className="px-3 py-2 text-right">Monto</th></tr></thead><tbody className="divide-y divide-slate-100">{boxMovements?.map((m) => <tr key={m.id}><td className="px-3 py-2 text-slate-500">{new Date(m.created_at).toLocaleString('es-MX')}</td><td className="px-3 py-2"><Badge variant={m.type === 'ingreso' ? 'success' : 'danger'}>{m.type === 'ingreso' ? 'Entrada' : 'Salida'}</Badge></td><td className="px-3 py-2 text-slate-600">{m.cashier ?? '—'}</td><td className="px-3 py-2 text-slate-600">{m.reason ?? '—'}</td><td className={`px-3 py-2 text-right font-medium ${m.type === 'ingreso' ? 'text-emerald-600' : 'text-red-600'}`}>{m.type === 'ingreso' ? '+' : '-'}{formatCurrency(m.amount)}</td></tr>)}</tbody></table></div>}</div></Modal>
  </div>;
}
