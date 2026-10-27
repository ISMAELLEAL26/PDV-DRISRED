/*
# Evitar folios repetidos al abrir turnos

1. Cambio funcional
- `open_cash_turn` conserva el folio solicitado cuando está disponible.
- Si el folio ya existe, genera automáticamente el siguiente consecutivo del día.

2. Seguridad e integridad
- La apertura continúa validando usuario activo, sucursal autorizada, caja activa y caja libre.
- La inserción usa la restricción única existente para evitar duplicados aun si dos usuarios abren turno al mismo tiempo.
- No se modifican ni eliminan turnos existentes.
*/

CREATE OR REPLACE FUNCTION public.open_cash_turn(
  p_branch_id uuid,
  p_cash_box_id uuid,
  p_opening_amount numeric,
  p_folio text
)
RETURNS public.cash_registers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.cash_registers;
  candidate_folio text := trim(p_folio);
  base_folio text;
  suffix_number integer;
BEGIN
  IF NOT public.is_active_staff() THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_opening_amount IS NULL OR p_opening_amount < 0 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  IF p_folio IS NULL OR length(trim(p_folio)) = 0 THEN RAISE EXCEPTION 'invalid folio'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_accessible_branches() b WHERE b.id = p_branch_id) THEN
    RAISE EXCEPTION 'branch not authorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cash_boxes cb
    WHERE cb.id = p_cash_box_id AND cb.branch_id = p_branch_id AND cb.active
  ) THEN RAISE EXCEPTION 'cash box unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_registers r WHERE r.user_id = auth.uid() AND r.status = 'abierta') THEN
    RAISE EXCEPTION 'user already has an open turn';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_registers r WHERE r.cash_box_id = p_cash_box_id AND r.status = 'abierta') THEN
    RAISE EXCEPTION 'cash box already occupied';
  END IF;

  base_folio := regexp_replace(candidate_folio, '-[0-9]+$', '');
  suffix_number := COALESCE(NULLIF(substring(candidate_folio FROM '([0-9]+)$'), '')::integer, 0);

  FOR attempt IN 0..20 LOOP
    INSERT INTO public.cash_registers (branch_id, user_id, cash_box_id, folio, opening_amount, status)
    VALUES (p_branch_id, auth.uid(), p_cash_box_id, candidate_folio, p_opening_amount, 'abierta')
    ON CONFLICT (folio) WHERE folio IS NOT NULL DO NOTHING
    RETURNING * INTO result;

    IF result.id IS NOT NULL THEN RETURN result; END IF;
    suffix_number := suffix_number + 1;
    candidate_folio := base_folio || '-' || suffix_number;
  END LOOP;

  RAISE EXCEPTION 'could not generate unique folio';
END;
$$;

REVOKE ALL ON FUNCTION public.open_cash_turn(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_cash_turn(uuid, uuid, numeric, text) TO authenticated;
