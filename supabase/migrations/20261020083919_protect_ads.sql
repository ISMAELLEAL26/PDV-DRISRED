/*
  # Lock promotional images to administrators

  1. Policies
    - ads: active staff read; insert/update/delete administrators only.
*/

DROP POLICY IF EXISTS "auth_select_ads" ON public.ads;
DROP POLICY IF EXISTS "auth_insert_ads" ON public.ads;
DROP POLICY IF EXISTS "auth_update_ads" ON public.ads;
DROP POLICY IF EXISTS "auth_delete_ads" ON public.ads;

CREATE POLICY "staff_select_ads" ON public.ads FOR SELECT TO authenticated USING (public.is_active_staff());
CREATE POLICY "admin_insert_ads" ON public.ads FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "admin_update_ads" ON public.ads FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_delete_ads" ON public.ads FOR DELETE TO authenticated USING (public.is_admin());
