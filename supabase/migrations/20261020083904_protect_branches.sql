/*
  # Lock branches to administrators

  1. Policies
    - branches: active staff read (branch switcher needs it);
      insert/update/delete administrators only.
*/

DROP POLICY IF EXISTS "auth_select_branches" ON public.branches;
DROP POLICY IF EXISTS "auth_insert_branches" ON public.branches;
DROP POLICY IF EXISTS "auth_update_branches" ON public.branches;
DROP POLICY IF EXISTS "auth_delete_branches" ON public.branches;

CREATE POLICY "staff_select_branches" ON public.branches FOR SELECT TO authenticated USING (public.is_active_staff());
CREATE POLICY "admin_insert_branches" ON public.branches FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "admin_update_branches" ON public.branches FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_delete_branches" ON public.branches FOR DELETE TO authenticated USING (public.is_admin());
