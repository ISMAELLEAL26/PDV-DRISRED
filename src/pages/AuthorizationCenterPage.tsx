import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PageHeader, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import Button from '@/components/Button';
import { ShieldCheck, Clock, CheckCircle2, XCircle, FileText, MessageCircle, RefreshCw, Lock, KeyRound } from 'lucide-react';

type StatusFilter = 'pending' | 'history' | 'rejected';

interface AuthRequestRow {
  id: string;
  folio: string;
  operation_type: 'inventory' | 'sale_cancel' | 'cash_cut';
  status: 'pending' | 'authorized' | 'rejected' | 'consumed';
  summary: string;
  payload: Record<string, unknown>;
  branch_id: string | null;
  created_at: string;
  token?: string | null;
  token_created_at: string;
  authorized_at: string | null;
  rejected_at: string | null;
  consumed_at: string | null;
  requester?: { full_name: string | null; email: string | null; phone: string | null } | null;
  branch?: { name: string | null } | null;
}

const OPERATION_LABELS: Record<string, string> = {
  inventory: 'Inventario',
  sale_cancel: 'Cancelación de venta',
  cash_cut: 'Corte de caja',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function whatsappUrl(phone: string, message: string): string {
  const clean = (phone ?? '').replace(/[^\d]/g, '');
  return clean ? `https://wa.me/${clean}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function buildSummaryHtml(row: AuthRequestRow): string {
  const items = Array.isArray(row.payload?.items) ? (row.payload.items as Array<Record<string, unknown>>) : [];
  const rows = items.map((item) => {
    const name = String(item.name ?? '—');
    const theoretical = Number(item.theoretical ?? 0);
    const physical = Number(item.physical ?? 0);
    const diff = Number(item.difference ?? physical - theoretical);
    const sign = diff > 0 ? '+' : '';
    const color = diff < 0 ? '#dc2626' : diff > 0 ? '#16a34a' : '#475569';
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(name)}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${theoretical}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${physical}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:${color};font-weight:600;">${sign}${diff}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Resumen ${row.folio}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:0 auto;padding:24px;color:#1e293b;">
<h1 style="font-size:22px;color:#0f172a;margin-bottom:4px;">Resumen de Autorización</h1>
<p style="color:#64748b;font-size:14px;margin-bottom:20px;">Folio: <strong>${escapeHtml(row.folio)}</strong> · ${OPERATION_LABELS[row.operation_type] ?? row.operation_type}</p>
<table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:20px;">
<tr><td style="padding:8px 0;color:#64748b;">Solicitante:</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(row.requester?.full_name ?? '—')}</td></tr>
<tr><td style="padding:8px 0;color:#64748b;">Sucursal:</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(row.branch?.name ?? '—')}</td></tr>
<tr><td style="padding:8px 0;color:#64748b;">Fecha:</td><td style="padding:8px 0;font-weight:600;">${formatDateTime(row.created_at)}</td></tr>
<tr><td style="padding:8px 0;color:#64748b;">Estado:</td><td style="padding:8px 0;font-weight:600;">${row.status}</td></tr>
</table>
<p style="font-size:14px;color:#334155;margin-bottom:12px;">${escapeHtml(row.summary)}</p>
${items.length > 0 ? `<h2 style="font-size:16px;color:#0f172a;margin-bottom:10px;">Detalle</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;">
<thead><tr style="background:#f8fafc;"><th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb;">Producto</th><th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e5e7eb;">Teórico</th><th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e5e7eb;">Físico</th><th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e5e7eb;">Diferencia</th></tr></thead>
<tbody>${rows}</tbody></table>` : ''}
<p style="margin-top:24px;font-size:12px;color:#94a3b8;">Documento generado por el Centro de Autorizaciones.</p>
</body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default function AuthorizationCenterPage() {
  const [tab, setTab] = useState<StatusFilter>('pending');
  const [requests, setRequests] = useState<AuthRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('authorization-center', {
        body: { action: 'list', status_filter: tab },
      });
      const result = data as { success?: boolean; requests?: AuthRequestRow[]; error?: string } | null;
      if (fnError || !result?.success) {
        setError(result?.error ?? 'No se pudieron cargar las solicitudes.');
        if (!silent) setRequests([]);
      } else {
        setRequests(result.requests ?? []);
      }
    } finally {
      loadingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
    if (tab !== 'pending') return;
    const timer = window.setInterval(() => { void load(true); }, 3000);
    return () => window.clearInterval(timer);
  }, [load, tab]);

  const reject = async (id: string) => {
    if (!confirm('¿Rechazar esta solicitud de autorización?')) return;
    setRejecting(id);
    const { data, error: fnError } = await supabase.functions.invoke('authorization-center', {
      body: { action: 'reject', request_id: id },
    });
    const result = data as { success?: boolean; error?: string } | null;
    if (fnError || !result?.success) {
      setError(result?.error ?? 'No se pudo rechazar la solicitud.');
    } else {
      await load();
    }
    setRejecting(null);
  };

  const downloadSummary = (row: AuthRequestRow) => {
    const html = buildSummaryHtml(row);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (w) {
      w.onload = () => { setTimeout(() => w.print(), 300); };
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const tabs: { key: StatusFilter; label: string; icon: typeof ShieldCheck }[] = [
    { key: 'pending', label: 'Pendientes por Autorizar', icon: Clock },
    { key: 'history', label: 'Historial de Autorizadas', icon: CheckCircle2 },
    { key: 'rejected', label: 'Rechazadas', icon: XCircle },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Centro de Autorizaciones" subtitle="Tokens dinámicos de gerencia para operaciones protegidas" />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${tab === t.key ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
        <button onClick={() => { void load(); }} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <Spinner size={32} />
      ) : requests.length === 0 ? (
        <Card><EmptyState title={tab === 'pending' ? 'Sin solicitudes pendientes' : tab === 'rejected' ? 'Sin solicitudes rechazadas' : 'Sin historial'} description="Cuando se generen solicitudes aparecerán aquí." icon={<ShieldCheck size={48} />} /></Card>
      ) : (
        <div className="space-y-3">
          {requests.map((row) => {
            const token = row.token ?? undefined;
            const phone = row.requester?.phone ?? '';
            const activity = OPERATION_LABELS[row.operation_type] ?? row.operation_type;
            const whatsappMsg = token
              ? `Hola ${row.requester?.full_name ?? 'Cajero'}, autoriza tu actividad de ${activity}, con el folio ${row.folio}. Usa este token: ${token}.`
              : `Hola ${row.requester?.full_name ?? 'Cajero'}, tu solicitud con folio ${row.folio} fue procesada.`;
            return (
              <Card key={row.id} className="p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-extrabold tracking-wider text-slate-800">{row.folio}</span>
                      <Badge variant={row.operation_type === 'inventory' ? 'info' : row.operation_type === 'cash_cut' ? 'warning' : 'danger'}>{OPERATION_LABELS[row.operation_type] ?? row.operation_type}</Badge>
                      <Badge variant={row.status === 'pending' ? 'warning' : row.status === 'rejected' ? 'danger' : 'success'}>{row.status === 'pending' ? 'Pendiente' : row.status === 'rejected' ? 'Rechazada' : 'Autorizada'}</Badge>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Solicitante: <span className="font-medium text-slate-800">{row.requester?.full_name ?? '—'}</span>
                      <span className="mx-2 text-slate-300">·</span>
                      Sucursal: <span className="font-medium text-slate-800">{row.branch?.name ?? '—'}</span>
                      <span className="mx-2 text-slate-300">·</span>
                      {formatDateTime(row.created_at)}
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{row.summary}</p>
                  </div>

                  {tab === 'pending' && token && (
                    <div className="flex-shrink-0 rounded-xl border-2 border-amber-300 bg-amber-50 px-5 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700"><KeyRound size={12} /> Token dinámico</div>
                      <div className="mt-1 text-3xl font-extrabold tracking-[0.4em] text-amber-900">{token}</div>
                      <div className="mt-1 text-[10px] text-amber-600">Solo gerencia · único uso</div>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <Button variant="secondary" onClick={() => downloadSummary(row)}><FileText size={14} /> Descargar PDF de Resumen</Button>
                  {tab === 'pending' && token && (
                    <a href={whatsappUrl(phone, whatsappMsg)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 hover:shadow-md">
                      <MessageCircle size={14} /> Enviar Token por WhatsApp
                    </a>
                  )}
                  {tab === 'pending' && (
                    <Button variant="danger" onClick={() => reject(row.id)} disabled={rejecting === row.id}>
                      <XCircle size={14} /> {rejecting === row.id ? 'Rechazando…' : 'Rechazar'}
                    </Button>
                  )}
                  {tab !== 'pending' && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                      <Lock size={12} /> Token {row.status === 'consumed' ? 'consumido' : row.status === 'rejected' ? 'invalidado' : 'autorizado'}
                      {row.consumed_at && ` · ${formatDateTime(row.consumed_at)}`}
                      {row.rejected_at && ` · ${formatDateTime(row.rejected_at)}`}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
