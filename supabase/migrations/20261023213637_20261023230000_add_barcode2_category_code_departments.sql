/*
# Add barcode_2 to products, code to categories, departments table

## Overview
1. `products.barcode_2` — segundo código de barras opcional.
2. `categories.code` — código único de categoría (texto, UNIQUE) para evitar duplicados y permitir importación automática.
3. New table `departments` — reemplaza el texto libre en products.department por una tabla con código único.
   - `id`, `code` (unique text), `name`, `created_at`
4. Migrar products.department existente a la nueva tabla (si hay datos).
5. Agregar constraints UNIQUE en barcode, barcode_2 y sku (solo no-null) para evitar duplicados.

## Notas
- Todos los cambios son aditivos. El campo `department` en products se conserva como texto por compatibilidad,
  pero la nueva tabla `departments` es la fuente de verdad con su `code` único.
- La importación usará el código de categoría/departamento para encontrar o crear automáticamente.
*/

-- 1. barcode_2 en products
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode_2 text;

-- 2. code en categories
ALTER TABLE categories ADD COLUMN IF NOT EXISTS code text;

-- Crear índice único parcial (solo donde code no es null) para evitar duplicados
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_code_unique ON categories(code) WHERE code IS NOT NULL;

-- 3. Tabla departments
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO authenticated;

DROP POLICY IF EXISTS "select_departments" ON departments;
CREATE POLICY "select_departments" ON departments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_departments" ON departments;
CREATE POLICY "insert_departments" ON departments
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_departments" ON departments;
CREATE POLICY "update_departments" ON departments
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_departments" ON departments;
CREATE POLICY "delete_departments" ON departments
  FOR DELETE TO authenticated USING (true);

-- 4. Migrar departments existentes desde products.department (texto libre)
INSERT INTO departments (code, name)
SELECT DISTINCT department, department
FROM products
WHERE department IS NOT NULL AND department <> ''
AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.code = products.department)
ON CONFLICT (code) DO NOTHING;

-- 5. Constraints únicos para barcode y barcode_2 (parcial, solo no-null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique ON products(barcode) WHERE barcode IS NOT NULL AND barcode <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_2_unique ON products(barcode_2) WHERE barcode_2 IS NOT NULL AND barcode_2 <> '';
