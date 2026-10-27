/*
# Aplicar las autorizaciones de sucursal a las operaciones

1. Nuevas funciones
- `user_can_access_branch`: valida en el servidor si el usuario activo puede operar una sucursal.

2. Seguridad
- Las consultas y escrituras de inventario, ventas, compras, pedidos, asistencia y cajas quedan limitadas a sucursales autorizadas.
- Administradores y encargados con `branch_switch` pueden operar en todas las sucursales activas.
- Se actualiza la consulta de cajas físicas para permitir el acceso correcto a todas las sucursales autorizadas.
- No se amplían permisos a usuarios sin asignación.
*/

CREATE OR REPLACE FUNCTION public.user_can_access_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
      AND p.active
      AND (
        r.permissions @> '["all"]'::jsonb
        OR r.permissions @> '["branch_switch"]'::jsonb
        OR EXISTS (
          SELECT 1 FROM public.user_branch_access uba
          WHERE uba.user_id = p.id AND uba.branch_id = p_branch_id
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_branch(uuid) TO authenticated;

DROP POLICY IF EXISTS "staff_select_cash_boxes" ON public.cash_boxes;
CREATE POLICY "staff_select_cash_boxes" ON public.cash_boxes FOR SELECT TO authenticated
USING (public.user_can_access_branch(branch_id));

DROP POLICY IF EXISTS "staff_select_product_stock" ON public.product_stock;
CREATE POLICY "staff_select_product_stock" ON public.product_stock FOR SELECT TO authenticated
USING (public.user_can_access_branch(branch_id));
DROP POLICY IF EXISTS "staff_insert_product_stock" ON public.product_stock;
CREATE POLICY "staff_insert_product_stock" ON public.product_stock FOR INSERT TO authenticated
WITH CHECK (public.is_active_staff() AND public.user_can_access_branch(branch_id));
DROP POLICY IF EXISTS "staff_update_product_stock" ON public.product_stock;
CREATE POLICY "staff_update_product_stock" ON public.product_stock FOR UPDATE TO authenticated
USING (public.is_active_staff() AND public.user_can_access_branch(branch_id))
WITH CHECK (public.is_active_staff() AND public.user_can_access_branch(branch_id));

DROP POLICY IF EXISTS "staff_select_sales" ON public.sales;
CREATE POLICY "staff_select_sales" ON public.sales FOR SELECT TO authenticated
USING (public.is_active_staff() AND public.user_can_access_branch(branch_id));
DROP POLICY IF EXISTS "staff_insert_own_sales" ON public.sales;
CREATE POLICY "staff_insert_own_sales" ON public.sales FOR INSERT TO authenticated
WITH CHECK (public.is_active_staff() AND user_id = auth.uid() AND public.user_can_access_branch(branch_id));
DROP POLICY IF EXISTS "admin_update_sales" ON public.sales;
CREATE POLICY "admin_update_sales" ON public.sales FOR UPDATE TO authenticated
USING (public.is_admin() OR (public.is_active_staff() AND public.user_can_access_branch(branch_id)))
WITH CHECK (public.is_admin() OR (public.is_active_staff() AND public.user_can_access_branch(branch_id)));

DROP POLICY IF EXISTS "staff_select_sale_items" ON public.sale_items;
CREATE POLICY "staff_select_sale_items" ON public.sale_items FOR SELECT TO authenticated
USING (public.is_active_staff() AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND public.user_can_access_branch(s.branch_id)));
DROP POLICY IF EXISTS "staff_insert_own_sale_items" ON public.sale_items;
CREATE POLICY "staff_insert_own_sale_items" ON public.sale_items FOR INSERT TO authenticated
WITH CHECK (public.is_active_staff() AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.user_id = auth.uid() AND public.user_can_access_branch(s.branch_id)));

DROP POLICY IF EXISTS "staff_select_purchases" ON public.purchases;
CREATE POLICY "staff_select_purchases" ON public.purchases FOR SELECT TO authenticated
USING (public.is_active_staff() AND public.user_can_access_branch(branch_id));
DROP POLICY IF EXISTS "staff_insert_purchases" ON public.purchases;
CREATE POLICY "staff_insert_purchases" ON public.purchases FOR INSERT TO authenticated
WITH CHECK (public.is_active_staff() AND public.user_can_access_branch(branch_id));
DROP POLICY IF EXISTS "staff_update_purchases" ON public.purchases;
CREATE POLICY "staff_update_purchases" ON public.purchases FOR UPDATE TO authenticated
USING (public.is_active_staff() AND public.user_can_access_branch(branch_id))
WITH CHECK (public.is_active_staff() AND public.user_can_access_branch(branch_id));

DROP POLICY IF EXISTS "staff_select_supplier_orders" ON public.supplier_orders;
CREATE POLICY "staff_select_supplier_orders" ON public.supplier_orders FOR SELECT TO authenticated
USING (public.is_active_staff() AND public.user_can_access_branch(branch_id));
DROP POLICY IF EXISTS "staff_insert_supplier_orders" ON public.supplier_orders;
CREATE POLICY "staff_insert_supplier_orders" ON public.supplier_orders FOR INSERT TO authenticated
WITH CHECK (public.is_active_staff() AND public.user_can_access_branch(branch_id));
DROP POLICY IF EXISTS "staff_update_supplier_orders" ON public.supplier_orders;
CREATE POLICY "staff_update_supplier_orders" ON public.supplier_orders FOR UPDATE TO authenticated
USING (public.is_active_staff() AND public.user_can_access_branch(branch_id))
WITH CHECK (public.is_active_staff() AND public.user_can_access_branch(branch_id));

DROP POLICY IF EXISTS "staff_select_purchase_items" ON public.purchase_items;
CREATE POLICY "staff_select_purchase_items" ON public.purchase_items FOR SELECT TO authenticated
USING (public.is_active_staff() AND EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id AND public.user_can_access_branch(p.branch_id)));
DROP POLICY IF EXISTS "staff_select_supplier_order_items" ON public.supplier_order_items;
CREATE POLICY "staff_select_supplier_order_items" ON public.supplier_order_items FOR SELECT TO authenticated
USING (public.is_active_staff() AND EXISTS (SELECT 1 FROM public.supplier_orders o WHERE o.id = supplier_order_id AND public.user_can_access_branch(o.branch_id)));

DROP POLICY IF EXISTS "staff_select_attendance" ON public.attendance;
CREATE POLICY "staff_select_attendance" ON public.attendance FOR SELECT TO authenticated
USING (public.is_active_staff() AND (branch_id IS NULL OR public.user_can_access_branch(branch_id)));
DROP POLICY IF EXISTS "staff_insert_own_attendance" ON public.attendance;
CREATE POLICY "staff_insert_own_attendance" ON public.attendance FOR INSERT TO authenticated
WITH CHECK (public.is_active_staff() AND user_id = auth.uid() AND (branch_id IS NULL OR public.user_can_access_branch(branch_id)));
DROP POLICY IF EXISTS "staff_update_own_attendance" ON public.attendance;
CREATE POLICY "staff_update_own_attendance" ON public.attendance FOR UPDATE TO authenticated
USING (public.is_admin() OR (public.is_active_staff() AND user_id = auth.uid() AND (branch_id IS NULL OR public.user_can_access_branch(branch_id))))
WITH CHECK (public.is_admin() OR (public.is_active_staff() AND user_id = auth.uid() AND (branch_id IS NULL OR public.user_can_access_branch(branch_id))));
