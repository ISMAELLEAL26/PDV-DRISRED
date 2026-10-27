/*
  # Lock store settings to administrators

  1. Policies
    - settings: active staff read (tickets and taxes need it);
      insert/update/delete administrators only.
*/

DROP POLICY IF EXISTS "auth_select_settings" ON public.settings;
DROP POLICY IF EXISTS "auth_insert_settings" ON public.settings;
DROP POLICY IF EXISTS "auth_update_settings" ON public.settings;
DROP POLICY IF EXISTS "auth_delete_settings" ON public.settings;

CREATE POLICY "staff_select_settings" ON public.settings FOR SELECT TO authenticated USING (public.is_active_staff());
CREATE POLICY "admin_insert_settings" ON public.settings FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "admin_update_settings" ON public.settings FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_delete_settings" ON public.settings FOR DELETE TO authenticated USING (public.is_admin());
