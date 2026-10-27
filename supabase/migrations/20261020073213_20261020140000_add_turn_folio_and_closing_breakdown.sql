/*
# Folio de turno y desglose de cierre en cajas

## Descripción
Añade un folio único de turno (formato T-AAAAMMDD-N) a las cajas y un campo
jsonb para guardar el desglose de métodos de pago al momento del corte.

## Tablas modificadas
1. cash_registers
   - folio text UNIQUE — folio del turno (Ej: T-20261020-0).
   - closing_breakdown jsonb — desglose de métodos de pago y denominaciones
     contadas al cierre (efectivo, tarjeta_debito, tarjeta_credito,
     transferencia, cheque, otros, denominaciones).

## Seguridad
- Sin cambios en RLS (las políticas existentes ya cubren la tabla).
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'cash_registers' AND column_name = 'folio') THEN
    ALTER TABLE cash_registers ADD COLUMN folio text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'cash_registers' AND column_name = 'closing_breakdown') THEN
    ALTER TABLE cash_registers ADD COLUMN closing_breakdown jsonb;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_registers_folio ON cash_registers(folio) WHERE folio IS NOT NULL;
