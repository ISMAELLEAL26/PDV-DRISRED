import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency } from '@/lib/format';
import { printCashTicket, type CashTicketData } from '@/components/TicketPrint';
import type { Branch } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input } from '@/components/Field';
import { DENOMINATIONS, useCashTurn } from '@/lib/cashTurn';
import { sanitizeFilterValue } from '@/lib/search';
import { PROGRAM_LOGO } from '@/lib/branding';
import {
  Wallet, Play, ArrowUpCircle, ArrowDownCircle, ScanLine, MessageSquare,
  Square, Calculator, Printer, X, CheckCircle2, AlertTriangle, CreditCard,
  ArrowLeftRight, FileCheck2, Ticket, WalletCards, ImageIcon,
} from 'lucide-react';

interface Props {
  onTurnChange?: () => void;
}

const METHOD_KEYS: { key: string; label: string; icon: React.ReactNode; countField?: 'cardCount' | 'transferCount' | 'chequeCount' | 'valeCount' | 'monederoCount' }[] = [
  { key: 'efectivo', label: 'Efectivo', icon: <Wallet size={16} /> },
  { key: 'tarjeta', label: 'Tarjeta (Vouchers)', icon: <CreditCard size={16} />, countField: 'cardCount' },
  { key: 'credito', label: 'Crédito', icon: <CreditCard size={16} /> },
  { key: 'transferencia', label: 'Transferencia', icon: <ArrowLeftRight size={16} />, countField: 'transferCount' },
  { key: 'cheque', label: 'Cheque', icon: <FileCheck2 size={16} />, countField: 'chequeCount' },
  { key: 'vale', label: 'Vales', icon: <Ticket size={16} />, countField: 'valeCount' },
  { key: 'monedero_electronico', label: 'Monedero electrónico', icon: <WalletCards size={16} />, countField: 'monederoCount' },
];

const BILL_DENOMINATIONS = [1000, 500, 200, 100, 50, 20];
const COIN_DENOMINATIONS = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.01];

function denomTotal(counts: Record<number, string>): number {
  return DENOMINATIONS.reduce((sum, d) => sum + d * (parseInt(counts[d] ?? '0') || 0), 0);
}

