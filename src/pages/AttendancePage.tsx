import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatDate, todayISO } from '@/lib/format';
import type { Attendance, Profile, Branch } from '@/lib/types';
import Button from '@/components/Button';
import { Field, Input, Select, Textarea } from '@/components/Field';
import { PageHeader, Card, EmptyState, Spinner, Badge, StatCard } from '@/components/ui';
import Modal from '@/components/Modal';
import { Clock, LogIn, LogOut, CalendarDays, Users } from 'lucide-react';

export default function AttendancePage() {
  const { user, currentBranch, branches, setCurrentBranchId } = useAuth();
  const [records, setRecords] = useState<Attendance[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentBranch) return;
    setLoading(true);
    const start = `${filterDate}T00:00:00`;
    const end = `${filterDate}T23:59:59`;
    const { data } = await supabase
      .from('attendance')
      .select('*, branch:branches(*)')
      .eq('branch_id', currentBranch.id)
      .gte('created_at', start)
      .lte('created_at', end)
      .order('created_at', { ascending: false });
    const { data: profs } = await supabase.from('profiles').select('*');
    const profileMap = new Map(((profs as Profile[]) ?? []).map((p) => [p.id, p]));
    const recordsWithUsers = ((data as Attendance[]) ?? []).map((record) => ({
      ...record,
      user: record.user_id ? profileMap.get(record.user_id) ?? null : null,
    }));
    setRecords(recordsWithUsers);
    setProfiles((profs as Profile[]) ?? []);
    setLoading(false);
  }, [currentBranch, filterDate]);

  useEffect(() => { load(); }, [load]);

  const myOpenRecord = useMemo(
    () => records.find((r) => r.user_id === user?.id && r.check_in && !r.check_out),
    [records, user]
  );

  const checkIn = async () => {
    if (!user || !currentBranch) return;
    setSaving(true); setError(null);
    const { error: e } = await supabase.from('attendance').insert({
      user_id: user.id,
      branch_id: currentBranch.id,
      check_in: new Date().toISOString(),
      notes: notes || null,
    });
    if (e) { console.error(e); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setSaving(false); return; }
    setSaving(false); setNotes(''); load();
  };

  const checkOut = async () => {
    if (!myOpenRecord) return;
    setSaving(true); setError(null);
    const { error: e } = await supabase.from('attendance').update({
      check_out: new Date().toISOString(),
    }).eq('id', myOpenRecord.id);
    if (e) { console.error(e); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setSaving(false); return; }
    setSaving(false); load();
  };

  const presentCount = records.filter((r) => r.check_in && !r.check_out).length;
  const checkedOutCount = records.filter((r) => r.check_out).length;

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader title="Asistencia de Personal" subtitle={currentBranch?.name} />

      <div className="mb-4 flex flex-wrap gap-2">
        {branches.map((b) => (
          <button
            key={b.id}
            onClick={() => setCurrentBranchId(b.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${b.id === currentBranch?.id ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {b.name.replace('BIENESTAR ', '')}
          </button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Presentes ahora" value={String(presentCount)} icon={<LogIn size={18} />} accent="emerald" />
        <StatCard label="Ya salieron" value={String(checkedOutCount)} icon={<LogOut size={18} />} accent="slate" />
        <StatCard label="Fecha" value={formatDate(filterDate)} icon={<CalendarDays size={18} />} accent="blue" />
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Notas (opcional)" className="flex-1">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Comentario..." />
          </Field>
          <div className="flex gap-2">
            {!myOpenRecord ? (
              <Button onClick={checkIn} disabled={saving}><LogIn size={16} /> Registrar entrada</Button>
            ) : (
              <Button variant="danger" onClick={checkOut} disabled={saving}><LogOut size={16} /> Registrar salida</Button>
            )}
          </div>
        </div>
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      </Card>

      <div className="mb-4">
        <Field label="Filtrar por fecha">
          <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="sm:w-56" />
        </Field>
      </div>

      <Card className="overflow-hidden">
        {records.length === 0 ? (
          <EmptyState title="Sin registros" description="No hay asistencia registrada en esta fecha." icon={<Clock size={48} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Empleado</th>
                  <th className="px-4 py-3">Entrada</th>
                  <th className="px-4 py-3">Salida</th>
                  <th className="px-4 py-3">Tiempo</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((r) => {
                  const duration = r.check_in && r.check_out
                    ? Math.round((new Date(r.check_out).getTime() - new Date(r.check_in).getTime()) / 60000)
                    : null;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                            {(r.user?.full_name ?? '?').charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-slate-700">{r.user?.full_name ?? 'Desconocido'}</span>
                        </div>
                        {r.notes && <div className="ml-10 text-xs text-slate-400">{r.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatDateTime(r.check_in)}</td>
                      <td className="px-4 py-3 text-slate-600">{formatDateTime(r.check_out)}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {duration != null ? `${Math.floor(duration / 60)}h ${duration % 60}m` : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.check_out ? <Badge variant="default">Completado</Badge> : <Badge variant="success">Activo</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
