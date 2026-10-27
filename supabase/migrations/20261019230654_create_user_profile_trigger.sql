/*
# Trigger: auto-crear profile al registrarse
Crea una función que se ejecuta tras INSERT en auth.users para generar el perfil
del nuevo usuario con valores por defecto (rol cajero, sin sucursal).
*/
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cajero_role uuid;
BEGIN
  SELECT id INTO cajero_role FROM roles WHERE name = 'Cajero' LIMIT 1;
  INSERT INTO public.profiles (id, full_name, email, role_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    cajero_role
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
