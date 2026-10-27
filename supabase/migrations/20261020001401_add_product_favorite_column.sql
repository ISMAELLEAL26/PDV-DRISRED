/*
# Add favorite flag to products
Agrega una columna booleana `favorite` a la tabla products para marcar productos
favoritos que se mostrarán arriba en el módulo de Punto de Venta.
*/
ALTER TABLE products ADD COLUMN IF NOT EXISTS favorite boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN products.favorite IS 'Indica si el producto es favorito (mostrado arriba en el POS)';
