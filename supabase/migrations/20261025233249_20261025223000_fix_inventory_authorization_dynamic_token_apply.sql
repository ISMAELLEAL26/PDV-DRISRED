/*
# Fix atomic inventory application for dynamic authorization tokens

1. Database function
- Adds the four-parameter overload `authorize_inventory_session(uuid, text, uuid, uuid[])` used by the dynamic-token inventory flow.
- The fourth parameter limits the applied inventory rows to the selected department/category when filters are active.

2. Inventory behavior
- Validates the open authorization session, expiration, retry limit, completeness, and intervening sales.
- Updates product stock, writes adjustment history, and closes the inventory session in one database transaction.
- Keeps the existing three-parameter function intact for older flows; no records or columns are removed.

3. Security
- Uses SECURITY DEFINER with a fixed search path.
- Revokes execution from PUBLIC, anon, and authenticated.
- Grants execution only to service_role, which is called by the protected Edge Function.

4. Important notes
- This fixes the mismatch between the Edge Function call and the function signature that caused a valid token to be consumed before inventory was saved.
- The operation remains server-validated and cannot be completed by changing browser state.
*/

CREATE OR REPLACE FUNCTION public.authorize_inventory_session(p_session_id uuid, p_code text, p_actor uuid, p_product_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.inventory_sessions%ROWTYPE;
  v_pending integer;
  v_affected integer;
  v_count public.inventory_counts%ROWTYPE;
  v_adjusted integer;
BEGIN
  SELECT * INTO v_session
  FROM public.inventory_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL OR v_session.status = 'closed' THEN
    RAISE EXCEPTION 'La sesión de inventario ya no está disponible.';
  END IF;

  IF v_session.status <> 'authorization_requested' OR v_session.code_expires_at IS NULL OR v_session.code_expires_at < now() THEN
    RAISE EXCEPTION 'El código expiró. Solicita un código nuevo.';
  END IF;

  IF v_session.code_attempts >= 5 THEN
    RAISE EXCEPTION 'Se alcanzó el límite de intentos. Solicita un código nuevo.';
  END IF;

  IF encode(digest(coalesce(p_code, ''), 'sha256'), 'hex') <> v_session.verification_code_hash THEN
    UPDATE public.inventory_sessions SET code_attempts = code_attempts + 1 WHERE id = v_session.id;
    RAISE EXCEPTION 'El código no coincide.';
  END IF;

  SELECT count(*) INTO v_pending
  FROM public.inventory_counts
  WHERE session_id = v_session.id
    AND physical IS NULL
    AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids));

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'Faltan productos por contar.';
  END IF;

  WITH operation_totals AS (
    SELECT si.product_id, sum(si.quantity) AS quantity, max(s.created_at) AS last_at
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id
    WHERE s.branch_id = v_session.branch_id
      AND s.created_at > v_session.started_at
      AND coalesce(lower(s.status), '') NOT IN ('cancelada', 'cancelled')
    GROUP BY si.product_id
  )
  UPDATE public.inventory_counts c
  SET affected_by_operation = true,
      affected_quantity = o.quantity,
      last_operation_at = o.last_at,
      updated_at = now()
  FROM operation_totals o
  WHERE c.session_id = v_session.id
    AND c.product_id = o.product_id
    AND (p_product_ids IS NULL OR c.product_id = ANY(p_product_ids));

  SELECT count(*) INTO v_affected
  FROM public.inventory_counts
  WHERE session_id = v_session.id
    AND affected_by_operation = true
    AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids));

  IF v_affected > 0 THEN
    RAISE EXCEPTION 'Hay productos afectados por operaciones de caja. Valida nuevamente esos productos.';
  END IF;

  v_adjusted := 0;
  FOR v_count IN
    SELECT *
    FROM public.inventory_counts
    WHERE session_id = v_session.id
      AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids))
    FOR UPDATE
  LOOP
    UPDATE public.product_stock
    SET quantity = v_count.physical
    WHERE product_id = v_count.product_id
      AND branch_id = v_count.branch_id;

    IF NOT FOUND THEN
      INSERT INTO public.product_stock(product_id, branch_id, quantity, min_stock)
      VALUES (v_count.product_id, v_count.branch_id, v_count.physical, 0);
    END IF;

    INSERT INTO public.stock_adjustments(product_id, branch_id, theoretical, physical, difference, reason, user_id)
    VALUES (v_count.product_id, v_count.branch_id, v_count.theoretical, v_count.physical, v_count.difference, 'Conteo de inventario autorizado', p_actor);

    v_adjusted := v_adjusted + 1;
  END LOOP;

  UPDATE public.inventory_sessions
  SET status = 'closed',
      authorized_at = now(),
      authorized_by = p_actor,
      completed_at = now(),
      verification_code_hash = null,
      code_expires_at = null,
      code_attempts = 0
  WHERE id = v_session.id;

  RETURN jsonb_build_object('success', true, 'session_id', v_session.id, 'adjusted', v_adjusted);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.authorize_inventory_session(uuid, text, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_inventory_session(uuid, text, uuid, uuid[]) TO service_role;