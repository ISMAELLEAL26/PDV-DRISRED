import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { CashRegister, CashMovement, CashBox } from '@/lib/types';

export interface OccupiedBox {
  boxId: string;
  userName: string;
}

const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.01];

function turnFolioStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function generateTurnFolio(): Promise<string> {
  const stamp = turnFolioStamp();
  const prefix = `T-${stamp}`;
  const { data, error } = await supabase
    .from('cash_registers')
    .select('folio')
    .like('folio', `${prefix}-%`)
    .order('folio', { ascending: false })
    .limit(1);
  if (error) return `${prefix}-0`;
  if (!data || data.length === 0) return `${prefix}-0`;
  const lastFolio = data[0].folio ?? `${prefix}-0`;
  const lastNum = parseInt(lastFolio.split('-').pop() ?? '0', 10);
  return `${prefix}-${lastNum + 1}`;
}

export interface TurnSummary {
  openingAmount: number;
  cashSales: number;
  cardDebit: number;
  cardCredit: number;
  transfer: number;
  cheque: number;
  vale: number;
  monedero: number;
  other: number;
  ingresos: number;
  egresos: number;
  expectedCash: number;
  cardCount: number;
  transferCount: number;
  chequeCount: number;
  valeCount: number;
  monederoCount: number;
  cashCount: number;
  totalSales: number;
}

export { DENOMINATIONS, generateTurnFolio };

