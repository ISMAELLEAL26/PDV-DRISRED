/*
# Sistema POS BIENESTAR — Esquema Core

## Descripción
Crea el esquema completo de base de datos para un punto de venta (POS) multi-sucursal
para la tienda BIENESTAR. Incluye gestión de sucursales, productos con stock por sucursal,
clientes, ventas con detalle, usuarios con roles, proveedores, compras, arqueos de caja,
asistencia de personal, imágenes publicitarias y configuración general.

## Tablas nuevas
1. roles — Roles de usuario.
2. branches — Sucursales (2).
3. profiles — Perfiles de usuario vinculados a auth.users.
4. categories — Categorías de productos.
5. suppliers — Proveedores.
6. products — Productos del catálogo.
7. product_stock — Stock por sucursal.
8. customers — Clientes.
9. cash_registers — Sesiones de caja.
10. cash_movements — Movimientos de caja.
11. cash_counts — Arqueo de caja.
12. sales — Cabecera de ventas.
13. sale_items — Detalle de venta.
14. purchases — Cabecera de compras.
15. purchase_items — Detalle de compras.
16. supplier_orders — Pedidos a proveedor.
17. supplier_order_items — Detalle pedidos.
18. attendance — Asistencia de personal.
19. ads — Imágenes publicitarias.
20. settings — Configuración general.

## Seguridad
- RLS habilitado en todas las tablas.
- Políticas TO authenticated (sistema requiere login).
*/

-- ROLES
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_roles" ON roles; CREATE POLICY "auth_select_roles" ON roles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_roles" ON roles; CREATE POLICY "auth_insert_roles" ON roles FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_roles" ON roles; CREATE POLICY "auth_update_roles" ON roles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_roles" ON roles; CREATE POLICY "auth_delete_roles" ON roles FOR DELETE TO authenticated USING (true);

-- BRANCHES
CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text, phone text, email text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_branches" ON branches; CREATE POLICY "auth_select_branches" ON branches FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_branches" ON branches; CREATE POLICY "auth_insert_branches" ON branches FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_branches" ON branches; CREATE POLICY "auth_update_branches" ON branches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_branches" ON branches; CREATE POLICY "auth_delete_branches" ON branches FOR DELETE TO authenticated USING (true);

-- PROFILES
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  role_id uuid REFERENCES roles(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  phone text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_profiles" ON profiles; CREATE POLICY "auth_select_profiles" ON profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_profiles" ON profiles; CREATE POLICY "auth_insert_profiles" ON profiles FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_profiles" ON profiles; CREATE POLICY "auth_update_profiles" ON profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_profiles" ON profiles; CREATE POLICY "auth_delete_profiles" ON profiles FOR DELETE TO authenticated USING (true);

-- CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, description text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_categories" ON categories; CREATE POLICY "auth_select_categories" ON categories FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_categories" ON categories; CREATE POLICY "auth_insert_categories" ON categories FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_categories" ON categories; CREATE POLICY "auth_update_categories" ON categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_categories" ON categories; CREATE POLICY "auth_delete_categories" ON categories FOR DELETE TO authenticated USING (true);

-- SUPPLIERS
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, contact_name text, phone text, email text, address text, rfc text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_suppliers" ON suppliers; CREATE POLICY "auth_select_suppliers" ON suppliers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_suppliers" ON suppliers; CREATE POLICY "auth_insert_suppliers" ON suppliers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_suppliers" ON suppliers; CREATE POLICY "auth_update_suppliers" ON suppliers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_suppliers" ON suppliers; CREATE POLICY "auth_delete_suppliers" ON suppliers FOR DELETE TO authenticated USING (true);

-- PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text UNIQUE,
  name text NOT NULL, description text,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  cost_price numeric(12,2) NOT NULL DEFAULT 0,
  sale_price numeric(12,2) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'pieza',
  image_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_products" ON products; CREATE POLICY "auth_select_products" ON products FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_products" ON products; CREATE POLICY "auth_insert_products" ON products FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_products" ON products; CREATE POLICY "auth_update_products" ON products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_products" ON products; CREATE POLICY "auth_delete_products" ON products FOR DELETE TO authenticated USING (true);

-- PRODUCT STOCK
CREATE TABLE IF NOT EXISTS product_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  quantity numeric(14,3) NOT NULL DEFAULT 0,
  min_stock numeric(14,3) NOT NULL DEFAULT 0,
  UNIQUE (product_id, branch_id)
);
ALTER TABLE product_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_product_stock" ON product_stock; CREATE POLICY "auth_select_product_stock" ON product_stock FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_product_stock" ON product_stock; CREATE POLICY "auth_insert_product_stock" ON product_stock FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_product_stock" ON product_stock; CREATE POLICY "auth_update_product_stock" ON product_stock FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_product_stock" ON product_stock; CREATE POLICY "auth_delete_product_stock" ON product_stock FOR DELETE TO authenticated USING (true);

-- CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, phone text, email text, address text, rfc text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_customers" ON customers; CREATE POLICY "auth_select_customers" ON customers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_customers" ON customers; CREATE POLICY "auth_insert_customers" ON customers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_customers" ON customers; CREATE POLICY "auth_update_customers" ON customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_customers" ON customers; CREATE POLICY "auth_delete_customers" ON customers FOR DELETE TO authenticated USING (true);

-- CASH REGISTERS
CREATE TABLE IF NOT EXISTS cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  opening_amount numeric(12,2) NOT NULL DEFAULT 0,
  closing_amount numeric(12,2),
  expected_amount numeric(12,2),
  difference numeric(12,2),
  status text NOT NULL DEFAULT 'abierta',
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz
);
ALTER TABLE cash_registers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_cash_registers" ON cash_registers; CREATE POLICY "auth_select_cash_registers" ON cash_registers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_cash_registers" ON cash_registers; CREATE POLICY "auth_insert_cash_registers" ON cash_registers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_cash_registers" ON cash_registers; CREATE POLICY "auth_update_cash_registers" ON cash_registers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_cash_registers" ON cash_registers; CREATE POLICY "auth_delete_cash_registers" ON cash_registers FOR DELETE TO authenticated USING (true);

-- CASH MOVEMENTS
CREATE TABLE IF NOT EXISTS cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_register_id uuid NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  type text NOT NULL,
  amount numeric(12,2) NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_cash_movements" ON cash_movements; CREATE POLICY "auth_select_cash_movements" ON cash_movements FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_cash_movements" ON cash_movements; CREATE POLICY "auth_insert_cash_movements" ON cash_movements FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_cash_movements" ON cash_movements; CREATE POLICY "auth_update_cash_movements" ON cash_movements FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_cash_movements" ON cash_movements; CREATE POLICY "auth_delete_cash_movements" ON cash_movements FOR DELETE TO authenticated USING (true);

-- CASH COUNTS
CREATE TABLE IF NOT EXISTS cash_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_register_id uuid NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  denomination numeric(8,2) NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  subtotal numeric(12,2) NOT NULL DEFAULT 0
);
ALTER TABLE cash_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_cash_counts" ON cash_counts; CREATE POLICY "auth_select_cash_counts" ON cash_counts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_cash_counts" ON cash_counts; CREATE POLICY "auth_insert_cash_counts" ON cash_counts FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_cash_counts" ON cash_counts; CREATE POLICY "auth_update_cash_counts" ON cash_counts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_cash_counts" ON cash_counts; CREATE POLICY "auth_delete_cash_counts" ON cash_counts FOR DELETE TO authenticated USING (true);

-- SALES
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  cash_register_id uuid REFERENCES cash_registers(id) ON DELETE SET NULL,
  folio text,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'efectivo',
  amount_received numeric(12,2) NOT NULL DEFAULT 0,
  change numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completada',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_sales" ON sales; CREATE POLICY "auth_select_sales" ON sales FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_sales" ON sales; CREATE POLICY "auth_insert_sales" ON sales FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_sales" ON sales; CREATE POLICY "auth_update_sales" ON sales FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_sales" ON sales; CREATE POLICY "auth_delete_sales" ON sales FOR DELETE TO authenticated USING (true);

-- SALE ITEMS
CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL DEFAULT 0
);
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_sale_items" ON sale_items; CREATE POLICY "auth_select_sale_items" ON sale_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_sale_items" ON sale_items; CREATE POLICY "auth_insert_sale_items" ON sale_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_sale_items" ON sale_items; CREATE POLICY "auth_update_sale_items" ON sale_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_sale_items" ON sale_items; CREATE POLICY "auth_delete_sale_items" ON sale_items FOR DELETE TO authenticated USING (true);

-- PURCHASES
CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  folio text, total numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'recibida', notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_purchases" ON purchases; CREATE POLICY "auth_select_purchases" ON purchases FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_purchases" ON purchases; CREATE POLICY "auth_insert_purchases" ON purchases FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_purchases" ON purchases; CREATE POLICY "auth_update_purchases" ON purchases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_purchases" ON purchases; CREATE POLICY "auth_delete_purchases" ON purchases FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL DEFAULT 0
);
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_purchase_items" ON purchase_items; CREATE POLICY "auth_select_purchase_items" ON purchase_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_purchase_items" ON purchase_items; CREATE POLICY "auth_insert_purchase_items" ON purchase_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_purchase_items" ON purchase_items; CREATE POLICY "auth_update_purchase_items" ON purchase_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_purchase_items" ON purchase_items; CREATE POLICY "auth_delete_purchase_items" ON purchase_items FOR DELETE TO authenticated USING (true);

