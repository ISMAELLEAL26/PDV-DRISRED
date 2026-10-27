/*
  # Remove PUBLIC execute grants on helper functions

  1. Changes
    - Revoke EXECUTE from PUBLIC (which includes anon) on every SECURITY DEFINER
      helper, then grant only what the signed-in app needs.
    - handle_new_user stays callable only by the trigger owner.
*/

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_capability(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_active_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_capability(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text) TO authenticated;
