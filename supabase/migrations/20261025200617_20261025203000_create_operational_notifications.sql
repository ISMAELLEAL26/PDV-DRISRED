/*
# Create operational notification reports

1. New Tables
- `operational_notifications` stores durable inventory and cash-cut reports.
- `id` uniquely identifies each notification.
- `type` identifies the operation that produced it.
- `title` is the short notification title shown in the app.
- `message` contains the human-readable report.
- `branch_id` optionally links the report to a branch.
- `metadata` stores structured operation details without changing the table for each report format.
- `created_by` stores the authenticated staff member who created the report.
- `created_at` stores when the operation was recorded.

2. Security
- Row-level security is enabled.
- Authenticated active staff can read reports and create reports as themselves.
- Authenticated active staff can update or delete only reports they created.
- No anonymous access is granted.

3. Important Notes
- This table is append-oriented and does not replace sales, inventory, cash registers, or cash counts.
- Email delivery is intentionally not part of this table; reports remain available if an external email provider fails.
*/

CREATE TABLE IF NOT EXISTS public.operational_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('inventory_alert', 'cash_cut')),
  title text NOT NULL,
  message text NOT NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.operational_notifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operational_notifications TO authenticated;

DROP POLICY IF EXISTS "staff_select_operational_notifications" ON public.operational_notifications;
CREATE POLICY "staff_select_operational_notifications"
ON public.operational_notifications FOR SELECT
TO authenticated
USING (is_active_staff());

DROP POLICY IF EXISTS "staff_insert_operational_notifications" ON public.operational_notifications;
CREATE POLICY "staff_insert_operational_notifications"
ON public.operational_notifications FOR INSERT
TO authenticated
WITH CHECK (is_active_staff() AND created_by = auth.uid());

DROP POLICY IF EXISTS "staff_update_own_operational_notifications" ON public.operational_notifications;
CREATE POLICY "staff_update_own_operational_notifications"
ON public.operational_notifications FOR UPDATE
TO authenticated
USING (is_active_staff() AND created_by = auth.uid())
WITH CHECK (is_active_staff() AND created_by = auth.uid());

DROP POLICY IF EXISTS "staff_delete_own_operational_notifications" ON public.operational_notifications;
CREATE POLICY "staff_delete_own_operational_notifications"
ON public.operational_notifications FOR DELETE
TO authenticated
USING (is_active_staff() AND created_by = auth.uid());

CREATE INDEX IF NOT EXISTS operational_notifications_created_at_idx
ON public.operational_notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS operational_notifications_type_idx
ON public.operational_notifications (type, created_at DESC);
