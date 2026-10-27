/*
# Fix inventory authorization hash validation

1. Problem
- Inventory authorization reached the final database step but failed because the `digest` function from pgcrypto is installed in the `extensions` schema.
- The protected functions used a search path that excluded that schema.

2. Function changes
- Adds `extensions` to the fixed search path for the current four-parameter inventory application function.
- Adds `extensions` to the legacy three-parameter inventory authorization function for consistent behavior.

3. Security
- Both functions remain SECURITY DEFINER functions with an explicit fixed search path.
- Service-role-only execution grants are unchanged.

4. Data safety
- No inventory, stock, authorization, or user records are changed by this migration.
- This only fixes the code-hash lookup used while validating the authorization token.
*/

ALTER FUNCTION public.apply_inventory_authorization(uuid, text, uuid, uuid[])
SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.authorize_inventory_session(uuid, text, uuid)
SET search_path = public, extensions, pg_temp;