export function useCashTurn() {
  const { user, profile, currentBranch } = useAuth();
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);
  const [activeRegister, setActiveRegister] = useState<CashRegister | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loadingTurn, setLoadingTurn] = useState(true);
  const [turnSummary, setTurnSummary] = useState<TurnSummary | null>(null);

  const loadCashBoxes = useCallback(async () => {
    if (!currentBranch) { setCashBoxes([]); return; }
    const { data, error } = await supabase
      .from('cash_boxes')
      .select('*')
      .eq('branch_id', currentBranch.id)
      .eq('active', true)
      .order('name');
    if (error) { console.error('cash boxes load failed', error); setCashBoxes([]); return; }
    setCashBoxes((data as CashBox[]) ?? []);
  }, [currentBranch]);

  const [occupiedBoxes, setOccupiedBoxes] = useState<Record<string, string>>({});

  const loadTurn = useCallback(async () => {
    if (!user) { setLoadingTurn(false); return; }
    setLoadingTurn(true);
    const { data: regs } = await supabase
      .from('cash_registers')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'abierta')
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const reg = (regs as CashRegister) ?? null;
    setActiveRegister(reg);
    if (currentBranch) {
      const { data: occ, error: occErr } = await supabase.rpc('get_occupied_cash_boxes', { p_branch_id: currentBranch.id });
      if (occErr) { console.error('occupied cash boxes load failed', occErr); setOccupiedBoxes({}); }
      else {
        const map: Record<string, string> = {};
        for (const r of (occ as { box_id: string; user_name: string }[]) ?? []) {
          if (r.box_id) map[r.box_id] = r.user_name ?? 'Otro usuario';
        }
        setOccupiedBoxes(map);
      }
    } else {
      setOccupiedBoxes({});
    }
    if (reg) {
      const [{ data: mv }, { data: sales }] = await Promise.all([
        supabase.from('cash_movements').select('*').eq('cash_register_id', reg.id).order('created_at'),
        supabase.from('sales').select('total, payment_method').eq('cash_register_id', reg.id).eq('status', 'completada'),
      ]);
      setMovements((mv as CashMovement[]) ?? []);
      const salesArr = (sales as { total: number; payment_method: string }[]) ?? [];
      const cashSalesArr = salesArr.filter((s) => s.payment_method === 'efectivo');
      const cardDebitArr = salesArr.filter((s) => s.payment_method === 'tarjeta');
      const cardCreditArr = salesArr.filter((s) => s.payment_method === 'credito');
      const transferArr = salesArr.filter((s) => s.payment_method === 'transferencia');
      const chequeArr = salesArr.filter((s) => s.payment_method === 'cheque');
      const valeArr = salesArr.filter((s) => s.payment_method === 'vale');
      const monederoArr = salesArr.filter((s) => s.payment_method === 'monedero_electronico');
      const otherArr = salesArr.filter((s) => !['efectivo', 'tarjeta', 'credito', 'transferencia', 'cheque', 'vale', 'monedero_electronico'].includes(s.payment_method));
      const cashSales = cashSalesArr.reduce((s, x) => s + Number(x.total), 0);
      const cardDebit = cardDebitArr.reduce((s, x) => s + Number(x.total), 0);
      const cardCredit = cardCreditArr.reduce((s, x) => s + Number(x.total), 0);
      const transfer = transferArr.reduce((s, x) => s + Number(x.total), 0);
      const cheque = chequeArr.reduce((s, x) => s + Number(x.total), 0);
      const vale = valeArr.reduce((s, x) => s + Number(x.total), 0);
      const monedero = monederoArr.reduce((s, x) => s + Number(x.total), 0);
      const other = otherArr.reduce((s, x) => s + Number(x.total), 0);
      const totalSales = cashSales + cardDebit + cardCredit + transfer + cheque + vale + monedero + other;
      const mvArr = (mv as CashMovement[]) ?? [];
      const ingresos = mvArr.filter((m) => m.type === 'ingreso').reduce((s, m) => s + Number(m.amount), 0);
      const egresos = mvArr.filter((m) => m.type === 'egreso').reduce((s, m) => s + Number(m.amount), 0);
      setTurnSummary({
        openingAmount: Number(reg.opening_amount),
        cashSales,
        cardDebit,
        cardCredit,
        transfer,
        cheque,
        vale,
        monedero,
        other,
        ingresos,
        egresos,
        expectedCash: Number(reg.opening_amount) + cashSales + ingresos - egresos,
        cashCount: cashSalesArr.length,
        cardCount: cardDebitArr.length + cardCreditArr.length,
        transferCount: transferArr.length,
        chequeCount: chequeArr.length,
        valeCount: valeArr.length,
        monederoCount: monederoArr.length,
        totalSales,
      });
    } else {
      setMovements([]);
      setTurnSummary(null);
    }
    setLoadingTurn(false);
  }, [currentBranch]);

  useEffect(() => { loadCashBoxes(); loadTurn(); }, [loadCashBoxes, loadTurn]);

  const openTurn = useCallback(async (cashBoxId: string, openingAmount: number, denomCounts: Record<number, number>): Promise<CashRegister> => {
    if (!user || !currentBranch) throw new Error('Sin usuario o sucursal');
    const folio = await generateTurnFolio();
    const { data, error } = await supabase.rpc('open_cash_turn', {
      p_branch_id: currentBranch.id,
      p_cash_box_id: cashBoxId,
      p_opening_amount: openingAmount,
      p_folio: folio,
    });
    if (error) {
      console.error('cash turn operation failed', error);
      const msg = (error.message ?? '').toLowerCase();
      if (msg.includes('user already has an open turn')) throw new Error('Ya tienes un turno abierto en otra caja o sucursal. Ciérralo primero desde el menú de caja.');
      if (msg.includes('cash box already occupied')) throw new Error('Esta caja ya está ocupada por otro usuario. Selecciona una caja disponible.');
      if (msg.includes('branch not authorized')) throw new Error('No tienes permiso para operar en esta sucursal.');
      if (msg.includes('cash box unavailable')) throw new Error('La caja seleccionada no existe o está inactiva.');
      if (msg.includes('not authorized')) throw new Error('Tu cuenta no tiene permiso para abrir turnos.');
      throw new Error('No se pudo abrir la caja. Verifica que siga disponible e intenta de nuevo.');
    }
    const reg = data as CashRegister;
    const countRows = DENOMINATIONS
      .filter((d) => (denomCounts[d] ?? 0) > 0)
      .map((d) => ({
        cash_register_id: reg.id,
        denomination: d,
        quantity: denomCounts[d] ?? 0,
        subtotal: d * (denomCounts[d] ?? 0),
      }));
    if (countRows.length > 0) {
      const { error: countError } = await supabase.from('cash_counts').insert(countRows);
      if (countError) console.error('cash opening count save failed', countError);
    }
    await loadTurn();
    return reg;
  }, [user, currentBranch, loadTurn]);

  const addMovement = useCallback(async (type: 'ingreso' | 'egreso', amount: number, reason: string, denomCounts?: Record<number, number>) => {
    if (!activeRegister) throw new Error('No hay turno abierto');
    const { error } = await supabase.from('cash_movements').insert({
      cash_register_id: activeRegister.id,
      type,
      amount,
      reason: reason || null,
    });
    if (error) { console.error('cash turn operation failed', error); throw new Error('No se pudo completar la operación de caja.'); }
    if (denomCounts) {
      const countRows = DENOMINATIONS
        .filter((d) => (denomCounts[d] ?? 0) > 0)
        .map((d) => ({
          cash_register_id: activeRegister.id,
          denomination: d,
          quantity: denomCounts[d] ?? 0,
          subtotal: d * (denomCounts[d] ?? 0),
        }));
      if (countRows.length > 0) {
        await supabase.from('cash_counts').insert(countRows);
      }
    }
    await loadTurn();
  }, [activeRegister, loadTurn]);

  const closeTurn = useCallback(async (countedCash: number, denomCounts: Record<number, number>, methodTotals: Record<string, number>) => {
    if (!activeRegister || !turnSummary) throw new Error('No hay turno abierto');
    const diff = countedCash - turnSummary.expectedCash;
    const methodBreakdown = {
      efectivo: { expected: turnSummary.expectedCash, counted: countedCash, diff },
      tarjeta: { expected: turnSummary.cardDebit, counted: methodTotals['tarjeta'] ?? 0, diff: (methodTotals['tarjeta'] ?? 0) - turnSummary.cardDebit, vouchers: turnSummary.cardCount },
      credito: { expected: turnSummary.cardCredit, counted: methodTotals['credito'] ?? 0, diff: (methodTotals['credito'] ?? 0) - turnSummary.cardCredit },
      transferencia: { expected: turnSummary.transfer, counted: methodTotals['transferencia'] ?? 0, diff: (methodTotals['transferencia'] ?? 0) - turnSummary.transfer, count: turnSummary.transferCount },
      cheque: { expected: turnSummary.cheque, counted: methodTotals['cheque'] ?? 0, diff: (methodTotals['cheque'] ?? 0) - turnSummary.cheque, count: turnSummary.chequeCount },
      vale: { expected: turnSummary.vale, counted: methodTotals['vale'] ?? 0, diff: (methodTotals['vale'] ?? 0) - turnSummary.vale, count: turnSummary.valeCount },
      monedero_electronico: { expected: turnSummary.monedero, counted: methodTotals['monedero_electronico'] ?? 0, diff: (methodTotals['monedero_electronico'] ?? 0) - turnSummary.monedero, count: turnSummary.monederoCount },
    };
    const breakdown = {
      denominations: DENOMINATIONS.map((d) => ({ denomination: d, quantity: denomCounts[d] ?? 0, subtotal: d * (denomCounts[d] ?? 0) })),
      methodTotals,
      methodBreakdown,
      expectedCash: turnSummary.expectedCash,
      countedCash,
      totalDeclared: countedCash + (methodTotals['tarjeta'] ?? 0) + (methodTotals['credito'] ?? 0) + (methodTotals['transferencia'] ?? 0) + (methodTotals['cheque'] ?? 0) + (methodTotals['vale'] ?? 0) + (methodTotals['monedero_electronico'] ?? 0),
      totalSystem: turnSummary.totalSales + turnSummary.ingresos - turnSummary.egresos + turnSummary.openingAmount,
    };
    const { error } = await supabase.from('cash_registers').update({
      status: 'cerrada',
      closing_amount: countedCash,
      expected_amount: turnSummary.expectedCash,
      difference: diff,
      closed_at: new Date().toISOString(),
      closing_breakdown: breakdown,
    }).eq('id', activeRegister.id);
    if (error) { console.error('cash turn operation failed', error); throw new Error('No se pudo completar la operación de caja.'); }
    await loadTurn();
  }, [activeRegister, turnSummary, loadTurn]);

  return {
    user,
    profile,
    currentBranch,
    cashBoxes,
    occupiedBoxes,
    activeRegister,
    movements,
    loadingTurn,
    turnSummary,
    loadTurn,
    openTurn,
    addMovement,
    closeTurn,
  };
}
