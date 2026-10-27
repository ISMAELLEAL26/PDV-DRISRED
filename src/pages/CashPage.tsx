import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency, formatDateTime } from '@/lib/format';
import type { CashRegister, CashMovement, CashCount, Profile } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Select } from '@/components/Field';
import { PageHeader, Card, EmptyState, Spinner, Badge, StatCard } from '@/components/ui';
import { Wallet, Play, Square, ArrowUpCircle, ArrowDownCircle, CheckCircle2 } from 'lucide-react';
import { saveOperationalNotification } from '@/lib/operationalNotifications';

const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.01];
const BILL_DENOMINATIONS = [1000, 500, 200, 100, 50, 20];
const COIN_DENOMINATIONS = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.01];
const PAYMENT_LABELS: Record<string, string> = {
  tarjeta: 'Tarjeta (vouchers)',
  credito: 'Crédito',
  transferencia: 'Transferencia',
  vale: 'Vales',
  cheque: 'Cheques',
  monedero_electronico: 'Monedero electrónico',
};

interface MovementForm { type: string; amount: string; reason: string; }

function DenominationSection({
  title,
  denominations,
  counts,
  onChange,
}: {
  title: string;
  denominations: number[];
  counts: Record<number, string>;
  onChange: (denomination: number, value: string) => void;
}) {
  const subtotal = denominations.reduce((sum, denomination) => sum + denomination * (parseInt(counts[denomination] ?? '0') || 0), 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700">{title}</h4>
        <span className="text-xs font-semibold text-slate-400">Cantidad y subtotal</span>
      </div>
      <div className="space-y-2.5">
        {denominations.map((denomination) => {
          const quantity = parseInt(counts[denomination] ?? '0') || 0;
          return (
            <div key={denomination} className="grid grid-cols-[1fr_88px_1fr] items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <div className="text-sm font-semibold text-slate-700">{formatCurrency(denomination)}</div>
              <Input type="number" min="0" className="w-full text-center" value={counts[denomination] ?? ''} onChange={(event) => onChange(denomination, event.target.value)} placeholder="0" aria-label={`Cantidad de ${formatCurrency(denomination)}`} />
              <div className="text-right text-sm font-medium text-slate-600">{formatCurrency(denomination * quantity)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-sm">
        <span className="font-medium text-slate-500">Subtotal {title.toLowerCase()}</span>
        <span className="font-bold text-slate-800">{formatCurrency(subtotal)}</span>
      </div>
    </div>
  );
}

export default function CashPage() {
  const { user, currentBranch, branches, setCurrentBranchId } = useAuth();
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [counts, setCounts] = useState<CashCount[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAmount, setOpenAmount] = useState('');
  const [openOpen, setOpenOpen] = useState(false);
  const [movementForm, setMovementForm] = useState<MovementForm>({ type: 'ingreso', amount: '', reason: '' });
  const [movementOpen, setMovementOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [denomCounts, setDenomCounts] = useState<Record<number, string>>({});
  const [systemTotal, setSystemTotal] = useState(0);
  const [vouchers, setVouchers] = useState<Record<string, { count: number; total: number }>>({});
  const [methodTotals, setMethodTotals] = useState<Record<string, string>>({});
  const [methodConfirmed, setMethodConfirmed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zeroOpenWarning, setZeroOpenWarning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const activeRegister = useMemo(() => registers.find((r) => r.status === 'abierta'), [registers]);
  const myOpenRegister = useMemo(() => registers.find((r) => r.status === 'abierta' && r.user_id === user?.id), [registers, user]);
  const branchLocked = !!myOpenRegister;

  const load = useCallback(async () => {
    if (!currentBranch) return;
    setLoading(true);
    const { data: regs } = await supabase
      .from('cash_registers')
      .select('*')
      .eq('branch_id', currentBranch.id)
      .order('opened_at', { ascending: false })
      .limit(50);
    const registerRows = (regs as CashRegister[]) ?? [];
    const { data: profs } = await supabase.from('profiles').select('*');
    const profileMap = new Map(((profs as Profile[]) ?? []).map((p) => [p.id, p]));
    const registersWithUsers = registerRows.map((register) => ({
      ...register,
      user: register.user_id ? profileMap.get(register.user_id) ?? null : null,
    }));
    setRegisters(registersWithUsers);
    const active = registersWithUsers.find((r) => r.status === 'abierta');
    if (active) {
      const [{ data: mv }, { data: cn }, { data: sales }] = await Promise.all([
        supabase.from('cash_movements').select('*').eq('cash_register_id', active.id).order('created_at'),
        supabase.from('cash_counts').select('*').eq('cash_register_id', active.id),
        supabase.from('sales').select('total, payment_method').eq('cash_register_id', active.id).eq('status', 'completada'),
      ]);
      setMovements((mv as CashMovement[]) ?? []);
      setCounts((cn as CashCount[]) ?? []);
      const allSales = (sales as { total: number; payment_method: string }[]) ?? [];
      const cashSales = allSales
        .filter((s) => s.payment_method === 'efectivo')
        .reduce((s, x) => s + Number(x.total), 0);
      const voucherBreakdown = allSales.reduce<Record<string, { count: number; total: number }>>((acc, s) => {
        if (s.payment_method === 'efectivo') return acc;
        if (!acc[s.payment_method]) acc[s.payment_method] = { count: 0, total: 0 };
        acc[s.payment_method].count += 1;
        acc[s.payment_method].total += Number(s.total);
        return acc;
      }, {});
      setVouchers(voucherBreakdown);
      const ingresos = ((mv as CashMovement[]) ?? []).filter((m) => m.type === 'ingreso').reduce((s, m) => s + Number(m.amount), 0);
      const egresos = ((mv as CashMovement[]) ?? []).filter((m) => m.type === 'egreso').reduce((s, m) => s + Number(m.amount), 0);
      setSystemTotal(Number(active.opening_amount) + cashSales + ingresos - egresos);
    } else {
      setMovements([]); setCounts([]); setSystemTotal(0);
    }
    setProfiles((profs as Profile[]) ?? []);
    setLoading(false);
  }, [currentBranch]);

  useEffect(() => { load(); }, [load]);

  const openRegister = async () => {
    if (!user || !currentBranch) return;
    const amount = parseFloat(openAmount) || 0;
    if (amount === 0 && !zeroOpenWarning) {
      setZeroOpenWarning(true);
      return;
    }
    setSaving(true); setError(null);
    if (amount < 0) { setError('Monto inválido'); setSaving(false); return; }
    const { error: e } = await supabase.from('cash_registers').insert({
      branch_id: currentBranch.id,
      user_id: user.id,
      opening_amount: amount,
      status: 'abierta',
      opened_at: new Date().toISOString(),
    });
    if (e) { console.error(e); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setSaving(false); return; }
    setSaving(false); setOpenOpen(false); setOpenAmount(''); setZeroOpenWarning(false); load();
    window.dispatchEvent(new Event('cash-turn-changed'));
  };

  const addMovement = async () => {
    if (!activeRegister) return;
    setSaving(true); setError(null);
    const amt = parseFloat(movementForm.amount);
    if (!amt || amt <= 0) { setError('Monto inválido'); setSaving(false); return; }
    const { error: e } = await supabase.from('cash_movements').insert({
      cash_register_id: activeRegister.id,
      type: movementForm.type,
      amount: amt,
      reason: movementForm.reason || null,
    });
    if (e) { console.error(e); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setSaving(false); return; }
    setSaving(false); setMovementOpen(false);
    setMovementForm({ type: 'ingreso', amount: '', reason: '' });
    load();
  };

  const countedTotal = useMemo(() => {
    return DENOMINATIONS.reduce((sum, d) => sum + d * (parseInt(denomCounts[d] ?? '0') || 0), 0);
  }, [denomCounts]);

  const closeRegister = async () => {
    if (!activeRegister) return;
    const incompleteMethod = Object.entries(vouchers).find(([method, info]) => {
      const declared = methodTotals[method]?.trim();
      return info.count > 0 && (!declared || !methodConfirmed[method]);
    });
    if (incompleteMethod) {
      const label = PAYMENT_LABELS[incompleteMethod[0]] ?? incompleteMethod[0];
      setError(`Completa la declaración de ${label}: confirma los comprobantes e ingresa el monto total.`);
      return;
    }
    setSaving(true); setError(null);
    const declaredMethods = Object.fromEntries(Object.entries(vouchers).map(([method, info]) => {
      const counted = parseFloat(methodTotals[method] ?? '') || 0;
      return [method, {
        expected: info.total,
        counted,
        difference: counted - info.total,
        vouchers: info.count,
        confirmed: !!methodConfirmed[method],
      }];
    }));
    const diff = countedTotal - systemTotal;
    const { error: e } = await supabase.from('cash_registers').update({
      status: 'cerrada',
      closing_amount: countedTotal,
      expected_amount: systemTotal,
      difference: diff,
      closed_at: new Date().toISOString(),
      closing_breakdown: {
        cash: { expected: systemTotal, counted: countedTotal, difference: diff },
        denominations: DENOMINATIONS.map((d) => ({ denomination: d, quantity: parseInt(denomCounts[d] ?? '0') || 0, subtotal: d * (parseInt(denomCounts[d] ?? '0') || 0) })),
        paymentMethods: declaredMethods,
      },
    }).eq('id', activeRegister.id);
    if (e) { console.error(e); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setSaving(false); return; }
    // Save counts
    const countRows = DENOMINATIONS
      .filter((d) => (parseInt(denomCounts[d] ?? '0') || 0) > 0)
      .map((d) => ({
        cash_register_id: activeRegister.id,
        denomination: d,
        quantity: parseInt(denomCounts[d] ?? '0') || 0,
        subtotal: d * (parseInt(denomCounts[d] ?? '0') || 0),
      }));
    if (countRows.length > 0) {
      await supabase.from('cash_counts').insert(countRows);
    }
    setSaving(false); setCloseOpen(false); setDenomCounts({}); setMethodTotals({}); setMethodConfirmed({}); load();
    window.dispatchEvent(new Event('cash-turn-changed'));
    const report = `Sistema: ${formatCurrency(systemTotal)} | Contado: ${formatCurrency(countedTotal)} | Diferencia: ${formatCurrency(diff)}`;
    setToast('Corte de caja guardado correctamente.');
    void saveOperationalNotification({
      type: 'cash_cut',
      title: `Corte de caja ${activeRegister.folio ?? '—'}`,
      message: report,
      branchId: currentBranch?.id,
      metadata: {
        registerId: activeRegister.id,
        folio: activeRegister.folio ?? null,
        expected: systemTotal,
        counted: countedTotal,
        difference: diff,
      },
    }).then((saved) => {
      if (!saved) setToast('Corte guardado; no se pudo registrar la notificación.');
    });
  };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader title="Arqueo de Cajas" subtitle={currentBranch?.name} />
      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-emerald-600 px-5 py-3 font-medium text-white shadow-lg">{toast}</div>}

      {/* Branch selector quick */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {branches.map((b) => (
          <button
            key={b.id}
            onClick={() => !branchLocked && setCurrentBranchId(b.id)}
            disabled={branchLocked}
            title={branchLocked ? 'Cierra tu turno (corte de caja) para cambiar de sucursal' : ''}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${b.id === currentBranch?.id ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'} ${branchLocked ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            {b.name.replace('BIENESTAR ', '')}
          </button>
        ))}
        {branchLocked && (
          <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
            Tienes un turno abierto. Realiza el corte de caja para cambiar de sucursal o abrir otra caja.
          </span>
        )}
      </div>

      {activeRegister ? (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Apertura" value={formatCurrency(activeRegister.opening_amount)} icon={<Wallet size={18} />} accent="blue" />
            <StatCard label="Total esperado (sistema)" value={formatCurrency(systemTotal)} icon={<CheckCircle2 size={18} />} accent="emerald" />
            <StatCard label="Estado" value="Caja abierta" icon={<Play size={18} />} accent="amber" hint={`Desde ${formatDateTime(activeRegister.opened_at)}`} />
          </div>

          <div className="mb-4 flex gap-2">
            <Button variant="secondary" onClick={() => setMovementOpen(true)}><ArrowUpCircle size={16} /> Movimiento</Button>
            <Button variant="danger" onClick={() => setCloseOpen(true)}><Square size={16} /> Cerrar caja</Button>
          </div>

          <Card className="mb-4">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Movimientos de caja</div>
            {movements.length === 0 ? (
              <EmptyState title="Sin movimientos" description="Agrega ingresos o egresos." icon={<ArrowDownCircle size={40} />} />
            ) : (
              <div className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      {m.type === 'ingreso' ? <ArrowUpCircle size={18} className="text-emerald-500" /> : <ArrowDownCircle size={18} className="text-red-500" />}
                      <div>
                        <div className="text-sm font-medium text-slate-700">{m.type === 'ingreso' ? 'Ingreso' : 'Egreso'}</div>
                        <div className="text-xs text-slate-400">{m.reason ?? '—'} · {formatDateTime(m.created_at)}</div>
                      </div>
                    </div>
                    <div className={`text-sm font-bold ${m.type === 'ingreso' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {m.type === 'ingreso' ? '+' : '-'}{formatCurrency(m.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Voucher breakdown */}
          {Object.keys(vouchers).length > 0 && (
            <Card className="mb-4">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Vouches registrados (sin efectivo)</div>
              <div className="divide-y divide-slate-100">
                {Object.entries(vouchers).map(([method, info]) => (
                  <div key={method} className="flex items-center justify-between px-4 py-3">
                    <div className="text-sm font-medium text-slate-700 capitalize">{method.replace('_', ' ')}</div>
                    <div className="flex items-center gap-4">
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{info.count} {info.count === 1 ? 'voucher' : 'vouches'}</span>
                      <span className="text-sm font-bold text-slate-800">{formatCurrency(info.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : (
        <>
          <Card className="p-8">
            <EmptyState
              title="No hay caja abierta"
              description="Abre una caja para registrar ventas y movimientos."
              icon={<Wallet size={48} />}
              action={myOpenRegister ? null : <Button onClick={() => setOpenOpen(true)}><Play size={16} /> Abrir caja</Button>}
            />
            {myOpenRegister && (
              <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Ya tienes un turno abierto en esta sucursal. Realiza el corte de caja para abrir otra.
              </div>
            )}
          </Card>
        </>
      )}

      {/* History */}
      <h3 className="mb-3 mt-6 text-sm font-semibold text-slate-700">Historial de cajas</h3>
      <Card className="overflow-hidden">
        {registers.length === 0 ? (
          <EmptyState title="Sin historial" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Folio</th>
                  <th className="px-4 py-3">Apertura</th>
                  <th className="px-4 py-3">Cierre</th>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3 text-right">Inicial</th>
                  <th className="px-4 py-3 text-right">Esperado</th>
                  <th className="px-4 py-3 text-right">Contado</th>
                  <th className="px-4 py-3 text-right">Diferencia</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {registers.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 text-slate-600 font-medium">{r.folio ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(r.opened_at)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(r.closed_at)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.user?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.opening_amount)}</td>
                    <td className="px-4 py-3 text-right">{r.expected_amount != null ? formatCurrency(r.expected_amount) : '—'}</td>
                    <td className="px-4 py-3 text-right">{r.closing_amount != null ? formatCurrency(r.closing_amount) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {r.difference != null ? (
                        <span className={r.difference === 0 ? 'text-slate-600' : r.difference > 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                          {r.difference > 0 ? '+' : ''}{formatCurrency(r.difference)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.status === 'abierta' ? <Badge variant="warning">Abierta</Badge> : <Badge variant="success">Cerrada</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Open modal */}
      <Modal open={openOpen} onClose={() => setOpenOpen(false)} title="Abrir caja" size="sm">
        <div className="space-y-4">
          <Field label="Monto inicial en caja">
            <Input type="number" step="0.01" value={openAmount} onChange={(e) => setOpenAmount(e.target.value)} placeholder="0.00" autoFocus />
          </Field>
          {zeroOpenWarning && (parseFloat(openAmount) || 0) === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              De acuerdo con mandar en ceros tu fondo de caja. El turno se abrirá con un fondo inicial de $0.00.
            </div>
          )}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setOpenOpen(false); setZeroOpenWarning(false); }}>Cancelar</Button>
            <Button onClick={openRegister} disabled={saving}>{saving ? 'Abriendo...' : zeroOpenWarning && (parseFloat(openAmount) || 0) === 0 ? 'Confirmar apertura en ceros' : 'Abrir'}</Button>
          </div>
        </div>
      </Modal>

      {/* Movement modal */}
      <Modal open={movementOpen} onClose={() => setMovementOpen(false)} title="Registrar movimiento" size="sm">
        <div className="space-y-4">
          <Field label="Tipo">
            <Select value={movementForm.type} onChange={(e) => setMovementForm({ ...movementForm, type: e.target.value })}>
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </Select>
          </Field>
          <Field label="Monto">
            <Input type="number" step="0.01" value={movementForm.amount} onChange={(e) => setMovementForm({ ...movementForm, amount: e.target.value })} />
          </Field>
          <Field label="Motivo">
            <Input value={movementForm.reason} onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })} placeholder="Descripción" />
          </Field>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMovementOpen(false)}>Cancelar</Button>
            <Button onClick={addMovement} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </div>
      </Modal>

      {/* Close modal */}
      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title="Cerrar caja — Arqueo" size="md">
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-4">
            <div className="flex justify-between text-sm"><span className="text-slate-600">Total esperado (sistema)</span><span className="font-bold text-slate-800">{formatCurrency(systemTotal)}</span></div>
          </div>
          {Object.keys(vouchers).length > 0 && (
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-700">Declaración por método de pago</div>
              <div className="space-y-3">
                {Object.entries(vouchers).map(([method, info]) => {
                  const label = PAYMENT_LABELS[method] ?? method.replace('_', ' ');
                  return (
                    <div key={method} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold capitalize text-slate-700">{label}</div>
                          <div className="text-xs text-slate-500">Tienes que contar {info.count} {info.count === 1 ? 'comprobante' : 'comprobantes'} · Esperado: {formatCurrency(info.total)}</div>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                          <input
                            type="checkbox"
                            checked={methodConfirmed[method] ?? false}
                            onChange={(event) => setMethodConfirmed({ ...methodConfirmed, [method]: event.target.checked })}
                            className="h-4 w-4 accent-emerald-600"
                          />
                          Confirmo que cuento con ellos
                        </label>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">Monto recaudado</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={methodTotals[method] ?? ''}
                          onChange={(event) => setMethodTotals({ ...methodTotals, [method]: event.target.value })}
                          placeholder="0.00"
                          className="max-w-40"
                          aria-label={`Monto recaudado de ${label}`}
                        />
                        <span className="text-xs text-slate-500">Diferencia: {formatCurrency((parseFloat(methodTotals[method] ?? '') || 0) - info.total)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Efectivo: conteo de billetes y monedas</div>
            <div className="grid gap-4 md:grid-cols-2">
              <DenominationSection title="Billetes" denominations={BILL_DENOMINATIONS} counts={denomCounts} onChange={(denomination, value) => setDenomCounts({ ...denomCounts, [denomination]: value })} />
              <DenominationSection title="Monedas" denominations={COIN_DENOMINATIONS} counts={denomCounts} onChange={(denomination, value) => setDenomCounts({ ...denomCounts, [denomination]: value })} />
            </div>
          </div>
          <div className="flex justify-between rounded-lg bg-emerald-50 p-4">
            <span className="text-sm font-medium text-slate-700">Total de efectivo contado</span>
            <span className="text-lg font-bold text-emerald-600">{formatCurrency(countedTotal)}</span>
          </div>
          <div className="flex justify-between rounded-lg border border-slate-200 p-4">
            <span className="text-sm font-medium text-slate-700">Diferencia</span>
            <span className={`text-lg font-bold ${countedTotal - systemTotal === 0 ? 'text-slate-700' : countedTotal - systemTotal > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {countedTotal - systemTotal > 0 ? '+' : ''}{formatCurrency(countedTotal - systemTotal)}
            </span>
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCloseOpen(false)}>Cancelar</Button>
            <Button variant="danger" onClick={closeRegister} disabled={saving}>{saving ? 'Cerrando...' : 'Confirmar cierre'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
