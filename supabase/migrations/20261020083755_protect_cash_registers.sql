/*
  # Restrict cash turns to their own owner

  1. Policies
    - cash_registers: active staff read; insert only as the caller;
      update only the caller's own turn (or administrators); delete admin only.
*/

DROP POLICY IF EXISTS "auth_select_cash_registers" ON public.cash_registers;
DROP POLICY IF EXISTS "auth_insert_cash_registers" ON public.cash_registers;
DROP POLICY IF EXISTS "auth_update_cash_registers" ON public.cash_registers;
DROP POLICY IF EXISTS "auth_delete_cash_registers" ON public.cash_registers;

CREATE POLICY "staff_select_cash_registers" ON public.cash_registers FOR SELECT TO authenticated USING (public.is_active_staff());
CREATE POLICY "staff_insert_own_cash_registers" ON public.cash_registers FOR INSERT TO authenticated
  WITH CHECK (public.is_active_staff() AND user_id = auth.uid());
CREATE POLICY "staff_update_own_cash_registers" ON public.cash_registers FOR UPDATE TO authenticated
  USING (public.is_admin() OR (public.is_active_staff() AND user_id = auth.uid()))
  WITH CHECK (public.is_admin() OR (public.is_active_staff() AND user_id = auth.uid()));
CREATE POLICY "admin_delete_cash_registers" ON public.cash_registers FOR DELETE TO authenticated USING (public.is_admin());
