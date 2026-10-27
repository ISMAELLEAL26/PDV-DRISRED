/*
# Completar el aislamiento por sucursal

1. Cambios de seguridad
- Los detalles de compras y pedidos solo pueden escribirse mediante documentos de una sucursal autorizada.
- Las ventas y sus detalles conservan la modificación administrativa restringida.
- No se modifican datos existentes.
*/

DROP POLICY IF EXISTS "staff_insert_purchase_items" ON public.purchase_items;
CREATE POLICY "staff_insert_purchase_items" ON public.purchase_items FOR INSERT TO authenticated
WITH CHECK (public.is_active_staff() AND EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id AND public.user_can_access_branch(p.branch_id)));
DROP POLICY IF EXISTS "staff_update_purchase_items" ON public.purchase_items;
CREATE POLICY "staff_update_purchase_items" ON public.purchase_items FOR UPDATE TO authenticated
USING (public.is_active_staff() AND EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id AND public.user_can_access_branch(p.branch_id)))
WITH CHECK (public.is_active_staff() AND EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id AND public.user_can_access_branch(p.branch_id)));

DROP POLICY IF EXISTS "staff_insert_supplier_order_items" ON public.supplier_order_items;
CREATE POLICY "staff_insert_supplier_order_items" ON public.supplier_order_items FOR INSERT TO authenticated
WITH CHECK (public.is_active_staff() AND EXISTS (SELECT 1 FROM public.supplier_orders o WHERE o.id = supplier_order_id AND public.user_can_access_branch(o.branch_id)));
DROP POLICY IF EXISTS "staff_update_supplier_order_items" ON public.supplier_order_items;
CREATE POLICY "staff_update_supplier_order_items" ON public.supplier_order_items FOR UPDATE TO authenticated
USING (public.is_active_staff() AND EXISTS (SELECT 1 FROM public.supplier_orders o WHERE o.id = supplier_order_id AND public.user_can_access_branch(o.branch_id)))
WITH CHECK (public.is_active_staff() AND EXISTS (SELECT 1 FROM public.supplier_orders o WHERE o.id = supplier_order_id AND public.user_can_access_branch(o.branch_id)));

DROP POLICY IF EXISTS "admin_update_sales" ON public.sales;
CREATE POLICY "admin_update_sales" ON public.sales FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());
