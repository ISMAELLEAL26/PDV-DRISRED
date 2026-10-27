/*
  # Restrict catalog edits to staff with the products capability

  1. Policies
    - products, categories, suppliers: active staff read; insert/update
      require has_capability('products'); delete administrators only.
    - product_stock, customers, purchases, purchase_items, supplier_orders,
      supplier_order_items: active staff read/insert/update (the point of sale
      adjusts stock and registers customers); delete administrators only.
*/

-- products / categories / suppliers
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','categories','suppliers'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_select_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_insert_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_update_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_delete_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff_select_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'catalog_insert_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'catalog_update_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'admin_delete_' || t, t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_staff())', 'staff_select_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_capability(''products''))', 'catalog_insert_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_capability(''products'')) WITH CHECK (public.has_capability(''products''))', 'catalog_update_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())', 'admin_delete_' || t, t);
  END LOOP;
END $$;

-- operational tables staff must be able to write during normal work
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_stock','customers','purchases','purchase_items','supplier_orders','supplier_order_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_select_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_insert_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_update_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_delete_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff_select_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff_insert_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff_update_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'admin_delete_' || t, t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_staff())', 'staff_select_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_staff())', 'staff_insert_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_staff()) WITH CHECK (public.is_active_staff())', 'staff_update_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())', 'admin_delete_' || t, t);
  END LOOP;
END $$;
