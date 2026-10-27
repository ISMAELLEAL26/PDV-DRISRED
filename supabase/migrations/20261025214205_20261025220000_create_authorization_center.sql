/*
# Centro de Autorizaciones por Token Dinámico

1. New Tables
- `authorization_folio_counters` holds per-operation, per-year sequential folio counters.
- `authorization_requests` stores each protected operation request with a one-time dynamic 6-digit token, folio, status, requester, branch, summary, and structured payload.

2. Functions
- `next_authorization_folio(p_type text) RETURNS text` atomically increments the folio counter for the given operation type and current year, returning a folio like INV-2026-0001.
- `consume_authorization(p_request_id uuid, p_token text, p_actor uuid) RETURNS jsonb` validates that the request is pending and the token matches, then burns the token (sets it to NULL) and marks the request consumed. Returns the stored payload so the caller can execute the protected operation.
- `reject_authorization(p_request_id uuid, p_actor uuid) RETURNS jsonb` marks a pending request as rejected.

3. Security
- RLS enabled on both tables.
- `authorization_requests` SELECT granted to authenticated on all columns EXCEPT `token` (the plaintext token is only readable by the service role / edge function). The service role also gets full access.
- Authenticated staff can SELECT their own requests; managers (is_admin()) can SELECT all requests.
- INSERT/UPDATE/DELETE granted only to service_role (mutations happen through the edge function using the service role key).
- `authorization_folio_counters` is internal; only the service role can read/write it.
- Helper functions are SECURITY DEFINER, executable by the service role only (revoked from PUBLIC/anon) so token validation and folio generation stay server-side.

4. Important Notes
- Each token is single-use: once consumed it is set to NULL so it can never be reused.
- This table is append-oriented and keeps a permanent history (authorized and rejected records are retained).
- Operation types are restricted to inventory, sale_cancel, and cash_cut today; new protected operations can be added by extending the CHECK constraint.
*/

CREATE TABLE IF NOT EXISTS public.authorization_folio_counters (
  operation_type text NOT NULL,
  year int NOT NULL,
  last_number int NOT NULL DEFAULT 0,
  PRIMARY KEY (operation_type, year)
);

ALTER TABLE public.authorization_folio_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.authorization_folio_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.authorization_folio_counters TO service_role;

CREATE TABLE IF NOT EXISTS public.authorization_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio text NOT NULL UNIQUE,
  operation_type text NOT NULL CHECK (operation_type IN ('inventory', 'sale_cancel', 'cash_cut')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'rejected', 'consumed')),
  token text,
  token_hash text NOT NULL,
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  summary text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_created_at timestamptz NOT NULL DEFAULT now(),
  authorized_at timestamptz,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.authorization_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT (id, folio, operation_type, status, requester_id, branch_id, summary, payload, token_created_at, authorized_at, rejected_at, rejected_by, consumed_at, created_at)
ON public.authorization_requests TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.authorization_requests TO service_role;

DROP POLICY IF EXISTS "staff_select_own_authorization_requests" ON public.authorization_requests;
CREATE POLICY "staff_select_own_authorization_requests"
ON public.authorization_requests FOR SELECT
TO authenticated
USING (is_active_staff() AND (requester_id = auth.uid() OR is_admin()));

CREATE INDEX IF NOT EXISTS authorization_requests_status_idx
ON public.authorization_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS authorization_requests_requester_idx
ON public.authorization_requests (requester_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.next_authorization_folio(p_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_prefix text;
  v_number int;
BEGIN
  IF p_type = 'inventory' THEN v_prefix := 'INV';
  ELSIF p_type = 'sale_cancel' THEN v_prefix := 'CANC';
  ELSIF p_type = 'cash_cut' THEN v_prefix := 'CORTE';
  ELSE v_prefix := UPPER(SUBSTRING(p_type FROM 1 FOR 4));
  END IF;

  INSERT INTO public.authorization_folio_counters (operation_type, year, last_number)
  VALUES (p_type, v_year, 1)
  ON CONFLICT (operation_type, year)
  DO UPDATE SET last_number = public.authorization_folio_counters.last_number + 1
  RETURNING last_number INTO v_number;

  RETURN v_prefix || '-' || v_year || '-' || lpad(v_number::text, 4, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_authorization_folio(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_authorization_folio(text) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_authorization(p_request_id uuid, p_token text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.authorization_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.authorization_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'La solicitud de autorización no existe.');
  END IF;
  IF v_row.status = 'consumed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Este token ya fue utilizado y no puede reutilizarse.');
  END IF;
  IF v_row.status = 'rejected' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La solicitud fue rechazada por gerencia.');
  END IF;
  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La solicitud ya no está pendiente.');
  END IF;
  IF v_row.token IS DISTINCT FROM p_token THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token de autorización incorrecto.');
  END IF;

  UPDATE public.authorization_requests
  SET status = 'consumed', token = NULL, consumed_at = now(), authorized_at = coalesce(authorized_at, now())
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true, 'folio', v_row.folio, 'operation_type', v_row.operation_type, 'payload', v_row.payload);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_authorization(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_authorization(uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.reject_authorization(p_request_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.authorization_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.authorization_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'La solicitud de autorización no existe.');
  END IF;
  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solo las solicitudes pendientes pueden rechazarse.');
  END IF;

  UPDATE public.authorization_requests
  SET status = 'rejected', rejected_at = now(), rejected_by = p_actor, token = NULL
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true, 'folio', v_row.folio);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_authorization(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_authorization(uuid, uuid) TO service_role;
