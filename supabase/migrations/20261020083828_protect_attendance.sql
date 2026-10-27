/*
  # Bind attendance records to the signed-in employee

  1. Policies
    - attendance: active staff read; insert only for the caller;
      update own record or administrator; delete administrators only.
*/

DROP POLICY IF EXISTS "auth_select_attendance" ON public.attendance;
DROP POLICY IF EXISTS "auth_insert_attendance" ON public.attendance;
DROP POLICY IF EXISTS "auth_update_attendance" ON public.attendance;
DROP POLICY IF EXISTS "auth_delete_attendance" ON public.attendance;

CREATE POLICY "staff_select_attendance" ON public.attendance FOR SELECT TO authenticated USING (public.is_active_staff());
CREATE POLICY "staff_insert_own_attendance" ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (public.is_active_staff() AND user_id = auth.uid());
CREATE POLICY "staff_update_own_attendance" ON public.attendance FOR UPDATE TO authenticated
  USING (public.is_admin() OR (public.is_active_staff() AND user_id = auth.uid()))
  WITH CHECK (public.is_admin() OR (public.is_active_staff() AND user_id = auth.uid()));
CREATE POLICY "admin_delete_attendance" ON public.attendance FOR DELETE TO authenticated USING (public.is_admin());
