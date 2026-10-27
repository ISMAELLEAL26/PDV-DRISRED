import { supabase } from '@/lib/supabase';

export type OperationalNotificationType = 'inventory_alert' | 'cash_cut';

interface OperationalNotificationInput {
  type: OperationalNotificationType;
  title: string;
  message: string;
  branchId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function saveOperationalNotification(input: OperationalNotificationInput): Promise<boolean> {
  const { error } = await supabase.from('operational_notifications').insert({
    type: input.type,
    title: input.title,
    message: input.message,
    branch_id: input.branchId ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) {
    console.error('No se pudo guardar la notificación operativa:', error);
    return false;
  }

  return true;
}
