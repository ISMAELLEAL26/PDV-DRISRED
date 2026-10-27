import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { saveOperationalNotification } from '@/lib/operationalNotifications';
import type { Product, Category } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Input, Select } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner } from '@/components/ui';
import AuthorizationModal from '@/components/AuthorizationModal';
import BarcodeScanner from '@/components/BarcodeScanner';
import { AlertTriangle, CheckCircle2, Filter, ShieldCheck, XCircle, ScanLine, Layers, FolderTree, RotateCcw, ShoppingCart } from 'lucide-react';

interface InventorySession {
  id: string;
  branch_id: string;
  status: 'open' | 'authorization_requested' | 'closed';
  started_at: string;
  authorization_requested_at: string | null;
  completed_at: string | null;
}

interface InventoryCount {
  id: string;
  session_id: string;
  product_id: string;
  branch_id: string;
  theoretical: number;
  physical: number | null;
  difference: number | null;
  affected_by_operation: boolean;
  affected_quantity: number;
  last_operation_at: string | null;
  counted_at: string | null;
}

interface FunctionResponse {
  session?: InventorySession;
  counts?: InventoryCount[];
  expiresAt?: string;
  error?: string;
  success?: boolean;
}

type InventoryMode = 'scan' | 'department' | 'category';

async function loadActiveProducts(): Promise<Product[]> {
  const products: Product[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('products').select('*, category:categories(*)').is('deleted_at', null).eq('active', true).order('name').range(from, from + 999);
    if (error) throw error;
    products.push(...((data ?? []) as Product[]));
    if ((data ?? []).length < 1000) return products;
  }
}