-- SUPPLIER ORDERS
CREATE TABLE IF NOT EXISTS supplier_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  folio text, total numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendiente', notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_supplier_orders" ON supplier_orders; CREATE POLICY "auth_select_supplier_orders" ON supplier_orders FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_supplier_orders" ON supplier_orders; CREATE POLICY "auth_insert_supplier_orders" ON supplier_orders FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_supplier_orders" ON supplier_orders; CREATE POLICY "auth_update_supplier_orders" ON supplier_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_supplier_orders" ON supplier_orders; CREATE POLICY "auth_delete_supplier_orders" ON supplier_orders FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS supplier_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_order_id uuid NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL DEFAULT 0
);
ALTER TABLE supplier_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_supplier_order_items" ON supplier_order_items; CREATE POLICY "auth_select_supplier_order_items" ON supplier_order_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_supplier_order_items" ON supplier_order_items; CREATE POLICY "auth_insert_supplier_order_items" ON supplier_order_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_supplier_order_items" ON supplier_order_items; CREATE POLICY "auth_update_supplier_order_items" ON supplier_order_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_supplier_order_items" ON supplier_order_items; CREATE POLICY "auth_delete_supplier_order_items" ON supplier_order_items FOR DELETE TO authenticated USING (true);

-- ATTENDANCE
CREATE TABLE IF NOT EXISTS attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  check_in timestamptz, check_out timestamptz, notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_attendance" ON attendance; CREATE POLICY "auth_select_attendance" ON attendance FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_attendance" ON attendance; CREATE POLICY "auth_insert_attendance" ON attendance FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_attendance" ON attendance; CREATE POLICY "auth_update_attendance" ON attendance FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_attendance" ON attendance; CREATE POLICY "auth_delete_attendance" ON attendance FOR DELETE TO authenticated USING (true);

-- ADS
CREATE TABLE IF NOT EXISTS ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  image_url text NOT NULL,
  link_url text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE ads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_ads" ON ads; CREATE POLICY "auth_select_ads" ON ads FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_ads" ON ads; CREATE POLICY "auth_insert_ads" ON ads FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_ads" ON ads; CREATE POLICY "auth_update_ads" ON ads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_ads" ON ads; CREATE POLICY "auth_delete_ads" ON ads FOR DELETE TO authenticated USING (true);

-- SETTINGS
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_settings" ON settings; CREATE POLICY "auth_select_settings" ON settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_settings" ON settings; CREATE POLICY "auth_insert_settings" ON settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_settings" ON settings; CREATE POLICY "auth_update_settings" ON settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_settings" ON settings; CREATE POLICY "auth_delete_settings" ON settings FOR DELETE TO authenticated USING (true);

-- ÍNDICES
CREATE INDEX IF NOT EXISTS idx_sales_branch_date ON sales(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_product ON product_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_branch ON product_stock(branch_id);
CREATE INDEX IF NOT EXISTS idx_purchases_branch ON purchases(branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_registers_branch_status ON cash_registers(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, created_at);

-- SEED: roles, sucursales, settings
INSERT INTO roles (name, description, permissions)
SELECT 'Administrador', 'Acceso total al sistema', '["all"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Administrador');
INSERT INTO roles (name, description, permissions)
SELECT 'Cajero', 'Operacion de caja y ventas', '["pos","sales","customers","cash"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Cajero');
INSERT INTO roles (name, description, permissions)
SELECT 'Gerente', 'Gestion operativa y reportes', '["pos","sales","customers","products","purchases","reports","cash","attendance"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Gerente');

INSERT INTO branches (name, address, phone)
SELECT 'BIENESTAR Sucursal 1', 'Por configurar', '000-000-0000'
WHERE NOT EXISTS (SELECT 1 FROM branches WHERE name = 'BIENESTAR Sucursal 1');
INSERT INTO branches (name, address, phone)
SELECT 'BIENESTAR Sucursal 2', 'Por configurar', '000-000-0000'
WHERE NOT EXISTS (SELECT 1 FROM branches WHERE name = 'BIENESTAR Sucursal 2');

INSERT INTO settings (key, value) SELECT 'store_name', 'BIENESTAR' WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'store_name');
INSERT INTO settings (key, value) SELECT 'tax_rate', '0.16' WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'tax_rate');
INSERT INTO settings (key, value) SELECT 'currency', 'MXN' WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'currency');
INSERT INTO settings (key, value) SELECT 'currency_symbol', '$' WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'currency_symbol');
