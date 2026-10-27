/*
# Create protected inventory count sessions

1. New Tables
- `inventory_sessions`: one persisted inventory count per branch, including its lifecycle and server-managed authorization state.
- `inventory_counts`: one draft count per product inside a session, including theoretical stock, physical count, difference, and operation-impact markers.

2. Data protection
- Inventory counts remain available after refreshes and browser closure until the session is completed.
- Verification hashes, expiry, attempt counters, and authorization timestamps are server-managed fields.
- The final stock adjustment is performed only by the authorization Edge Function after the emailed code is verified.

3. Security
- RLS is enabled on both tables.
- Browser roles receive no direct table privileges; only the server-side service role can access these tables.
- The Edge Function validates the signed-in employee, branch access, session status, code expiry, and single-use authorization before changing stock.

4. Important notes
- Existing stock, sales, and adjustment records are preserved.
- No existing columns or records are removed.
*/

CREATE TABLE IF NOT EXISTS public.inventory_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  started_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'authorization_requested', 'closed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  authorization_requested_at timestamptz,
  authorized_at timestamptz,
  authorized_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  verification_code_hash text,
  code_expires_at timestamptz,
  code_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  theoretical numeric NOT NULL DEFAULT 0,
  physical numeric,
  difference numeric,
  affected_by_operation boolean NOT NULL DEFAULT false,
  affected_quantity numeric NOT NULL DEFAULT 0,
  last_operation_at timestamptz,
  counted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, product_id)
);

CREATE INDEX IF NOT EXISTS inventory_sessions_branch_status_idx ON public.inventory_sessions(branch_id, status);
CREATE INDEX IF NOT EXISTS inventory_counts_session_idx ON public.inventory_counts(session_id);
CREATE INDEX IF NOT EXISTS inventory_counts_product_idx ON public.inventory_counts(product_id);

ALTER TABLE public.inventory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.inventory_sessions FROM anon, authenticated;
REVOKE ALL ON public.inventory_counts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_counts TO service_role;
