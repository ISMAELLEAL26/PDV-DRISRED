import QRCode from 'qrcode';
import type { Branch } from '@/lib/types';

interface TicketItem {
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface TicketData {
  branch: Branch;
  logoUrl: string | null;
  ticketWidth: '55' | '80';
  storeName: string;
  folio: string;
  createdAt: string;
  customerName: string;
  items: TicketItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: string;
  amountReceived: number;
  change: number;
  currencySymbol: string;
  sellerName: string;
  paymentDetails?: Record<string, string | boolean | null>;
}

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character] ?? character));

const money = (value: number, symbol: string): string => `${symbol}${value.toFixed(2)}`;

const barcodeSvg = (value: string): string => {
  const bars = value.split('').flatMap((character) => {
    const code = character.charCodeAt(0);
    return Array.from({ length: 7 }, (_, index) => ((code >> index) & 1) === 1 ? 3 : 1);
  });
  const width = bars.reduce((sum, bar) => sum + bar, 0) + 16;
  let x = 8;
  const rectangles = bars.map((bar, index) => {
    const rect = index % 2 === 0 ? `<rect x="${x}" y="0" width="${bar}" height="42"/>` : '';
    x += bar;
    return rect;
  }).join('');
  return `<svg class="barcode" viewBox="0 0 ${width} 54" role="img" aria-label="Código de barras ${escapeHtml(value)}"><g fill="#000">${rectangles}</g><text x="50%" y="53" text-anchor="middle">${escapeHtml(value)}</text></svg>`;
};

const branchAddress = (branch: Branch): string[] => [
  [branch.street, branch.exterior_number && `No. ${branch.exterior_number}`, branch.interior_number && `Int. ${branch.interior_number}`].filter(Boolean).join(' '),
  [branch.neighborhood, branch.locality, branch.municipality, branch.state, branch.postal_code && `C.P. ${branch.postal_code}`].filter(Boolean).join(', '),
  branch.address ?? '',
].filter(Boolean);

export async function generateQrDataUrl(text: string): Promise<string> {
  try {
    return await QRCode.toDataURL(text, { margin: 1, width: 240, color: { dark: '#000000', light: '#ffffff' } });
  } catch {
    return '';
  }
}

function buildPaymentDetailsHtml(data: TicketData): string {
  const details = data.paymentDetails;
  if (!details) return '';
  const lines: string[] = [];
  if (data.paymentMethod === 'tarjeta') {
    lines.push(`<div class="row"><span>Tipo:</span><span>${escapeHtml(details.card_type === 'credito' ? 'Crédito' : 'Débito')}</span></div>`);
    if (details.card_last4) lines.push(`<div class="row"><span>Tarjeta:</span><span>**** ${escapeHtml(String(details.card_last4))}</span></div>`);
    if (details.card_bank) lines.push(`<div class="row"><span>Banco:</span><span>${escapeHtml(String(details.card_bank))}</span></div>`);
    if (details.authorization_number) lines.push(`<div class="row"><span>Aut.:</span><span>${escapeHtml(String(details.authorization_number))}</span></div>`);
    lines.push(`<div class="row"><span>Con NIP:</span><span>${details.nip_mode === 'con_nip' ? 'Sí' : 'No'}</span></div>`);
    if (details.nip_mode === 'sin_nip') {
      if (details.customer_name) lines.push(`<div class="row"><span>Cliente:</span><span>${escapeHtml(String(details.customer_name))}</span></div>`);
      if (details.customer_phone) lines.push(`<div class="row"><span>Tel.:</span><span>${escapeHtml(String(details.customer_phone))}</span></div>`);
      if (details.customer_address) lines.push(`<div>Dom: ${escapeHtml(String(details.customer_address))}</div>`);
      lines.push(`<div class="row"><span>Firmó:</span><span>${details.ticket_signed ? 'Sí' : 'No'}</span></div>`);
    }
  } else if (data.paymentMethod === 'transferencia') {
    if (details.receiving_bank_name) lines.push(`<div class="row"><span>Cta. receptora:</span><span>${escapeHtml(String(details.receiving_bank_name))}</span></div>`);
    if (details.transfer_origin_bank) lines.push(`<div class="row"><span>Banco origen:</span><span>${escapeHtml(String(details.transfer_origin_bank))}</span></div>`);
    if (details.transfer_origin_account) lines.push(`<div class="row"><span>Cta. origen:</span><span>${escapeHtml(String(details.transfer_origin_account))}</span></div>`);
    if (details.transfer_concept) lines.push(`<div>Concepto: ${escapeHtml(String(details.transfer_concept))}</div>`);
  }
  return lines.length ? `<div class="divider"></div><div class="center small">Detalles de pago</div>${lines.join('')}` : '';
}

