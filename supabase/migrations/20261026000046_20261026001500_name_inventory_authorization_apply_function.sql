/*
# Give dynamic inventory authorization a unique function name

1. Database function
- Renames the four-parameter inventory authorization function to `apply_inventory_authorization`.
- Keeps the older three-parameter function available for legacy operations.

2. Reliability
- Removes PostgreSQL API ambiguity caused by two overloaded functions with the same name.
- The protected inventory Edge Function will call the uniquely named function.

3. Security
- Preserves SECURITY DEFINER and the fixed search path.
- Preserves service-role-only execution.

4. Data safety
- No inventory records, stock rows, or authorization requests are deleted or changed by this migration.
*/

ALTER FUNCTION public.authorize_inventory_session(uuid, text, uuid, uuid[])
RENAME TO apply_inventory_authorization;

REVOKE EXECUTE ON FUNCTION public.apply_inventory_authorization(uuid, text, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_inventory_authorization(uuid, text, uuid, uuid[]) TO service_role;