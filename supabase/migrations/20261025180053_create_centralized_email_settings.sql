/*
# Create centralized EmailJS settings

1. New Tables
- `app_settings` stores application-wide notification configuration as key/value pairs.
- `key` is the unique setting name.
- `value` stores the configured value; the supervisor PIN is stored only as a SHA-256 hash.
- `updated_at` records the last change.

2. Initial Settings
- Adds EmailJS service ID, template ID, public key, alert recipient, and an empty supervisor PIN hash.

3. Security
- Enables row-level security.
- Active staff can read settings so operational notifications can be sent.
- Only administrators can insert or update settings.
- No delete permission is granted because these are required application controls.
*/

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.app_settings TO authenticated;
GRANT INSERT, UPDATE ON public.app_settings TO authenticated;

DROP POLICY IF EXISTS "staff_read_app_settings" ON public.app_settings;
CREATE POLICY "staff_read_app_settings"
ON public.app_settings FOR SELECT
TO authenticated
USING (is_active_staff());

DROP POLICY IF EXISTS "admin_insert_app_settings" ON public.app_settings;
CREATE POLICY "admin_insert_app_settings"
ON public.app_settings FOR INSERT
TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "admin_update_app_settings" ON public.app_settings;
CREATE POLICY "admin_update_app_settings"
ON public.app_settings FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

INSERT INTO public.app_settings (key, value)
VALUES
  ('emailjs_service_id', ''),
  ('emailjs_template_id', ''),
  ('emailjs_public_key', ''),
  ('email_alert_recipient', 'dtb.igerencia@gmail.com'),
  ('inventory_master_pin_hash', '')
ON CONFLICT (key) DO NOTHING;