function DenominationSection({
  title,
  denominations,
  counts,
  currencySymbol,
  onChange,
}: {
  title: string;
  denominations: number[];
  counts: Record<number, string>;
  currencySymbol: string;
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
              <div className="text-sm font-semibold text-slate-700">{formatCurrency(denomination, currencySymbol)}</div>
              <Input
                type="number"
                min="0"
                className="w-full text-center"
                value={counts[denomination] ?? ''}
                onChange={(event) => onChange(denomination, event.target.value)}
                placeholder="0"
                aria-label={`Cantidad de ${formatCurrency(denomination, currencySymbol)}`}
              />
              <div className="text-right text-sm font-medium text-slate-600">{formatCurrency(denomination * quantity, currencySymbol)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-sm">
        <span className="font-medium text-slate-500">Subtotal {title.toLowerCase()}</span>
        <span className="font-bold text-slate-800">{formatCurrency(subtotal, currencySymbol)}</span>
      </div>
    </div>
  );
}

export default function POSSubMenu({ onTurnChange }: Props) {
  const { user, profile, currentBranch, cashBoxes, occupiedBoxes, activeRegister, movements, loadingTurn, turnSummary, openTurn, addMovement, closeTurn } = useCashTurn();
  const { hasPermission } = useAuth();
  const canSeeExpected = hasPermission('view_expected_balance');
  const [menuOpen, setMenuOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [ticketWidth, setTicketWidth] = useState<'55' | '80'>('80');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('settings').select('key, value').eq('key', 'ticket_width').maybeSingle();
      if (data?.value === '55') setTicketWidth('55');
    })();
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        setPriceOpen(true);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  // Open turn
  const [openDenom, setOpenDenom] = useState<Record<number, string>>({});
  const [selectedCashBoxId, setSelectedCashBoxId] = useState('');
  const [savingTurn, setSavingTurn] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [zeroFundWarning, setZeroFundWarning] = useState(false);

  // Movement
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveType, setMoveType] = useState<'ingreso' | 'egreso'>('ingreso');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const [moveDenom, setMoveDenom] = useState<Record<number, string>>({});
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Price checker
  const [priceOpen, setPriceOpen] = useState(false);

  // Comments
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');

  // Close turn
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeDenom, setCloseDenom] = useState<Record<number, string>>({});
  const [closeMethods, setCloseMethods] = useState<Record<string, string>>({});
  const [closeSaving, setCloseSaving] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);

  const openTotal = useMemo(() => denomTotal(openDenom), [openDenom]);
  const countedCash = useMemo(() => denomTotal(closeDenom), [closeDenom]);
  const expectedCash = turnSummary?.expectedCash ?? 0;
  const diff = countedCash - expectedCash;

  const declaredMethods = useMemo(() => {
    const map: Record<string, number> = {};
    for (const mk of METHOD_KEYS) {
      if (mk.key !== 'efectivo') map[mk.key] = parseFloat(closeMethods[mk.key] ?? '0') || 0;
    }
    return map;
  }, [closeMethods]);
  const totalDeclared = countedCash + Object.values(declaredMethods).reduce((s, v) => s + v, 0);
  const totalSystem = (turnSummary?.totalSales ?? 0) + (turnSummary?.ingresos ?? 0) - (turnSummary?.egresos ?? 0) + (turnSummary?.openingAmount ?? 0);
  const globalDiff = totalDeclared - totalSystem;

  const branch = currentBranch as Branch | null;
  const storeName = currentBranch?.name ?? 'BIENESTAR';
  const currencySymbol = '$';
  const cashierName = profile?.full_name ?? 'Cajero';

  const buildCashTicket = (overrides: Partial<CashTicketData> & { title: string; rows: { label: string; value: string }[] }): CashTicketData => ({
    branch: branch as Branch,
    logoUrl: PROGRAM_LOGO,
    storeName,
    folio: activeRegister?.folio ?? '',
    cashierName,
    createdAt: new Date().toLocaleString('es-MX'),
    currencySymbol,
    ticketWidth,
    ...overrides,
  });

  const handleOpenTurn = async () => {
    if (openTotal === 0 && !zeroFundWarning) {
      setZeroFundWarning(true);
      return;
    }
    setSavingTurn(true);
    setTurnError(null);
    try {
      if (!selectedCashBoxId) throw new Error('Selecciona una caja para iniciar el turno.');
      const reg = await openTurn(selectedCashBoxId, openTotal, Object.fromEntries(DENOMINATIONS.map((d) => [d, parseInt(openDenom[d] ?? '0') || 0])));
      printCashTicket(buildCashTicket({
        title: 'APERTURA DE TURNO',
        rows: [
          { label: 'Folio:', value: reg.folio ?? '' },
          { label: 'Cajero:', value: cashierName },
          { label: 'Fecha:', value: new Date().toLocaleString('es-MX') },
          { label: 'Fondo inicial:', value: formatCurrency(openTotal, currencySymbol) },
        ],
        signatureLine: true,
      }));
      setOpenDenom({});
      setSelectedCashBoxId('');
      setZeroFundWarning(false);
      setWelcomeOpen(false);
      setMenuOpen(false);
      onTurnChange?.();
      window.dispatchEvent(new Event('cash-turn-changed'));
    } catch (e) {
      setTurnError(e instanceof Error ? e.message : 'Error al abrir turno');
    } finally {
      setSavingTurn(false);
    }
  };

  const handleMovement = async () => {
    setMoveSaving(true);
    setMoveError(null);
    try {
      const amt = parseFloat(moveAmount);
      if (!amt || amt <= 0) throw new Error('Monto inválido');
      if (!moveReason.trim()) throw new Error('El concepto es obligatorio');
      await addMovement(moveType, amt, moveReason.trim(), Object.fromEntries(DENOMINATIONS.map((d) => [d, parseInt(moveDenom[d] ?? '0') || 0])));
      printCashTicket(buildCashTicket({
        title: moveType === 'ingreso' ? 'ENTRADA DE DINERO' : 'SALIDA DE DINERO',
        rows: [
          { label: 'Concepto:', value: moveReason.trim() },
          { label: 'Monto:', value: `${moveType === 'egreso' ? '-' : ''}${formatCurrency(amt, currencySymbol)}` },
        ],
        signatureLine: true,
      }));
      setMoveOpen(false);
      setMoveAmount(''); setMoveReason(''); setMoveDenom({});
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : 'Error al guardar movimiento');
    } finally {
      setMoveSaving(false);
    }
  };

  const handleCloseTurn = async () => {
    setCloseSaving(true);
    setCloseError(null);
    try {
      const methodTotals: Record<string, number> = { efectivo: countedCash };
      for (const mk of METHOD_KEYS) {
        if (mk.key !== 'efectivo') methodTotals[mk.key] = parseFloat(closeMethods[mk.key] ?? '0') || 0;
      }
      await closeTurn(
        countedCash,
        Object.fromEntries(DENOMINATIONS.map((d) => [d, parseInt(closeDenom[d] ?? '0') || 0])),
        methodTotals,
      );
      const resultLabel = globalDiff === 0 ? 'CAJA CUADRADA' : globalDiff > 0 ? 'SOBRANTE' : 'FALTANTE';
      const methodRows: { label: string; value: string }[] = [];
      for (const mk of METHOD_KEYS) {
        const expected = mk.key === 'efectivo' ? expectedCash : (turnSummary as Record<string, number> | null)?.[mk.key === 'tarjeta' ? 'cardDebit' : mk.key === 'credito' ? 'cardCredit' : mk.key] ?? 0;
        const declared = methodTotals[mk.key] ?? 0;
        const mDiff = declared - expected;
        const countInfo = mk.countField && turnSummary ? ` (${turnSummary[mk.countField]} comprobantes)` : '';
        methodRows.push({ label: `${mk.label}${countInfo}:`, value: `${formatCurrency(declared, currencySymbol)} ${canSeeExpected ? `/ Esp: ${formatCurrency(expected, currencySymbol)} ${mDiff === 0 ? '✓' : mDiff > 0 ? '+' : ''}${mDiff !== 0 ? formatCurrency(Math.abs(mDiff), currencySymbol) : ''}` : ''}` });
      }
      printCashTicket(buildCashTicket({
        title: 'CORTE DE CAJA',
        rows: [
          { label: 'Folio:', value: activeRegister?.folio ?? '' },
          { label: 'Cajero:', value: cashierName },
          { label: 'Apertura:', value: activeRegister ? new Date(activeRegister.opened_at).toLocaleString('es-MX') : '' },
          { label: 'Cierre:', value: new Date().toLocaleString('es-MX') },
        ],
        sections: [
          {
            heading: 'ARQUEO FISICO EFECTIVO',
            rows: DENOMINATIONS
              .filter((d) => (parseInt(closeDenom[d] ?? '0') || 0) > 0)
              .map((d) => ({ label: `${formatCurrency(d, currencySymbol)} x${parseInt(closeDenom[d] ?? '0') || 0}`, value: formatCurrency(d * (parseInt(closeDenom[d] ?? '0') || 0), currencySymbol) })),
          },
          {
            heading: 'DECLARADO POR METODO',
            rows: methodRows,
          },
          ...(canSeeExpected ? [{
            heading: 'RESUMEN TEORICO',
            rows: [
              { label: 'Fondo inicial:', value: formatCurrency(turnSummary?.openingAmount ?? 0, currencySymbol) },
              { label: 'Ventas efectivo:', value: formatCurrency(turnSummary?.cashSales ?? 0, currencySymbol) },
              { label: 'Tarjeta:', value: formatCurrency(turnSummary?.cardDebit ?? 0, currencySymbol) },
              { label: 'Credito:', value: formatCurrency(turnSummary?.cardCredit ?? 0, currencySymbol) },
              { label: 'Transferencia:', value: formatCurrency(turnSummary?.transfer ?? 0, currencySymbol) },
              { label: 'Cheque:', value: formatCurrency(turnSummary?.cheque ?? 0, currencySymbol) },
              { label: 'Vales:', value: formatCurrency(turnSummary?.vale ?? 0, currencySymbol) },
              { label: 'Monedero:', value: formatCurrency(turnSummary?.monedero ?? 0, currencySymbol) },
              { label: 'Entradas:', value: formatCurrency(turnSummary?.ingresos ?? 0, currencySymbol) },
              { label: 'Salidas:', value: formatCurrency(turnSummary?.egresos ?? 0, currencySymbol) },
              { label: 'Total sistema:', value: formatCurrency(totalSystem, currencySymbol) },
              { label: 'Total declarado:', value: formatCurrency(totalDeclared, currencySymbol) },
            ],
          }] : []),
        ],
        resultLabel,
        resultValue: (globalDiff > 0 ? '+' : '') + formatCurrency(globalDiff, currencySymbol),
        signatureLine: true,
      }));
      setCloseOpen(false);
      setCloseConfirm(false);
      setCloseDenom({}); setCloseMethods({});
      onTurnChange?.();
      window.dispatchEvent(new Event('cash-turn-changed'));
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : 'Error al cerrar turno');
    } finally {
      setCloseSaving(false);
    }
  };

  // Auto-show welcome when no active register
  if (!loadingTurn && !activeRegister && !welcomeOpen && !menuOpen) {
    // Trigger welcome modal via the parent — we just expose state
  }

  return {
    menuOpen,
    setMenuOpen,
    welcomeOpen,
    setWelcomeOpen,
    activeRegister,
    loadingTurn,
    menuButton: (
      <button
        onClick={() => setMenuOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
      >
        <Wallet size={16} /> Menú
      </button>
    ),
    priceButton: (
      <button
        onClick={() => setPriceOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
      >
        <ScanLine size={16} /> Checador <span className="hidden sm:inline">F2</span>
      </button>
    ),
    modals: (
      <>
        {/* Submenu */}
        <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="Menú del Punto de Venta" size="md">
          <div className="space-y-3">
            <div className={`rounded-lg p-3 text-sm ${activeRegister ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {activeRegister ? (
                <span>Turno activo: <b>{activeRegister.folio}</b> · Fondo: {formatCurrency(activeRegister.opening_amount, currencySymbol)}</span>
              ) : (
                <span>No hay turno abierto. Debes abrir uno para vender.</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {!activeRegister && (
                <Button variant="secondary" onClick={() => { setMenuOpen(false); setWelcomeOpen(true); }}>
                  <Play size={16} /> Abrir turno
                </Button>
              )}
              {activeRegister && (
                <>
                  <Button variant="secondary" onClick={() => { setMenuOpen(false); setMoveOpen(true); }}>
                    <ArrowUpCircle size={16} /> Movimientos
                  </Button>
                  <Button variant="secondary" onClick={() => { setMenuOpen(false); setPriceOpen(true); }}>
                    <ScanLine size={16} /> Checador de precios
                  </Button>
                  <Button variant="secondary" onClick={() => { setMenuOpen(false); setCommentOpen(true); }}>
                    <MessageSquare size={16} /> Comentarios
                  </Button>
                  <Button variant="danger" onClick={() => { setMenuOpen(false); setCloseOpen(true); }}>
                    <Square size={16} /> Corte de caja
                  </Button>
                </>
              )}
            </div>

            {activeRegister && movements.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Movimientos del turno</div>
                <div className="space-y-1">
                  {movements.slice(-5).map((m) => (
                    <div key={m.id} className="flex justify-between text-sm">
                      <span className="text-slate-600">{m.type === 'ingreso' ? 'Entrada' : 'Salida'} · {m.reason ?? '—'}</span>
                      <span className={m.type === 'ingreso' ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                        {m.type === 'ingreso' ? '+' : '-'}{formatCurrency(Number(m.amount), currencySymbol)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>

        {/* Welcome / Open turn */}
        <Modal open={welcomeOpen} onClose={() => setWelcomeOpen(false)} title="Apertura de turno" size="md">
          <div className="space-y-4">
            <div className="rounded-lg bg-blue-50 p-4 text-center">
              <div className="text-sm text-slate-600">¡Hola <b>{cashierName}</b>!</div>
              <div className="text-base font-semibold text-[#0b347d]">Bienvenido, vas a iniciar el turno.</div>
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-700">Selecciona la caja</div>
              <div className="space-y-2">
                {cashBoxes.map((box) => {
                  const occupiedBy = occupiedBoxes[box.id];
                  const isOccupied = !!occupiedBy;
                  const isSelected = selectedCashBoxId === box.id;
                  return (
                    <button
                      key={box.id}
                      onClick={() => !isOccupied && setSelectedCashBoxId(box.id)}
                      disabled={isOccupied}
                      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                        isOccupied
                          ? 'cursor-not-allowed border-red-200 bg-red-50'
                          : isSelected
                            ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100'
                            : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Wallet size={18} className={isOccupied ? 'text-red-400' : isSelected ? 'text-emerald-600' : 'text-slate-400'} />
                        <span className={`text-sm font-medium ${isOccupied ? 'text-red-700' : 'text-slate-700'}`}>{box.name}</span>
                      </div>
                      {isOccupied
                        ? <span className="text-xs font-medium text-red-600">No disponible · Operada por: {occupiedBy}</span>
                        : isSelected
                          ? <span className="text-xs font-medium text-emerald-600">Seleccionada</span>
                          : <span className="text-xs text-slate-400">Disponible</span>}
                    </button>
                  );
                })}
              </div>
              {cashBoxes.length === 0 && <div className="mt-2 text-xs text-amber-700">No hay cajas activas configuradas para esta sucursal.</div>}
            </div>
            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700">Fondo de caja — Conteo por denominación</div>
              <div className="grid gap-4 md:grid-cols-2">
                <DenominationSection title="Billetes" denominations={BILL_DENOMINATIONS} counts={openDenom} currencySymbol={currencySymbol} onChange={(denomination, value) => setOpenDenom({ ...openDenom, [denomination]: value })} />
                <DenominationSection title="Monedas" denominations={COIN_DENOMINATIONS} counts={openDenom} currencySymbol={currencySymbol} onChange={(denomination, value) => setOpenDenom({ ...openDenom, [denomination]: value })} />
              </div>
            </div>
            <div className="flex justify-between rounded-lg bg-emerald-50 p-4">
              <span className="text-sm font-medium text-slate-700">Total fondo</span>
              <span className="text-lg font-bold text-emerald-600">{formatCurrency(openTotal, currencySymbol)}</span>
            </div>
            {zeroFundWarning && openTotal === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                De acuerdo con mandar en ceros tu fondo de caja. El turno se abrirá con un fondo inicial de $0.00.
              </div>
            )}
            {turnError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{turnError}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setWelcomeOpen(false); setZeroFundWarning(false); }}>Cancelar</Button>
              <Button onClick={handleOpenTurn} disabled={savingTurn || !selectedCashBoxId}>{savingTurn ? 'Abriendo...' : zeroFundWarning && openTotal === 0 ? 'Confirmar apertura en ceros' : 'Abrir e imprimir'}</Button>
            </div>
          </div>
        </Modal>

        {/* Movement */}
        <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title="Movimiento de caja" size="md">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMoveType('ingreso')} className={`rounded-lg border py-3 text-sm font-medium ${moveType === 'ingreso' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 text-slate-600'}`}>
                <ArrowUpCircle size={18} className="mx-auto mb-1" /> Entrada
              </button>
              <button onClick={() => setMoveType('egreso')} className={`rounded-lg border py-3 text-sm font-medium ${moveType === 'egreso' ? 'border-red-600 bg-red-600 text-white' : 'border-slate-200 text-slate-600'}`}>
                <ArrowDownCircle size={18} className="mx-auto mb-1" /> Salida
              </button>
            </div>
            <Field label="Monto"><Input type="number" step="0.01" value={moveAmount} onChange={(e) => setMoveAmount(e.target.value)} placeholder="0.00" /></Field>
            <Field label="Concepto o comentario (obligatorio)"><Input value={moveReason} onChange={(e) => setMoveReason(e.target.value)} placeholder="Justifica el movimiento" /></Field>
            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700">Conteo por denominación (opcional)</div>
              <div className="grid gap-4 md:grid-cols-2">
                <DenominationSection title="Billetes" denominations={BILL_DENOMINATIONS} counts={moveDenom} currencySymbol={currencySymbol} onChange={(denomination, value) => setMoveDenom({ ...moveDenom, [denomination]: value })} />
                <DenominationSection title="Monedas" denominations={COIN_DENOMINATIONS} counts={moveDenom} currencySymbol={currencySymbol} onChange={(denomination, value) => setMoveDenom({ ...moveDenom, [denomination]: value })} />
              </div>
              <div className="mt-2 flex justify-between rounded-lg bg-slate-50 p-3 text-sm">
                <span className="text-slate-600">Total contado</span>
                <span className="font-bold text-slate-800">{formatCurrency(denomTotal(moveDenom), currencySymbol)}</span>
              </div>
            </div>
            {moveError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{moveError}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setMoveOpen(false)}>Cancelar</Button>
              <Button onClick={handleMovement} disabled={moveSaving}>{moveSaving ? 'Guardando...' : 'Guardar e imprimir'}</Button>
            </div>
          </div>
        </Modal>

        {/* Price checker */}
        <PriceCheckerModal open={priceOpen} onClose={() => setPriceOpen(false)} />

        {/* Comments */}
        <Modal open={commentOpen} onClose={() => setCommentOpen(false)} title="Comentarios de la venta" size="sm">
          <div className="space-y-4">
            <Field label="Nota o comentario">
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-blue-500 focus:outline-none" placeholder="Agrega una nota a la venta o turno actual..." />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCommentOpen(false)}>Cerrar</Button>
              <Button onClick={() => { setCommentOpen(false); }}>Guardar</Button>
            </div>
          </div>
        </Modal>

        {/* Close turn — step 1: breakdown */}
        <Modal open={closeOpen && !closeConfirm} onClose={() => setCloseOpen(false)} title="Corte de caja — Arqueo" size="md">
          <div className="space-y-4">
            {!canSeeExpected && (
              <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
                Arqueo ciego: declara lo que físicamente contaste. El sistema validará las diferencias al cerrar.
              </div>
            )}
            {canSeeExpected && (
              <div className="rounded-lg bg-slate-50 p-4">
                <div className="flex justify-between text-sm"><span className="text-slate-600">Efectivo esperado</span><span className="font-bold text-slate-800">{formatCurrency(expectedCash, currencySymbol)}</span></div>
                <div className="flex justify-between text-sm mt-1"><span className="text-slate-600">Total sistema (todos métodos)</span><span className="font-bold text-slate-800">{formatCurrency(totalSystem, currencySymbol)}</span></div>
              </div>
            )}
            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700">Conteo de efectivo por denominaciones</div>
              <div className="grid gap-4 md:grid-cols-2">
                <DenominationSection title="Billetes" denominations={BILL_DENOMINATIONS} counts={closeDenom} currencySymbol={currencySymbol} onChange={(denomination, value) => setCloseDenom({ ...closeDenom, [denomination]: value })} />
                <DenominationSection title="Monedas" denominations={COIN_DENOMINATIONS} counts={closeDenom} currencySymbol={currencySymbol} onChange={(denomination, value) => setCloseDenom({ ...closeDenom, [denomination]: value })} />
              </div>
            </div>
            <div className="flex justify-between rounded-lg bg-emerald-50 p-4">
              <span className="text-sm font-medium text-slate-700">Efectivo contado</span>
              <span className="text-lg font-bold text-emerald-600">{formatCurrency(countedCash, currencySymbol)}</span>
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-700">Declaración por método de pago</div>
              <div className="space-y-3">
                {METHOD_KEYS.filter((mk) => mk.key !== 'efectivo').map((mk) => {
                  const expectedVal = (turnSummary as Record<string, number> | null)?.[mk.key === 'tarjeta' ? 'cardDebit' : mk.key === 'credito' ? 'cardCredit' : mk.key] ?? 0;
                  const declared = parseFloat(closeMethods[mk.key] ?? '0') || 0;
                  const mDiff = declared - expectedVal;
                  const voucherCount = mk.countField && turnSummary ? turnSummary[mk.countField] : 0;
                  return (
                    <div key={mk.key} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">{mk.icon} {mk.label}</div>
                        {mk.countField && turnSummary && voucherCount > 0 && (
                          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                            {voucherCount} comprobantes esperados
                          </span>
                        )}
                      </div>
                      {mk.countField && turnSummary && voucherCount > 0 && (
                        <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
                          <span>¿Cuentas con los {voucherCount} vouchers/comprobantes?</span>
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={closeMethods[`${mk.key}_vouchers_ok`] === '1'} onChange={(e) => setCloseMethods({ ...closeMethods, [`${mk.key}_vouchers_ok`]: e.target.checked ? '1' : '0' })} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                            Sí
                          </label>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Input type="number" step="0.01" className="flex-1" value={closeMethods[mk.key] ?? ''} onChange={(e) => setCloseMethods({ ...closeMethods, [mk.key]: e.target.value })} placeholder="Monto declarado" />
                        {canSeeExpected && (
                          <div className={`text-xs font-semibold ${mDiff === 0 ? 'text-emerald-600' : mDiff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            Esp: {formatCurrency(expectedVal, currencySymbol)}<br />
                            {mDiff === 0 ? '✓' : `${mDiff > 0 ? '+' : ''}${formatCurrency(mDiff, currencySymbol)}`}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-100 p-4">
              <span className="text-sm font-medium text-slate-700">Total declarado (todos métodos)</span>
              <span className="text-lg font-bold text-slate-800">{formatCurrency(totalDeclared, currencySymbol)}</span>
            </div>
            {canSeeExpected && (
              <div className={`flex items-center justify-between rounded-lg p-4 ${globalDiff === 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  {globalDiff === 0 ? <CheckCircle2 size={18} className="text-emerald-600" /> : <AlertTriangle size={18} className="text-red-600" />}
                  Diferencia global
                </span>
                <span className={`text-lg font-bold ${globalDiff === 0 ? 'text-emerald-600' : globalDiff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {globalDiff > 0 ? '+' : ''}{formatCurrency(globalDiff, currencySymbol)}
                </span>
              </div>
            )}
            {closeError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{closeError}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCloseOpen(false)}>Cancelar</Button>
              <Button onClick={() => setCloseConfirm(true)}>Continuar</Button>
            </div>
          </div>
        </Modal>

        {/* Close turn — step 2: confirm */}
        <Modal open={closeConfirm} onClose={() => setCloseConfirm(false)} title="Confirmar corte" size="sm">
          <div className="space-y-4">
            <div className={`rounded-lg p-4 text-center text-sm ${globalDiff === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
              <div className="mb-2 flex justify-center">
                {globalDiff === 0 ? <CheckCircle2 size={32} className="text-emerald-600" /> : <AlertTriangle size={32} className="text-red-600" />}
              </div>
              {globalDiff === 0 ? 'CUADRE PERFECTO' : globalDiff > 0 ? 'SOBRANTE' : 'FALTANTE'}
              <div className="mt-2 text-xs">
                Total declarado: <b>{formatCurrency(totalDeclared, currencySymbol)}</b>
                {canSeeExpected && <> · Total sistema: <b>{formatCurrency(totalSystem, currencySymbol)}</b></>}
              </div>
              <div className="mt-1 text-lg font-bold">
                {globalDiff === 0 ? 'Cuadró' : `${globalDiff > 0 ? '+' : ''}${formatCurrency(globalDiff, currencySymbol)}`}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCloseConfirm(false)}>No, revisar</Button>
              <Button variant="danger" onClick={handleCloseTurn} disabled={closeSaving}>{closeSaving ? 'Cerrando...' : 'Sí, cerrar e imprimir'}</Button>
            </div>
          </div>
        </Modal>
      </>
    ),
  };
}

type CheckerProduct = { id: string; name: string; sale_price: number; sku: string | null; barcode: string | null; barcode_2: string | null; image_url: string | null };

// Inline price checker using products search
function PriceCheckerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [results, setResults] = useState<CheckerProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CheckerProduct | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setCode(''); setResults([]); setSelected(null);
    }
  }, [open]);

  const runSearch = async (val: string) => {
    setCode(val);
    setSelected(null);
    const term = sanitizeFilterValue(val);
    if (!term) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from('products')
      .select('id, name, sale_price, sku, barcode, barcode_2, image_url')
      .eq('active', true)
      .is('deleted_at', null)
      .or(`barcode.eq.${term},barcode_2.eq.${term},sku.eq.${term},name.ilike.%${term}%`)
      .limit(8);
    const list = (data ?? []) as CheckerProduct[];
    setResults(list);
    if (list.length === 1) setSelected(list[0]);
    setSearching(false);
  };

  const handleInput = (val: string) => {
    setCode(val);
    setSelected(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(() => runSearch(val), 220);
  };

  return (
    <Modal open={open} onClose={onClose} title="Checador de precios" size="sm">
      <div className="space-y-4">
        <div className="relative">
          <ScanLine size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-blue-600" />
          <input
            autoFocus
            type="text"
            value={code}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (debounceRef.current) clearTimeout(debounceRef.current); runSearch(code); } }}
            placeholder="Escanear, teclear código o nombre..."
            className="w-full rounded-lg border border-slate-300 py-3 pl-10 pr-10 text-sm focus:border-blue-500 focus:outline-none"
          />
          {code && (
            <button onClick={() => { setCode(''); setResults([]); setSelected(null); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Lista de resultados aproximados */}
        {code.trim() && !selected && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm max-h-[260px] overflow-y-auto">
            {searching ? (
              <div className="px-3 py-4 text-center text-sm text-slate-400">Buscando...</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-400">No se encontraron productos</div>
            ) : (
              <>
                <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Productos encontrados ({results.length})
                </div>
                {results.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setSelected(p); setCode(p.name); }}
                    className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition last:border-0 hover:bg-blue-50"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                      {p.image_url ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" /> : <ImageIcon size={16} className="text-slate-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">{p.name}</div>
                      <div className="truncate text-xs text-slate-500">
                        {p.barcode && <>CB: {p.barcode}</>}
                        {p.barcode && p.sku && ' · '}
                        {p.sku && <>SKU: {p.sku}</>}
                      </div>
                    </div>
                    <div className="text-sm font-bold text-emerald-600">{formatCurrency(Number(p.sale_price))}</div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Detalle del producto seleccionado */}
        <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-6 text-center min-h-[120px] flex flex-col items-center justify-center">
          {selected ? (
            <>
              <div className="text-xs uppercase text-slate-500">Precio</div>
              <div className="text-4xl font-bold text-emerald-600">{formatCurrency(Number(selected.sale_price))}</div>
              <div className="mt-2 text-sm font-medium text-slate-800">{selected.name}</div>
              {selected.barcode && <div className="text-xs text-slate-400">Código de barras: {selected.barcode}</div>}
              {selected.barcode_2 && <div className="text-xs text-slate-400">Código de barras 2: {selected.barcode_2}</div>}
              {selected.sku && <div className="text-xs text-slate-400">SKU: {selected.sku}</div>}
            </>
          ) : !code.trim() ? (
            <div className="text-sm text-slate-400">Escanea o escribe el nombre del producto para ver el precio</div>
          ) : (
            <div className="text-sm text-slate-400">{searching ? 'Buscando...' : 'Selecciona un producto de la lista'}</div>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Modal>
  );
}
