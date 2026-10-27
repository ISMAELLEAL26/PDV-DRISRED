/*
# Add atomic inventory authorization

1. New server function
- `authorize_inventory_session(uuid, text, uuid)`: validates the one-time email code, checks completeness and sale activity, then applies all approved stock changes atomically.

2. Validation
- Rejects expired or already-closed sessions.
- Rejects incorrect codes and limits attempts.
- Rejects incomplete counts.
- Rechecks sales made after the count began and refuses closure when affected products need recounting.

3. Data changes
- Updates product stock only after all validations pass.
- Writes the corresponding stock adjustment history.
- Closes the inventory session and records the authorizing employee.

4. Security
- The function runs with a fixed public search path.
- Execution is revoked from public, anonymous, and authenticated clients.
- Only the protected server-side service role may call it.
*/

CREATE OR REPLACE FUNCTION public.authorize_inventory_session(p_session_id uuid, p_code text, p_actor uuid)
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
  v_stock public.product_stock%ROWTYPE;
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
  WHERE session_id = v_session.id AND physical IS NULL;

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
  WHERE c.session_id = v_session.id AND c.product_id = o.product_id;

  SELECT count(*) INTO v_affected
  FROM public.inventory_counts
  WHERE session_id = v_session.id AND affected_by_operation = true;

  IF v_affected > 0 THEN
    RAISE EXCEPTION 'Hay productos afectados por operaciones de caja. Valida nuevamente esos productos.';
  END IF;

  FOR v_count IN SELECT * FROM public.inventory_counts WHERE session_id = v_session.id FOR UPDATE LOOP
    UPDATE public.product_stock
    SET quantity = v_count.physical
    WHERE product_id = v_count.product_id AND branch_id = v_count.branch_id;

    IF NOT FOUND THEN
      INSERT INTO public.product_stock(product_id, branch_id, quantity, min_stock)
      VALUES (v_count.product_id, v_count.branch_id, v_count.physical, 0);
    END IF;

    INSERT INTO public.stock_adjustments(product_id, branch_id, theoretical, physical, difference, reason, user_id)
    VALUES (v_count.product_id, v_count.branch_id, v_count.theoretical, v_count.physical, v_count.difference, 'Conteo de inventario autorizado', p_actor);
  END LOOP;

  UPDATE public.inventory_sessions
  SET status = 'closed', authorized_at = now(), authorized_by = p_actor, completed_at = now(), verification_code_hash = null
  WHERE id = v_session.id;

  RETURN jsonb_build_object('success', true, 'session_id', v_session.id, 'affected_products', 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.authorize_inventory_session(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_inventory_session(uuid, text, uuid) TO service_role;
