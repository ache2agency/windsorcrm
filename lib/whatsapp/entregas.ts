import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhoneNumber } from './provider'
export function firmaMetaValida(raw: string, signature: string | null, secret?: string) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false
  return timingSafeEqual(createHmac('sha256', secret).update(raw).digest(), Buffer.from(signature.slice(7), 'hex'))
}
export async function registrarEstados(db: SupabaseClient, payload: { entry?: Array<{ changes?: Array<{ value?: { statuses?: unknown[] } }> }> }) {
  for (const entry of payload.entry || []) for (const change of entry.changes || []) for (const value of change.value?.statuses || []) {
    const s = value as { id?: string; status?: string; timestamp?: string; errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }> }
    if (!s.id || !['sent','delivered','read','failed'].includes(s.status || '') || !/^\d+$/.test(s.timestamp || '')) continue
    const error = s.errors?.[0]
    const { error: dbError } = await db.rpc('registrar_entrega_whatsapp', { p_wamid: s.id, p_estado: s.status,
      p_fecha: new Date(Number(s.timestamp) * 1000).toISOString(), p_codigo: error?.code ?? null,
      p_motivo: error?.error_data?.details || error?.message || error?.title || null })
    if (dbError) throw dbError
  }
}
export async function templateBloqueado(db: SupabaseClient, to: string, template: string) {
  const { data, error } = await db.from('whatsapp_template_bloqueos').select('template_name')
    .eq('whatsapp', normalizePhoneNumber(to.replace(/\D/g, ''))).eq('template_name', template).maybeSingle()
  if (error) throw error // No enviar si no se puede comprobar un fallo anterior.
  return Boolean(data)
}
