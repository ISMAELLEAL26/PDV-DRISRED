import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency } from '@/lib/format';
import type { Product, Category, Supplier, ProductStock, PackageItem, Branch, Department } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Select, Textarea } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import { Package, Plus, Pencil, Trash2, Image as ImageIcon, AlertTriangle, Star, Boxes, Tags, ArrowLeftRight, Trash, FileSpreadsheet, Upload, Download, FolderTree, Layers, CheckCircle2, XCircle, Loader2, Eye, ScanLine } from 'lucide-react';
import { downloadXLSX, downloadXLSXTemplate, parseCSV, readSpreadsheet, readFileText } from '@/lib/excel';
import InventoryAdjustmentPage from './InventoryAdjustmentPage';
import PriceManagerPage from './PriceManagerPage';
import TransfersPage from './TransfersPage';
import DeletedProductsPage from './DeletedProductsPage';
import BarcodeScanner from '@/components/BarcodeScanner';

type Tab = 'catalog' | 'inventory' | 'prices' | 'transfers' | 'trash' | 'import-export';

function normalizeImportHeader(value: string): string {
  const header = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/%/g, 'porcentaje')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (header === 'clave' || header === 'clave_sku') return 'sku';
  if (header === 'codigo_de_barras_1' || header === 'codigo_barras_1') return 'barcode';
  if (header === 'codigo_de_barras_2' || header === 'codigo_barras_2') return 'barcode_2';
  if (header === 'nombre') return 'name';
  if (header === 'codigo_de_departamento') return 'department_code';
  if (header === 'codigo_de_categoria') return 'category_code';
  if (header === 'unidad') return 'unit';
  if (header === 'precio_de_costo') return 'cost_price';
  if (header === 'precio_de_venta_1') return 'sale_price';
  if (header === 'precio_de_venta_2') return 'price_2';
  if (header === 'precio_de_venta_3') return 'price_3';
  if (header === 'iva_porcentaje' || header === 'iva') return 'tax_rate';
  if (header === 'ieps_porcentaje' || header === 'ieps') return 'ieps_rate';
  if (header === 'venta_a_granel') return 'bulk';
  if (header === 'control_de_inventario') return 'track_inventory';
  if (header === 'url_de_foto' || header === 'url_de_imagen' || header === 'foto' || header === 'imagen') return 'image_url';
  if (header === 'codigo') return 'code';
  if (header === 'descripcion') return 'description';
  if (header.startsWith('existencia_')) return `stock_${header.slice('existencia_'.length)}`;
  if (header.startsWith('minimo_')) return `min_stock_${header.slice('minimo_'.length)}`;
  return header;
}

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'catalog', label: 'Catálogo', icon: <Package size={16} /> },
  { key: 'inventory', label: 'Inventario', icon: <Boxes size={16} /> },
  { key: 'prices', label: 'Precios', icon: <Tags size={16} /> },
  { key: 'transfers', label: 'Traspasos', icon: <ArrowLeftRight size={16} /> },
  { key: 'trash', label: 'Papelera', icon: <Trash size={16} /> },
  { key: 'import-export', label: 'Importar / Exportar', icon: <FileSpreadsheet size={16} /> },
];

const UNITS = ['pieza', 'kg', 'g', 'litro', 'ml', 'metro', 'caja', 'paquete', 'bolsa', 'docena'];

const TAX_PRESETS = [
  { label: 'IVA 16%', taxRate: 16, iepsRate: 0 },
  { label: 'IEPS 8%', taxRate: 0, iepsRate: 8 },
  { label: 'Sin impuesto', taxRate: 0, iepsRate: 0 },
];

type PriceMode = 'manual' | 'margin';

type ImportRowStatus = 'new' | 'existing' | 'error';
interface ImportPreviewRow {
  rowIndex: number;
  name: string;
  sku: string;
  barcode: string;
  barcode2: string;
  imageUrl: string;
  department: string;
  category: string;
  unit: string;
  costPrice: number;
  salePrice: number;
  price2: number;
  price3: number;
  taxRate: number;
  iepsRate: number;
  bulk: boolean;
  trackInventory: boolean;
  stockColumns: Record<string, string>;
  status: ImportRowStatus;
  existingProductId?: string;
  existingStock?: Record<string, number>;
  error?: string;
}

