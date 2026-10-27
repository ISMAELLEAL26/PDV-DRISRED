import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';
import { PROGRAM_LOGO } from '@/lib/branding';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { AlertTriangle, Lock, MessageCircle, ShieldCheck, Loader2 } from 'lucide-react';

export type AuthorizationOperationType = 'inventory' | 'sale_cancel' | 'cash_cut';

export interface AuthorizationPayload {
  operationType: AuthorizationOperationType;
  branchId?: string | null;
  summary: string;
  payload?: Record<string, unknown>;
}

export interface CreatedAuthorizationRequest {
  id: string;
  folio: string;
  token: string;
}

interface AuthorizationModalProps {
  open: boolean;
  onClose: () => void;
  payload: AuthorizationPayload | null;
  onAuthorized: (request: { id: string; folio: string; payload: Record<string, unknown> }) => Promise<void> | void;
  onRequestCreated?: () => void;
  managerWhatsapp?: string;
}

function whatsappUrl(phone: string, message: string): string {
  const clean = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

export default function AuthorizationModal({ open, onClose, payload, onAuthorized, onRequestCreated, managerWhatsapp }: AuthorizationModalProps) {
  const { profile } = useAuth();
  const [creating, setCreating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [request, setRequest] = useState<CreatedAuthorizationRequest | null>(null);
  const [verifiedAuthorization, setVerifiedAuthorization] = useState<{ id: string; folio: string; payload: Record<string, unknown> } | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setRequest(null);
    setVerifiedAuthorization(null);
    setTokenInput('');
    setError(null);
    setCreating(false);
    setValidating(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const createRequest = async () => {
    if (!payload) return;
    setCreating(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('authorization-center', {
        body: {
          action: 'create',
          operation_type: payload.operationType,
          branch_id: payload.branchId ?? null,
          summary: payload.summary,
          payload: payload.payload ?? {},
        },
      });
      const result = data as { success?: boolean; request?: { id: string; folio: string }; token?: string; error?: string } | null;
      if (fnError || !result?.success || !result.request) {
        setError(result?.error ?? 'No se pudo crear la solicitud de autorización.');
        setCreating(false);
        return;
      }
      setRequest({ id: result.request.id, folio: result.request.folio, token: result.token ?? '' });
      onRequestCreated?.();
    } catch {
      setError('No se pudo crear la solicitud. Revisa tu conexión.');
    } finally {
      setCreating(false);
    }
  };

  const validateToken = async () => {
    if (!request) return;
    if (!verifiedAuthorization && tokenInput.length !== 6) {
      setError('Ingresa el token de 6 dígitos.');
      return;
    }
    setValidating(true);
    setError(null);
    try {
      let authorization = verifiedAuthorization;
      if (!authorization) {
        const { data, error: fnError } = await supabase.functions.invoke('authorization-center', {
          body: { action: 'consume', request_id: request.id, token: tokenInput },
        });
        const result = data as { success?: boolean; payload?: Record<string, unknown>; error?: string; folio?: string } | null;
        if (fnError || !result?.success) {
          setError(result?.error ?? 'Token de autorización incorrecto.');
          return;
        }
        authorization = { id: request.id, folio: result.folio ?? request.folio, payload: result.payload ?? {} };
        setVerifiedAuthorization(authorization);
      }
      await onAuthorized(authorization);
      close();
    } catch (caughtError) {
      setError(caughtError instanceof Error && caughtError.message ? caughtError.message : 'No se pudo guardar el inventario. Revisa tu conexión.');
    } finally {
      setValidating(false);
    }
  };

  useEffect(() => {
    if (open && !request && payload && !creating) {
      void createRequest();
    }
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal open={open} onClose={close} title=" " size="md">
      <div className="space-y-5">
        <div className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-6 text-center text-white shadow-lg">
          <img src={PROGRAM_LOGO} alt="Logo" className="mx-auto mb-3 h-12 max-w-[60%] object-contain" />
          <h2 className="text-2xl font-extrabold tracking-tight">PIDE AUTORIZACIÓN A GERENCIA</h2>
          <p className="mt-1 text-sm font-medium text-slate-300">Token de Autorización de Gerencia</p>
        </div>

        {!request ? (
          <div className="space-y-4 text-center">
            <Loader2 size={28} className="mx-auto animate-spin text-slate-400" />
            <p className="text-sm text-slate-600">Generando solicitud de autorización…</p>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Folio de la operación</div>
              <div className="mt-1 text-xl font-extrabold tracking-wider text-slate-800">{request.folio}</div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600">
                Solicita a Gerencia el <span className="font-semibold text-slate-800">Token de 6 dígitos</span> generado para este folio.
              </div>
              {managerWhatsapp && (
                <a
                  href={whatsappUrl(managerWhatsapp, `Hola Gerencia, requiero autorización para la solicitud con Folio ${request.folio}.`)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                >
                  <MessageCircle size={16} /> Solicitar por WhatsApp
                </a>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Token de Autorización (6 dígitos)</label>
              <input
                autoFocus
                inputMode="numeric"
                maxLength={6}
                className="w-full rounded-lg border border-slate-300 px-3 py-3 text-center text-3xl font-bold tracking-[0.6em] focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                value={tokenInput}
                onChange={(e) => { setTokenInput(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && tokenInput.length === 6 && !validating) validateToken(); }}
                placeholder="000000"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={close} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">Cancelar</button>
              <button
                onClick={validateToken}
                disabled={validating || tokenInput.length !== 6}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {validating ? <><Loader2 size={16} className="animate-spin" /> Validando…</> : <><ShieldCheck size={16} /> Autorizar y Guardar</>}
              </button>
            </div>
            <div className="flex items-center justify-center gap-1.5 pt-1 text-xs text-slate-400">
              <Lock size={12} /> Token de único uso · empleado: {profile?.full_name ?? '—'}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
