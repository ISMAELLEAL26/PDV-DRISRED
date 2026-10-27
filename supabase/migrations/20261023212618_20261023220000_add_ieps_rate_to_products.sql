/*
# Add IEPS rate to products

## Overview
Adds an `ieps_rate` column to the `products` table to support IEPS (Impuesto Especial sobre Producción y Servicios)
alongside the existing IVA `tax_rate`. This enables accurate margin calculation that accounts for both taxes.

## Changes
- `products.ieps_rate` (numeric, default 0): Porcentaje de IEPS aplicable al producto (0% por defecto).

## Notes
1. The column is nullable-safe with a default of 0 so existing products are unaffected.
2. The migration is idempotent.
*/

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ieps_rate numeric NOT NULL DEFAULT 0;