export default function ProductsPage() {
  const { branches, user } = useAuth();
  const [tab, setTab] = useState<Tab>('catalog');
  const [products, setProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stockRows, setStockRows] = useState<ProductStock[]>([]);
  const [packageItems, setPackageItems] = useState<PackageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Product>>({});
  const [stockByBranch, setStockByBranch] = useState<Record<string, { quantity: string; min_stock: string }>>({});
  const [comboItems, setComboItems] = useState<{ product_id: string; quantity: string; unit_cost: string }[]>([]);
  const [priceMode, setPriceMode] = useState<PriceMode>('manual');
  const [profitPercent, setProfitPercent] = useState('');
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [deptRows, setDeptRows] = useState<Department[]>([]);
  const [catForm, setCatForm] = useState({ id: '', code: '', name: '', description: '' });
  const [deptForm, setDeptForm] = useState({ id: '', code: '', name: '' });
  const [catSaving, setCatSaving] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<'search' | 'barcode' | 'barcode_2'>('search');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: pData }, { data: allPData }, { data: cData }, { data: sData }, { data: stData }, { data: piData }, { data: dData }] = await Promise.all([
      supabase.from('products').select('*, category:categories(*), supplier:suppliers(*)').is('deleted_at', null).order('name'),
      supabase.from('products').select('*, category:categories(*), supplier:suppliers(*)').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('product_stock').select('*'),
      supabase.from('package_items').select('*, product:products!package_items_product_id_fkey(*)'),
      supabase.from('departments').select('*').order('name'),
    ]);
    setProducts((pData as Product[]) ?? []);
    setAllProducts((allPData as Product[]) ?? []);
    setCategories((cData as Category[]) ?? []);
    setSuppliers((sData as Supplier[]) ?? []);
    setStockRows((stData as ProductStock[]) ?? []);
    setPackageItems((piData as PackageItem[]) ?? []);
    setDeptRows((dData as Department[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const stockMap = useMemo(() => {
    const m = new Map<string, Record<string, ProductStock>>();
    stockRows.forEach((r) => {
      if (!m.has(r.product_id)) m.set(r.product_id, {});
      m.get(r.product_id)![r.branch_id] = r;
    });
    return m;
  }, [stockRows]);

  const comboMap = useMemo(() => {
    const m = new Map<string, PackageItem[]>();
    packageItems.forEach((pi) => {
      if (!m.has(pi.package_id)) m.set(pi.package_id, []);
      m.get(pi.package_id)!.push(pi);
    });
    return m;
  }, [packageItems]);

  const productsByCategory = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => { if (p.category_id) m.set(p.category_id, (m.get(p.category_id) ?? 0) + 1); });
    return m;
  }, [products]);

  const productsByDepartment = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => { if (p.department) m.set(p.department, (m.get(p.department) ?? 0) + 1); });
    return m;
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (filterCategory && p.category_id !== filterCategory) return false;
      if (filterDept && p.department !== filterDept) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q) || (p.barcode_2 ?? '').toLowerCase().includes(q);
    });
  }, [products, search, filterCategory, filterDept]);

  const computeMargin = useCallback((cost: number, sale: number, taxRate: number, iepsRate: number): number => {
    if (cost <= 0) return 0;
    const totalTaxRate = taxRate + iepsRate;
    const priceWithoutTax = totalTaxRate > 0 ? sale / (1 + totalTaxRate / 100) : sale;
    const profit = priceWithoutTax - cost;
    return (profit / cost) * 100;
  }, []);

  const computeSaleFromMargin = useCallback((cost: number, marginPct: number, taxRate: number, iepsRate: number): number => {
    const totalTaxRate = taxRate + iepsRate;
    const priceWithoutTax = cost * (1 + marginPct / 100);
    return totalTaxRate > 0 ? priceWithoutTax * (1 + totalTaxRate / 100) : priceWithoutTax;
  }, []);

  const computedMargin = useMemo(() => {
    return computeMargin(
      Number(form.cost_price ?? 0),
      Number(form.sale_price ?? 0),
      Number(form.tax_rate ?? 0),
      Number(form.ieps_rate ?? 0),
    );
  }, [form.cost_price, form.sale_price, form.tax_rate, form.ieps_rate, computeMargin]);

  const applyProfitPercent = () => {
    const pct = parseFloat(profitPercent) || 0;
    const cost = Number(form.cost_price ?? 0);
    const newSale = computeSaleFromMargin(cost, pct, Number(form.tax_rate ?? 0), Number(form.ieps_rate ?? 0));
    setForm({ ...form, sale_price: Math.round(newSale * 100) / 100 });
  };

  const applyTaxPreset = (preset: typeof TAX_PRESETS[0]) => {
    setForm({ ...form, tax_rate: preset.taxRate, ieps_rate: preset.iepsRate });
  };

  const openNew = () => {
    setEditing(null);
    setForm({ active: true, unit: 'pieza', cost_price: 0, sale_price: 0, tax_rate: 16, ieps_rate: 0, bulk: false, track_inventory: true, is_package: false, favorite: false, price_2: 0, price_3: 0 });
    setPriceMode('manual');
    setProfitPercent('');
    const init: Record<string, { quantity: string; min_stock: string }> = {};
    branches.forEach((b) => { init[b.id] = { quantity: '0', min_stock: '0' }; });
    setStockByBranch(init);
    setComboItems([]);
    setError(null);
    setOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      ...p,
      cost_price: Number(p.cost_price),
      sale_price: Number(p.sale_price),
      price_2: Number(p.price_2),
      price_3: Number(p.price_3),
      tax_rate: Number(p.tax_rate),
      ieps_rate: Number(p.ieps_rate ?? 0),
    });
    setPriceMode('manual');
    setProfitPercent('');
    const init: Record<string, { quantity: string; min_stock: string }> = {};
    branches.forEach((b) => {
      const s = stockMap.get(p.id)?.[b.id];
      init[b.id] = { quantity: String(s?.quantity ?? 0), min_stock: String(s?.min_stock ?? 0) };
    });
    setStockByBranch(init);
    const existing = comboMap.get(p.id) ?? [];
    setComboItems(existing.map((pi) => ({ product_id: pi.product_id, quantity: String(pi.quantity), unit_cost: String(pi.unit_cost) })));
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    if (!form.name || !form.name.trim()) { setError('El nombre es obligatorio'); setSaving(false); return; }
    if (form.is_package && comboItems.filter((c) => c.product_id && parseFloat(c.quantity) > 0).length === 0) {
      setError('Los paquetes deben incluir al menos un producto'); setSaving(false); return;
    }
    const payload = {
      sku: form.sku || null,
      barcode: form.barcode || null,
      barcode_2: form.barcode_2 || null,
      name: form.name.trim(),
      description: form.description ?? null,
      department: form.department || null,
      category_id: form.category_id || null,
      supplier_id: form.supplier_id || null,
      cost_price: Number(form.cost_price ?? 0),
      sale_price: Number(form.sale_price ?? 0),
      price_2: Number(form.price_2 ?? 0),
      price_3: Number(form.price_3 ?? 0),
      tax_rate: Number(form.tax_rate ?? 0),
      ieps_rate: Number(form.ieps_rate ?? 0),
      unit: form.unit ?? 'pieza',
      bulk: form.bulk ?? false,
      track_inventory: form.track_inventory ?? true,
      is_package: form.is_package ?? false,
      image_url: form.image_url || null,
      active: form.active ?? true,
      favorite: form.favorite ?? false,
    };
    let productId = editing?.id;
    if (editing) {
      const { error: e } = await supabase.from('products').update(payload).eq('id', editing.id);
      if (e) { console.error(e); setError('No se pudo completar la operación.'); setSaving(false); return; }
    } else {
      const { data, error: e } = await supabase.from('products').insert(payload).select().single();
      if (e) { console.error(e); setError('No se pudo completar la operación.'); setSaving(false); return; }
      productId = data.id;
    }
    if (!form.is_package) {
      for (const b of branches) {
        const v = stockByBranch[b.id];
        if (!v) continue;
        const existing = stockMap.get(productId!)?.[b.id];
        if (existing) {
          await supabase.from('product_stock').update({ quantity: Number(v.quantity), min_stock: Number(v.min_stock) }).eq('id', existing.id);
        } else {
          await supabase.from('product_stock').insert({ product_id: productId, branch_id: b.id, quantity: Number(v.quantity), min_stock: Number(v.min_stock) });
        }
      }
    }
    if (form.is_package && productId) {
      await supabase.from('package_items').delete().eq('package_id', productId);
      const validCombos = comboItems.filter((c) => c.product_id && parseFloat(c.quantity) > 0);
      if (validCombos.length > 0) {
        await supabase.from('package_items').insert(validCombos.map((c) => ({
          package_id: productId,
          product_id: c.product_id,
          quantity: parseFloat(c.quantity),
          unit_cost: parseFloat(c.unit_cost) || 0,
        })));
      }
    }
    setSaving(false);
    setOpen(false);
    load();
  };

  const toggleFavorite = async (p: Product) => {
    await supabase.from('products').update({ favorite: !p.favorite }).eq('id', p.id);
    load();
  };

  const remove = async (p: Product) => {
    if (!confirm(`¿Eliminar el producto "${p.name}"? Irá a la papelera y podrá restaurarse.`)) return;
    await supabase.from('products').update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null, active: false }).eq('id', p.id);
    load();
  };

  const deleteSelectedProducts = async () => {
    if (selectedProducts.size === 0 || bulkBusy) return;
    if (!confirm(`¿Enviar ${selectedProducts.size} producto(s) a la papelera?`)) return;
    setBulkBusy(true);
    setBulkError(null);
    const { error: updateError } = await supabase
      .from('products')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null, active: false })
      .in('id', Array.from(selectedProducts));
    if (updateError) {
      console.error(updateError);
      setBulkError('No se pudieron eliminar los productos. Verifica tus permisos e intenta de nuevo.');
      setBulkBusy(false);
      return;
    }
    setSelectedProducts(new Set());
    setBulkBusy(false);
    await load();
  };

  const formatAllProducts = async () => {
    if (products.length === 0 || bulkBusy) return;
    if (!confirm(`¿Enviar los ${products.length} productos del catálogo a la papelera? Esta acción se puede revertir desde Papelera.`)) return;
    setBulkBusy(true);
    setBulkError(null);
    const { error: updateError } = await supabase
      .from('products')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null, active: false })
      .is('deleted_at', null);
    if (updateError) {
      console.error(updateError);
      setBulkError('No se pudo formatear el catálogo. Verifica tus permisos e intenta de nuevo.');
      setBulkBusy(false);
      return;
    }
    setSelectedProducts(new Set());
    setBulkBusy(false);
    await load();
  };

  const toggleProductSelection = (id: string) => {
    setSelectedProducts((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const toggleSelectAll = () => {
    if (selectedProducts.size === filtered.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(filtered.map((p) => p.id)));
    }
  };

  // ─── Category / Department management ──────────────────────────────────────
  const openCatNew = () => { setCatForm({ id: '', code: '', name: '', description: '' }); setCatError(null); };
  const openCatEdit = (c: Category) => { setCatForm({ id: c.id, code: c.code ?? '', name: c.name, description: c.description ?? '' }); setCatError(null); };

  const saveCategory = async () => {
    if (!catForm.name.trim()) { setCatError('El nombre es obligatorio'); return; }
    if (!catForm.code.trim()) { setCatError('El código es obligatorio'); return; }
    setCatSaving(true); setCatError(null);
    const code = catForm.code.trim().toUpperCase();
    if (catForm.id) {
      const { error: e } = await supabase.from('categories').update({ name: catForm.name.trim(), code, description: catForm.description || null }).eq('id', catForm.id);
      if (e) { console.error(e); setCatError(e.code === '23505' ? 'El código ya existe en otra categoría.' : 'No se pudo guardar.'); setCatSaving(false); return; }
    } else {
      const { error: e } = await supabase.from('categories').insert({ name: catForm.name.trim(), code, description: catForm.description || null });
      if (e) { console.error(e); setCatError(e.code === '23505' ? 'El código ya existe.' : 'No se pudo guardar.'); setCatSaving(false); return; }
    }
    setCatSaving(false);
    setCatForm({ id: '', code: '', name: '', description: '' });
    load();
  };

  const deleteCategory = async (id: string) => {
    const linked = productsByCategory.get(id) ?? 0;
    if (linked > 0) { setCatError(`No se puede eliminar: ${linked} producto(s) vinculado(s). Reasigna los productos primero.`); return; }
    if (!confirm('¿Eliminar esta categoría?')) return;
    await supabase.from('categories').delete().eq('id', id);
    setSelectedCats((prev) => { const n = new Set(prev); n.delete(id); return n; });
    load();
  };

  const deleteSelectedCategories = async () => {
    const blocked = Array.from(selectedCats).filter((id) => (productsByCategory.get(id) ?? 0) > 0);
    if (blocked.length > 0) {
      setCatError(`${blocked.length} categoría(s) no se pueden eliminar porque tienen productos vinculados.`);
      return;
    }
    if (!confirm(`¿Eliminar ${selectedCats.size} categoría(s)?`)) return;
    for (const id of selectedCats) {
      await supabase.from('categories').delete().eq('id', id);
    }
    setSelectedCats(new Set());
    load();
  };

  const saveDepartment = async () => {
    if (!deptForm.name.trim()) { setCatError('El nombre es obligatorio'); return; }
    if (!deptForm.code.trim()) { setCatError('El código es obligatorio'); return; }
    setCatSaving(true); setCatError(null);
    const code = deptForm.code.trim().toUpperCase();
    if (deptForm.id) {
      const { error: e } = await supabase.from('departments').update({ code, name: deptForm.name.trim() }).eq('id', deptForm.id);
      if (e) { console.error(e); setCatError(e.code === '23505' ? 'El código ya existe en otro departamento.' : 'No se pudo guardar.'); setCatSaving(false); return; }
      if (deptForm.id !== code) {
        await supabase.from('products').update({ department: code }).eq('department', deptForm.id);
      }
    } else {
      const { error: e } = await supabase.from('departments').insert({ code, name: deptForm.name.trim() });
      if (e) { console.error(e); setCatError(e.code === '23505' ? 'El código ya existe.' : 'No se pudo guardar.'); setCatSaving(false); return; }
    }
    setCatSaving(false);
    setDeptForm({ id: '', code: '', name: '' });
    load();
  };

  const deleteDepartment = async (dept: Department) => {
    const linked = productsByDepartment.get(dept.code) ?? 0;
    if (linked > 0) { setCatError(`No se puede eliminar: ${linked} producto(s) con este departamento. Reasigna primero.`); return; }
    if (!confirm('¿Eliminar este departamento?')) return;
    setCatSaving(true);
    await supabase.from('departments').delete().eq('id', dept.id);
    setCatSaving(false);
    load();
  };

  if (loading && tab === 'catalog') return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="device-page p-6">
      <PageHeader title="Productos e Inventarios" subtitle={`${products.length} productos en catálogo`} />

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition ${
              tab === t.key ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'catalog' && (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <SearchInput value={search} onChange={setSearch} className="flex-1" />
            <button type="button" onClick={() => { setScannerTarget('search'); setScannerOpen(true); }} title="Escanear código con la cámara" className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-blue-50 hover:text-blue-700"><ScanLine size={16} /> Escanear</button>
            <Select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="sm:w-48">
              <option value="">Todos los departamentos</option>
              {deptRows.map((d) => <option key={d.id} value={d.code}>{d.name}</option>)}
            </Select>
            <Select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="sm:w-48">
              <option value="">Todas las categorías</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => { setDeptModalOpen(true); setCatError(null); }}><FolderTree size={16} /> Departamentos</Button>
              <Button variant="secondary" onClick={() => { setCatModalOpen(true); setCatError(null); setSelectedCats(new Set()); }}><Layers size={16} /> Categorías</Button>
              <Button onClick={openNew}><Plus size={16} /> Nuevo producto</Button>
            </div>
          </div>

          {/* Bulk actions bar */}
          {bulkError && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{bulkError}</div>}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
            <button
              onClick={toggleSelectAll}
              className="text-sm font-medium text-slate-600 hover:text-emerald-600"
            >
              {selectedProducts.size === filtered.length && filtered.length > 0 ? 'Quitar selección' : 'Seleccionar todo'}
            </button>
            {selectedProducts.size > 0 && (
              <span className="text-sm text-slate-500">{selectedProducts.size} seleccionado(s)</span>
            )}
            <div className="flex-1" />
            {selectedProducts.size > 0 && (
              <Button variant="danger" onClick={deleteSelectedProducts} disabled={bulkBusy}>
                {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Eliminar {selectedProducts.size} seleccionado(s)
              </Button>
            )}
            <Button variant="danger" onClick={formatAllProducts} disabled={bulkBusy || products.length === 0}>
              {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
              Formatear todo ({products.length})
            </Button>
          </div>

          <Card className="overflow-hidden">
            {filtered.length === 0 ? (
              <EmptyState title="Sin productos" description="Agrega tu primer producto al catálogo." icon={<Package size={48} />} />
            ) : (
              <div className="device-desktop-only overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={selectedProducts.size === filtered.length && filtered.length > 0}
                          onChange={toggleSelectAll}
                          className="h-4 w-4 accent-emerald-600"
                        />
                      </th>
                      <th className="px-4 py-3">Producto</th>
                      <th className="px-4 py-3">Depto</th>
                      <th className="px-4 py-3">Categoría</th>
                      <th className="px-4 py-3 text-right">Costo</th>
                      <th className="px-4 py-3 text-right">P. Venta</th>
                      {branches.map((b) => (
                        <th key={b.id} className="px-4 py-3 text-right">{b.name.replace('BIENESTAR ', '')}</th>
                      ))}
                      <th className="px-4 py-3 text-center">Estado</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((p) => {
                      const stocks = stockMap.get(p.id) ?? {};
                      const combos = comboMap.get(p.id);
                      const isSelected = selectedProducts.has(p.id);
                      return (
                        <tr key={p.id} className={`hover:bg-slate-50/50 ${isSelected ? 'bg-emerald-50/40' : ''}`}>
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleProductSelection(p.id)}
                              className="h-4 w-4 accent-emerald-600"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                                {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={14} className="text-slate-400" />}
                              </div>
                              <div>
                                <div className="font-medium text-slate-800">{p.name}</div>
                                <div className="text-xs text-slate-400">
                                  {p.sku ?? 'Sin SKU'} · {p.unit}
                                  {p.barcode && ` · ${p.barcode}`}
                                  {p.is_package && <span className="ml-1 text-blue-500">· Combo</span>}
                                  {p.bulk && <span className="ml-1 text-amber-500">· Granel</span>}
                                  {(p.tax_rate > 0 || p.ieps_rate > 0) && (
                                    <span className="ml-1 text-slate-400">· {p.tax_rate > 0 ? `IVA ${p.tax_rate}%` : ''}{p.ieps_rate > 0 ? `${p.tax_rate > 0 ? ' + ' : ''}IEPS ${p.ieps_rate}%` : ''}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{deptRows.find((d) => d.code === p.department)?.name ?? p.department ?? '—'}</td>
                          <td className="px-4 py-3 text-slate-600">{p.category?.name ?? '—'}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(p.cost_price)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatCurrency(p.sale_price)}</td>
                          {p.is_package ? (
                            <td colSpan={branches.length} className="px-4 py-3 text-xs text-blue-600">
                              {combos?.length ?? 0} producto(s) en combo
                            </td>
                          ) : branches.map((b) => {
                            const s = stocks[b.id];
                            const qty = Number(s?.quantity ?? 0);
                            const min = Number(s?.min_stock ?? 0);
                            const low = qty <= min && qty > 0;
                            const out = qty <= 0;
                            return (
                              <td key={b.id} className="px-4 py-3 text-right">
                                <span className={out ? 'text-red-600 font-semibold' : low ? 'text-amber-600 font-semibold' : 'text-slate-700'}>
                                  {qty}
                                </span>
                                {low && !out && <AlertTriangle size={12} className="inline ml-1 text-amber-500" />}
                              </td>
                            );
                          })}
                          <td className="px-4 py-3 text-center">
                            {p.active ? <Badge variant="success">Activo</Badge> : <Badge variant="default">Inactivo</Badge>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-1">
                              <button onClick={() => toggleFavorite(p)} className={`rounded p-1.5 hover:bg-amber-50 ${p.favorite ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`} title="Favorito">
                                <Star size={15} className={p.favorite ? 'fill-amber-400' : ''} />
                              </button>
                              <button onClick={() => openEdit(p)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600">
                                <Pencil size={15} />
                              </button>
                              <button onClick={() => remove(p)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {filtered.length > 0 && (
              <div className="device-mobile-only divide-y divide-slate-100">
                {filtered.map((p) => {
                  const stocks = stockMap.get(p.id) ?? {};
                  const department = deptRows.find((d) => d.code === p.department)?.name ?? p.department ?? 'Sin departamento';
                  const combos = comboMap.get(p.id);
                  const isSelected = selectedProducts.has(p.id);
                  return (
                    <article key={p.id} className={`p-3 ${isSelected ? 'bg-emerald-50/40' : 'bg-white'}`}>
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleProductSelection(p.id)}
                          className="mt-1 h-4 w-4 flex-shrink-0 accent-emerald-600"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="break-words text-sm font-semibold leading-5 text-slate-800">{p.name}</div>
                              <div className="mt-0.5 text-xs text-slate-500">{p.sku ?? 'Sin SKU'} · {p.unit}</div>
                            </div>
                            <Badge variant={p.active ? 'success' : 'default'}>{p.active ? 'Activo' : 'Inactivo'}</Badge>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                            <div className="min-w-0"><span className="text-slate-400">Depto: </span><span className="break-words text-slate-700">{department}</span></div>
                            <div className="min-w-0"><span className="text-slate-400">Categoría: </span><span className="break-words text-slate-700">{p.category?.name ?? '—'}</span></div>
                            <div><span className="text-slate-400">Costo: </span><span className="font-medium text-slate-700">{formatCurrency(p.cost_price)}</span></div>
                            <div><span className="text-slate-400">Venta: </span><span className="font-semibold text-slate-800">{formatCurrency(p.sale_price)}</span></div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {p.is_package ? (
                              <span className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700">{combos?.length ?? 0} en combo</span>
                            ) : branches.map((b) => {
                              const quantity = Number(stocks[b.id]?.quantity ?? 0);
                              return <span key={b.id} className={`rounded-md px-2 py-1 text-xs font-medium ${quantity <= 0 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-700'}`}>{b.name.replace('BIENESTAR ', '')}: {quantity}</span>;
                            })}
                          </div>
                          <div className="mt-2 flex justify-end gap-1 border-t border-slate-100 pt-2">
                            <button onClick={() => toggleFavorite(p)} className={`rounded p-2 hover:bg-amber-50 ${p.favorite ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`} title="Favorito"><Star size={16} className={p.favorite ? 'fill-amber-400' : ''} /></button>
                            <button onClick={() => openEdit(p)} className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-emerald-600" title="Editar"><Pencil size={16} /></button>
                            <button onClick={() => remove(p)} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Eliminar"><Trash2 size={16} /></button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'inventory' && <InventoryAdjustmentPage />}
      {tab === 'prices' && <PriceManagerPage />}
      {tab === 'transfers' && <TransfersPage />}
      {tab === 'trash' && <DeletedProductsPage />}
      {tab === 'import-export' && <ImportExportTab products={products} lookupProducts={allProducts} stockRows={stockRows} categories={categories} branches={branches} onReload={load} />}

      {/* Product form modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar producto' : 'Nuevo producto'} size="xl">
        <div className="space-y-5">
          {/* General info */}
          <div>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Información general</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Nombre *">
                <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="SKU / Clave">
                <Input value={form.sku ?? ''} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              </Field>
              <Field label="Código de barras 1">
                <div className="flex gap-2">
                  <Input value={form.barcode ?? ''} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
                  <button type="button" onClick={() => { setScannerTarget('barcode'); setScannerOpen(true); }} title="Escanear" className="flex-shrink-0 rounded-lg border border-slate-200 px-3 text-slate-500 hover:bg-blue-50 hover:text-blue-700"><ScanLine size={16} /></button>
                </div>
              </Field>
              <Field label="Código de barras 2">
                <div className="flex gap-2">
                  <Input value={form.barcode_2 ?? ''} onChange={(e) => setForm({ ...form, barcode_2: e.target.value })} placeholder="Opcional" />
                  <button type="button" onClick={() => { setScannerTarget('barcode_2'); setScannerOpen(true); }} title="Escanear" className="flex-shrink-0 rounded-lg border border-slate-200 px-3 text-slate-500 hover:bg-blue-50 hover:text-blue-700"><ScanLine size={16} /></button>
                </div>
              </Field>
              <Field label="Departamento">
                <Select value={form.department ?? ''} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                  <option value="">Sin departamento</option>
                  {deptRows.map((d) => <option key={d.id} value={d.code}>{d.name}</option>)}
                </Select>
              </Field>
              <Field label="Categoría">
                <Select value={form.category_id ?? ''} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                  <option value="">Sin categoría</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Proveedor">
                <Select value={form.supplier_id ?? ''} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                  <option value="">Sin proveedor</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Unidad de venta">
                <Select value={form.unit ?? 'pieza'} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              </Field>
              <Field label="Control de inventario">
                <Select value={form.track_inventory ? '1' : '0'} onChange={(e) => setForm({ ...form, track_inventory: e.target.value === '1' })}>
                  <option value="1">Sí, llevar inventario</option>
                  <option value="0">No</option>
                </Select>
              </Field>
              <Field label="Venta a granel (decimales)">
                <Select value={form.bulk ? '1' : '0'} onChange={(e) => setForm({ ...form, bulk: e.target.value === '1' })}>
                  <option value="0">No</option>
                  <option value="1">Sí, permitir decimales (1.05)</option>
                </Select>
              </Field>
            </div>
          </div>

          {/* Pricing — simplified: cost + sale, tax buttons, margin mode */}
          <div>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Precio e impuestos</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Precio de costo">
                <Input type="number" step="0.01" value={form.cost_price ?? 0} onChange={(e) => setForm({ ...form, cost_price: parseFloat(e.target.value) || 0 })} />
              </Field>
              <Field label="Precio de venta">
                <Input type="number" step="0.01" value={form.sale_price ?? 0} onChange={(e) => { setForm({ ...form, sale_price: parseFloat(e.target.value) || 0 }); setPriceMode('manual'); }} />
              </Field>
            </div>

            {/* Tax buttons */}
            <div className="mt-3 flex flex-wrap gap-2">
              {TAX_PRESETS.map((preset) => {
                const isActive = Number(form.tax_rate ?? 0) === preset.taxRate && Number(form.ieps_rate ?? 0) === preset.iepsRate;
                return (
                  <button
                    key={preset.label}
                    onClick={() => applyTaxPreset(preset)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Profit margin mode */}
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">Calcular precio por ganancia</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPriceMode('margin')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${priceMode === 'margin' ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}
                  >
                    Por porcentaje
                  </button>
                  <button
                    onClick={() => setPriceMode('manual')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${priceMode === 'manual' ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}
                  >
                    Manual
                  </button>
                </div>
              </div>
              {priceMode === 'margin' && (
                <div className="flex items-end gap-2">
                  <Field label="% de ganancia sobre costo" className="flex-1">
                    <Input
                      type="number"
                      step="0.1"
                      value={profitPercent}
                      onChange={(e) => setProfitPercent(e.target.value)}
                      placeholder="Ej. 50"
                    />
                  </Field>
                  <Button onClick={applyProfitPercent} disabled={!form.cost_price}>Calcular precio</Button>
                </div>
              )}
              <div className="mt-3 flex items-center gap-4">
                <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2">
                  <span className="text-xs text-slate-500">Margen real: </span>
                  <span className={`text-sm font-bold ${computedMargin > 0 ? 'text-emerald-600' : computedMargin < 0 ? 'text-red-600' : 'text-slate-600'}`}>
                    {computedMargin.toFixed(1)}%
                  </span>
                </div>
                {(Number(form.tax_rate ?? 0) > 0 || Number(form.ieps_rate ?? 0) > 0) && (
                  <div className="text-xs text-slate-400">
                    Impuesto incluido: IVA {form.tax_rate ?? 0}%{Number(form.ieps_rate ?? 0) > 0 ? ` + IEPS ${form.ieps_rate}%` : ''}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Package / combo */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Paquete / Combo</h3>
              <Select value={form.is_package ? '1' : '0'} onChange={(e) => setForm({ ...form, is_package: e.target.value === '1' })} className="w-32">
                <option value="0">No es combo</option>
                <option value="1">Es un combo</option>
              </Select>
            </div>
            {form.is_package && (
              <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
                {comboItems.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select
                      value={c.product_id}
                      onChange={(e) => setComboItems(comboItems.map((it, i) => (i === idx ? { ...it, product_id: e.target.value } : it)))}
                      className="flex-1"
                    >
                      <option value="">Selecciona producto</option>
                      {products.filter((p) => p.id !== editing?.id && !p.is_package).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      className="w-24"
                      value={c.quantity}
                      onChange={(e) => setComboItems(comboItems.map((it, i) => (i === idx ? { ...it, quantity: e.target.value } : it)))}
                      placeholder="Cant."
                    />
                    <Input
                      type="number"
                      step="0.01"
                      className="w-24"
                      value={c.unit_cost}
                      onChange={(e) => setComboItems(comboItems.map((it, i) => (i === idx ? { ...it, unit_cost: e.target.value } : it)))}
                      placeholder="Costo"
                    />
                    <button onClick={() => setComboItems(comboItems.filter((_, i) => i !== idx))} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <Button variant="secondary" onClick={() => setComboItems([...comboItems, { product_id: '', quantity: '1', unit_cost: '0' }])}>
                  <Plus size={14} /> Agregar producto al combo
                </Button>
              </div>
            )}
          </div>

          <Field label="Características / Descripción">
            <Textarea rows={2} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>

          <Field label="URL de imagen">
            <Input value={form.image_url ?? ''} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." />
          </Field>

          {/* Stock per branch */}
          {!form.is_package && (
            <div>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Inventario por sucursal</h3>
              <div className="space-y-3">
                {branches.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                    <div className="flex-1 text-sm font-medium text-slate-700">{b.name}</div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-500">Cantidad</label>
                      <Input
                        type="number"
                        step={form.bulk ? '0.001' : '1'}
                        className="w-24"
                        value={stockByBranch[b.id]?.quantity ?? '0'}
                        onChange={(e) => setStockByBranch({ ...stockByBranch, [b.id]: { ...stockByBranch[b.id], quantity: e.target.value } })}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-500">Mín</label>
                      <Input
                        type="number"
                        step="0.001"
                        className="w-20"
                        value={stockByBranch[b.id]?.min_stock ?? '0'}
                        onChange={(e) => setStockByBranch({ ...stockByBranch, [b.id]: { ...stockByBranch[b.id], min_stock: e.target.value } })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Field label="Producto favorito (aparece arriba en POS)">
            <Select value={form.favorite ? '1' : '0'} onChange={(e) => setForm({ ...form, favorite: e.target.value === '1' })}>
              <option value="0">No</option>
              <option value="1">Sí</option>
            </Select>
          </Field>

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </div>
      </Modal>

      {/* Categories modal */}
      <Modal open={catModalOpen} onClose={() => setCatModalOpen(false)} title="Categorías" size="lg">
        <div className="space-y-4">
          {/* Add / edit form */}
          <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
            <Field label={catForm.id ? 'Código' : 'Código *'} className="sm:w-32">
              <Input value={catForm.code} onChange={(e) => setCatForm({ ...catForm, code: e.target.value.toUpperCase() })} placeholder="Ej. CAT01" />
            </Field>
            <Field label={catForm.id ? 'Editar nombre' : 'Nueva categoría'} className="flex-1">
              <Input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} placeholder="Nombre" />
            </Field>
            <Field label="Descripción" className="flex-1">
              <Input value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} placeholder="Opcional" />
            </Field>
            <div className="flex gap-2">
              {catForm.id && <Button variant="secondary" onClick={openCatNew}>Cancelar edición</Button>}
              <Button onClick={saveCategory} disabled={catSaving}>{catSaving ? 'Guardando...' : catForm.id ? 'Actualizar' : 'Agregar'}</Button>
            </div>
          </div>

          {catError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{catError}</div>}

          {/* Categories list */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">{categories.length} categoría(s)</span>
            {selectedCats.size > 0 && (
              <Button variant="danger" onClick={deleteSelectedCategories} disabled={catSaving}>
                <Trash2 size={14} /> Eliminar {selectedCats.size} seleccionada(s)
              </Button>
            )}
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {categories.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">No hay categorías. Agrega la primera arriba.</div>
            ) : categories.map((c) => {
              const linked = productsByCategory.get(c.id) ?? 0;
              return (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/50">
                  <input
                    type="checkbox"
                    checked={selectedCats.has(c.id)}
                    onChange={(e) => setSelectedCats((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(c.id); else n.delete(c.id);
                      return n;
                    })}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-700">{c.name}</div>
                    <div className="text-xs text-slate-400">{c.code ?? 'Sin código'}{c.description ? ` · ${c.description}` : ''}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${linked > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                    {linked} producto{linked === 1 ? '' : 's'}
                  </span>
                  <button onClick={() => openCatEdit(c)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600" title="Editar nombre">
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => deleteCategory(c.id)}
                    disabled={linked > 0}
                    className={`rounded p-1.5 ${linked > 0 ? 'cursor-not-allowed text-slate-300' : 'text-slate-400 hover:bg-red-50 hover:text-red-600'}`}
                    title={linked > 0 ? 'No se puede eliminar: tiene productos vinculados' : 'Eliminar'}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      {/* Departments modal */}
      <Modal open={deptModalOpen} onClose={() => setDeptModalOpen(false)} title="Departamentos" size="md">
        <div className="space-y-4">
          {/* Add / rename form */}
          <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
            <Field label={deptForm.id ? 'Renombrar departamento' : 'Nuevo departamento'} className="flex-1">
              <Input value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} placeholder="Nombre" />
            </Field>
            <div className="flex gap-2">
              {deptForm.id && <Button variant="secondary" onClick={() => setDeptForm({ id: '', code: '', name: '' })}>Cancelar</Button>}
              <Button onClick={saveDepartment} disabled={catSaving}>{catSaving ? 'Guardando...' : deptForm.id ? 'Renombrar' : 'Agregar'}</Button>
            </div>
          </div>

          {catError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{catError}</div>}

          {/* Departments list */}
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {deptRows.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">No hay departamentos. Agrega el primero arriba.</div>
            ) : deptRows.map((d) => {
              const linked = productsByDepartment.get(d.code) ?? 0;
              return (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/50">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-700">{d.name}</div>
                    <div className="text-xs text-slate-400">{d.code}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${linked > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                    {linked} producto{linked === 1 ? '' : 's'}
                  </span>
                  <button onClick={() => setDeptForm({ id: d.id, code: d.code, name: d.name })} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600" title="Renombrar">
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => deleteDepartment(d)}
                    disabled={linked > 0 || catSaving}
                    className={`rounded p-1.5 ${linked > 0 ? 'cursor-not-allowed text-slate-300' : 'text-slate-400 hover:bg-red-50 hover:text-red-600'}`}
                    title={linked > 0 ? 'No se puede eliminar: tiene productos vinculados' : 'Eliminar'}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetect={(code) => {
          if (scannerTarget === 'search') setSearch(code);
          else setForm((prev) => ({ ...prev, [scannerTarget]: code }));
        }}
        title={scannerTarget === 'search' ? 'Escanear producto' : 'Escanear código de barras'}
      />
    </div>
  );
}

// ─── Import / Export tab ───────────────────────────────────────────────────

type ExportPreview = { type: string; count: number; headers: string[]; rows: (string | number)[][]; filename: string } | null;
type ImportOutcome = { rowIndex: number; name: string; sku: string; barcode: string; result: 'Éxito' | 'Error'; reason: string }; 

function ImportExportTab({ products, lookupProducts, stockRows, categories, branches, onReload }: {
  products: Product[];
  lookupProducts: Product[];
  stockRows: ProductStock[];
  categories: Category[];
  branches: Branch[];
  onReload: () => void;
}) {
  const [deptImportMsg, setDeptImportMsg] = useState<string | null>(null);
  const [deptImporting, setDeptImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [catImporting, setCatImporting] = useState(false);
  const [catMsg, setCatMsg] = useState<string | null>(null);

  // Import preview state
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[] | null>(null);
  const [importMode, setImportMode] = useState<'add-stock' | 'replace'>('replace');
  const [importStep, setImportStep] = useState<'idle' | 'preview' | 'saving' | 'done'>('idle');
  const [importResult, setImportResult] = useState<{ created: number; updated: number; failed: number; depts: number; cats: number; firstError: string | null; outcomes: ImportOutcome[] } | null>(null);

  // Export preview state
  const [exportPreview, setExportPreview] = useState<ExportPreview>(null);
  const [exporting, setExporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const stockMap = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    stockRows.forEach((r) => {
      if (!m.has(r.product_id)) m.set(r.product_id, {});
      m.get(r.product_id)![r.branch_id] = Number(r.quantity);
    });
    return m;
  }, [stockRows]);

  const productBySku = useMemo(() => {
    const m = new Map<string, Product>();
    lookupProducts.forEach((p) => { if (p.sku) m.set(p.sku.toLowerCase(), p); });
    return m;
  }, [lookupProducts]);

  const productByBarcode = useMemo(() => {
    const m = new Map<string, Product>();
    lookupProducts.forEach((p) => {
      if (p.barcode) m.set(p.barcode.toLowerCase(), p);
      if (p.barcode_2) m.set(p.barcode_2.toLowerCase(), p);
    });
    return m;
  }, [lookupProducts]);

  // Build dynamic headers for product template (including stock per branch)
  const productTemplateHeaders = useMemo(() => {
    const stockHeaders = branches.flatMap((b) => {
      const branchKey = b.name.replace(/\s+/g, '_');
      return [`Existencia_${branchKey}`, `Mínimo_${branchKey}`];
    });
    return ['SKU', 'Código de barras 1', 'Código de barras 2', 'Nombre', 'URL de foto', 'Código de departamento', 'Código de categoría', 'Unidad', 'Precio de costo', 'Precio de venta 1', 'Precio de venta 2', 'Precio de venta 3', 'IVA %', 'IEPS %', 'Venta a granel', 'Control de inventario', ...stockHeaders];
  }, [branches]);

  const productTemplateExample = useMemo(() => {
    const stockExample: string[] = [];
    branches.forEach(() => { stockExample.push('100', '10'); });
    return [
      ['PROD001', '7501000001', '7501099981', 'Coca Cola 600ml', '', 'DEP01', 'CAT01', 'pieza', '12', '18', '20', '22', '16', '0', '0', '1', ...stockExample],
      ['PROD002', '7501000002', '', 'Arroz 1kg', '', 'DEP02', 'CAT02', 'kg', '20', '35', '0', '0', '0', '0', '1', ...stockExample.map(() => '50')],
    ];
  }, [branches]);

  // ─── Export logic ──────────────────────────────────────────────────────
  const buildExportData = (type: string): ExportPreview => {
    if (type === 'products') {
      const headers = ['SKU', 'Código de barras 1', 'Código de barras 2', 'Nombre', 'Departamento', 'Categoría', 'Unidad', 'Costo', 'Precio 1', 'Precio 2', 'Precio 3', 'IVA %', 'IEPS %', 'Granel', 'Control inventario', 'Activo', 'Favorito', ...branches.map((b) => `Stock ${b.name}`)];
      const rows = products.map((p) => {
        const stocks = stockMap.get(p.id) ?? {};
        return [
          p.sku ?? '', p.barcode ?? '', p.barcode_2 ?? '', p.name, p.department ?? '',
          p.category?.name ?? '', p.unit, p.cost_price, p.sale_price, p.price_2, p.price_3,
          p.tax_rate, p.ieps_rate ?? 0, p.bulk ? 'Sí' : 'No', p.track_inventory ? 'Sí' : 'No', p.active ? 'Sí' : 'No', p.favorite ? 'Sí' : 'No',
          ...branches.map((b) => stocks[b.id] ?? 0),
        ];
      });
      return { type, count: rows.length, headers, rows, filename: 'productos.xlsx' };
    }
    if (type === 'inventory') {
      const headers = ['SKU', 'Nombre', 'Departamento', ...branches.map((b) => b.name), 'Mínimo'];
      const rows = products.map((p) => {
        const stocks = stockMap.get(p.id) ?? {};
        return [
          p.sku ?? '', p.name, p.department ?? '',
          ...branches.map((b) => stocks[b.id] ?? 0),
          Math.min(...branches.map((b) => {
            const s = stockRows.find((r) => r.product_id === p.id && r.branch_id === b.id);
            return Number(s?.min_stock ?? 0);
          })),
        ];
      });
      return { type, count: rows.length, headers, rows, filename: 'inventario.xlsx' };
    }
    if (type === 'prices') {
      const headers = ['SKU', 'Nombre', 'Costo', 'Precio 1', 'Precio 2', 'Precio 3', 'IVA %', 'IEPS %', 'Margen real %'];
      const rows = products.map((p) => {
        const cost = Number(p.cost_price);
        const sale = Number(p.sale_price);
        const totalTax = Number(p.tax_rate ?? 0) + Number(p.ieps_rate ?? 0);
        const priceNoTax = totalTax > 0 ? sale / (1 + totalTax / 100) : sale;
        const margin = cost > 0 ? ((priceNoTax - cost) / cost * 100).toFixed(1) : '0';
        return [p.sku ?? '', p.name, p.cost_price, p.sale_price, p.price_2, p.price_3, p.tax_rate, p.ieps_rate ?? 0, margin];
      });
      return { type, count: rows.length, headers, rows, filename: 'precios.xlsx' };
    }
    if (type === 'categories') {
      const headers = ['Código', 'Nombre', 'Descripción'];
      const rows = categories.map((c) => [c.code ?? '', c.name, c.description ?? '']);
      return { type, count: rows.length, headers, rows, filename: 'categorias.xlsx' };
    }
    return null;
  };

  const showExportPreview = (type: string) => {
    const data = buildExportData(type);
    setExportPreview(data);
  };

  const confirmExport = () => {
    if (!exportPreview) return;
    setExporting(true);
    setTimeout(() => {
      downloadXLSX(exportPreview.filename, [{
        name: exportPreview.type === 'products' ? 'Productos' : exportPreview.type === 'inventory' ? 'Inventario' : exportPreview.type === 'prices' ? 'Precios' : 'Categorías',
        headers: exportPreview.headers,
        rows: exportPreview.rows,
      }]);
      setExporting(false);
      setExportPreview(null);
    }, 600);
  };

  const exportDepartments = async () => {
    const { data } = await supabase.from('departments').select('*').order('name');
    const depts = (data as Department[]) ?? [];
    downloadXLSX('departamentos.xlsx', [{
      name: 'Departamentos',
      headers: ['Código', 'Nombre'],
      rows: depts.map((d) => [d.code, d.name]),
    }]);
  };

  // ─── Template downloads ────────────────────────────────────────────────
  const downloadProductTemplate = () => {
    downloadXLSXTemplate('plantilla_productos.xlsx', productTemplateHeaders, productTemplateExample);
  };

  const downloadCategoryTemplate = () => {
    downloadXLSXTemplate('plantilla_categorias.xlsx',
      ['Código', 'Nombre', 'Descripción'],
      [
        ['CAT01', 'Refrescos', 'Bebidas gasificadas'],
        ['CAT02', 'Lácteos', 'Productos derivados de la leche'],
      ]
    );
  };

  const downloadDepartmentTemplate = () => {
    downloadXLSXTemplate('plantilla_departamentos.xlsx',
      ['Código', 'Nombre'],
      [
        ['DEP01', 'Bebidas'],
        ['DEP02', 'Abarrotes'],
      ]
    );
  };

  // ─── Import with preview ───────────────────────────────────────────────
  const handleImportFile = async (file: File) => {
    setImportStep('preview');
    setImportResult(null);
    setMsg(null);
    try {
      let rows: string[][];
      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await readFileText(file);
        rows = parseCSV(text);
      } else {
        rows = await readSpreadsheet(file);
      }
      if (rows.length < 2) {
        setMsg('El archivo no tiene filas suficientes.');
        setImportStep('idle');
        return;
      }
      const headers = rows[0].map((h) => normalizeImportHeader(h));

      // Identify stock column indices
      const stockColMap: Record<string, { stockIdx: number; minIdx: number }> = {};
      for (const b of branches) {
        const bKey = normalizeImportHeader(b.name);
        const stockKey = `stock_${bKey}`;
        const minKey = `min_stock_${bKey}`;
        const sIdx = headers.indexOf(stockKey);
        const mIdx = headers.indexOf(minKey);
        if (sIdx >= 0) stockColMap[b.id] = { stockIdx: sIdx, minIdx: mIdx >= 0 ? mIdx : -1 };
      }

      const previewRows: ImportPreviewRow[] = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const get = (key: string): string => { const idx = headers.indexOf(key); return idx >= 0 ? (row[idx] ?? '').trim() : ''; };
        const name = get('name');
        if (!name) continue;

        const sku = get('sku');
        const barcode = get('barcode');
        const barcode2 = get('barcode_2');
        const imageUrl = get('image_url');
        const deptCode = get('department_code') || get('department');
        const catCode = get('category_code') || get('category');
        const unitVal = get('unit') || 'pieza';
        const parseNum = (v: string): number => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
        const parseBool = (v: string): boolean => v === '1' || v.toLowerCase() === 'si' || v.toLowerCase() === 'true' || v.toLowerCase() === 'verdadero';
        const costPrice = parseNum(get('cost_price'));
        const salePrice = parseNum(get('sale_price'));
        const price2 = parseNum(get('price_2'));
        const price3 = parseNum(get('price_3'));
        const taxRate = parseNum(get('tax_rate'));
        const iepsRate = parseNum(get('ieps_rate'));
        const bulkVal = parseBool(get('bulk'));
        const trackInvVal = get('track_inventory') ? parseBool(get('track_inventory')) : true;

        // Determine if product exists
        let existingProduct: Product | undefined;
        if (barcode && productByBarcode.has(barcode.toLowerCase())) {
          existingProduct = productByBarcode.get(barcode.toLowerCase());
        } else if (barcode2 && productByBarcode.has(barcode2.toLowerCase())) {
          existingProduct = productByBarcode.get(barcode2.toLowerCase());
        } else if (sku && productBySku.has(sku.toLowerCase())) {
          existingProduct = productBySku.get(sku.toLowerCase());
        }

        const stockColumns: Record<string, string> = {};
        for (const b of branches) {
          const colInfo = stockColMap[b.id];
          if (colInfo) {
            stockColumns[b.id] = row[colInfo.stockIdx] ?? '';
          }
        }

        const existingStock = existingProduct ? (stockMap.get(existingProduct.id) ?? {}) : undefined;

        let error: string | undefined;
        if (!sku && !barcode && !existingProduct) {
          error = 'Sin SKU ni código de barras';
        }

        previewRows.push({
          rowIndex: i + 1,
          name,
          sku,
          barcode,
          barcode2,
          imageUrl,
          department: deptCode,
          category: catCode,
          unit: unitVal,
          costPrice,
          salePrice,
          price2,
          price3,
          taxRate,
          iepsRate,
          bulk: bulkVal,
          trackInventory: trackInvVal,
          stockColumns,
          status: existingProduct ? 'existing' : (error ? 'error' : 'new'),
          existingProductId: existingProduct?.id,
          existingStock,
          error,
        });
      }

      setImportPreview(previewRows);
    } catch (err) {
      console.error(err);
      setMsg('Error al leer el archivo. Verifica que sea XLSX o CSV válido.');
      setImportStep('idle');
    }
  };

  const confirmImport = async () => {
    if (!importPreview || importPreview.length === 0) return;
    setImportStep('saving');
    setImportResult(null);

    try {
      const catByCode = new Map(categories.map((c) => [(c.code ?? '').toLowerCase(), c.id]));
      const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

      // Collect all department and category codes for auto-creation
      const deptCodes = new Map<string, string>();
      const catCodes = new Map<string, string>();
      for (const row of importPreview) {
        if (row.department) {
          const code = row.department.toUpperCase();
          if (!deptCodes.has(code)) deptCodes.set(code, code);
        }
        if (row.category) {
          const code = row.category.toUpperCase();
          if (!catCodes.has(code)) catCodes.set(code, code);
        }
      }

      // Auto-create missing departments
      let deptsCreated = 0;
      for (const [code, name] of deptCodes) {
        const { data: existing } = await supabase.from('departments').select('id').eq('code', code).maybeSingle();
        if (!existing) {
          await supabase.from('departments').insert({ code, name });
          deptsCreated++;
        }
      }

      // Auto-create missing categories
      let catsCreated = 0;
      for (const [code, name] of catCodes) {
        if (!catByCode.has(code.toLowerCase()) && !catByName.has(name.toLowerCase())) {
          const { data: newCat } = await supabase.from('categories').insert({ code, name }).select().single();
          if (newCat) { catByCode.set(code.toLowerCase(), (newCat as Category).id); catsCreated++; }
        }
      }

      let created = 0;
      let updated = 0;
      let failed = importPreview.filter((row) => row.status === 'error').length;
      let firstError: string | null = importPreview.find((row) => row.status === 'error')?.error ?? null;
      const outcomes: ImportOutcome[] = importPreview.map((row) => ({ rowIndex: row.rowIndex, name: row.name, sku: row.sku, barcode: row.barcode, result: row.status === 'error' ? 'Error' : 'Éxito', reason: row.error ?? 'Pendiente' }));

      for (const row of importPreview) {
        if (row.status === 'error') continue;

        const deptCode = row.department ? row.department.toUpperCase() : null;
        const catCode = row.category;
        const catId = catCode ? (catByCode.get(catCode.toLowerCase()) ?? catByName.get(catCode.toLowerCase()) ?? null) : null;

        const parseStockVal = (v: string): number => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

        if (row.status === 'existing' && row.existingProductId) {
          // Update existing product
          const { error: e } = await supabase.from('products').update({
            name: row.name,
            barcode: row.barcode || null,
            barcode_2: row.barcode2 || null,
            image_url: row.imageUrl || null,
            department: deptCode,
            category_id: catId,
            unit: row.unit || 'pieza',
            cost_price: row.costPrice,
            sale_price: row.salePrice,
            price_2: row.price2,
            price_3: row.price3,
            tax_rate: row.taxRate,
            ieps_rate: row.iepsRate,
            bulk: row.bulk,
            track_inventory: row.trackInventory,
            active: true,
            deleted_at: null,
            deleted_by: null,
          }).eq('id', row.existingProductId);

          if (e) {
            failed++;
            firstError ??= 'No se pudo actualizar un producto. Revisa que el SKU o código de barras no esté duplicado y que tu usuario tenga permiso para editar productos.';
            console.error('product import update failed', e);
            const outcome = outcomes.find((item) => item.rowIndex === row.rowIndex);
            if (outcome) { outcome.result = 'Error'; outcome.reason = e.code === '42501' ? 'Sin permiso para modificar productos' : e.code === '23505' ? 'SKU o código de barras duplicado' : 'Error al actualizar el producto'; }
          } else {
            updated++;
            const outcome = outcomes.find((item) => item.rowIndex === row.rowIndex);
            if (outcome) { outcome.result = 'Éxito'; outcome.reason = 'Producto actualizado'; }
            // Handle stock
            for (const b of branches) {
              const stockVal = row.stockColumns[b.id];
              if (stockVal !== undefined && stockVal !== '') {
                const newQty = parseStockVal(stockVal);
                const existing = stockRows.find((r) => r.product_id === row.existingProductId && r.branch_id === b.id);
                if (existing) {
                  const finalQty = importMode === 'add-stock' ? Number(existing.quantity) + newQty : newQty;
                  await supabase.from('product_stock').update({ quantity: finalQty }).eq('id', existing.id);
                } else {
                  await supabase.from('product_stock').insert({ product_id: row.existingProductId, branch_id: b.id, quantity: newQty, min_stock: 0 });
                }
              }
            }
          }
        } else {
          // New product
          const productPayload = {
            sku: row.sku || null,
            barcode: row.barcode || null,
            barcode_2: row.barcode2 || null,
            image_url: row.imageUrl || null,
            name: row.name,
            department: deptCode,
            category_id: catId,
            unit: row.unit || 'pieza',
            cost_price: row.costPrice,
            sale_price: row.salePrice,
            price_2: row.price2,
            price_3: row.price3,
            tax_rate: row.taxRate,
            ieps_rate: row.iepsRate,
            bulk: row.bulk,
            track_inventory: row.trackInventory,
            active: true,
            deleted_at: null,
            deleted_by: null,
          };
          const productQuery = row.sku
            ? supabase.from('products').upsert(productPayload, { onConflict: 'sku' }).select().maybeSingle()
            : supabase.from('products').insert(productPayload).select().maybeSingle();
          const { data: newProd, error: e } = await productQuery;

          if (e || !newProd) {
            failed++;
            firstError ??= 'No se pudo crear un producto. Revisa que el SKU o código de barras no esté duplicado y que tu usuario tenga permiso para crear productos.';
            console.error('product import insert failed', e);
            const outcome = outcomes.find((item) => item.rowIndex === row.rowIndex);
            if (outcome) { outcome.result = 'Error'; outcome.reason = e?.code === '42501' ? 'Sin permiso para crear productos' : e?.code === '23505' ? 'SKU o código de barras duplicado' : 'Error al crear el producto'; }
          } else {
            created++;
            const outcome = outcomes.find((item) => item.rowIndex === row.rowIndex);
            if (outcome) { outcome.result = 'Éxito'; outcome.reason = 'Producto creado'; }
            for (const b of branches) {
              const stockVal = row.stockColumns[b.id];
              if (stockVal !== undefined && stockVal !== '') {
                const newQty = parseStockVal(stockVal);
                await supabase.from('product_stock').insert({ product_id: newProd.id, branch_id: b.id, quantity: newQty, min_stock: 0 });
              }
            }
          }
        }
      }

      setImportResult({ created, updated, failed, depts: deptsCreated, cats: catsCreated, firstError, outcomes });
      setImportStep('done');
      onReload();
    } catch (err) {
      console.error(err);
      setMsg('Error durante la importación.');
      setImportStep('preview');
    }
  };

  const downloadImportReport = () => {
    if (!importResult) return;
    const headers = ['Fila', 'Nombre', 'SKU', 'Código de barras 1', 'Resultado', 'Motivo'];
    const rows = importResult.outcomes.map((item) => [item.rowIndex, item.name, item.sku, item.barcode, item.result, item.reason]);
    downloadXLSX('resultado_importacion_productos.xlsx', [
      { name: 'Resumen', headers: ['Métrica', 'Cantidad'], rows: [['Creados', importResult.created], ['Actualizados', importResult.updated], ['Errores', importResult.failed], ['Departamentos nuevos', importResult.depts], ['Categorías nuevas', importResult.cats]] },
      { name: 'Todos', headers, rows },
      { name: 'Éxitos', headers, rows: rows.filter((row) => row[4] === 'Éxito') },
      { name: 'Errores', headers, rows: rows.filter((row) => row[4] === 'Error') },
    ]);
  };

  const resetImport = () => {
    setImportPreview(null);
    setImportStep('idle');
    setImportResult(null);
    setMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCategoryImport = async (file: File) => {
    setCatImporting(true); setCatMsg(null);
    try {
      const text = await readFileText(file);
      const rows = parseCSV(text);
      if (rows.length < 2) { setCatMsg('El archivo no tiene filas suficientes.'); setCatImporting(false); return; }
      const headers = rows[0].map((h) => normalizeImportHeader(h));
      let count = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const get = (key: string): string => { const idx = headers.indexOf(key); return idx >= 0 ? (row[idx] ?? '').trim() : ''; };
        const name = get('name');
        const code = get('code');
        if (!name) continue;
        const { error } = await supabase.from('categories').insert({ name, code: code || null, description: get('description') || null });
        if (!error) count++;
      }
      setCatMsg(`Importación completa: ${count} categoría(s) agregada(s).`);
      onReload();
    } catch (err) {
      console.error(err);
      setCatMsg('Error al leer el archivo.');
    }
    setCatImporting(false);
  };

  const handleDepartmentImport = async (file: File) => {
    setDeptImporting(true); setDeptImportMsg(null);
    try {
      const text = await readFileText(file);
      const rows = parseCSV(text);
      if (rows.length < 2) { setDeptImportMsg('El archivo no tiene filas suficientes.'); setDeptImporting(false); return; }
      const headers = rows[0].map((h) => normalizeImportHeader(h));
      let count = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const get = (key: string): string => { const idx = headers.indexOf(key); return idx >= 0 ? (row[idx] ?? '').trim() : ''; };
        const name = get('name');
        const code = get('code');
        if (!name || !code) continue;
        const { error } = await supabase.from('departments').insert({ code: code.toUpperCase(), name });
        if (!error) count++;
      }
      setDeptImportMsg(`Importación completa: ${count} departamento(s) agregado(s).`);
      onReload();
    } catch (err) {
      console.error(err);
      setDeptImportMsg('Error al leer el archivo.');
    }
    setDeptImporting(false);
  };

  const newCount = importPreview?.filter((r) => r.status === 'new').length ?? 0;
  const existingCount = importPreview?.filter((r) => r.status === 'existing').length ?? 0;
  const errorCount = importPreview?.filter((r) => r.status === 'error').length ?? 0;

  return (
    <div className="space-y-6">
      {/* Export Preview Modal */}
      <Modal open={!!exportPreview} onClose={() => setExportPreview(null)} title="Vista previa de exportación" size="xl">
        {exportPreview && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg bg-emerald-50 px-4 py-3">
              <FileSpreadsheet size={24} className="text-emerald-600" />
              <div>
                <div className="text-sm font-bold text-slate-800">{exportPreview.count} producto(s) a exportar</div>
                <div className="text-xs text-slate-500">Archivo: {exportPreview.filename}</div>
              </div>
            </div>
            <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left font-semibold uppercase text-slate-500">
                  <tr>
                    {exportPreview.headers.map((h, i) => <th key={i} className="px-2 py-2 whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {exportPreview.rows.slice(0, 100).map((r, ri) => (
                    <tr key={ri} className="hover:bg-slate-50/50">
                      {r.map((c, ci) => <td key={ci} className="px-2 py-1.5 whitespace-nowrap text-slate-700">{String(c)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {exportPreview.rows.length > 100 && (
                <div className="px-3 py-2 text-center text-xs text-slate-400">... y {exportPreview.rows.length - 100} más</div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setExportPreview(null)}>Cancelar</Button>
              <Button onClick={confirmExport} disabled={exporting}>
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {exporting ? 'Exportando...' : 'Confirmar y exportar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Import Preview Modal */}
      <Modal open={importStep !== 'idle'} onClose={resetImport} title="Vista previa de importación" size="xl">
        <div className="space-y-4">
          {importStep === 'preview' && importPreview && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-emerald-50 px-4 py-3 text-center">
                  <div className="text-2xl font-bold text-emerald-700">{newCount}</div>
                  <div className="text-xs font-medium text-emerald-600">Productos nuevos</div>
                </div>
                <div className="rounded-lg bg-amber-50 px-4 py-3 text-center">
                  <div className="text-2xl font-bold text-amber-700">{existingCount}</div>
                  <div className="text-xs font-medium text-amber-600">Ya existen</div>
                </div>
                <div className="rounded-lg bg-red-50 px-4 py-3 text-center">
                  <div className="text-2xl font-bold text-red-700">{errorCount}</div>
                  <div className="text-xs font-medium text-red-600">Con error</div>
                </div>
              </div>

              {existingCount > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="mb-2 text-sm font-semibold text-amber-800">Productos que ya existen — ¿Qué hacer con el stock?</div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setImportMode('add-stock')}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${importMode === 'add-stock' ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      Sumar al stock existente
                    </button>
                    <button
                      onClick={() => setImportMode('replace')}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${importMode === 'replace' ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      Reemplazar con la nueva cantidad
                    </button>
                  </div>
                </div>
              )}

              {/* Preview table */}
              <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Nombre</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Código</th>
                      <th className="px-3 py-2">Foto</th>
                      <th className="px-3 py-2 text-right">Costo</th>
                      <th className="px-3 py-2 text-right">P. Venta</th>
                      <th className="px-3 py-2">Depto</th>
                      <th className="px-3 py-2">Categoría</th>
                      {branches.map((b) => <th key={b.id} className="px-3 py-2 text-right">Stock {b.name.replace('BIENESTAR ', '')}</th>)}
                      <th className="px-3 py-2 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importPreview.map((row) => (
                      <tr key={row.rowIndex} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 text-slate-400">{row.rowIndex}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{row.name}</td>
                        <td className="px-3 py-2 text-slate-600">{row.sku || '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{row.barcode || '—'}</td>
                        <td className="max-w-40 truncate px-3 py-2 text-slate-600" title={row.imageUrl}>{row.imageUrl || '—'}</td>
                        <td className="px-3 py-2 text-right font-medium text-slate-700">{row.costPrice ? `${row.costPrice}` : '—'}</td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-700">{row.salePrice ? `${row.salePrice}` : '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{row.department || '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{row.category || '—'}</td>
                        {branches.map((b) => <td key={b.id} className="px-3 py-2 text-right text-slate-600">{row.stockColumns[b.id] || '—'}</td>)}
                        <td className="px-3 py-2 text-center">
                          {row.status === 'new' && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle2 size={12} /> Nuevo</span>}
                          {row.status === 'existing' && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"><AlertTriangle size={12} /> Existe</span>}
                          {row.status === 'error' && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"><XCircle size={12} /> {row.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={resetImport}>Cancelar</Button>
                <Button onClick={confirmImport} disabled={newCount + existingCount === 0}>
                  <CheckCircle2 size={16} /> Confirmar e importar ({newCount + existingCount})
                </Button>
              </div>
            </>
          )}

          {importStep === 'saving' && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 size={48} className="animate-spin text-emerald-600" />
              <div className="mt-4 text-sm font-medium text-slate-600">Guardando productos...</div>
              <div className="mt-1 text-xs text-slate-400">Por favor espera, no cierres esta ventana.</div>
            </div>
          )}

          {importStep === 'done' && importResult && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 size={36} className="text-emerald-600" />
              </div>
              <div className="mt-4 text-lg font-bold text-slate-800">{importResult.failed > 0 ? 'Importación finalizada con observaciones' : '¡Importación completada con éxito!'}</div>
              {importResult.firstError && <div className="mt-3 max-w-lg rounded-lg bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">{importResult.firstError}</div>}
              <div className="mt-3 flex gap-6">
                <div className="text-center">
                  <div className="text-xl font-bold text-emerald-600">{importResult.created}</div>
                  <div className="text-xs text-slate-500">Creados</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-amber-600">{importResult.updated}</div>
                  <div className="text-xs text-slate-500">Actualizados</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-red-600">{importResult.failed}</div>
                  <div className="text-xs text-slate-500">Con error</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-blue-600">{importResult.depts}</div>
                  <div className="text-xs text-slate-500">Departamentos nuevos</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-blue-600">{importResult.cats}</div>
                  <div className="text-xs text-slate-500">Categorías nuevas</div>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={downloadImportReport}><Download size={16} /> Descargar resultado</Button>
                <Button onClick={resetImport}>Cerrar</Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Export */}
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Download size={20} className="text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">Exportar</h3>
          </div>
          <p className="mb-4 text-sm text-slate-500">Revisa los productos antes de exportar en formato Excel (.xlsx).</p>
          <div className="space-y-2">
            <Button variant="secondary" onClick={() => showExportPreview('products')} className="w-full justify-start"><Eye size={16} /> Exportar catálogo de productos</Button>
            <Button variant="secondary" onClick={() => showExportPreview('inventory')} className="w-full justify-start"><Boxes size={16} /> Exportar inventario completo</Button>
            <Button variant="secondary" onClick={() => showExportPreview('prices')} className="w-full justify-start"><Tags size={16} /> Exportar precios y márgenes</Button>
            <Button variant="secondary" onClick={() => showExportPreview('categories')} className="w-full justify-start"><Layers size={16} /> Exportar categorías</Button>
            <Button variant="secondary" onClick={exportDepartments} className="w-full justify-start"><FolderTree size={16} /> Exportar departamentos</Button>
          </div>
        </Card>

        {/* Import */}
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Upload size={20} className="text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">Importar</h3>
          </div>
          <p className="mb-4 text-sm text-slate-500">Descarga la plantilla en formato XLSX, llénala y súbelo. Verás una vista previa antes de confirmar.</p>
          <div className="space-y-4">
            {/* Products import */}
            <div className="space-y-2 rounded-lg border border-slate-100 p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Productos (con existencias por sucursal)</span>
              <Button variant="secondary" onClick={downloadProductTemplate} className="w-full justify-start"><FileSpreadsheet size={16} /> Descargar plantilla XLSX</Button>
              <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-4 text-sm font-medium text-slate-500 transition hover:border-emerald-400 hover:bg-emerald-50/30 hover:text-emerald-600">
                <Upload size={16} />
                Subir XLSX o CSV de productos
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
              </label>
              {msg && <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{msg}</div>}
            </div>
            {/* Categories import */}
            <div className="space-y-2 rounded-lg border border-slate-100 p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Categorías</span>
              <Button variant="secondary" onClick={downloadCategoryTemplate} className="w-full justify-start"><FileSpreadsheet size={16} /> Descargar plantilla XLSX</Button>
              <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-4 text-sm font-medium text-slate-500 transition hover:border-emerald-400 hover:bg-emerald-50/30 hover:text-emerald-600">
                <Upload size={16} />
                {catImporting ? 'Importando...' : 'Subir CSV de categorías'}
                <input type="file" accept=".csv,text/csv" className="hidden" disabled={catImporting} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCategoryImport(f); e.target.value = ''; }} />
              </label>
              {catMsg && <div className={`rounded-lg px-3 py-2 text-sm ${catMsg.includes('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{catMsg}</div>}
            </div>
            {/* Departments import */}
            <div className="space-y-2 rounded-lg border border-slate-100 p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Departamentos</span>
              <Button variant="secondary" onClick={downloadDepartmentTemplate} className="w-full justify-start"><FileSpreadsheet size={16} /> Descargar plantilla XLSX</Button>
              <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-4 text-sm font-medium text-slate-500 transition hover:border-emerald-400 hover:bg-emerald-50/30 hover:text-emerald-600">
                <Upload size={16} />
                {deptImporting ? 'Importando...' : 'Subir CSV de departamentos'}
                <input type="file" accept=".csv,text/csv" className="hidden" disabled={deptImporting} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDepartmentImport(f); e.target.value = ''; }} />
              </label>
              {deptImportMsg && <div className={`rounded-lg px-3 py-2 text-sm ${deptImportMsg.includes('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{deptImportMsg}</div>}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
