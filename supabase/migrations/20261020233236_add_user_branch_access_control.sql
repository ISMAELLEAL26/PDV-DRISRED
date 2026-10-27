/*
# Control de acceso por sucursal para usuarios

1. Nuevas tablas
- `user_branch_access`: asigna una o varias sucursales a cada usuario.
- `user_branch_access.user_id`: empleado autorizado.
- `user_branch_access.branch_id`: sucursal autorizada.

2. Cambios de seguridad
- Los empleados solo reciben las sucursales que tienen autorizadas.
- Administradores y usuarios con `branch_switch` pueden trabajar en todas las sucursales activas.
- Solo administradores pueden modificar las asignaciones de sucursal.
- Se actualizan las funciones administrativas para guardar la lista completa de sucursales.

3. Compatibilidad
- Se conserva `profiles.branch_id` como sucursal principal para no romper datos existentes.
- Los usuarios que ya tenían una sucursal reciben esa asignación automáticamente.
- Los administradores y encargados con permiso de cambio conservan acceso global.
- No se eliminan columnas ni registros existentes.
*/

CREATE TABLE IF NOT EXISTS public.user_branch_access (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, branch_id)
);

ALTER TABLE public.user_branch_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own_branch_access" ON public.user_branch_access;
CREATE POLICY "users_select_own_branch_access" ON public.user_branch_access FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "admins_insert_branch_access" ON public.user_branch_access;
CREATE POLICY "admins_insert_branch_access" ON public.user_branch_access FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admins_update_branch_access" ON public.user_branch_access;
CREATE POLICY "admins_update_branch_access" ON public.user_branch_access FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admins_delete_branch_access" ON public.user_branch_access;
CREATE POLICY "admins_delete_branch_access" ON public.user_branch_access FOR DELETE TO authenticated
USING (public.is_admin());

INSERT INTO public.user_branch_access (user_id, branch_id)
SELECT p.id, p.branch_id
FROM public.profiles p
WHERE p.branch_id IS NOT NULL
ON CONFLICT (user_id, branch_id) DO NOTHING;

UPDATE public.roles
SET permissions = permissions || '["branch_switch"]'::jsonb
WHERE lower(name) IN ('gerente', 'encargado', 'encargado de área', 'encargado de area')
  AND NOT (permissions @> '["branch_switch"]'::jsonb);

CREATE OR REPLACE FUNCTION public.get_accessible_branches()
RETURNS SETOF public.branches
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.*
  FROM public.branches b
  WHERE b.active
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND p.active
        AND (r.permissions @> '["all"]'::jsonb OR r.permissions @> '["branch_switch"]'::jsonb)
    )
  UNION ALL
  SELECT b.*
  FROM public.branches b
  JOIN public.user_branch_access uba ON uba.branch_id = b.id
  JOIN public.profiles p ON p.id = uba.user_id
  WHERE b.active AND p.active AND uba.user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles p2
      JOIN public.roles r2 ON r2.id = p2.role_id
      WHERE p2.id = auth.uid()
        AND p2.active
        AND (r2.permissions @> '["all"]'::jsonb OR r2.permissions @> '["branch_switch"]'::jsonb)
    );
$$;

REVOKE ALL ON FUNCTION public.get_accessible_branches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accessible_branches() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_user(
  target_id uuid,
  p_full_name text,
  p_role_id uuid,
  p_branch_id uuid,
  p_active boolean,
  p_phone text,
  p_position text,
  p_avatar_url text,
  p_branch_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  UPDATE public.profiles
  SET full_name = trim(p_full_name),
      role_id = p_role_id,
      branch_id = p_branch_id,
      active = COALESCE(p_active, active),
      phone = p_phone,
      position = NULLIF(trim(p_position), ''),
      avatar_url = NULLIF(trim(p_avatar_url), '')
  WHERE id = target_id;

  DELETE FROM public.user_branch_access WHERE user_id = target_id;
  INSERT INTO public.user_branch_access (user_id, branch_id)
  SELECT target_id, x.branch_id
  FROM unnest(COALESCE(p_branch_ids, ARRAY[]::uuid[])) AS x(branch_id)
  JOIN public.branches b ON b.id = x.branch_id AND b.active
  ON CONFLICT (user_id, branch_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text, text, text, uuid[]) TO authenticated;

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
  INSERT INTO public.cash_registers (branch_id, user_id, cash_box_id, folio, opening_amount, status)
  VALUES (p_branch_id, auth.uid(), p_cash_box_id, trim(p_folio), p_opening_amount, 'abierta')
  RETURNING * INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.open_cash_turn(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_cash_turn(uuid, uuid, numeric, text) TO authenticated;
