import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { downloadXLSX } from '@/lib/excel';
import { PROGRAM_LOGO } from '@/lib/branding';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Input, Select } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner, StatCard } from '@/components/ui';
import {
  History, Eye, FileText, FileSpreadsheet, MessageSquare, Clock,
  TrendingDown, TrendingUp, Package, Wallet, CheckCircle2, X as XIcon,
} from 'lucide-react';

interface HistorySession {
  id: string;
  folio: string | null;
  branch_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  authorized_at: string | null;
  authorized_by: string | null;
  authorized_by_name: string | null;
  started_by: string;
  observations: string | null;
  branch_name: string | null;
  started_by_name: string | null;
  inventory_mode: string | null;
  inventory_department: string | null;
  inventory_category_id: string | null;
  inventory_category_name: string | null;
  total_products: number;
  counted_products: number;
  discrepancies: number;
  total_loss: number;
  total_surplus: number;
  total_invested: number;
  total_gain: number;
}

interface DetailCount {
  product_id: string;
  theoretical: number;
  physical: number | null;
  difference: number | null;
  affected_by_operation: boolean;
  counted_at: string | null;
  product: {
    name: string;
    sku: string | null;
    barcode: string | null;
    barcode_2: string | null;
    department: string | null;
    unit: string;
    cost_price: number;
    sale_price: number;
  } | null;
}

interface DetailSession {
  id: string;
  folio: string | null;
  branch_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  authorized_at: string | null;
  authorized_by: string | null;
  authorized_by_name: string | null;
  started_by: string;
  observations: string | null;
  branch_name: string | null;
  inventory_mode: string | null;
  inventory_department: string | null;
  inventory_category_id: string | null;
  inventory_category_name: string | null;
  branch: {
    name: string;
    address: string | null;
    phone: string | null;
    street: string | null;
    exterior_number: string | null;
    neighborhood: string | null;
    municipality: string | null;
    state: string | null;
    postal_code: string | null;
  } | null;
  started_by_name: string | null;
}

interface HistoryResponse {
  sessions?: HistorySession[];
  error?: string;
}

interface DetailResponse {
  session?: DetailSession;
  counts?: DetailCount[];
  error?: string;
}

