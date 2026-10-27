import { useEffect, useState, useCallback, useMemo } from 'react';
import { useDeviceMode } from '@/lib/deviceMode';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency, generateFolio } from '@/lib/format';
import { PROGRAM_LOGO } from '@/lib/branding';
import { printTicket, buildTicketText, buildWhatsAppUrl, generateQrDataUrl, type TicketData } from '@/components/TicketPrint';
import POSSubMenu from '@/components/POSSubMenu';
import BarcodeScanner from '@/components/BarcodeScanner';
import type { Product, SaleItem, Customer, Ad, BankAccount } from '@/lib/types';
import Button from '@/components/Button';
import { SearchInput, Spinner } from '@/components/ui';
import Modal from '@/components/Modal';
import { Field, Input, Select } from '@/components/Field';
import {
  Plus, Minus, Trash2, ShoppingCart, X, Image as ImageIcon,
  CreditCard, Banknote, ArrowLeftRight, Ticket, WalletCards, FileCheck2,
  UserPlus, CheckCircle2, AlertTriangle, ScanLine, Building2, Upload, Landmark,
  Lock, MessageCircle, Mail, Send,
} from 'lucide-react';

interface CartItem extends SaleItem {
  stock: number;
  image_url: string | null;
  sku: string | null;
  tax_rate: number;
  ieps_rate: number;
}

const calculateLineTotal = (quantity: number, unitPrice: number, discount = 0): number => {
  const safeDiscount = Math.min(100, Math.max(0, discount));
  return quantity * unitPrice * (1 - safeDiscount / 100);
};

const PAYMENT_METHODS = [
  { value: 'efectivo', label: 'Efectivo', icon: <Banknote size={17} /> },
  { value: 'tarjeta', label: 'Tarjeta', icon: <CreditCard size={17} /> },
  { value: 'transferencia', label: 'Transferencia', icon: <ArrowLeftRight size={17} /> },
  { value: 'vale', label: 'Vale', icon: <Ticket size={17} /> },
  { value: 'cheque', label: 'Cheque', icon: <FileCheck2 size={17} /> },
  { value: 'credito', label: 'Crédito', icon: <WalletCards size={17} />, requiresCustomer: true },
  { value: 'monedero_electronico', label: 'Monedero electrónico', icon: <WalletCards size={17} />, requiresCustomer: true },
];

