/*
  # Lock role definitions to administrators

  1. Policies
    - roles: readable by active staff; insert/update/delete only by administrators
*/

DROP POLICY IF EXISTS "auth_select_roles" ON public.roles;
DROP POLICY IF EXISTS "auth_insert_roles" ON public.roles;
DROP POLICY IF EXISTS "auth_update_roles" ON public.roles;
DROP POLICY IF EXISTS "auth_delete_roles" ON public.roles;
DROP POLICY IF EXISTS "staff_select_roles" ON public.roles;
DROP POLICY IF EXISTS "admin_insert_roles" ON public.roles;
DROP POLICY IF EXISTS "admin_update_roles" ON public.roles;
DROP POLICY IF EXISTS "admin_delete_roles" ON public.roles;

CREATE POLICY "staff_select_roles" ON public.roles FOR SELECT TO authenticated USING (public.is_active_staff());
CREATE POLICY "admin_insert_roles" ON public.roles FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "admin_update_roles" ON public.roles FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_delete_roles" ON public.roles FOR DELETE TO authenticated USING (public.is_admin());
