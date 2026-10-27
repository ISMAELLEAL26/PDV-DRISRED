export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  created_at: string;
}

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  street: string | null;
  exterior_number: string | null;
  interior_number: string | null;
  neighborhood: string | null;
  locality: string | null;
  municipality: string | null;
  state: string | null;
  postal_code: string | null;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role_id: string | null;
  branch_id: string | null;
  active: boolean;
  phone: string | null;
  position: string | null;
  avatar_url: string | null;
  created_at: string;
  role?: Role | null;
  branch?: Branch | null;
}

export interface Category {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  legal_name: string | null;
  commercial_name: string | null;
  contact_name: string | null;
  phone: string | null;
  phone_secondary: string | null;
  email: string | null;
  address: string | null;
  rfc: string | null;
  visit_days: string | null;
  delivery_days: string | null;
  distribution_route: string | null;
  credit_enabled: boolean;
  credit_limit: number;
  credit_term_days: number;
  balance_due: number;
  created_at: string;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  created_at: string;
}

export interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  barcode_2: string | null;
  name: string;
  description: string | null;
  department: string | null;
  category_id: string | null;
  supplier_id: string | null;
  cost_price: number;
  sale_price: number;
  price_2: number;
  price_3: number;
  tax_rate: number;
  ieps_rate: number;
  unit: string;
  bulk: boolean;
  track_inventory: boolean;
  is_package: boolean;
  image_url: string | null;
  active: boolean;
  favorite: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  category?: Category | null;
  supplier?: Supplier | null;
  package_items?: PackageItem[];
}

export interface PackageItem {
  id: string;
  package_id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  created_at: string;
  product?: Product | null;
}

export interface ProductStock {
  id: string;
  product_id: string;
  branch_id: string;
  quantity: number;
  min_stock: number;
}

export interface StockAdjustment {
  id: string;
  product_id: string;
  branch_id: string;
  theoretical: number;
  physical: number;
  difference: number;
  reason: string | null;
  user_id: string | null;
  created_at: string;
  product?: Product | null;
}

export interface Transfer {
  id: string;
  folio: string | null;
  origin_branch_id: string;
  destination_branch_id: string;
  status: string;
  user_id: string | null;
  notes: string | null;
  created_at: string;
  received_at: string | null;
  origin_branch?: Branch | null;
  destination_branch?: Branch | null;
  transfer_items?: TransferItem[];
}

export interface TransferItem {
  id: string;
  transfer_id: string;
  product_id: string;
  quantity: number;
  created_at: string;
  product?: Product | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  rfc: string | null;
  created_at: string;
}

export interface SaleItem {
  id?: string;
  sale_id?: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  line_total: number;
  returned_quantity?: number;
}

export interface BankAccount {
  id: string;
  bank_name: string;
  logo_url: string | null;
  beneficiary: string;
  account_number: string;
  clabe: string;
  active: boolean;
  created_at: string;
}

export interface Sale {
  id: string;
  branch_id: string;
  user_id: string | null;
  customer_id: string | null;
  cash_register_id: string | null;
  folio: string | null;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payment_method: string;
  amount_received: number;
  change: number;
  status: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  canceled_at?: string | null;
  canceled_by?: string | null;
  cancellation_reason?: string | null;
  payment_details?: Record<string, string | boolean | null>;
  customer?: Customer | null;
  branch?: Branch | null;
  sale_items?: SaleItem[];
}

export interface CashBox {
  id: string;
  branch_id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface CashRegister {
  id: string;
  branch_id: string;
  user_id: string | null;
  cash_box_id: string | null;
  folio: string | null;
  opening_amount: number;
  closing_amount: number | null;
  expected_amount: number | null;
  difference: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
  closing_breakdown?: Record<string, unknown> | null;
  user?: Profile | null;
}

export interface CashMovement {
  id: string;
  cash_register_id: string;
  type: string;
  amount: number;
  reason: string | null;
  created_at: string;
}

export interface CashCount {
  id?: string;
  cash_register_id: string;
  denomination: number;
  quantity: number;
  subtotal: number;
}

export interface Purchase {
  id: string;
  branch_id: string;
  supplier_id: string | null;
  user_id: string | null;
  folio: string | null;
  subtotal_before_tax: number;
  subtotal_after_tax: number;
  tax_total: number;
  total: number;
  status: string;
  notes: string | null;
  created_at: string;
  supplier?: Supplier | null;
}

export interface PurchaseItem {
  id?: string;
  purchase_id?: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
  purchase_unit?: string;
  box_count?: number;
  pieces_per_box?: number;
  piece_quantity?: number;
  tax_type?: string;
  includes_tax?: boolean;
  unit_cost_before_tax?: number;
  unit_cost_after_tax?: number;
  line_subtotal_before_tax?: number;
  line_subtotal_after_tax?: number;
  tax_amount?: number;
}

export interface SupplierOrder extends Omit<Purchase, 'status'> {
  status: string;
}

export interface SupplierOrderItem extends Omit<PurchaseItem, 'purchase_id'> {
  supplier_order_id?: string;
}

export interface Attendance {
  id: string;
  user_id: string | null;
  branch_id: string | null;
  check_in: string | null;
  check_out: string | null;
  notes: string | null;
  created_at: string;
  user?: Profile | null;
  branch?: Branch | null;
}

export interface Ad {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
}

export interface Settings {
  store_name: string;
  tax_rate: string;
  currency: string;
  currency_symbol: string;
  [key: string]: string;
}
