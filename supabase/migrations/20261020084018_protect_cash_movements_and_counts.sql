/*
  # Restrict cash movements and counts to the caller's own turn

  1. Policies
    - cash_movements: active staff read; insert only against a turn owned by
      the caller and still open; update/delete administrators only.
    - cash_counts: same ownership rule for inserts; update/delete admin only.
*/

DROP POLICY IF EXISTS "auth_select_cash_movements" ON public.cash_movements;
DROP POLICY IF EXISTS "auth_insert_cash_movements" ON public.cash_movements;
DROP POLICY IF EXISTS "auth_update_cash_movements" ON public.cash_movements;
DROP POLICY IF EXISTS "auth_delete_cash_movements" ON public.cash_movements;

CREATE POLICY "staff_select_cash_movements" ON public.cash_movements FOR SELECT TO authenticated USING (public.is_active_staff());
CREATE POLICY "staff_insert_own_cash_movements" ON public.cash_movements FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_staff()
    AND EXISTS (
      SELECT 1 FROM public.cash_registers r
      WHERE r.id = cash_register_id AND r.user_id = auth.uid() AND r.status = 'abierta'
    )
  );
CREATE POLICY "admin_update_cash_movements" ON public.cash_movements FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_delete_cash_movements" ON public.cash_movements FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "auth_select_cash_counts" ON public.cash_counts;
DROP POLICY IF EXISTS "auth_insert_cash_counts" ON public.cash_counts;
DROP POLICY IF EXISTS "auth_update_cash_counts" ON public.cash_counts;
DROP POLICY IF EXISTS "auth_delete_cash_counts" ON public.cash_counts;

CREATE POLICY "staff_select_cash_counts" ON public.cash_counts FOR SELECT TO authenticated USING (public.is_active_staff());
CREATE POLICY "staff_insert_own_cash_counts" ON public.cash_counts FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_staff()
    AND EXISTS (
      SELECT 1 FROM public.cash_registers r
      WHERE r.id = cash_register_id AND r.user_id = auth.uid()
    )
  );
CREATE POLICY "admin_update_cash_counts" ON public.cash_counts FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_delete_cash_counts" ON public.cash_counts FOR DELETE TO authenticated USING (public.is_admin());
