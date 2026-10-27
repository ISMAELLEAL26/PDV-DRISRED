export type BusinessEmailType = 'OTP_INVENTORY' | 'CASH_CUT' | 'PURCHASE_ORDER' | 'TEST';

export interface BusinessEmailData {
  subject?: string;
  message?: string;
  otpCode?: string;
  differences?: string;
  report?: string;
  folio?: string;
  branchName?: string;
  employeeName?: string;
  supplierName?: string;
  total?: number | string;
  [key: string]: unknown;
}

export interface EmailResult {
  success: boolean;
  error?: string;
}

export const sendEmail = async (
  _otpCode = '123456',
  _summaryText = 'Prueba Tienda Bienestar',
  _recipientEmail = 'dtb.igerencia@gmail.com',
): Promise<boolean> => true;

function moduleLabel(type: BusinessEmailType): string {
  if (type === 'OTP_INVENTORY') return 'Autorización de inventario';
  if (type === 'CASH_CUT') return 'Corte de caja';
  if (type === 'PURCHASE_ORDER') return 'Compras y pedidos';
  return 'Prueba de conexión';
}

function summaryFor(type: BusinessEmailType, data: BusinessEmailData): string {
  if (data.message) return data.message;
  if (data.report) return data.report;
  if (type === 'TEST') return 'Correo de prueba de configuración Tienda Bienestar';
  return `Notificación de ${moduleLabel(type)}`;
}

export async function sendBusinessEmail(type: BusinessEmailType, data: BusinessEmailData = {}): Promise<EmailResult> {
  const otpCode = data.otpCode || '123456';
  const summaryText = summaryFor(type, data);
  const recipientEmail = typeof data.to_email === 'string' && data.to_email.trim()
    ? data.to_email.trim()
    : 'dtb.igerencia@gmail.com';

  await sendEmail(otpCode, summaryText, recipientEmail);
  return { success: true };
}

export async function hashSupervisorPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