export default function POSPage() {
  const { user, profile, currentBranch } = useAuth();
  const { mode } = useDeviceMode();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [adIndex, setAdIndex] = useState(0);
  const [taxRate, setTaxRate] = useState(0.16);
  const [currencySymbol, setCurrencySymbol] = useState('$');
  const [ticketWidth, setTicketWidth] = useState<'55' | '80'>('80');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedBankAccount, setSelectedBankAccount] = useState<BankAccount | null>(null);
  const [cardType, setCardType] = useState<'debito' | 'credito'>('debito');
  const [cardLast4, setCardLast4] = useState('');
  const [cardBank, setCardBank] = useState('');
  const [authorizationNumber, setAuthorizationNumber] = useState('');
  const [nipMode, setNipMode] = useState<'con_nip' | 'sin_nip'>('con_nip');
  const [noNipName, setNoNipName] = useState('');
  const [noNipAddress, setNoNipAddress] = useState('');
  const [noNipPhone, setNoNipPhone] = useState('');
  const [ticketSigned, setTicketSigned] = useState<'si' | 'no'>('no');
  const [transferOriginBank, setTransferOriginBank] = useState('');
  const [transferConcept, setTransferConcept] = useState('');
  const [transferOriginAccount, setTransferOriginAccount] = useState('');
  const [transferReceipt, setTransferReceipt] = useState<File | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
  const [amountReceived, setAmountReceived] = useState('');
  const [discount, setDiscount] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [processing, setProcessing] = useState(false);
  const [lastSale, setLastSale] = useState<TicketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanAlert, setScanAlert] = useState<string | null>(null);
  const [turnChecked, setTurnChecked] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sendPhone, setSendPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [saleStartedAt, setSaleStartedAt] = useState<number | null>(null);
  const [saleElapsed, setSaleElapsed] = useState(0);
  const [newSaleOpen, setNewSaleOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const subMenu = POSSubMenu({ onTurnChange: () => loadProducts() });
  const activeRegister = subMenu.activeRegister;

  // Auto-show welcome modal when no turn is open on first load
  useEffect(() => {
    if (!subMenu.loadingTurn && activeRegister && !saleStartedAt && !newSaleOpen && !subMenu.welcomeOpen) {
      setNewSaleOpen(true);
    }
  }, [subMenu.loadingTurn, activeRegister, saleStartedAt, newSaleOpen, subMenu.welcomeOpen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !checkoutOpen && !lastSale) setNewSaleOpen(true);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [checkoutOpen, lastSale]);

  useEffect(() => {
    if (!saleStartedAt) return;
    const update = () => setSaleElapsed(Math.max(0, Math.floor((Date.now() - saleStartedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [saleStartedAt]);

  useEffect(() => {
    if (!subMenu.loadingTurn && !turnChecked && !subMenu.welcomeOpen) {
      setTurnChecked(true);
      if (!activeRegister) {
        subMenu.setWelcomeOpen(true);
      }
    }
  }, [subMenu.loadingTurn, activeRegister, turnChecked, subMenu.welcomeOpen]);

  const loadProducts = useCallback(async () => {
    if (!currentBranch) return;
    const { data, error } = await supabase
      .from('products')
      .select('*, category:categories(*)')
      .eq('active', true)
      .order('name');
    if (error) { console.error(error); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); return; }
    const stockRes = await supabase
      .from('product_stock')
      .select('product_id, quantity')
      .eq('branch_id', currentBranch.id);
    const stockMap = new Map<string, number>();
    (stockRes.data ?? []).forEach((s: { product_id: string; quantity: number }) => {
      stockMap.set(s.product_id, Number(s.quantity));
    });
    setProducts((data as Product[]).map((p) => ({ ...p, sale_price: Number(p.sale_price) })));
    setStockMap(stockMap);
    setLoading(false);
  }, [currentBranch]);

  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());

  const loadAds = useCallback(async () => {
    const { data } = await supabase
      .from('ads')
      .select('*')
      .eq('active', true)
      .order('sort_order');
    setAds((data as Ad[]) ?? []);
  }, []);

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from('settings').select('key, value');
    const map: Record<string, string> = {};
    (data ?? []).forEach((r: { key: string; value: string }) => { map[r.key] = r.value; });
    setTaxRate(parseFloat(map.tax_rate ?? '0.16'));
    setCurrencySymbol(map.currency_symbol ?? '$');
    setTicketWidth(map.ticket_width === '55' ? '55' : '80');
  }, []);

  const loadCustomers = useCallback(async () => {
    const { data } = await supabase.from('customers').select('*').order('name').limit(200);
    setCustomers((data as Customer[]) ?? []);
  }, []);

  const loadBankAccounts = useCallback(async () => {
    const { data } = await supabase.from('bank_accounts').select('*').eq('active', true).order('bank_name');
    setBankAccounts((data as BankAccount[]) ?? []);
  }, []);

  useEffect(() => {
    loadProducts();
    loadAds();
    loadSettings();
    loadCustomers();
    loadBankAccounts();
  }, [loadProducts, loadAds, loadSettings, loadCustomers, loadBankAccounts]);

  // Rotate ads every 6 seconds
  useEffect(() => {
    if (ads.length <= 1) return;
    const t = setInterval(() => setAdIndex((i) => (i + 1) % ads.length), 6000);
    return () => clearInterval(t);
  }, [ads.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q) || (p.barcode_2 ?? '').toLowerCase().includes(q)
    );
  }, [products, search]);

  const handleScan = (codeArg?: string) => {
    const code = (codeArg ?? search).trim();
    if (!code) return;
    setScanAlert(null);
    const match = products.find(
      (p) => (p.barcode ?? '').toLowerCase() === code.toLowerCase() || (p.barcode_2 ?? '').toLowerCase() === code.toLowerCase() || (p.sku ?? '').toLowerCase() === code.toLowerCase() || p.name.toLowerCase() === code.toLowerCase()
    );
    if (!match) {
      setScanAlert(`ALERTA: Producto no agregado. El código "${code}" no existe.`);
      setSearch('');
      return;
    }
    const stock = stockMap.get(match.id) ?? 0;
    if (stock <= 0) {
      setScanAlert(`ALERTA: Producto no agregado. "${match.name}" sin stock.`);
      setSearch('');
      return;
    }
    addToCart(match);
    setSearch('');
  };

  const addToCart = (product: Product) => {
    const stock = stockMap.get(product.id) ?? 0;
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      const qty = existing ? existing.quantity + 1 : 1;
      if (qty > stock) return prev;
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id
            ? { ...i, quantity: qty, line_total: calculateLineTotal(qty, i.unit_price, i.discount ?? 0) }
            : i
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          unit_price: Number(product.sale_price),
          discount: 0,
          line_total: Number(product.sale_price),
          stock,
          image_url: product.image_url,
          sku: product.sku,
          tax_rate: Number(product.tax_rate ?? 0),
          ieps_rate: Number(product.ieps_rate ?? 0),
        },
      ];
    });
  };

  const changeQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.product_id !== productId) return i;
          const q = i.quantity + delta;
          if (q <= 0) return null;
          if (q > i.stock) return i;
          return { ...i, quantity: q, line_total: calculateLineTotal(q, i.unit_price, i.discount ?? 0) };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeItem = (productId: string) => {
    setCart((prev) => prev.filter((i) => i.product_id !== productId));
  };

  const updateItemDiscount = (productId: string, value: string) => {
    const nextDiscount = Math.min(100, Math.max(0, Number(value) || 0));
    setCart((prev) => prev.map((item) => item.product_id === productId
      ? { ...item, discount: nextDiscount, line_total: calculateLineTotal(item.quantity, item.unit_price, nextDiscount) }
      : item
    ));
  };

  const startNewSale = () => {
    clearCart();
    setError(null);
    setSaleElapsed(0);
    setSaleStartedAt(Date.now());
    setNewSaleOpen(false);
  };

  const formatSaleElapsed = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };

  const clearCart = () => {
    setCart([]);
    setSelectedCustomer(null);
    setSelectedBankAccount(null);
    setPaymentMethod('efectivo');
    setCardLast4('');
    setCardBank('');
    setAuthorizationNumber('');
    setNipMode('con_nip');
    setNoNipName('');
    setNoNipAddress('');
    setNoNipPhone('');
    setTicketSigned('no');
    setTransferOriginBank('');
    setTransferConcept('');
    setTransferOriginAccount('');
    setTransferReceipt(null);
    setDiscount('');
    setAmountReceived('');
  };

  const subtotal = cart.reduce((s, i) => s + i.line_total, 0);
  const discountVal = parseFloat(discount) || 0;
  const total = Math.max(0, subtotal - discountVal);
  const tax = cart.reduce((sum, item) => {
    const rate = (Number(item.tax_rate ?? 0) + Number(item.ieps_rate ?? 0)) / 100;
    return sum + (rate > 0 ? item.line_total - (item.line_total / (1 + rate)) : 0);
  }, 0);
  const received = parseFloat(amountReceived) || 0;
  const change = Math.max(0, received - total);

  const completeSale = async () => {
    if (!currentBranch || !user) return;
    if (cart.length === 0) return;
    if (paymentMethod === 'efectivo' && received < total) {
      setError('El monto recibido es menor al total');
      return;
    }

    const paymentDetails: Record<string, string | boolean | null> = {};
    if (paymentMethod === 'tarjeta') {
      if (!cardLast4.match(/^\d{4}$/) || !cardBank.trim() || !authorizationNumber.trim()) {
        setError('Completa los datos de la tarjeta y la autorización.');
        return;
      }
      if (nipMode === 'sin_nip' && (!noNipName.trim() || !noNipAddress.trim() || !noNipPhone.trim())) {
        setError('Completa los datos del cliente cuando el pago es sin NIP.');
        return;
      }
      paymentDetails.card_type = cardType;
      paymentDetails.card_last4 = cardLast4;
      paymentDetails.card_bank = cardBank.trim();
      paymentDetails.authorization_number = authorizationNumber.trim();
      paymentDetails.nip_mode = nipMode;
      paymentDetails.customer_name = nipMode === 'sin_nip' ? noNipName.trim() : null;
      paymentDetails.customer_address = nipMode === 'sin_nip' ? noNipAddress.trim() : null;
      paymentDetails.customer_phone = nipMode === 'sin_nip' ? noNipPhone.trim() : null;
      paymentDetails.ticket_signed = nipMode === 'sin_nip' ? ticketSigned === 'si' : null;
    }
    if (paymentMethod === 'transferencia') {
      if (!selectedBankAccount || !transferOriginBank.trim() || !transferConcept.trim() || !transferOriginAccount.trim() || !transferReceipt) {
        setError('Completa los datos y adjunta el comprobante de transferencia.');
        return;
      }
      if (transferReceipt.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'application/pdf'].includes(transferReceipt.type)) {
        setError('El comprobante debe ser JPG, PNG o PDF de máximo 5 MB.');
        return;
      }
      setProcessing(true);
      const receiptPath = `${user.id}/${crypto.randomUUID()}-${transferReceipt.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: uploadError } = await supabase.storage.from('payment-receipts').upload(receiptPath, transferReceipt, { contentType: transferReceipt.type, upsert: false });
      if (uploadError) {
        setError('No se pudo guardar el comprobante.');
        setProcessing(false);
        return;
      }
      paymentDetails.receiving_bank_account_id = selectedBankAccount.id;
      paymentDetails.receiving_bank_name = selectedBankAccount.bank_name;
      paymentDetails.transfer_origin_bank = transferOriginBank.trim();
      paymentDetails.transfer_concept = transferConcept.trim();
      paymentDetails.transfer_origin_account = transferOriginAccount.trim();
      paymentDetails.receipt_path = receiptPath;
    }

    setProcessing(true);
    setError(null);
    const folio = generateFolio('V');
    const { data: saleData, error: saleErr } = await supabase
      .from('sales')
      .insert({
        branch_id: currentBranch.id,
        user_id: user.id,
        customer_id: selectedCustomer?.id ?? null,
        cash_register_id: activeRegister?.id ?? null,
        folio,
        subtotal,
        tax,
        discount: discountVal,
        total,
        payment_method: paymentMethod,
        payment_details: paymentDetails,
        amount_received: received,
        change,
        status: 'completada',
        started_at: saleStartedAt ? new Date(saleStartedAt).toISOString() : new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (saleErr) { console.error(saleErr); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setProcessing(false); return; }

    const items = cart.map((i) => ({
      sale_id: saleData.id,
      product_id: i.product_id,
      product_name: i.product_name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      discount: i.discount ?? 0,
      line_total: i.line_total,
    }));
    const { error: itemsErr } = await supabase.from('sale_items').insert(items);
    if (itemsErr) { console.error(itemsErr); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setProcessing(false); return; }

    // Decrement stock
    for (const item of cart) {
      const newQty = Math.max(0, (stockMap.get(item.product_id!) ?? 0) - item.quantity);
      await supabase
        .from('product_stock')
        .update({ quantity: newQty })
        .eq('product_id', item.product_id)
        .eq('branch_id', currentBranch.id);
    }

    const ticketData: TicketData = { branch: currentBranch, logoUrl: PROGRAM_LOGO, ticketWidth, storeName: currentBranch.name, folio, createdAt: new Date().toLocaleString('es-MX'), customerName: selectedCustomer?.name ?? 'Público en General', items: cart.map((item) => ({ product_name: item.product_name, sku: item.sku, quantity: item.quantity, unit_price: item.unit_price, line_total: item.line_total })), subtotal, tax, discount: discountVal, total, paymentMethod, amountReceived: received, change, currencySymbol, sellerName: profile?.full_name ?? 'Vendedor', paymentDetails };
    setLastSale(ticketData);
    setSaleStartedAt(null);
    setSaleElapsed(0);
    setQrUrl('');
    generateQrDataUrl(buildTicketText(ticketData)).then((url) => setQrUrl(url));
    setProcessing(false);
    setCheckoutOpen(false);
    clearCart();
    loadProducts();
  };

  const availablePaymentMethods = PAYMENT_METHODS.filter(
    (method) => !method.requiresCustomer || selectedCustomer
  );

  const clearSelectedCustomer = () => {
    setSelectedCustomer(null);
    if (paymentMethod === 'credito' || paymentMethod === 'monedero_electronico') {
      setPaymentMethod('efectivo');
    }
  };

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase())
  );

  return (
    <div className="pos-layout flex h-full flex-col">
      {/* Top bar: always accessible buttons */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          {activeRegister ? (
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Turno: {activeRegister.folio}</span>
          ) : (
            <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Sin turno abierto</span>
          )}
          {saleStartedAt && <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-xs font-bold text-emerald-700">Venta {formatSaleElapsed(saleElapsed)}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setNewSaleOpen(true)} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"><Plus size={16} /> Nueva venta <span className="hidden sm:inline">ESC</span></button>
          {subMenu.priceButton}
          {subMenu.menuButton}
        </div>
      </div>

      <div className={`flex flex-1 overflow-hidden ${mode === 'vertical' ? 'pos-layout-vertical' : 'lg:flex-row'}`}>
      {/* Left: Sale */}
      <div className="pos-sale-panel relative flex w-full flex-col border-r border-slate-200 bg-white lg:w-1/2">
        {newSaleOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/95 p-6">
            <div className="w-full max-w-sm space-y-4 text-center">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5"><Plus size={32} className="mx-auto mb-2 text-emerald-600" /><p className="font-semibold text-slate-800">¿Deseas iniciar una nueva venta?</p><p className="mt-1 text-sm text-slate-600">El cronómetro comenzará al aceptar.</p></div>
              <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setNewSaleOpen(false)}>Cancelar</Button><Button onClick={startNewSale}>Iniciar venta</Button></div>
            </div>
          </div>
        )}
        <div className="border-b border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2">
            <button
              onClick={() => { setCustomerSearch(''); setCustomerSearchOpen(true); }}
              className="flex flex-1 items-center gap-2 rounded-lg bg-white px-3 py-2 text-left shadow-sm transition hover:bg-emerald-50"
            >
              <UserPlus size={16} className="flex-shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cliente</span>
                <span className="block truncate text-sm font-semibold text-slate-700">{selectedCustomer?.name ?? 'Público en General'}</span>
              </span>
            </button>
          </div>

          <div className="relative">
            <ScanLine size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-blue-600" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setScanAlert(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } }}
              placeholder="Buscar o escanear código de producto..."
              className="w-full rounded-lg border border-slate-300 py-3 pl-10 pr-12 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
            />
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              title="Escanear con la cámara"
              aria-label="Escanear con la cámara"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-blue-600 p-1.5 text-white transition hover:bg-blue-700"
            >
              <ScanLine size={18} />
            </button>
          </div>

          {/* Alerta de escaneo */}
          {scanAlert && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3 text-red-700 animate-pulse">
              <AlertTriangle size={20} className="flex-shrink-0 text-red-600" />
              <span className="text-sm font-bold">{scanAlert}</span>
              <button
                onClick={() => setScanAlert(null)}
                className="ml-auto rounded p-1 text-red-500 hover:bg-red-100"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {search.trim() && (
            <div className="relative z-20">
              <div className="absolute left-0 right-0 top-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Productos encontrados ({filtered.length})
                </div>
                {filtered.slice(0, 8).map((p) => {
                  const stock = stockMap.get(p.id) ?? 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => { addToCart(p); setSearch(''); }}
                      disabled={stock <= 0}
                      className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition last:border-0 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                        ) : (
                          <ImageIcon size={16} className="text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-800">{p.name}</div>
                        <div className="text-xs text-slate-500">SKU: {p.sku ?? 'Sin código'} · Stock: {stock}</div>
                      </div>
                      <div className="text-sm font-bold text-emerald-600">{formatCurrency(p.sale_price, currencySymbol)}</div>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="px-3 py-4 text-center text-sm text-slate-500">No se encontraron productos</div>
                )}
                {filtered.length > 8 && (
                  <div className="border-t border-slate-100 px-3 py-2 text-center text-xs text-slate-400">Escribe más para ver resultados precisos</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <ShoppingCart size={16} /> Carrito ({cart.length})
            </h2>
            {cart.length > 0 && (
              <button onClick={clearCart} className="text-xs text-red-600 hover:underline">
                Vaciar
              </button>
            )}
          </div>
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
              <ShoppingCart size={40} className="mb-2" />
              <p className="text-sm">Agrega productos al carrito</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((item) => (
                <div key={item.product_id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                      {item.image_url ? <img src={item.image_url} alt={item.product_name} className="h-full w-full object-cover" /> : <ImageIcon size={16} className="text-slate-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-800">{item.product_name}</div>
                      <div className="truncate text-[11px] text-slate-500">{item.sku ?? 'Sin código'} · {formatCurrency(item.unit_price, currencySymbol)} · Stock: {item.stock}</div>
                    </div>
                    <div className="text-right text-sm font-bold text-slate-800">{formatCurrency(item.line_total, currencySymbol)}</div>
                    <button
                      onClick={() => removeItem(item.product_id!)}
                      className="text-slate-400 hover:text-red-600"
                      aria-label={`Eliminar ${item.product_name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => changeQty(item.product_id!, -1)}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => changeQty(item.product_id!, 1)}
                        disabled={item.quantity >= item.stock}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500">
                      Desc
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={item.discount ?? 0}
                        onChange={(e) => updateItemDiscount(item.product_id!, e.target.value)}
                        className="h-8 w-16 rounded-md border border-slate-200 px-2 text-center text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                        aria-label={`Descuento para ${item.product_name}`}
                      />
                      %
                    </label>
                    <div className="ml-auto text-right">
                      <div className="text-[10px] uppercase text-slate-400">Subtotal</div>
                      <div className="text-sm font-bold text-slate-800">{formatCurrency(item.line_total, currencySymbol)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="border-t border-slate-200 bg-slate-50 p-4">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="font-medium">{formatCurrency(subtotal, currencySymbol)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Descuento</span>
              <span className="font-medium">{formatCurrency(discountVal, currencySymbol)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-800">
              <span>Total</span>
              <span className="text-emerald-600">{formatCurrency(total, currencySymbol)}</span>
            </div>
          </div>
          {activeRegister ? (
            <Button
              className="mt-3 w-full"
              size="lg"
              disabled={cart.length === 0}
              onClick={() => setCheckoutOpen(true)}
            >
              Cobrar · {formatCurrency(total, currencySymbol)}
            </Button>
          ) : (
            <Button
              className="mt-3 w-full"
              size="lg"
              variant="secondary"
              disabled
            >
              <Lock size={16} /> Abre un turno para vender
            </Button>
          )}
        </div>
      </div>

      {/* Right: Ads */}
      <div className="pos-ads-panel hidden w-1/2 bg-slate-900 lg:flex flex-col">
        {ads.length > 0 ? (
          <div className="relative flex-1 overflow-hidden">
            {ads.map((ad, i) => (
              <div
                key={ad.id}
                className={`absolute inset-0 transition-opacity duration-1000 ${
                  i === adIndex ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <img src={ad.image_url} alt={ad.title} className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-8">
                  <h3 className="text-2xl font-bold text-white">{ad.title}</h3>
                </div>
              </div>
            ))}
            {ads.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                {ads.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setAdIndex(i)}
                    className={`h-2 rounded-full transition-all ${
                      i === adIndex ? 'w-8 bg-white' : 'w-2 bg-white/40'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-500">
            <ImageIcon size={56} className="mb-3" />
            <p className="text-sm">Sin imágenes publicitarias</p>
            <p className="text-xs text-slate-600 mt-1">Añádelas desde Configuración</p>
          </div>
        )}
        {/* Quick stats */}
        <div className="border-t border-slate-800 bg-slate-900 p-4 text-center">
          <p className="text-xs text-slate-400">Operando en</p>
          <p className="text-sm font-semibold uppercase tracking-wide text-white">{currentBranch?.name ?? 'BIENESTAR'}</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Versión actual: VERSION-LEAL-2601</p>
        </div>
      </div>

      {/* Checkout modal */}
      <Modal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} title="Cobro de venta" size="md">
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-50 p-4 text-center">
            <div className="text-sm text-slate-600">Total a pagar</div>
            <div className="text-3xl font-bold text-emerald-600">{formatCurrency(total, currencySymbol)}</div>
          </div>

          <Field label="Método de pago">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {availablePaymentMethods.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setPaymentMethod(m.value)}
                  className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition ${
                    paymentMethod === m.value
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
          </Field>

          {paymentMethod === 'tarjeta' && (
            <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0b347d]"><CreditCard size={17} /> Datos de tarjeta</div>
              <div className="grid grid-cols-2 gap-2">
                {(['debito', 'credito'] as const).map((type) => (
                  <button key={type} type="button" onClick={() => setCardType(type)} className={`rounded-lg border px-3 py-2 text-sm font-medium ${cardType === type ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                    {type === 'debito' ? 'Débito' : 'Crédito'}
                  </button>
                ))}
              </div>
              <Field label="Número de tarjeta · XXXX XXXX XXXX ____">
                <Input value={cardLast4} onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" maxLength={4} placeholder="1234" />
              </Field>
              <Field label="Banco"><Input value={cardBank} onChange={(e) => setCardBank(e.target.value)} placeholder="Nombre del banco" /></Field>
              <Field label="Número de autorización"><Input value={authorizationNumber} onChange={(e) => setAuthorizationNumber(e.target.value)} /></Field>
              <Field label="Autorizado con NIP">
                <Select value={nipMode} onChange={(e) => setNipMode(e.target.value as 'con_nip' | 'sin_nip')}>
                  <option value="con_nip">Sí, con NIP</option><option value="sin_nip">No, sin NIP</option>
                </Select>
              </Field>
              {nipMode === 'sin_nip' && (
                <div className="space-y-3 border-t border-blue-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Datos del cliente que pagó</div>
                  <Field label="Nombre"><Input value={noNipName} onChange={(e) => setNoNipName(e.target.value)} /></Field>
                  <Field label="Domicilio"><Input value={noNipAddress} onChange={(e) => setNoNipAddress(e.target.value)} /></Field>
                  <Field label="Teléfono"><Input value={noNipPhone} onChange={(e) => setNoNipPhone(e.target.value)} /></Field>
                  <Field label="¿Firmó el ticket?">
                    <Select value={ticketSigned} onChange={(e) => setTicketSigned(e.target.value as 'si' | 'no')}><option value="si">Sí</option><option value="no">No</option></Select>
                  </Field>
                </div>
              )}
            </div>
          )}

          {paymentMethod === 'transferencia' && (
            <div className="space-y-3 rounded-xl border border-cyan-100 bg-cyan-50/50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-cyan-800"><Landmark size={17} /> Cuenta receptora</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {bankAccounts.map((account) => (
                  <button key={account.id} type="button" onClick={() => setSelectedBankAccount(account)} className={`rounded-lg border bg-white p-3 text-left transition ${selectedBankAccount?.id === account.id ? 'border-cyan-600 ring-2 ring-cyan-100' : 'border-slate-200 hover:border-cyan-300'}`}>
                    <div className="flex items-center gap-2">
                      {account.logo_url ? <img src={account.logo_url} alt="" className="h-8 w-8 rounded object-contain" /> : <Building2 size={22} className="text-cyan-700" />}
                      <span className="font-semibold text-slate-800">{account.bank_name}</span>
                    </div>
                    <div className="mt-2 space-y-0.5 text-xs text-slate-500"><div>Beneficiario: {account.beneficiary}</div><div>Cuenta: {account.account_number}</div><div>CLABE: {account.clabe}</div></div>
                  </button>
                ))}
              </div>
              {bankAccounts.length === 0 && <div className="rounded-lg bg-white p-3 text-sm text-slate-500">No hay cuentas receptoras activas configuradas.</div>}
              <Field label="Banco de origen"><Input value={transferOriginBank} onChange={(e) => setTransferOriginBank(e.target.value)} /></Field>
              <Field label="Concepto"><Input value={transferConcept} onChange={(e) => setTransferConcept(e.target.value)} /></Field>
              <Field label="Cuenta de origen"><Input value={transferOriginAccount} onChange={(e) => setTransferOriginAccount(e.target.value)} /></Field>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-cyan-300 bg-white px-3 py-3 text-sm text-slate-600 hover:bg-cyan-50">
                <Upload size={17} className="text-cyan-700" />
                <span>{transferReceipt ? transferReceipt.name : 'Adjuntar comprobante (JPG, PNG o PDF)'}</span>
                <input type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={(e) => setTransferReceipt(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          )}

          {paymentMethod === 'efectivo' && (
            <Field label="Monto recibido">
              <Input
                type="number"
                value={amountReceived}
                onChange={(e) => setAmountReceived(e.target.value)}
                placeholder="0.00"
                min={0}
                step="0.01"
              />
            </Field>
          )}

          {paymentMethod === 'efectivo' && received > 0 && (
            <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-600">Cambio</span>
              <span className="font-bold text-slate-800">{formatCurrency(change, currencySymbol)}</span>
            </div>
          )}

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <Button className="w-full" size="lg" disabled={processing} onClick={completeSale}>
            {processing ? 'Procesando...' : 'Confirmar venta'}
          </Button>
        </div>
      </Modal>

      {/* Customer search */}
      <Modal open={customerSearchOpen} onClose={() => setCustomerSearchOpen(false)} title="Seleccionar cliente" size="md">
        <div className="space-y-3">
          <SearchInput value={customerSearch} onChange={setCustomerSearch} placeholder="Buscar cliente..." />
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {filteredCustomers.map((c) => (
              <button
                key={c.id}
                onClick={() => { setSelectedCustomer(c); setCustomerSearchOpen(false); setSendPhone(c.phone ?? ''); setSendEmail(c.email ?? ''); }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <div>
                  <div className="font-medium text-slate-700">{c.name}</div>
                  <div className="text-xs text-slate-400">{c.phone ?? 'Sin teléfono'} · {c.email ?? 'Sin correo'}</div>
                </div>
              </button>
            ))}
            {filteredCustomers.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">Sin resultados</p>
            )}
          </div>
        </div>
      </Modal>

      {/* Success */}
      <Modal open={!!lastSale} onClose={() => setLastSale(null)} title="Venta completada" size="sm">
        <div className="flex flex-col items-center text-center py-4">
          <CheckCircle2 size={56} className="mb-3 text-emerald-500" />
          <div className="text-sm text-slate-500">Folio</div>
          <div className="text-xl font-bold text-slate-800">{lastSale?.folio}</div>
          <div className="mt-4 w-full space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span className="text-slate-600">Total</span><span className="font-bold">{formatCurrency(lastSale?.total ?? 0, currencySymbol)}</span></div>
            {lastSale && lastSale.change > 0 && (
              <div className="flex justify-between"><span className="text-slate-600">Cambio</span><span className="font-bold text-emerald-600">{formatCurrency(lastSale.change, currencySymbol)}</span></div>
            )}
          </div>
          {lastSale?.paymentDetails && lastSale.paymentMethod === 'tarjeta' && (
            <div className="mt-3 w-full space-y-1.5 rounded-lg border border-blue-100 bg-blue-50/60 p-4 text-left text-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#0b347d]">Datos de tarjeta</div>
              <div className="flex justify-between"><span className="text-slate-600">Tipo</span><span className="font-medium text-slate-800">{lastSale.paymentDetails.card_type === 'credito' ? 'Crédito' : 'Débito'}</span></div>
              {lastSale.paymentDetails.card_last4 && <div className="flex justify-between"><span className="text-slate-600">Tarjeta</span><span className="font-medium text-slate-800">**** {String(lastSale.paymentDetails.card_last4)}</span></div>}
              {lastSale.paymentDetails.card_bank && <div className="flex justify-between"><span className="text-slate-600">Banco</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.card_bank)}</span></div>}
              {lastSale.paymentDetails.authorization_number && <div className="flex justify-between"><span className="text-slate-600">No. de autorización</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.authorization_number)}</span></div>}
              <div className="flex justify-between"><span className="text-slate-600">Autorizado con NIP</span><span className="font-medium text-slate-800">{lastSale.paymentDetails.nip_mode === 'con_nip' ? 'Sí' : 'No'}</span></div>
              {lastSale.paymentDetails.nip_mode === 'sin_nip' && (
                <div className="mt-2 space-y-1.5 border-t border-blue-100 pt-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente que pagó</div>
                  {lastSale.paymentDetails.customer_name && <div className="flex justify-between"><span className="text-slate-600">Nombre</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.customer_name)}</span></div>}
                  {lastSale.paymentDetails.customer_phone && <div className="flex justify-between"><span className="text-slate-600">Teléfono</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.customer_phone)}</span></div>}
                  {lastSale.paymentDetails.customer_address && <div className="flex justify-between gap-3"><span className="text-slate-600">Domicilio</span><span className="text-right font-medium text-slate-800">{String(lastSale.paymentDetails.customer_address)}</span></div>}
                  <div className="flex justify-between"><span className="text-slate-600">¿Firmó el ticket?</span><span className="font-medium text-slate-800">{lastSale.paymentDetails.ticket_signed ? 'Sí' : 'No'}</span></div>
                </div>
              )}
            </div>
          )}
          {lastSale?.paymentDetails && lastSale.paymentMethod === 'transferencia' && (
            <div className="mt-3 w-full space-y-1.5 rounded-lg border border-cyan-100 bg-cyan-50/60 p-4 text-left text-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-cyan-800">Datos de transferencia</div>
              {lastSale.paymentDetails.receiving_bank_name && <div className="flex justify-between"><span className="text-slate-600">Cuenta receptora</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.receiving_bank_name)}</span></div>}
              {lastSale.paymentDetails.transfer_origin_bank && <div className="flex justify-between"><span className="text-slate-600">Banco de origen</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.transfer_origin_bank)}</span></div>}
              {lastSale.paymentDetails.transfer_origin_account && <div className="flex justify-between"><span className="text-slate-600">Cuenta de origen</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.transfer_origin_account)}</span></div>}
              {lastSale.paymentDetails.transfer_concept && <div className="flex justify-between gap-3"><span className="text-slate-600">Concepto</span><span className="text-right font-medium text-slate-800">{String(lastSale.paymentDetails.transfer_concept)}</span></div>}
            </div>
          )}
          {/* QR del ticket */}
          {qrUrl && (
            <div className="mt-4 flex w-full flex-col items-center rounded-lg border border-slate-200 bg-white p-4 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Escanea para ver tu ticket</div>
              <img src={qrUrl} alt="Código QR del ticket" className="mt-2 h-40 w-40" />
              <div className="mt-2 text-xs text-slate-400">Folio: {lastSale?.folio}</div>
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => setLastSale(null)}>Listo</Button><Button onClick={() => lastSale && printTicket(lastSale)}>Imprimir ticket</Button></div>

          {/* Send options */}
          <div className="mt-5 w-full space-y-3 rounded-lg border border-slate-200 p-4 text-left">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Enviar ticket</div>
            <Field label="WhatsApp (teléfono del cliente)">
              <Input
                type="tel"
                value={sendPhone}
                onChange={(e) => setSendPhone(e.target.value)}
                placeholder="Ej: 525512345678"
              />
            </Field>
            <Button
              variant="secondary"
              className="w-full"
              disabled={!lastSale || !sendPhone.trim()}
              onClick={() => {
                if (!lastSale) return;
                const text = buildTicketText(lastSale);
                window.open(buildWhatsAppUrl(sendPhone.trim(), text), '_blank', 'noopener,noreferrer');
              }}
            >
              <MessageCircle size={16} /> Enviar por WhatsApp
            </Button>
            <Field label="Correo electrónico">
              <Input
                type="email"
                value={sendEmail}
                onChange={(e) => setSendEmail(e.target.value)}
                placeholder="cliente@correo.com"
              />
            </Field>
            <Button
              variant="secondary"
              className="w-full"
              disabled={!lastSale || !sendEmail.trim() || sending}
              onClick={async () => {
                if (!lastSale) return;
                setSending(true);
                setSendStatus(null);
                try {
                  const text = buildTicketText(lastSale);
                  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-ticket-email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
                    body: JSON.stringify({ to: sendEmail.trim(), subject: `Ticket ${lastSale.folio}`, text, folio: lastSale.folio, storeName: lastSale.storeName }),
                  });
                  if (!res.ok) throw new Error('No se pudo enviar');
                  setSendStatus('Correo enviado correctamente');
                } catch {
                  setSendStatus('No se pudo enviar el correo. Verifica la configuración.');
                } finally {
                  setSending(false);
                }
              }}
            >
              {sending ? 'Enviando...' : <><Mail size={16} /> Enviar por correo</>}
            </Button>
            {sendStatus && <div className={`rounded-lg px-3 py-2 text-sm ${sendStatus.includes('correctamente') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{sendStatus}</div>}
          </div>
        </div>
      </Modal>

      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80">
          <Spinner size={32} />
        </div>
      )}

      {subMenu.modals}

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetect={(code) => { setSearch(code); handleScan(code); }}
        title="Escanear producto"
      />
      </div>
    </div>
  );
}
