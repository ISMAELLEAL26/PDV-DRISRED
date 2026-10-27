/*
# Add structured payment details and receiving bank accounts

1. New Tables
- `bank_accounts`: shared receiving accounts managed from Settings.
- `id`: unique account identifier.
- `bank_name`: bank display name.
- `logo_url`: optional bank logo.
- `beneficiary`: account beneficiary.
- `account_number`: account number.
- `clabe`: interbank key.
- `active`: whether the account can be selected during checkout.
- `created_at`: creation timestamp.

2. Modified Tables
- `sales.payment_details`: JSON document containing card and transfer details, including the private receipt path.

3. Security
- RLS is enabled on `bank_accounts`.
- Authenticated users receive separate CRUD policies because this POS has a sign-in screen.
- A private `payment-receipts` storage bucket is created for transfer proofs.
- Storage policies restrict files to the authenticated user's folder.

4. Important Notes
- Existing sales are preserved; payment_details defaults to an empty JSON object.
- Receipt files are stored privately and should be accessed with signed URLs.
*/

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS payment_details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name text NOT NULL,
  logo_url text,
  beneficiary text NOT NULL,
  account_number text NOT NULL,
  clabe text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_bank_accounts" ON bank_accounts;
CREATE POLICY "auth_select_bank_accounts" ON bank_accounts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_bank_accounts" ON bank_accounts;
CREATE POLICY "auth_insert_bank_accounts" ON bank_accounts FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_bank_accounts" ON bank_accounts;
CREATE POLICY "auth_update_bank_accounts" ON bank_accounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_bank_accounts" ON bank_accounts;
CREATE POLICY "auth_delete_bank_accounts" ON bank_accounts FOR DELETE TO authenticated USING (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-receipts', 'payment-receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "payment_receipts_select_own" ON storage.objects;
CREATE POLICY "payment_receipts_select_own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'payment-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "payment_receipts_insert_own" ON storage.objects;
CREATE POLICY "payment_receipts_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'payment-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "payment_receipts_update_own" ON storage.objects;
CREATE POLICY "payment_receipts_update_own" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'payment-receipts' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'payment-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "payment_receipts_delete_own" ON storage.objects;
CREATE POLICY "payment_receipts_delete_own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'payment-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);