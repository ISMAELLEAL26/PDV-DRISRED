/*
# Add per-product discounts to sale items

1. New columns
- `sale_items.discount` — Porcentaje de descuento aplicado a ese producto en la venta. Es numérico y comienza en 0.

2. Modified tables
- `sale_items` — Se agrega el descuento individual sin modificar ni eliminar datos existentes.

3. Security
- No se crean tablas nuevas ni se cambian las políticas existentes. El nuevo campo queda protegido por las mismas políticas RLS de `sale_items`.

4. Important notes
- Los descuentos existentes conservan el valor 0.
- La columna permite guardar el descuento usado en cada renglón para reportes y comprobantes futuros.
*/
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS discount numeric(5,2) NOT NULL DEFAULT 0;
