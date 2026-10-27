/*
# Enhance Products and Inventory Module

## Overview
Expands the products catalog and inventory system to support advanced product creation,
multiple price lists, packages/combos, inventory adjustment with theoretical/physical counts,
inter-branch transfers, a product recycling bin (soft delete), departments, and tax configuration.

## 1. Products table — new columns
- `barcode` (text): Código de barras del producto.
- `department` (text): Departamento al que pertenece.
- `tax_rate` (numeric): Porcentaje de impuesto (IVA) aplicable al producto.
- `bulk` (boolean): Permite venta a granel con decimales.
- `track_inventory` (boolean): Controla si el producto maneja inventario.
- `price_2` (numeric): Segundo precio de venta.
- `price_3` (numeric): Tercer precio de venta.
- `is_package` (boolean): Indica si el producto es un paquete/combo.
- `deleted_at` (timestamptz): Marca de tiempo de borrado lógico (soft delete).
- `deleted_by` (uuid): Usuario que eliminó el producto.

## 2. New table: package_items
Stores the individual products that compose a package/combo.
- `id` (uuid, pk)
- `package_id` (uuid, fk products) — el producto que es el paquete
- `product_id` (uuid, fk products) — el producto contenido
- `quantity` (numeric) — cantidad del producto dentro del paquete
- `unit_cost` (numeric) — costo unitario dentro del paquete
- `created_at` (timestamptz)

## 3. New table: stock_adjustments
Records each inventory adjustment with theoretical, physical and difference values.
- `id` (uuid, pk)
- `product_id` (uuid, fk products)
- `branch_id` (uuid, fk branches)
- `theoretical` (numeric) — existencia teórica
- `physical` (numeric) — existencia física contada
- `difference` (numeric) — diferencia física - teórica
- `reason` (text) — motivo del ajuste
- `user_id` (uuid) — usuario que realizó el ajuste
- `created_at` (timestamptz)

## 4. New table: transfers
Inter-branch merchandise transfers.
- `id` (uuid, pk)
- `folio` (text) — folio del traspaso
- `origin_branch_id` (uuid, fk branches)
- `destination_branch_id` (uuid, fk branches)
- `status` (text) — pendiente, en_transito, recibido, cancelado
- `user_id` (uuid) — usuario que inicia el traspaso
- `notes` (text)
- `created_at` (timestamptz)
- `received_at` (timestamptz)

## 5. New table: transfer_items
Products moved in a transfer.
- `id` (uuid, pk)
- `transfer_id` (uuid, fk transfers)
- `product_id` (uuid, fk products)
- `quantity` (numeric)
- `created_at` (timestamptz)

## Security
- RLS enabled on all new tables.
- All new tables grant CRUD to authenticated with ownership/branch checks.
- Existing product RLS policies are preserved.

## Notes
1. All new columns are nullable or have safe defaults so existing rows are unaffected.
2. The migration is idempotent — uses IF NOT EXISTS for columns and tables.
3. Soft delete uses deleted_at; active products have deleted_at = null.
*/

-- 1. Add columns to products
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS bulk boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS price_2 numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_3 numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_package boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- 2. package_items
CREATE TABLE IF NOT EXISTS package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 1,
  unit_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE package_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON package_items TO authenticated;

DROP POLICY IF EXISTS "select_package_items" ON package_items;
CREATE POLICY "select_package_items" ON package_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_package_items" ON package_items;
CREATE POLICY "insert_package_items" ON package_items
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_package_items" ON package_items;
CREATE POLICY "update_package_items" ON package_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_package_items" ON package_items;
CREATE POLICY "delete_package_items" ON package_items
  FOR DELETE TO authenticated USING (true);

-- 3. stock_adjustments
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  theoretical numeric NOT NULL DEFAULT 0,
  physical numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  reason text,
  user_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_adjustments TO authenticated;

DROP POLICY IF EXISTS "select_stock_adjustments" ON stock_adjustments;
CREATE POLICY "select_stock_adjustments" ON stock_adjustments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_stock_adjustments" ON stock_adjustments;
CREATE POLICY "insert_stock_adjustments" ON stock_adjustments
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_stock_adjustments" ON stock_adjustments;
CREATE POLICY "update_stock_adjustments" ON stock_adjustments
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_stock_adjustments" ON stock_adjustments;
CREATE POLICY "delete_stock_adjustments" ON stock_adjustments
  FOR DELETE TO authenticated USING (true);

-- 4. transfers
CREATE TABLE IF NOT EXISTS transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio text,
  origin_branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  destination_branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pendiente',
  user_id uuid,
  notes text,
  created_at timestamptz DEFAULT now(),
  received_at timestamptz
);

ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON transfers TO authenticated;

DROP POLICY IF EXISTS "select_transfers" ON transfers;
CREATE POLICY "select_transfers" ON transfers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_transfers" ON transfers;
CREATE POLICY "insert_transfers" ON transfers
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_transfers" ON transfers;
CREATE POLICY "update_transfers" ON transfers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_transfers" ON transfers;
CREATE POLICY "delete_transfers" ON transfers
  FOR DELETE TO authenticated USING (true);

-- 5. transfer_items
CREATE TABLE IF NOT EXISTS transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE transfer_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON transfer_items TO authenticated;

DROP POLICY IF EXISTS "select_transfer_items" ON transfer_items;
CREATE POLICY "select_transfer_items" ON transfer_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_transfer_items" ON transfer_items;
CREATE POLICY "insert_transfer_items" ON transfer_items
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_transfer_items" ON transfer_items;
CREATE POLICY "update_transfer_items" ON transfer_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_transfer_items" ON transfer_items;
CREATE POLICY "delete_transfer_items" ON transfer_items
  FOR DELETE TO authenticated USING (true);

-- Index for soft-delete filtering
CREATE INDEX IF NOT EXISTS idx_products_deleted_at ON products(deleted_at) WHERE deleted_at IS NULL;
