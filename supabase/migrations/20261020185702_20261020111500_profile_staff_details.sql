/*
# Datos ampliados del personal

1. Cambios
- Amplía la función administrativa de perfiles para guardar puesto y avatar.
- Mantiene los cambios de rol, sucursal y estado dentro de una función SECURITY DEFINER.

2. Seguridad
- Solo un administrador activo puede ejecutar la función.
- La fotografía se guarda como URL; nunca se guarda una contraseña en `profiles`.
- Se conserva la función anterior para no romper sesiones o versiones ya abiertas.
*/

CREATE OR REPLACE FUNCTION public.admin_update_user(
  target_id uuid,
  p_full_name text,
  p_role_id uuid,
  p_branch_id uuid,
  p_active boolean,
  p_phone text,
  p_position text,
  p_avatar_url text
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
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text, text, text) TO authenticated;
