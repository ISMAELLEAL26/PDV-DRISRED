/*
# Multi-sucursal, multi-caja y permisos granulares

1. Nuevas tablas
- `cash_boxes`: catálogo de cajas físicas por sucursal, con nombre y estado.

2. Nuevas columnas
- `profiles.position`: puesto del usuario.
- `profiles.avatar_url`: fotografía o avatar del usuario.
- `cash_registers.cash_box_id`: caja física asignada al turno.

3. Relaciones y consistencia
- `cash_registers.user_id` queda relacionado con `profiles.id` para que las consultas anidadas de usuario funcionen.
- `cash_registers.cash_box_id` queda relacionado con `cash_boxes.id`.
- Se crea una restricción única parcial para impedir dos turnos abiertos en la misma caja.
- Las cajas existentes reciben una caja física inicial por sucursal para conservar sus registros.

4. Seguridad
- `cash_boxes` solo puede ser administrada por administradores; el personal activo solo puede consultar las cajas de su sucursal asignada.
- Los turnos solo pueden ser consultados por su propio usuario, salvo administradores.
- La apertura se realiza mediante `open_cash_turn`, que valida usuario activo, sucursal, caja libre y fondo no negativo dentro del servidor.
- Los permisos de roles aceptan capacidades granulares: `sales`, `cash_open`, `cash_balance`, `cash_movements`, `settings`, `queries`, `customers`, `products`, `purchases`, `attendance`, `reports` y `all`.
- Las funciones nuevas no son ejecutables por usuarios anónimos.

5. Notas
- No se eliminan columnas ni registros existentes.
- La función de apertura devuelve el turno creado para que la interfaz pueda actualizarse inmediatamente.
*/

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS position text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.cash_registers ADD COLUMN IF NOT EXISTS cash_box_id uuid;

CREATE TABLE IF NOT EXISTS public.cash_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, name)
);

ALTER TABLE public.cash_boxes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_registers_user_id_fkey') THEN
    ALTER TABLE public.cash_registers ADD CONSTRAINT cash_registers_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_registers_cash_box_id_fkey') THEN
    ALTER TABLE public.cash_registers ADD CONSTRAINT cash_registers_cash_box_id_fkey
      FOREIGN KEY (cash_box_id) REFERENCES public.cash_boxes(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
DECLARE b record; r record;
BEGIN
  FOR b IN SELECT id FROM public.branches LOOP
    INSERT INTO public.cash_boxes (branch_id, name)
    SELECT b.id, 'Caja 1'
    WHERE NOT EXISTS (SELECT 1 FROM public.cash_boxes cb WHERE cb.branch_id = b.id);
  END LOOP;
  UPDATE public.cash_registers cr
  SET cash_box_id = cb.id
  FROM public.cash_boxes cb
  WHERE cr.cash_box_id IS NULL AND cb.branch_id = cr.branch_id AND cb.name = 'Caja 1';
  FOR r IN
    SELECT id, branch_id, row_number() OVER (PARTITION BY branch_id ORDER BY opened_at, id) AS box_number
    FROM public.cash_registers
    WHERE status = 'abierta'
  LOOP
    IF r.box_number > 1 THEN
      INSERT INTO public.cash_boxes (branch_id, name)
      VALUES (r.branch_id, 'Caja ' || r.box_number)
      ON CONFLICT (branch_id, name) DO NOTHING;
      UPDATE public.cash_registers cr
      SET cash_box_id = cb.id
      FROM public.cash_boxes cb
      WHERE cr.id = r.id AND cb.branch_id = r.branch_id AND cb.name = 'Caja ' || r.box_number;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cash_registers_one_open_per_box
  ON public.cash_registers (cash_box_id) WHERE status = 'abierta' AND cash_box_id IS NOT NULL;

DROP POLICY IF EXISTS "staff_select_cash_boxes" ON public.cash_boxes;
CREATE POLICY "staff_select_cash_boxes" ON public.cash_boxes FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.active AND (p.branch_id IS NULL OR p.branch_id = cash_boxes.branch_id)
  )
);
DROP POLICY IF EXISTS "admin_insert_cash_boxes" ON public.cash_boxes;
CREATE POLICY "admin_insert_cash_boxes" ON public.cash_boxes FOR INSERT TO authenticated
WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin_update_cash_boxes" ON public.cash_boxes;
CREATE POLICY "admin_update_cash_boxes" ON public.cash_boxes FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin_delete_cash_boxes" ON public.cash_boxes;
CREATE POLICY "admin_delete_cash_boxes" ON public.cash_boxes FOR DELETE TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "staff_select_cash_registers" ON public.cash_registers;
CREATE POLICY "staff_select_cash_registers" ON public.cash_registers FOR SELECT TO authenticated
USING (public.is_admin() OR user_id = auth.uid());

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
DECLARE result public.cash_registers;
BEGIN
  IF NOT public.is_active_staff() THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_opening_amount IS NULL OR p_opening_amount < 0 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  IF p_folio IS NULL OR length(trim(p_folio)) = 0 THEN RAISE EXCEPTION 'invalid folio'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND (p.branch_id IS NULL OR p.branch_id = p_branch_id)
  ) THEN RAISE EXCEPTION 'branch not authorized'; END IF;
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
  INSERT INTO public.cash_registers (branch_id, user_id, cash_box_id, folio, opening_amount, status)
  VALUES (p_branch_id, auth.uid(), p_cash_box_id, trim(p_folio), p_opening_amount, 'abierta')
  RETURNING * INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.open_cash_turn(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_cash_turn(uuid, uuid, numeric, text) TO authenticated;
