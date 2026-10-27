/*
# Add thermal ticket branch configuration

1. Modified Tables
- `branches.street`: street name.
- `branches.exterior_number`: exterior number.
- `branches.interior_number`: interior number.
- `branches.neighborhood`: neighborhood or colony.
- `branches.locality`: locality.
- `branches.municipality`: municipality.
- `branches.state`: state.
- `branches.postal_code`: postal code.
- `branches.logo_url`: branch logo URL printed on tickets.

2. Modified Settings
- Existing key/value settings support `ticket_width` with values `55` or `80` millimeters.
- Existing key/value settings support `printer_name` for the configured default printer label.

3. Security
- Existing branch RLS policies continue to protect the new fields.

4. Important Notes
- Existing branch records are preserved; all new fields are optional for gradual setup.
- Browser printing uses the operating system's default printer. The configured printer name is retained as ticket configuration and display information.
*/

ALTER TABLE branches ADD COLUMN IF NOT EXISTS street text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS exterior_number text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS interior_number text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS neighborhood text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS locality text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS municipality text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS logo_url text;

INSERT INTO settings (key, value)
VALUES ('ticket_width', '80'), ('printer_name', 'Impresora predeterminada')
ON CONFLICT (key) DO NOTHING;