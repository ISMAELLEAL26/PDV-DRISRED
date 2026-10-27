/*
# Restrict payment receipt uploads

1. Modified Storage
- `payment-receipts` is limited to 5 MB per file.
- Only JPEG, PNG, and PDF receipts are accepted.

2. Security
- The restriction is enforced by Supabase Storage, in addition to the checkout validation.
- Existing payment records and files are not changed.
*/

UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[]
WHERE id = 'payment-receipts';