import type { SupabaseClient } from '@supabase/supabase-js'
import { ADMIN_WA_ALERTA } from './atencion'
import { normalizePhoneNumber, getMetaConfig, sendMetaWhatsAppMessage, sendMetaWhatsAppTemplate } from './provider'

export async function avisoInternoAprobado() {
  const { accessToken, businessAccountId } = getMetaConfig()
  if (!accessToken || !businessAccountId) return false
  try {
    const res = await fetch(`https://graph.facebook.com/v23.0/${businessAccountId}/message_templates?name=windsor_aviso_interno&fields=name,status,language,category`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000),
    })
    const json = await res.json()
    return res.ok && (json.data || []).some((t: { name: string; status: string; language: string; category: string }) =>
      t.name === 'windsor_aviso_interno' && t.status === 'APPROVED' && t.language === 'es_MX' && t.category === 'UTILITY')
  } catch { return false }
}
export async function avisarAdmin(db: SupabaseClient, body: string) {
  const { data: convs, error } = await db.from('whatsapp_conversaciones').select('id')
    .in('whatsapp', [ADMIN_WA_ALERTA, normalizePhoneNumber(ADMIN_WA_ALERTA)])
  if (error) throw error
  const ids = (convs || []).map(c => c.id)
  const { data: ultimo, error: msgError } = ids.length ? await db.from('whatsapp_mensajes').select('created_at')
    .in('conversacion_id', ids).eq('rol', 'usuario').order('created_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null, error: null }
  if (msgError) throw msgError
  const ventana = ultimo && Date.now() - Date.parse(ultimo.created_at) < 23.5 * 3600_000
  if (ventana || !await avisoInternoAprobado()) return sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body })
  // El código encabeza el aviso. El texto íntegro queda en la conversación del CRM.
  return sendMetaWhatsAppTemplate({ to: ADMIN_WA_ALERTA, templateName: 'windsor_aviso_interno', parameters: [body.replace(/\s+/g, ' ').slice(0, 900), 'Contacto en CRM', body.match(/\+?52\d{10,11}/)?.[0] || 'Ver conversación'] })
}
