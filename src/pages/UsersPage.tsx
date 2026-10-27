import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import type { Profile, Role, Branch } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Select } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import { UserCog, Plus, Pencil, Shield, KeyRound } from 'lucide-react';

const PERMISSION_OPTIONS = [
  { value: 'all', label: 'Todos (Administrador)' },
  { value: 'sales', label: 'Ventas y punto de venta' },
  { value: 'cash_open', label: 'Abrir turno y fondo inicial' },
  { value: 'cash_balance', label: 'Ver saldo y corte de caja' },
  { value: 'cash_movements', label: 'Movimientos de caja' },
  { value: 'settings', label: 'Configuración y usuarios' },
  { value: 'queries', label: 'Consultas de ventas' },
  { value: 'customers', label: 'Clientes' },
  { value: 'products', label: 'Productos' },
  { value: 'purchases', label: 'Compras y proveedores' },
  { value: 'attendance', label: 'Asistencia' },
  { value: 'reports', label: 'Reportes' },
  { value: 'branch_switch', label: 'Cambiar de sucursal' },
  { value: 'view_expected_balance', label: 'Ver saldo esperado en arqueo' },
];

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchAccess, setBranchAccess] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [form, setForm] = useState<Partial<Profile> & { password?: string; branch_ids?: string[] }>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleEditing, setRoleEditing] = useState<Role | null>(null);
  const [roleForm, setRoleForm] = useState<{ name: string; description: string; permissions: string[] }>({ name: '', description: '', permissions: [] });

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: pData }, { data: rData }, { data: bData }, { data: aData }] = await Promise.all([
      supabase.from('profiles').select('*, role:roles(*), branch:branches!profiles_branch_id_fkey(*)').order('full_name'),
      supabase.from('roles').select('*').order('name'),
      supabase.from('branches').select('*').order('name'),
      supabase.from('user_branch_access').select('user_id, branch_id'),
    ]);
    setProfiles((pData as Profile[]) ?? []);
    setRoles((rData as Role[]) ?? []);
    setBranches((bData as Branch[]) ?? []);
    const accessMap: Record<string, string[]> = {};
    for (const row of (aData as { user_id: string; branch_id: string }[]) ?? []) {
      accessMap[row.user_id] = [...(accessMap[row.user_id] ?? []), row.branch_id];
    }
    setBranchAccess(accessMap);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
  }, [profiles, search]);

  const openNewUser = () => {
    setEditing(null);
    setForm({ full_name: '', email: '', password: '', role_id: '', branch_id: '', branch_ids: [], phone: '', position: '', avatar_url: '', active: false });
    setError(null);
    setOpen(true);
  };

  const openEdit = (p: Profile) => {
    setEditing(p);
    setForm({ ...p, branch_ids: branchAccess[p.id] ?? (p.branch_id ? [p.branch_id] : []) });
    setError(null);
    setOpen(true);
  };

  const saveProfile = async () => {
    setSaving(true); setError(null);
    if (!editing) {
      const { error: createError } = await supabase.functions.invoke('admin-create-user', {
        body: { email: form.email, password: form.password, fullName: form.full_name, roleId: form.role_id || null, branchId: form.branch_ids?.[0] || null, branchIds: form.branch_ids ?? [], phone: form.phone || null, position: form.position || null, avatarUrl: form.avatar_url || null },
      });
      if (createError) { console.error('admin-create-user failed', createError); setError('No se pudo crear el usuario. Revisa los datos e intenta de nuevo.'); setSaving(false); return; }
      setSaving(false); setOpen(false); load(); return;
    }
    const { error: e } = await supabase.rpc('admin_update_user', {
      target_id: editing.id,
      p_full_name: form.full_name ?? editing.full_name,
      p_role_id: form.role_id || null,
      p_branch_id: form.branch_ids?.[0] || null,
      p_active: form.active ?? true,
      p_phone: form.phone || null,
      p_position: form.position || null,
      p_avatar_url: form.avatar_url || null,
      p_branch_ids: form.branch_ids ?? [],
    });
    if (e) {
      console.error('admin_update_user failed', e);
      setError('No se pudo guardar el usuario. Solo un administrador puede modificar rol y estado.');
      setSaving(false);
      return;
    }
    setSaving(false); setOpen(false); load();
  };

  const openRoleNew = () => {
    setRoleEditing(null);
    setRoleForm({ name: '', description: '', permissions: [] });
    setError(null);
    setRoleOpen(true);
  };
  const openRoleEdit = (r: Role) => {
    setRoleEditing(r);
    setRoleForm({ name: r.name, description: r.description ?? '', permissions: r.permissions ?? [] });
    setError(null);
    setRoleOpen(true);
  };
  const saveRole = async () => {
    setSaving(true); setError(null);
    if (!roleForm.name.trim()) { setError('El nombre es obligatorio'); setSaving(false); return; }
    const payload = { name: roleForm.name.trim(), description: roleForm.description, permissions: roleForm.permissions };
    if (roleEditing) {
      const { error: e } = await supabase.from('roles').update(payload).eq('id', roleEditing.id);
      if (e) { console.error('role update failed', e); setError('No se pudo guardar el rol. Solo un administrador puede modificar permisos.'); setSaving(false); return; }
    } else {
      const { error: e } = await supabase.from('roles').insert(payload);
      if (e) { console.error('role insert failed', e); setError('No se pudo crear el rol. Solo un administrador puede crear roles.'); setSaving(false); return; }
    }
    setSaving(false); setRoleOpen(false); load();
  };
  const togglePerm = (perm: string) => {
    setRoleForm((f) => {
      if (perm === 'all') return { ...f, permissions: f.permissions.includes('all') ? [] : ['all'] };
      let next = f.permissions.filter((p) => p !== 'all');
      if (next.includes(perm)) next = next.filter((p) => p !== perm);
      else next = [...next, perm];
      return { ...f, permissions: next };
    });
  };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader title="Usuarios y Roles" subtitle="Gestión de personal y permisos" />

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab('users')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === 'users' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
        >
          Usuarios ({profiles.length})
        </button>
        <button
          onClick={() => setTab('roles')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === 'roles' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
        >
          Roles ({roles.length})
        </button>
      </div>

      {tab === 'users' && (
        <>
          <div className="mb-4 flex items-center gap-3"><SearchInput value={search} onChange={setSearch} className="flex-1" /><Button onClick={openNewUser}><Plus size={16} /> Nuevo usuario</Button></div>
          <Card className="overflow-hidden">
            {filtered.length === 0 ? (
              <EmptyState title="Sin usuarios" description="Los usuarios se crean al registrarse." icon={<UserCog size={48} />} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Usuario</th>
                      <th className="px-4 py-3">Rol</th>
                      <th className="px-4 py-3">Sucursal</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Registro</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {p.avatar_url ? <img src={p.avatar_url} alt={p.full_name} className="h-8 w-8 rounded-full object-cover" /> : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">{p.full_name.charAt(0).toUpperCase()}</div>}
                            <div>
                              <div className="font-medium text-slate-800">{p.full_name}</div>
                              <div className="text-xs text-slate-400">{p.position ? `${p.position} · ` : ''}{p.email}</div>
                            </div>
                            {p.id === currentUser?.id && <Badge variant="info">Tú</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3">{p.role ? <Badge variant="info">{p.role.name}</Badge> : '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{p.role?.permissions?.includes('all') || p.role?.permissions?.includes('branch_switch') ? 'Todas' : (branchAccess[p.id] ?? []).map((id) => branches.find((branch) => branch.id === id)?.name).filter(Boolean).join(', ') || 'Sin asignar'}</td>
                        <td className="px-4 py-3">{p.active ? <Badge variant="success">Activo</Badge> : <Badge variant="danger">Inactivo</Badge>}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(p.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => openEdit(p)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"><Pencil size={15} /></button>
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

      {tab === 'roles' && (
        <>
          <div className="mb-4 flex justify-end"><Button onClick={openRoleNew}><Plus size={16} /> Nuevo rol</Button></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Shield size={18} className="text-emerald-600" />
                    <div className="font-semibold text-slate-800">{r.name}</div>
                  </div>
                  <button onClick={() => openRoleEdit(r)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"><Pencil size={14} /></button>
                </div>
                <p className="mt-2 text-xs text-slate-500">{r.description ?? 'Sin descripción'}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(r.permissions ?? []).map((perm) => <Badge key={perm} variant="default">{perm}</Badge>)}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar usuario' : 'Nuevo usuario'} size="md">
        <div className="space-y-4">
          <Field label="Nombre"><Input value={form.full_name ?? ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <Field label="Correo"><Input type="email" value={form.email ?? ''} disabled={!!editing} onChange={(e) => setForm({ ...form, email: e.target.value })} className={editing ? 'bg-slate-50' : ''} /></Field>
          {!editing && <Field label="Contraseña temporal"><Input type="password" minLength={8} value={form.password ?? ''} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 8 caracteres" /></Field>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Rol">
              <Select value={form.role_id ?? ''} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
                <option value="">Sin rol</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <Field label="Sucursales autorizadas">
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                {branches.map((branch) => {
                  const selected = (form.branch_ids ?? []).includes(branch.id);
                  return <label key={branch.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={selected} onChange={() => setForm({ ...form, branch_ids: selected ? (form.branch_ids ?? []).filter((id) => id !== branch.id) : [...(form.branch_ids ?? []), branch.id] })} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                    {branch.name}
                  </label>;
                })}
                <p className="text-xs text-slate-400">El usuario solo podrá entrar a las sucursales seleccionadas. Administradores y encargados con permiso especial pueden cambiar de sucursal.</p>
              </div>
            </Field>
          </div>
          <Field label="Teléfono"><Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Puesto"><Input value={form.position ?? ''} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Cajero, gerente, supervisor..." /></Field>
          <Field label="URL de fotografía o avatar"><Input value={form.avatar_url ?? ''} onChange={(e) => setForm({ ...form, avatar_url: e.target.value })} placeholder="https://..." /></Field>
          <Field label="Estado">
            <Select value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}>
              <option value="1">Activo</option>
              <option value="0">Inactivo</option>
            </Select>
          </Field>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={saveProfile} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={roleOpen} onClose={() => setRoleOpen(false)} title={roleEditing ? 'Editar rol' : 'Nuevo rol'} size="md">
        <div className="space-y-4">
          <Field label="Nombre *"><Input value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} /></Field>
          <Field label="Descripción"><Input value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} /></Field>
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700"><KeyRound size={14} /> Permisos</div>
            <div className="grid grid-cols-2 gap-2">
              {PERMISSION_OPTIONS.map((p) => (
                <label key={p.value} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={roleForm.permissions.includes(p.value)}
                    onChange={() => togglePerm(p.value)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-slate-700">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRoleOpen(false)}>Cancelar</Button>
            <Button onClick={saveRole} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