function elapsedDuration(startISO: string, endISO: string | null): string {
  if (!endISO) return '—';
  const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
  if (ms < 0 || isNaN(ms)) return '—';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface InventorySummary {
  totalLoss: number;
  totalSurplus: number;
  totalInvested: number;
  totalGain: number;
}

function calculateInventorySummary(counts: DetailCount[]): InventorySummary {
  return counts.reduce<InventorySummary>((summary, count) => {
    const difference = Number(count.difference ?? 0);
    const cost = Number(count.product?.cost_price ?? 0);
    const salePrice = Number(count.product?.sale_price ?? 0);
    const costValue = difference * cost;
    if (costValue < 0) summary.totalLoss += Math.abs(costValue);
    if (costValue > 0) summary.totalSurplus += costValue;
    summary.totalInvested += Math.abs(difference) * cost;
    summary.totalGain += Math.abs(difference) * salePrice;
    return summary;
  }, { totalLoss: 0, totalSurplus: 0, totalInvested: 0, totalGain: 0 });
}

function modeLabel(mode: string | null): string {
  if (mode === 'scan') return 'Escaneo';
  if (mode === 'department') return 'Por Departamento';
  if (mode === 'category') return 'Por Categoría';
  return '—';
}

function modeScopeLabel(session: { inventory_mode: string | null; inventory_department: string | null; inventory_category_name: string | null }): string {
  if (session.inventory_mode === 'scan') return 'Escaneo individual';
  if (session.inventory_mode === 'department') return session.inventory_department ?? '—';
  if (session.inventory_mode === 'category') return session.inventory_category_name ?? '—';
  return '—';
}

function buildExcelReport(session: DetailSession, counts: DetailCount[]): void {
  const discrep = counts.filter((c) => Number(c.difference ?? 0) !== 0);
  const { totalLoss, totalSurplus, totalInvested, totalGain } = calculateInventorySummary(counts);

  const branchAddress = [session.branch?.street && session.branch?.exterior_number ? `${session.branch.street} No. ${session.branch.exterior_number}` : session.branch?.address, [session.branch?.neighborhood, session.branch?.municipality, session.branch?.state, session.branch?.postal_code && `C.P. ${session.branch.postal_code}`].filter(Boolean).join(', ')].filter(Boolean).join(' | ');
  const infoRows: (string | number)[][] = [
    ['REPORTE DE INVENTARIO', ''],
    ['Identificador de sesión', session.id],
    ['', ''],
    ['Folio', session.folio ?? '—'],
    ['Sucursal', session.branch?.name ?? '—'],
    ['Dirección', branchAddress || '—'],
    ['Teléfono', session.branch?.phone ?? '—'],
    ['Tipo de inventario', modeLabel(session.inventory_mode)],
    ['Alcance', modeScopeLabel(session)],
    ['Fecha de inicio', formatDateTime(session.started_at)],
    ['Fecha de cierre', formatDateTime(session.completed_at)],
    ['Duración', elapsedDuration(session.started_at, session.completed_at)],
    ['Realizado por', session.started_by_name ?? '—'],
    ['Autorizado por', session.authorized_by_name ?? '—'],
    ['Total de productos contados', counts.filter((c) => c.physical != null).length],
    ['Productos con discrepancia', discrep.length],
    ['', ''],
    ['Total Perdida (Faltantes)', totalLoss],
    ['Total Sobrante', totalSurplus],
    ['Dinero Invertido', totalInvested],
    ['Ganancia Estimada', totalGain],
  ];

  const detailHeaders = ['Producto', 'SKU', 'Codigo de Barras', 'Departamento', 'Unidad', 'Existencia Teorica', 'Existencia Fisica', 'Diferencia', 'Costo Unitario', 'Precio Venta', 'Monto Diferencia', 'Tipo', 'Contado en', 'Afectado por caja'];
  const detailRows: (string | number)[][] = counts.map((c) => {
    const diff = Number(c.difference ?? 0);
    const cost = Number(c.product?.cost_price ?? 0);
    const amount = diff * cost;
    return [
      c.product?.name ?? '—',
      c.product?.sku ?? '—',
      c.product?.barcode ?? c.product?.barcode_2 ?? '—',
      c.product?.department ?? '—',
      c.product?.unit ?? '—',
      Number(c.theoretical),
      c.physical != null ? Number(c.physical) : 'No contado',
      diff,
      cost,
      Number(c.product?.sale_price ?? 0),
      amount,
      diff < 0 ? 'Faltante' : diff > 0 ? 'Sobrante' : 'Cuadrado',
      c.counted_at ? formatDateTime(c.counted_at) : '—',
      c.affected_by_operation ? 'Sí' : 'No',
    ];
  });

  downloadXLSX(`Inventario_${session.folio ?? session.id}.xlsx`, [
    { name: 'Resumen', headers: ['Campo', 'Valor'], rows: infoRows },
    { name: 'Detalle Productos', headers: detailHeaders, rows: detailRows },
  ]);
}

function buildPDFReport(session: DetailSession, counts: DetailCount[]): void {
  const discrep = counts.filter((c) => Number(c.difference ?? 0) !== 0);
  const { totalLoss, totalSurplus, totalInvested, totalGain } = calculateInventorySummary(counts);

  const branch = session.branch;
  const branchLines = [
    branch?.street && branch?.exterior_number ? `${branch.street} No. ${branch.exterior_number}` : branch?.address,
    [branch?.neighborhood, branch?.municipality, branch?.state, branch?.postal_code && `C.P. ${branch.postal_code}`].filter(Boolean).join(', '),
    branch?.phone,
  ].filter(Boolean) as string[];
  const reportLogoUrl = `${window.location.origin}${PROGRAM_LOGO}`;

  const rowsHtml = counts.map((c) => {
    const diff = Number(c.difference ?? 0);
    const cost = Number(c.product?.cost_price ?? 0);
    const amount = diff * cost;
    const color = diff < 0 ? '#dc2626' : diff > 0 ? '#16a34a' : '#6b7280';
    const type = diff < 0 ? 'Faltante' : diff > 0 ? 'Sobrante' : 'Cuadrado';
    return `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(c.product?.name ?? '—')}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(c.product?.sku ?? '—')}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(c.product?.barcode ?? c.product?.barcode_2 ?? '—')}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(c.product?.department ?? '—')}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(c.product?.unit ?? '—')}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${c.theoretical}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${c.physical ?? '—'}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:${color};">${diff > 0 ? '+' : ''}${diff}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(amount)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;color:${color};">${type}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${c.counted_at ? escapeHtml(formatDateTime(c.counted_at)) : '—'}</td>
    </tr>`;
  }).join('');

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de Inventario ${escapeHtml(session.folio ?? '')}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 0; }
    .header { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid #0b347d; padding-bottom: 12px; margin-bottom: 20px; }
    .header img { max-height: 60px; object-fit: contain; }
    .header h1 { font-size: 20px; color: #0b347d; margin: 0; }
    .header .subtitle { font-size: 12px; color: #64748b; margin-top: 2px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 20px; font-size: 13px; }
    .info-grid .label { color: #64748b; }
    .info-grid .value { font-weight: 600; }
    .stats { display: flex; gap: 12px; margin-bottom: 20px; }
    .stat { flex: 1; border-radius: 8px; padding: 12px; text-align: center; }
    .stat-loss { background: #fef2f2; }
    .stat-surplus { background: #f0fdf4; }
    .stat-invested { background: #eff6ff; }
    .stat-gain { background: #fefce8; }
    .stat .stat-label { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
    .stat .stat-value { font-size: 16px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    thead th { background: #f8fafc; padding: 8px; text-align: left; border-bottom: 2px solid #e5e7eb; font-size: 10px; text-transform: uppercase; color: #64748b; }
    .observations { margin-top: 20px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
    .observations h3 { font-size: 13px; margin: 0 0 8px; color: #374151; }
    .observations p { font-size: 12px; color: #6b7280; margin: 0; white-space: pre-wrap; }
    .footer { margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 8px; font-size: 10px; color: #94a3b8; text-align: center; }
    @media print { .no-print { display: none; } }
  </style></head><body>
    <div class="header">
      <img src="${reportLogoUrl}" alt="Logo de la tienda" onerror="this.style.display='none'" />
      <div>
        <h1>Reporte de Inventario</h1>
        <div class="subtitle">Folio: ${escapeHtml(session.folio ?? '—')} · ${escapeHtml(branch?.name ?? '—')}</div>
      </div>
    </div>
    <div class="info-grid">
      <div><span class="label">Folio:</span> <span class="value">${escapeHtml(session.folio ?? '—')}</span></div>
      <div><span class="label">Sucursal:</span> <span class="value">${escapeHtml(branch?.name ?? '—')}</span></div>
      <div><span class="label">Dirección:</span> <span class="value">${escapeHtml(branchLines.join(' · ') || '—')}</span></div>
      <div><span class="label">Tipo:</span> <span class="value">${escapeHtml(modeLabel(session.inventory_mode))}</span></div>
      <div><span class="label">Alcance:</span> <span class="value">${escapeHtml(modeScopeLabel(session))}</span></div>
      <div><span class="label">Fecha de inicio:</span> <span class="value">${formatDateTime(session.started_at)}</span></div>
      <div><span class="label">Fecha de cierre:</span> <span class="value">${formatDateTime(session.completed_at)}</span></div>
      <div><span class="label">Duracion:</span> <span class="value">${elapsedDuration(session.started_at, session.completed_at)}</span></div>
      <div><span class="label">Realizado por:</span> <span class="value">${escapeHtml(session.started_by_name ?? '—')}</span></div>
      <div><span class="label">Autorizado por:</span> <span class="value">${escapeHtml(session.authorized_by_name ?? '—')}</span></div>
      <div><span class="label">Teléfono:</span> <span class="value">${escapeHtml(branch?.phone ?? '—')}</span></div>
      <div><span class="label">Productos contados:</span> <span class="value">${counts.length}</span></div>
    </div>
    <div class="stats">
      <div class="stat stat-loss"><div class="stat-label">Total Perdida</div><div class="stat-value" style="color:#dc2626;">${formatCurrency(totalLoss)}</div></div>
      <div class="stat stat-surplus"><div class="stat-label">Total Sobrante</div><div class="stat-value" style="color:#16a34a;">${formatCurrency(totalSurplus)}</div></div>
      <div class="stat stat-invested"><div class="stat-label">Dinero Invertido</div><div class="stat-value" style="color:#2563eb;">${formatCurrency(totalInvested)}</div></div>
      <div class="stat stat-gain"><div class="stat-label">Ganancia Estimada</div><div class="stat-value" style="color:#ca8a04;">${formatCurrency(totalGain)}</div></div>
    </div>
    <table>
      <thead><tr><th>Producto</th><th>SKU</th><th>Código</th><th>Departamento</th><th>Unidad</th><th style="text-align:right;">Teórico</th><th style="text-align:right;">Físico</th><th style="text-align:right;">Diferencia</th><th style="text-align:right;">Monto</th><th>Tipo</th><th>Contado en</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    ${session.observations ? `<div class="observations"><h3>Observaciones y Comentarios</h3><p>${escapeHtml(session.observations)}</p></div>` : ''}
    <div class="footer">Reporte generado el ${formatDateTime(new Date().toISOString())} · Sistema de Punto de Venta</div>
    <script>(function(){setTimeout(function(){try{window.print()}catch(e){}},300)})();</script>
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (win) {
    win.focus();
    win.addEventListener('load', () => URL.revokeObjectURL(url));
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else {
    URL.revokeObjectURL(url);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default function InventoryHistoryPage() {
  const { branches, currentBranch } = useAuth();
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('');

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSession, setDetailSession] = useState<DetailSession | null>(null);
  const [detailCounts, setDetailCounts] = useState<DetailCount[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [observationsOpen, setObservationsOpen] = useState(false);
  const [observationsText, setObservationsText] = useState('');
  const [observationsSessionId, setObservationsSessionId] = useState<string | null>(null);
  const [savingObs, setSavingObs] = useState(false);

  const selectedBranchId = filterBranch || currentBranch?.id || '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('authorize-inventory', {
        body: { action: 'history', branchId: selectedBranchId || undefined },
      });
      const response = data as HistoryResponse | null;
      if (fnError || response?.error) {
        setError(response?.error ?? 'No se pudo cargar el historial.');
      } else {
        setSessions(response?.sessions ?? []);
      }
    } catch {
      setError('Ocurrió un error al cargar el historial.');
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (!query) return true;
      return (s.folio ?? '').toLowerCase().includes(query) || (s.branch_name ?? '').toLowerCase().includes(query) || (s.started_by_name ?? '').toLowerCase().includes(query);
    });
  }, [sessions, search]);

  const openDetail = async (sessionId: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetailSession(null);
    setDetailCounts([]);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('authorize-inventory', {
        body: { action: 'history_detail', sessionId },
      });
      const response = data as DetailResponse | null;
      if (fnError || response?.error) {
        setDetailError(response?.error ?? 'No se pudo cargar el detalle.');
      } else {
        setDetailSession(response?.session ?? null);
        setDetailCounts(response?.counts ?? []);
      }
    } catch {
      setDetailError('Ocurrió un error al cargar el detalle.');
    } finally {
      setDetailLoading(false);
    }
  };

  const openObservations = (session: HistorySession) => {
    setObservationsSessionId(session.id);
    setObservationsText(session.observations ?? '');
    setObservationsOpen(true);
  };

  const saveObservations = async () => {
    if (!observationsSessionId) return;
    setSavingObs(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('authorize-inventory', {
        body: { action: 'save_observations', sessionId: observationsSessionId, observations: observationsText },
      });
      if (fnError || (data as { error?: string } | null)?.error) {
        setError((data as { error?: string } | null)?.error ?? 'No se guardaron las observaciones.');
      } else {
        setObservationsOpen(false);
        setSessions((prev) => prev.map((s) => s.id === observationsSessionId ? { ...s, observations: observationsText } : s));
        if (detailSession?.id === observationsSessionId) {
          setDetailSession({ ...detailSession, observations: observationsText });
        }
      }
    } catch {
      setError('No se guardaron las observaciones.');
    } finally {
      setSavingObs(false);
    }
  };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="device-page p-6">
      <PageHeader title="Historial de Inventarios" subtitle="Inventarios cerrados agrupados por folio y fecha" />

      {error && <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar folio, sucursal o responsable..." />
        <Select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
          <option value="">Todas las sucursales</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <div className="flex items-center justify-end">
          <Button variant="secondary" onClick={load}>Actualizar</Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card><EmptyState title="Sin historial" description="Aún no hay inventarios cerrados." icon={<History size={48} />} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Folio</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Sucursal</th>
                  <th className="px-4 py-3">Tipo de inventario</th>
                  <th className="px-4 py-3">Selección</th>
                  <th className="px-4 py-3">Realizado por</th>
                  <th className="px-4 py-3">Autorizado por</th>
                  <th className="px-4 py-3 text-right">Productos</th>
                  <th className="px-4 py-3 text-right">Discrepancias</th>
                  <th className="px-4 py-3 text-right">Pérdida</th>
                  <th className="px-4 py-3 text-right">Sobrante</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{s.folio ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(s.started_at)}</td>
                    <td className="px-4 py-3 text-slate-600">{s.branch_name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-700">{modeLabel(s.inventory_mode)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{modeScopeLabel(s)}</td>
                    <td className="px-4 py-3 text-slate-600">{s.started_by_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{s.authorized_by_name ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{s.counted_products}/{s.total_products}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={s.discrepancies > 0 ? 'font-semibold text-red-600' : 'text-emerald-600'}>{s.discrepancies}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{s.total_loss > 0 ? formatCurrency(s.total_loss) : '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">{s.total_surplus > 0 ? formatCurrency(s.total_surplus) : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openDetail(s.id)} title="Ver detalle" className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"><Eye size={16} /></button>
                        <button onClick={() => openObservations(s)} title="Observaciones" className={`rounded-lg p-1.5 hover:bg-amber-50 ${s.observations ? 'text-amber-600' : 'text-slate-400'}`}><MessageSquare size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={`Detalle del Inventario ${detailSession?.folio ?? ''}`} size="xl">
        {detailLoading ? (
          <div className="py-8"><Spinner size={32} /></div>
        ) : detailError ? (
          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{detailError}</div>
        ) : detailSession ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Duración" value={elapsedDuration(detailSession.started_at, detailSession.completed_at)} icon={<Clock size={18} />} accent="blue" />
              <StatCard label="Productos Contados" value={String(detailCounts.length)} icon={<Package size={18} />} accent="slate" />
              <StatCard label="Discrepancias" value={String(detailCounts.filter((c) => Number(c.difference ?? 0) !== 0).length)} icon={<XIcon size={18} />} accent="rose" />
              <StatCard label="Cuadrados" value={String(detailCounts.filter((c) => Number(c.difference ?? 0) === 0 && c.physical != null).length)} icon={<CheckCircle2 size={18} />} accent="emerald" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(() => {
                const { totalLoss, totalSurplus, totalInvested, totalGain } = calculateInventorySummary(detailCounts);
                return (
                  <>
                    <StatCard label="Total Pérdida" value={formatCurrency(totalLoss)} icon={<TrendingDown size={18} />} accent="rose" />
                    <StatCard label="Total Sobrante" value={formatCurrency(totalSurplus)} icon={<TrendingUp size={18} />} accent="emerald" />
                    <StatCard label="Dinero Invertido" value={formatCurrency(totalInvested)} icon={<Wallet size={18} />} accent="blue" />
                    <StatCard label="Ganancia Estimada" value={formatCurrency(totalGain)} icon={<TrendingUp size={18} />} accent="amber" />
                  </>
                );
              })()}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="text-xs font-semibold uppercase text-slate-400">Información del Inventario</div>
                <dl className="mt-2 space-y-1">
                  <div className="flex justify-between"><dt className="text-slate-500">Folio:</dt><dd className="font-medium text-slate-700">{detailSession.folio ?? '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Tipo:</dt><dd className="font-medium text-slate-700">{modeLabel(detailSession.inventory_mode)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Alcance:</dt><dd className="font-medium text-slate-700">{modeScopeLabel(detailSession)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Inicio:</dt><dd className="font-medium text-slate-700">{formatDateTime(detailSession.started_at)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Cierre:</dt><dd className="font-medium text-slate-700">{formatDateTime(detailSession.completed_at)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Duración:</dt><dd className="font-medium text-slate-700">{elapsedDuration(detailSession.started_at, detailSession.completed_at)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Realizado por:</dt><dd className="font-medium text-slate-700">{detailSession.started_by_name ?? '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Autorizado por:</dt><dd className="font-medium text-slate-700">{detailSession.authorized_by_name ?? '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Sucursal:</dt><dd className="font-medium text-slate-700">{detailSession.branch?.name ?? '—'}</dd></div>
                </dl>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase text-slate-400">Observaciones</div>
                  <button onClick={() => { setObservationsSessionId(detailSession.id); setObservationsText(detailSession.observations ?? ''); setObservationsOpen(true); }} className="text-xs font-medium text-blue-600 hover:underline">Editar</button>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-slate-600">{detailSession.observations ?? 'Sin observaciones.'}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => buildPDFReport(detailSession, detailCounts)}><FileText size={16} /> Descargar PDF</Button>
              <Button variant="secondary" onClick={() => buildExcelReport(detailSession, detailCounts)}><FileSpreadsheet size={16} /> Descargar Excel</Button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2 text-right">Teórico</th>
                    <th className="px-3 py-2 text-right">Físico</th>
                    <th className="px-3 py-2 text-right">Diferencia</th>
                    <th className="px-3 py-2 text-right">Monto</th>
                    <th className="px-3 py-2">Tipo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detailCounts.map((c) => {
                    const diff = Number(c.difference ?? 0);
                    const amount = diff * Number(c.product?.cost_price ?? 0);
                    return (
                      <tr key={c.product_id} className={diff < 0 ? 'bg-red-50/30' : diff > 0 ? 'bg-emerald-50/30' : ''}>
                        <td className="px-3 py-2 font-medium text-slate-700">{c.product?.name ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{c.product?.sku ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{Number(c.theoretical)}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{c.physical ?? '—'}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${diff < 0 ? 'text-red-600' : diff > 0 ? 'text-emerald-600' : 'text-slate-600'}`}>{diff > 0 ? '+' : ''}{diff}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(amount)}</td>
                        <td className="px-3 py-2 text-xs">{diff < 0 ? <span className="text-red-600">Faltante</span> : diff > 0 ? <span className="text-emerald-600">Sobrante</span> : <span className="text-slate-500">Cuadrado</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={observationsOpen} onClose={() => setObservationsOpen(false)} title="Observaciones y Comentarios" size="md">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Agrega comentarios u observaciones sobre este inventario. Se guardarán junto al registro para consulta futura.</p>
          <textarea
            value={observationsText}
            onChange={(e) => setObservationsText(e.target.value)}
            rows={6}
            placeholder="Escribe observaciones, notas o comentarios sobre este inventario..."
            className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setObservationsOpen(false)}>Cancelar</Button>
            <Button onClick={saveObservations} disabled={savingObs}>{savingObs ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
