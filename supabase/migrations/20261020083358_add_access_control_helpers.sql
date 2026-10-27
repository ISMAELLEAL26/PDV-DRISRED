/*
# Access control helpers and baseline hardening

Adds the capability helpers every policy will consult, promotes the founding
account to Administrador so administrative screens keep working, and removes
the unused table grants held by the anon role.
*/

CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.active
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
      AND p.active
      AND r.permissions @> '["all"]'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.has_capability(capability text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
      AND p.active
      AND (r.permissions @> '["all"]'::jsonb
           OR r.permissions @> to_jsonb(ARRAY[capability]))
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_staff() FROM anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon;
REVOKE ALL ON FUNCTION public.has_capability(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_active_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_capability(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- The founding account must keep access to the administrative screens once the
-- policies below start requiring the Administrador role.
UPDATE public.profiles p
SET role_id = (SELECT id FROM public.roles WHERE name = 'Administrador' LIMIT 1)
WHERE p.id = (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles pp
    JOIN public.roles rr ON rr.id = pp.role_id
    WHERE rr.permissions @> '["all"]'::jsonb
  );

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;
