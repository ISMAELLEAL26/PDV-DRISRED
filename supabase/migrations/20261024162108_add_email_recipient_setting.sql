/*
# Add email recipient setting for inventory OTP notifications

1. New Settings Keys
- `email_recipient`: The email address where OTP codes and inventory reports are sent (Gerencia General).
  Defaults to 'dtb.igerencia@gmail.com' if not set.

2. No new tables — uses the existing `settings` key-value table.
3. No security changes — the settings table already has RLS policies for authenticated users.
*/

INSERT INTO public.settings (key, value, updated_at)
VALUES ('email_recipient', 'dtb.igerencia@gmail.com', now())
ON CONFLICT (key) DO NOTHING;
