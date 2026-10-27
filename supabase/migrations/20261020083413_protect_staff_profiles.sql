/*
# Protect staff profiles

Row access is limited to the caller's own profile (or an administrator), the
privilege columns role_id / active / email can no longer be written through the
data API, and administrators change them through a checked function instead.
*/

DROP POLICY IF EXISTS auth_select_profiles ON public.profiles;
DROP POLICY IF EXISTS auth_insert_profiles ON public.profiles;
DROP POLICY IF EXISTS auth_update_profiles ON public.profiles;
DROP POLICY IF EXISTS auth_delete_profiles ON public.profiles;

CREATE POLICY "staff_select_profiles" ON public.profiles FOR SELECT
  TO authenticated USING (id = auth.uid() OR public.is_active_staff());

CREATE POLICY "self_insert_profile" ON public.profiles FOR INSERT
  TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "self_or_admin_update_profiles" ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

CREATE POLICY "admin_delete_profiles" ON public.profiles FOR DELETE
  TO authenticated USING (public.is_admin());

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone, branch_id) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_user(
  target_id uuid,
  p_full_name text,
  p_role_id uuid,
  p_branch_id uuid,
  p_active boolean,
  p_phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  UPDATE public.profiles
  SET full_name = COALESCE(NULLIF(btrim(p_full_name), ''), full_name),
      role_id = p_role_id,
      branch_id = p_branch_id,
      active = COALESCE(p_active, active),
      phone = p_phone
  WHERE id = target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text) TO authenticated;
