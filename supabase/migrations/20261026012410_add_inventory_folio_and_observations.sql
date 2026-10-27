/*
# Add folio and observations to inventory sessions

1. Modified Tables
- `inventory_sessions`: add `folio` (text, unique sequence-based) for grouping history records.
- `inventory_sessions`: add `observations` (text, nullable) for comments on completed inventories.
- `inventory_sessions`: add `authorized_by_name` (text, nullable) cached name of authorizer for reports.
2. Backfill
- Assigns a folio (INV-YYYYMMDD-HHMMSS) to existing closed sessions without one.
3. Security
- No new tables. RLS already enabled on inventory_sessions. No policy changes needed; existing grants cover the new columns.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_sessions' AND column_name='folio') THEN
    ALTER TABLE inventory_sessions ADD COLUMN folio text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_sessions' AND column_name='observations') THEN
    ALTER TABLE inventory_sessions ADD COLUMN observations text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_sessions' AND column_name='authorized_by_name') THEN
    ALTER TABLE inventory_sessions ADD COLUMN authorized_by_name text;
  END IF;
END $$;

-- Backfill folios for closed sessions missing one
UPDATE inventory_sessions
SET folio = 'INV-' || to_char(started_at AT TIME ZONE 'America/Mexico_City', 'YYYYMMDD-HH24MISS')
WHERE folio IS NULL AND status = 'closed';

-- Auto-assign folio on insert for new sessions
DROP TRIGGER IF EXISTS trg_inventory_sessions_folio ON inventory_sessions;
CREATE OR REPLACE FUNCTION assign_inventory_folio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.folio IS NULL THEN
    NEW.folio := 'INV-' || to_char(NOW() AT TIME ZONE 'America/Mexico_City', 'YYYYMMDD-HH24MISS');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inventory_sessions_folio
BEFORE INSERT ON inventory_sessions
FOR EACH ROW EXECUTE FUNCTION assign_inventory_folio();

REVOKE EXECUTE ON FUNCTION assign_inventory_folio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION assign_inventory_folio() TO authenticated;
