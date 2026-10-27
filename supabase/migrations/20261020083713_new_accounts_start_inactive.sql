/*
  # Self-registered accounts start inactive

  1. Changes
    - handle_new_user() now creates profiles with active = false, so a new
      self-registered account has no staff access until an administrator
      activates it. The very first account (when no profile exists yet) is
      created active so the business owner is not locked out.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id uuid;
  v_first boolean;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO v_first;

  IF v_first THEN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'Administrador' LIMIT 1;
  ELSE
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'Cajero' LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role_id, active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    v_role_id,
    v_first
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
