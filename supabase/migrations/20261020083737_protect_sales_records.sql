/*
  # Protect sales records

  1. Policies
    - sales: active staff read; insert must be attributed to the caller;
      update/delete administrators only (so a cashier cannot rewrite or
      erase a completed sale).
    - sale_items: readable by active staff; insert allowed only for a sale
      owned by the caller; update/delete administrators only.
*/

DROP POLICY IF EXISTS "auth_select_sales" ON public.sales;
DROP POLICY IF EXISTS "auth_insert_sales" ON public.sales;
DROP POLICY IF EXISTS "auth_update_sales" ON public.sales;
DROP POLICY IF EXISTS "auth_delete_sales" ON public.sales;

CREATE POLICY "staff_select_sales" ON public.sales FOR SELECT TO authenticated USING (public.is_active_staff());
CREATE POLICY "staff_insert_own_sales" ON public.sales FOR INSERT TO authenticated WITH CHECK (public.is_active_staff() AND user_id = auth.uid());
CREATE POLICY "admin_update_sales" ON public.sales FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_delete_sales" ON public.sales FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "auth_select_sale_items" ON public.sale_items;
DROP POLICY IF EXISTS "auth_insert_sale_items" ON public.sale_items;
DROP POLICY IF EXISTS "auth_update_sale_items" ON public.sale_items;
DROP POLICY IF EXISTS "auth_delete_sale_items" ON public.sale_items;

CREATE POLICY "staff_select_sale_items" ON public.sale_items FOR SELECT TO authenticated USING (public.is_active_staff());
CREATE POLICY "staff_insert_own_sale_items" ON public.sale_items FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_staff()
    AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.user_id = auth.uid())
  );
CREATE POLICY "admin_update_sale_items" ON public.sale_items FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_delete_sale_items" ON public.sale_items FOR DELETE TO authenticated USING (public.is_admin());