function buildTicketBody(data: TicketData): string {
  const paymentLabel = data.paymentMethod.replace('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
  const itemsHtml = data.items.map((item) => `<div class="item"><div><b>${item.quantity} x ${escapeHtml(item.sku ?? '')} ${escapeHtml(item.product_name)}</b></div><div class="row"><span>${money(item.unit_price, data.currencySymbol)}</span><b>${money(item.line_total, data.currencySymbol)}</b></div></div>`).join('');
  const addressHtml = branchAddress(data.branch).map((line) => `<div>${escapeHtml(line)}</div>`).join('');
  const logoHtml = data.logoUrl ? `<img class="logo" src="${escapeHtml(data.logoUrl)}" alt="Logotipo" />` : '';
  const paymentDetailsHtml = buildPaymentDetailsHtml(data);
  return `<header>${logoHtml}<h1>${escapeHtml(data.storeName)}</h1>${addressHtml}<div>${escapeHtml(data.branch.phone ?? '')}</div></header><div class="divider"></div><div class="row"><span>Venta:</span><span>${escapeHtml(data.createdAt)}</span></div><div class="row"><span>Vendedor:</span><span>${escapeHtml(data.sellerName)}</span></div><div class="row"><span>${escapeHtml(data.folio)}</span><span></span></div><div>Cliente: ${escapeHtml(data.customerName)}</div><div class="divider"></div>${itemsHtml}<div class="divider"></div><div class="totals"><div class="row"><span>Subtotal:</span><span>${money(data.subtotal, data.currencySymbol)}</span></div>${data.discount > 0 ? `<div class="row"><span>Descuento:</span><span>-${money(data.discount, data.currencySymbol)}</span></div>` : ''}<div class="row"><span>IVA:</span><span>${money(data.tax, data.currencySymbol)}</span></div><div class="row"><b>Total ${data.currencySymbol}:</b><b>${money(data.total, data.currencySymbol)}</b></div><div class="row"><span>${paymentLabel}:</span><span>${money(data.amountReceived || data.total, data.currencySymbol)}</span></div><div class="row"><span>Cambio:</span><span>${money(data.change, data.currencySymbol)}</span></div></div>${paymentDetailsHtml}<div class="footer">Precios incluyen impuestos</div>${barcodeSvg(data.folio)}<div class="center small">Gracias por su compra</div><div class="ticket-spacer"><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div></div><div class="center small">.</div>`;
}

function buildTicketDocument(data: TicketData): string {
  const width = '58mm';
  const fontSize = '12px';
  const padding = '0mm';
  const h1Size = '14px';
  const smallSize = '10px';
  const bodyContent = buildTicketBody(data);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ticket ${escapeHtml(data.folio)}</title><style>
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000 !important; background: #fff !important; border-color: #000 !important; opacity: 1 !important; }
    html, body { width: ${width}; margin: 0; padding: 0; background: #fff; color: #000; }
    body { padding: ${padding}; color: #000; font-family: 'Courier New', monospace; font-size: ${fontSize}; font-weight: bold; line-height: 1.4; -webkit-font-smoothing: none; }
    header { text-align: center; color: #000; }
    .logo { display: block; max-width: 70%; max-height: 26mm; margin: 0 auto 1mm; object-fit: contain; }
    h1 { font-size: ${h1Size}; margin: 0 0 1mm; text-transform: uppercase; color: #000; font-weight: bold; }
    .center { text-align: center; color: #000; }
    .divider { border-top: 1px dashed #000; margin: 2mm 0; color: #000; }
    .row { display: flex; justify-content: space-between; gap: 4px; color: #000; font-weight: bold; }
    .item { margin: 1mm 0; overflow-wrap: anywhere; page-break-inside: avoid; color: #000; font-weight: bold; }
    .small { font-size: ${smallSize}; color: #000; font-weight: bold; }
    .barcode { display: block; width: 90%; height: 18mm; margin: 3mm auto 1mm; page-break-inside: avoid; }
    .barcode text { font: bold 8px 'Courier New', monospace; fill: #000; }
    .barcode rect { fill: #000; }
    .footer { text-align: center; margin-top: 2mm; page-break-after: avoid; color: #000; font-weight: bold; }
    .ticket-spacer { line-height: 1.4; }
    b, strong { color: #000; font-weight: bold; }
    * { page-break-inside: avoid; }
    @media print {
      html, body { width: ${width}; margin: 0; padding: 0; }
      .no-print { display: none; }
    }
  </style></head><body>${bodyContent}<script>
    (function () {
      function doPrint() {
        try { window.print(); } catch (e) {}
      }
      function ready() {
        var img = document.querySelector('img.logo');
        if (img && !img.complete && img.src) {
          var called = false;
          function go() { if (called) return; called = true; setTimeout(doPrint, 150); }
          img.addEventListener('load', go);
          img.addEventListener('error', function () { img.remove(); go(); });
          setTimeout(function () { if (!called) { img.remove(); go(); } }, 2000);
        } else {
          setTimeout(doPrint, 150);
        }
      }
      if (document.readyState === 'complete') { ready(); }
      else { window.addEventListener('load', ready); }
    })();
  <\/script></body></html>`;
}

export function printTicket(data: TicketData): void {
  const html = buildTicketDocument(data);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer,width=420,height=640');
  if (win) {
    win.focus();
    win.addEventListener('load', () => URL.revokeObjectURL(url));
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else {
    URL.revokeObjectURL(url);
  }
}

export function buildTicketText(data: TicketData): string {
  const lines: string[] = [];
  lines.push(`*${data.storeName}*`);
  branchAddress(data.branch).forEach((line) => lines.push(line));
  if (data.branch.phone) lines.push(`Tel: ${data.branch.phone}`);
  lines.push('--------------------------------');
  lines.push(`Folio: ${data.folio}`);
  lines.push(`Fecha: ${data.createdAt}`);
  lines.push(`Vendedor: ${data.sellerName}`);
  lines.push(`Cliente: ${data.customerName}`);
  lines.push('--------------------------------');
  data.items.forEach((item) => {
    lines.push(`${item.quantity} x ${item.sku ?? ''} ${item.product_name}`);
    lines.push(`${money(item.unit_price, data.currencySymbol)} = ${money(item.line_total, data.currencySymbol)}`);
  });
  lines.push('--------------------------------');
  lines.push(`Subtotal: ${money(data.subtotal, data.currencySymbol)}`);
  if (data.discount > 0) lines.push(`Descuento: -${money(data.discount, data.currencySymbol)}`);
  lines.push(`IVA: ${money(data.tax, data.currencySymbol)}`);
  lines.push(`*Total: ${money(data.total, data.currencySymbol)}*`);
  const paymentLabel = data.paymentMethod.replace('_', ' ').replace(/^./, (l) => l.toUpperCase());
  lines.push(`${paymentLabel}: ${money(data.amountReceived || data.total, data.currencySymbol)}`);
  if (data.change > 0) lines.push(`Cambio: ${money(data.change, data.currencySymbol)}`);
  lines.push('--------------------------------');
  lines.push('Precios incluyen impuestos');
  lines.push('Gracias por su compra');
  return lines.join('\n');
}

export function buildWhatsAppUrl(phone: string, text: string): string {
  const cleanPhone = phone.replace(/\D/g, '');
  const encoded = encodeURIComponent(text);
  return `https://wa.me/${cleanPhone}?text=${encoded}`;
}

export interface CashTicketData {
  branch: Branch;
  logoUrl: string | null;
  storeName: string;
  title: string;
  folio: string;
  cashierName: string;
  createdAt: string;
  currencySymbol: string;
  ticketWidth?: '55' | '80';
  rows: { label: string; value: string }[];
  sections?: { heading: string; rows: { label: string; value: string }[] }[];
  resultLabel?: string;
  resultValue?: string;
  resultKind?: 'ok' | 'short' | 'over';
  signatureLine?: boolean;
}

function buildCashTicketDocument(data: CashTicketData): string {
  const width = '58mm';
  const fontSize = '12px';
  const h1Size = '14px';
  const smallSize = '10px';
  const addressHtml = branchAddress(data.branch).map((line) => `<div>${escapeHtml(line)}</div>`).join('');
  const logoHtml = data.logoUrl ? `<img class="logo" src="${escapeHtml(data.logoUrl)}" alt="Logotipo" />` : '';
  const rowsHtml = data.rows.map((r) => `<div class="row"><span>${escapeHtml(r.label)}</span><span>${escapeHtml(r.value)}</span></div>`).join('');
  const sectionsHtml = (data.sections ?? []).map((s) => `<div class="divider"></div><div class="center small">${escapeHtml(s.heading)}</div>${s.rows.map((r) => `<div class="row"><span>${escapeHtml(r.label)}</span><span>${escapeHtml(r.value)}</span></div>`).join('')}`).join('');
  const resultHtml = data.resultLabel && data.resultValue
    ? `<div class="divider"></div><div class="row"><b>${escapeHtml(data.resultLabel)}</b><b>${escapeHtml(data.resultValue)}</b></div>`
    : '';
  const signatureHtml = data.signatureLine ? `<div class="divider"></div><div style="margin-top:8mm;text-align:center;"><div style="border-top:1px solid #000;width:70%;margin:0 auto;"></div><div class="small" style="margin-top:1mm;">Firma del cajero</div></div>` : '';
  const body = `<header>${logoHtml}<h1>${escapeHtml(data.storeName)}</h1>${addressHtml}</header><div class="divider"></div><div class="center small">${escapeHtml(data.title)}</div><div class="divider"></div>${rowsHtml}${sectionsHtml}${resultHtml}${signatureHtml}<div class="center small" style="margin-top:2mm;">Gracias por su preferencia</div><div class="ticket-spacer"><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div></div><div class="center small">.</div>`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(data.title)} ${escapeHtml(data.folio)}</title><style>
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000 !important; background: #fff !important; border-color: #000 !important; opacity: 1 !important; }
    html, body { width: ${width}; margin: 0; padding: 0; background: #fff; color: #000; }
    body { color: #000; font-family: 'Courier New', monospace; font-size: ${fontSize}; font-weight: bold; line-height: 1.4; -webkit-font-smoothing: none; }
    header { text-align: center; }
    .logo { display: block; max-width: 70%; max-height: 26mm; margin: 0 auto 1mm; object-fit: contain; }
    h1 { font-size: ${h1Size}; margin: 0 0 1mm; text-transform: uppercase; }
    .center { text-align: center; }
    .divider { border-top: 1px dashed #000; margin: 2mm 0; }
    .row { display: flex; justify-content: space-between; gap: 4px; }
    .small { font-size: ${smallSize}; }
    .ticket-spacer { line-height: 1.4; }
    b, strong { font-weight: bold; }
    * { page-break-inside: avoid; }
    @media print { html, body { width: ${width}; margin: 0; padding: 0; } }
  </style></head><body>${body}<script>(function(){function p(){try{window.print()}catch(e){}}if(document.readyState==='complete'){setTimeout(p,150)}else{window.addEventListener('load',function(){setTimeout(p,150)})}})();<\/script></body></html>`;
}

export function printCashTicket(data: CashTicketData): void {
  const html = buildCashTicketDocument(data);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer,width=420,height=640');
  if (win) {
    win.focus();
    win.addEventListener('load', () => URL.revokeObjectURL(url));
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else {
    URL.revokeObjectURL(url);
  }
}
