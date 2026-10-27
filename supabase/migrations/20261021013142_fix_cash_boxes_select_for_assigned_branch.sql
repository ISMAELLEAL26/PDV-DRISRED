/*
# Fix cash_boxes SELECT policy for staff with assigned branch

## Problem
The `staff_select_cash_boxes` SELECT policy used `user_can_access_branch(branch_id)`,
which only grants access to admins (`all`), users with `branch_switch`, or users
with an explicit `user_branch_access` row. A regular cashier whose branch is
assigned via `profiles.branch_id` (but who lacks `branch_switch` and has no
`user_branch_access` entry) could NOT read `cash_boxes`, so the Layout header
join `cash_box:cash_boxes(name)` returned null and the header always showed
"Sin caja abierta".

## Fix
Replace the policy predicate so it ALSO allows access when the cash box's
`branch_id` matches the user's own `profiles.branch_id` (and the user is active).
This lets every active cashier read the cash boxes of their assigned branch.

## Security
- Still scoped to `authenticated`.
- Still denies access to branches the user does not belong to.
- No changes to INSERT/UPDATE/DELETE policies.
*/

DROP POLICY IF EXISTS "staff_select_cash_boxes" ON public.cash_boxes;

CREATE POLICY "staff_select_cash_boxes"
ON public.cash_boxes FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active
      AND p.branch_id = cash_boxes.branch_id
  )
  OR public.user_can_access_branch(cash_boxes.branch_id)
);