export default function InventoryAdjustmentPage() {
  const { branches, currentBranch } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [inventorySession, setInventorySession] = useState<InventorySession | null>(null);
  const [inventoryCounts, setInventoryCounts] = useState<InventoryCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<InventoryMode | null>(null);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [authorizationOpen, setAuthorizationOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<InventoryMode | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);

  const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
  const [scanInput, setScanInput] = useState('');
  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const selectedBranchId = filterBranch || currentBranch?.id || '';
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === selectedBranchId) ?? currentBranch, [branches, selectedBranchId, currentBranch]);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useMemo(() => ({ current: 0 as number }), []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, [toastTimer]);

  const departments = useMemo(() => Array.from(new Set(products.map((product) => product.department).filter((department): department is string => Boolean(department)))).sort(), [products]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadedProducts, categoriesRes] = await Promise.all([
        loadActiveProducts(),
        supabase.from('categories').select('*').order('name'),
      ]);
      setProducts(loadedProducts);
      setCategories((categoriesRes.data as Category[]) ?? []);
    } catch {
      setError('Ocurrió un error al cargar los productos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!inventorySession?.started_at || inventorySession.status === 'closed' || !timerRunning) return;
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(inventorySession.started_at).getTime()) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [inventorySession, timerRunning]);

  const formatElapsed = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const startInventory = useCallback(async () => {
    if (!selectedBranchId) {
      setError('Selecciona una sucursal primero.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('authorize-inventory', { body: { action: 'start', branchId: selectedBranchId } });
      const response = data as FunctionResponse | null;
      if (fnError || !response?.session) {
        setError(response?.error ?? fnError?.message ?? 'No se pudo iniciar la sesión de inventario. Verifica tu conexión e intenta de nuevo.');
      } else {
        setInventorySession(response.session);
        setElapsedSeconds(0);
        setTimerRunning(true);
        setAuthorizationOpen(false);
        const rows = response.counts ?? [];
        setInventoryCounts(rows);
        setCounts(Object.fromEntries(rows.filter((row) => row.physical != null).map((row) => [row.product_id, String(row.physical)])));
      }
    } catch {
      setError('Ocurrió un error al iniciar el inventario.');
    } finally {
      setStarting(false);
    }
  }, [selectedBranchId]);

  const exitInventory = useCallback(() => {
    setMode(null);
    setInventorySession(null);
    setTimerRunning(false);
    setElapsedSeconds(0);
    setInventoryCounts([]);
    setCounts({});
    setFilterDept('');
    setFilterCat('');
    setSearch('');
    setScannedProduct(null);
    setScanInput('');
    setError(null);
  }, []);

  const selectMode = (selected: InventoryMode) => {
    if (selected === 'department' && !filterDept) {
      setError('Primero selecciona un departamento.');
      return;
    }
    if (selected === 'category' && !filterCat) {
      setError('Primero selecciona una categoría.');
      return;
    }
    setError(null);
    setPendingMode(selected);
    setStartConfirmOpen(true);
  };

  const confirmStartInventory = () => {
    if (!pendingMode) return;
    setMode(pendingMode);
    setCounts({});
    setScannedProduct(null);
    setScanInput('');
    setStartConfirmOpen(false);
    void startInventory();
  };

  const countMap = useMemo(() => new Map(inventoryCounts.map((row) => [row.product_id, row])), [inventoryCounts]);

  const filtered = useMemo(() => {
    if (mode === 'scan') {
      return scannedProduct ? [scannedProduct] : [];
    }
    if (mode === 'department') {
      return products.filter((product) => product.department === filterDept);
    }
    if (mode === 'category') {
      return products.filter((product) => product.category_id === filterCat);
    }
    return [];
  }, [products, mode, scannedProduct, filterDept, filterCat]);

  const getRow = (productId: string): InventoryCount | undefined => countMap.get(productId);
  const getTheoretical = (productId: string): number => getRow(productId)?.theoretical ?? 0;
  const isCounted = (productId: string): boolean => counts[productId] != null && counts[productId].trim() !== '';
  const getPhysical = (productId: string): number => Number(counts[productId] ?? 0);
  const getDifference = (productId: string): number => getPhysical(productId) - getTheoretical(productId);

  const pendingCount = useMemo(() => filtered.filter((product) => !isCounted(product.id)).length, [filtered, counts]);
  const affectedCount = useMemo(() => inventoryCounts.filter((row) => row.affected_by_operation && filtered.some((product) => product.id === row.product_id)).length, [inventoryCounts, filtered]);
  const matchedCount = useMemo(() => filtered.filter((product) => isCounted(product.id) && getDifference(product.id) === 0).length, [filtered, counts]);
  const mismatchCount = useMemo(() => filtered.filter((product) => isCounted(product.id) && getDifference(product.id) !== 0).length, [filtered, counts]);

  const scannedProductIds = useMemo(() => {
    if (mode !== 'scan') return null;
    const ids = new Set<string>();
    for (const id of Object.keys(counts)) {
      if (counts[id].trim() !== '') ids.add(id);
    }
    return ids.size > 0 ? Array.from(ids) : null;
  }, [mode, counts]);

  const savePhysical = async (productId: string) => {
    const value = counts[productId]?.trim() ?? '';
    if (!inventorySession || value === '') return;
    const physical = Number(value);
    if (!Number.isFinite(physical) || physical < 0) {
      setError('La existencia física debe ser un número válido.');
      return;
    }
    try {
      const { data, error: functionError } = await supabase.functions.invoke('authorize-inventory', {
        body: { action: 'save_count', sessionId: inventorySession.id, productId, physical },
      });
      const response = data as FunctionResponse | null;
      if (functionError || response?.error) {
        setError(response?.error ?? 'No se pudo guardar el conteo.');
      } else {
        showToast('Conteo guardado');
      }
    } catch {
      setError('No se pudo guardar el conteo. Revisa tu conexión.');
    }
  };

  const handleScan = (codeArg?: string) => {
    const code = (codeArg ?? scanInput).trim().toLowerCase();
    if (!code) return;
    const found = products.find((product) =>
      (product.barcode ?? '').toLowerCase() === code ||
      (product.barcode_2 ?? '').toLowerCase() === code ||
      (product.sku ?? '').toLowerCase() === code
    );
    if (found) {
      setScannedProduct(found);
      setScanInput('');
      setError(null);
      showToast(`Producto: ${found.name}`);
    } else {
      setError('No se encontró ningún producto con ese código.');
      setScannedProduct(null);
    }
  };

  const [validationOpen, setValidationOpen] = useState(false);

  const recordInventoryNotification = () => {
    const countedRows = inventoryCounts.filter((row) => isCounted(row.product_id));
    const discrepancies = countedRows.filter((row) => getDifference(row.product_id) !== 0);
    const message = `${countedRows.length} productos contados | ${discrepancies.length} discrepancias | Sucursal: ${selectedBranch?.name ?? '—'}`;
    void saveOperationalNotification({
      type: 'inventory_alert',
      title: 'Inventario autorizado y guardado',
      message,
      branchId: selectedBranchId,
      metadata: {
        sessionId: inventorySession?.id ?? null,
        counted: countedRows.length,
        discrepancies: discrepancies.length,
        discrepancyProducts: discrepancies.map((row) => ({ productId: row.product_id, difference: getDifference(row.product_id) })),
      },
    }).then((saved) => {
      if (!saved) showToast('Inventario guardado; no se pudo registrar la notificación.');
    });
  };

  const requestAuthorization = async () => {
    if (!inventorySession) return;
    setValidationOpen(true);
  };

  const confirmValidationAndRequestCode = () => {
    if (!inventorySession) return;
    if (pendingCount > 0) {
      setError(`Faltan ${pendingCount} producto(s) por contar. Completa el conteo antes de continuar.`);
      setValidationOpen(false);
      return;
    }
    setValidationOpen(false);
    setAuthError(null);
    setAuthorizationOpen(true);
  };

  const authorizationPayload = useMemo(() => {
    if (!inventorySession) return null;
    const countedRows = inventoryCounts.filter((row) => isCounted(row.product_id));
    const discrepancies = countedRows.filter((row) => getDifference(row.product_id) !== 0);
    const summary = `${countedRows.length} productos contados · ${discrepancies.length} discrepancias · ${selectedBranch?.name ?? 'Sucursal'}`;
    const items = filtered.map((product) => ({
      productId: product.id,
      name: product.name,
      theoretical: getTheoretical(product.id),
      physical: getPhysical(product.id),
      difference: getDifference(product.id),
    }));
    return {
      operationType: 'inventory' as const,
      branchId: inventorySession.branch_id,
      summary,
      payload: {
        sessionId: inventorySession.id,
        mode,
        department: mode === 'department' ? filterDept : undefined,
        categoryId: mode === 'category' ? filterCat : undefined,
        productIds: mode === 'scan' ? scannedProductIds ?? [] : undefined,
        items,
      },
    };
  }, [inventorySession, inventoryCounts, filtered, mode, filterDept, filterCat, scannedProductIds, selectedBranch]);

  const applyAuthorized = async (authRequest: { id: string }) => {
    if (!inventorySession) return;
    setSaving(true);
    setAuthError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('authorize-inventory', {
        body: {
          action: 'apply_authorized',
          sessionId: inventorySession.id,
          authorizationId: authRequest.id,
          mode,
          department: mode === 'department' ? filterDept : undefined,
          categoryId: mode === 'category' ? filterCat : undefined,
          productIds: mode === 'scan' ? scannedProductIds ?? [] : undefined,
        },
      });
      const response = data as FunctionResponse | null;
      if (functionError || response?.error) {
        const message = response?.error ?? functionError?.message ?? 'No se pudo aplicar el inventario autorizado.';
        setAuthError(message);
        throw new Error(message);
      } else {
        setAuthorizationOpen(false);
        setSuccessOpen(true);
        showToast('Inventario actualizado exitosamente con autorización de gerencia');
        recordInventoryNotification();
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error && caughtError.message ? caughtError.message : 'No se pudo aplicar el inventario autorizado. Revisa tu conexión e intenta de nuevo.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleNewInventory = () => {
    setSuccessOpen(false);
    exitInventory();
  };

  const handleExitToPOS = () => {
    setSuccessOpen(false);
    window.dispatchEvent(new CustomEvent('app-navigate', { detail: 'pos' }));
  };

  // Method selection screen
  if (!mode || !inventorySession) {
    return (
      <div className="device-page p-6">
        <PageHeader
          title="Ajuste de Inventario"
          subtitle={`${selectedBranch?.name ?? ''} · Selecciona el método de conteo`}
        />

        {error && <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-600" /><span>{error}</span></div>}
        {starting && <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800"><Spinner size={18} /> Preparando el inventario y cargando existencias...</div>}

        <div className="mb-6 max-w-xs">
          <Select value={filterBranch} onChange={(event) => setFilterBranch(event.target.value)}>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Scan mode */}
          <div className="group flex flex-col items-center rounded-2xl border-2 border-slate-200 bg-white p-8 text-center transition hover:border-blue-400 hover:shadow-lg">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition group-hover:bg-blue-100">
              <ScanLine size={32} />
            </div>
            <h3 className="text-lg font-bold text-slate-800">Escaneo</h3>
            <p className="mt-2 text-sm text-slate-500">Escanea o captura el código de barras de cada producto para contarlo individualmente, igual que en la pantalla de venta.</p>
            <Button className="mt-4 w-full" onClick={() => selectMode('scan')} disabled={starting}>Iniciar conteo</Button>
          </div>

          {/* Department mode */}
          <div className="flex flex-col items-center rounded-2xl border-2 border-slate-200 bg-white p-8 text-center transition hover:border-emerald-400 hover:shadow-lg">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <FolderTree size={32} />
            </div>
            <h3 className="text-lg font-bold text-slate-800">Por Departamento</h3>
            <p className="mt-2 text-sm text-slate-500">Lista todos los productos del departamento seleccionado para contarlos juntos.</p>
            <div className="mt-4 w-full">
              <Select value={filterDept} onChange={(event) => setFilterDept(event.target.value)}>
                <option value="">Selecciona departamento...</option>
                {departments.map((department) => <option key={department} value={department}>{department}</option>)}
              </Select>
            </div>
            <Button className="mt-4 w-full" onClick={() => selectMode('department')} disabled={!filterDept || starting}>
              Iniciar conteo
            </Button>
          </div>

          {/* Category mode */}
          <div className="flex flex-col items-center rounded-2xl border-2 border-slate-200 bg-white p-8 text-center transition hover:border-amber-400 hover:shadow-lg">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600">
              <Layers size={32} />
            </div>
            <h3 className="text-lg font-bold text-slate-800">Por Categoría</h3>
            <p className="mt-2 text-sm text-slate-500">Lista todos los productos de la categoría seleccionada para contarlos juntos.</p>
            <div className="mt-4 w-full">
              <Select value={filterCat} onChange={(event) => setFilterCat(event.target.value)}>
                <option value="">Selecciona categoría...</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </Select>
            </div>
            <Button className="mt-4 w-full" onClick={() => selectMode('category')} disabled={!filterCat || starting}>
              Iniciar conteo
            </Button>
          </div>
        </div>

        <Modal open={startConfirmOpen} onClose={() => setStartConfirmOpen(false)} title="Confirmar inicio de inventario" size="sm">
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">¿Deseas iniciar el inventario en este momento?</p>
              <p className="mt-2">El cronómetro comenzará al aceptar y permanecerá visible durante todo el conteo.</p>
              <p className="mt-2 font-medium">Método: {pendingMode === 'scan' ? 'Escaneo' : pendingMode === 'department' ? `Por Departamento — ${filterDept}` : `Por Categoría — ${categories.find((category) => category.id === filterCat)?.name ?? '—'}`}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setStartConfirmOpen(false)}>Cancelar</Button>
              <Button onClick={confirmStartInventory} disabled={starting}>Sí, iniciar inventario</Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // Counting screen
  return (
    <div className="device-page p-6">
      <div className="mb-4 flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-800"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-600" /> Tiempo transcurrido</div>
        <div className="font-mono text-xl font-bold tracking-wider text-blue-900">{formatElapsed(elapsedSeconds)}</div>
      </div>
      <PageHeader
        title="Ajuste de Inventario"
        subtitle={`${selectedBranch?.name ?? ''} · ${mode === 'scan' ? 'Escaneo' : mode === 'department' ? `Departamento: ${filterDept}` : `Categoría: ${categories.find((c) => c.id === filterCat)?.name ?? ''}`}`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={exitInventory}><RotateCcw size={16} /> Cambiar método</Button>
            <Button onClick={requestAuthorization} disabled={saving || inventorySession?.status === 'closed'}><ShieldCheck size={16} /> {saving ? 'Procesando...' : 'Guardar y autorizar'}</Button>
          </div>
        }
      />

      {error && <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-600" /><span>{error}</span></div>}

      {mode === 'scan' && (
        <Card className="mb-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Escanear o capturar código</label>
              <div className="flex gap-2">
                <input
                  ref={scanRef}
                  type="text"
                  value={scanInput}
                  onChange={(event) => setScanInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') handleScan(); }}
                  placeholder="Escanee código de barras o escriba SKU..."
                  className="w-full rounded-lg border border-slate-300 py-2.5 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  autoFocus
                />
                <button type="button" onClick={() => setScannerOpen(true)} title="Escanear con la cámara" className="flex-shrink-0 rounded-lg bg-blue-600 px-3 text-white transition hover:bg-blue-700"><ScanLine size={18} /></button>
                <Button onClick={() => handleScan()}>Buscar</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {mode !== 'scan' && (
        <div className="mb-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar dentro de la lista..." />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm"><CheckCircle2 size={16} className="text-emerald-600" /><span className="font-semibold text-emerald-700">{matchedCount}</span><span className="text-slate-500">cuadrados</span></div>
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm"><XCircle size={16} className="text-red-600" /><span className="font-semibold text-red-700">{mismatchCount}</span><span className="text-slate-500">discrepancias</span></div>
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm"><AlertTriangle size={16} className="text-amber-600" /><span className="font-semibold text-amber-700">{pendingCount}</span><span className="text-slate-500">pendientes</span></div>
        {affectedCount > 0 && <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm"><AlertTriangle size={16} className="text-blue-600" /><span className="font-semibold text-blue-700">{affectedCount}</span><span className="text-slate-500">afectados por caja</span></div>}
      </div>

      <Card className="mb-4 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title={mode === 'scan' ? 'Escanea un producto' : 'Sin productos'}
            description={mode === 'scan' ? 'Usa el escáner o escribe un código arriba para empezar a contar.' : 'No hay productos para el filtro seleccionado.'}
            icon={mode === 'scan' ? <ScanLine size={48} /> : <Filter size={48} />}
          />
        ) : (
          <>
            <div className="device-desktop-only hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Producto</th><th className="px-4 py-3">Código de barras</th><th className="px-4 py-3 text-right">Existencia teórica</th><th className="px-4 py-3 text-right">Existencia física</th><th className="px-4 py-3 text-right">Diferencia</th><th className="px-4 py-3 text-center">Estado</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{filtered.map((product) => {
                  const row = getRow(product.id); const filled = isCounted(product.id); const difference = getDifference(product.id); const affected = row?.affected_by_operation;
                  return <tr key={product.id} className={affected ? 'bg-blue-50/40' : difference < 0 ? 'bg-red-50/30' : difference > 0 ? 'bg-emerald-50/30' : ''}>
                    <td className="px-4 py-3"><div className="font-medium text-slate-800">{product.name}</div><div className="text-xs text-slate-400">{product.sku ?? 'Sin SKU'} · {product.unit}</div></td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{product.barcode ?? product.barcode_2 ?? 'Sin código'}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{getTheoretical(product.id)}</td>
                    <td className="px-4 py-3 text-right"><Input type="number" min="0" step={product.bulk ? '0.001' : '1'} className="w-24 text-right" value={counts[product.id] ?? ''} onChange={(event) => setCounts({ ...counts, [product.id]: event.target.value })} onBlur={() => savePhysical(product.id)} placeholder="0" disabled={inventorySession?.status === 'closed'} /></td>
                    <td className={`px-4 py-3 text-right font-semibold ${affected ? 'text-blue-700' : !filled ? 'text-amber-600' : difference < 0 ? 'text-red-600' : difference > 0 ? 'text-emerald-600' : 'text-slate-600'}`}>{filled ? (difference > 0 ? '+' : '') + difference : 'Pendiente'}</td>
                    <td className="px-4 py-3 text-center text-xs font-medium">{affected ? <span className="text-blue-700">Afectado por caja</span> : filled ? difference === 0 ? <span className="text-emerald-600">Cuadrado</span> : <span className="text-slate-600">Revisar</span> : <span className="text-amber-600">Pendiente</span>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div className="device-mobile-only hidden divide-y divide-slate-100">{filtered.map((product) => {
              const row = getRow(product.id); const filled = isCounted(product.id); const difference = getDifference(product.id); const affected = row?.affected_by_operation;
              return <article key={product.id} className={`p-3 ${affected ? 'bg-blue-50/40' : difference < 0 ? 'bg-red-50/30' : difference > 0 ? 'bg-emerald-50/30' : 'bg-white'}`}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="break-words text-sm font-semibold leading-5 text-slate-800">{product.name}</div><div className="mt-0.5 text-xs text-slate-500">{product.department ?? 'Sin departamento'} · {product.sku ?? 'Sin SKU'} · {product.unit}</div><div className="mt-1 font-mono text-xs text-blue-700">Código: {product.barcode ?? product.barcode_2 ?? 'Sin código'}</div></div>{affected ? <span className="flex-shrink-0 text-xs font-medium text-blue-700">Afectado por caja</span> : !filled ? <span className="flex-shrink-0 text-xs font-medium text-amber-600">Pendiente</span> : difference === 0 ? <CheckCircle2 size={20} className="flex-shrink-0 text-emerald-600" /> : difference < 0 ? <XCircle size={20} className="flex-shrink-0 text-red-600" /> : <CheckCircle2 size={20} className="flex-shrink-0 text-emerald-600" />}</div>
                <div className="mt-2 space-y-2 text-xs"><div className="flex items-center justify-between border-t border-slate-100 pt-2"><span className="text-slate-400">Existencia teórica</span><span className="font-semibold text-slate-700">{getTheoretical(product.id)}</span></div><label className="flex items-center justify-between gap-3"><span className="text-slate-400">Existencia física</span><Input type="number" min="0" step={product.bulk ? '0.001' : '1'} className="h-9 w-28 text-right" value={counts[product.id] ?? ''} onChange={(event) => setCounts({ ...counts, [product.id]: event.target.value })} onBlur={() => savePhysical(product.id)} placeholder="0" /></label><div className="flex items-center justify-between"><span className="text-slate-400">Diferencia</span><span className={`font-semibold ${affected ? 'text-blue-700' : !filled ? 'text-amber-600' : difference < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{filled ? (difference > 0 ? '+' : '') + difference : 'Pendiente'}</span></div></div>
              </article>;
            })}</div>
          </>
        )}
      </Card>

      {pendingCount > 0 && <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800"><AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-600" /><span>Faltan {pendingCount} producto(s) por contar antes de poder cerrar el inventario.</span></div>}
      {affectedCount > 0 && <div className="mb-6 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-800"><AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-blue-600" /><span>Hay {affectedCount} producto(s) afectados por operaciones de caja durante el conteo. Debes validarlos nuevamente antes de cerrar el inventario.</span></div>}

      <Modal open={validationOpen} onClose={() => setValidationOpen(false)} title="Validar inventario" size="sm">
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Se va a validar que todos los productos estén contados. {pendingCount > 0 ? <span className="font-semibold">Aún faltan {pendingCount} producto(s) por contar.</span> : <span className="font-semibold text-emerald-700">Todos los productos están contados.</span>}</div>
          {pendingCount > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">No se puede guardar el inventario hasta que todos los productos estén contados.</div>}
          {affectedCount > 0 && <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">Hay {affectedCount} producto(s) afectados por operaciones de caja. Deberás validarlos nuevamente.</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setValidationOpen(false)}>Cancelar</Button>
            <Button onClick={confirmValidationAndRequestCode} disabled={saving || pendingCount > 0}>{saving ? 'Procesando...' : 'Continuar a autorización'}</Button>
          </div>
        </div>
      </Modal>

      {authError && <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-600" /><span>{authError}</span></div>}

      <AuthorizationModal
        open={authorizationOpen}
        onClose={() => setAuthorizationOpen(false)}
        payload={authorizationPayload}
        onAuthorized={applyAuthorized}
        onRequestCreated={() => setTimerRunning(false)}
      />

      <Modal open={successOpen} onClose={() => setSuccessOpen(false)} title="Inventario guardado" size="sm">
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <ShieldCheck size={40} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-lg font-bold text-emerald-700">Inventario guardado con éxito</p>
            <p className="mt-2 text-sm text-slate-600">Las existencias se actualizaron y el ajuste se registró en el historial.</p>
          </div>
          <div className="space-y-2">
            <Button onClick={handleNewInventory} className="w-full"><RotateCcw size={16} /> Nuevo inventario</Button>
            <Button variant="secondary" onClick={handleExitToPOS} className="w-full"><ShoppingCart size={16} /> Salir a venta</Button>
          </div>
        </div>
      </Modal>

      {toast && <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl bg-emerald-600 px-5 py-3 text-white shadow-lg shadow-emerald-600/20 animate-in fade-in slide-in-from-bottom-2 duration-300"><CheckCircle2 size={20} className="flex-shrink-0" /><span className="font-medium">{toast}</span></div>}

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetect={(code) => { setScanInput(code); handleScan(code); }}
        title="Escanear producto"
      />
    </div>
  );
}
