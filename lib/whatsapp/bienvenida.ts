import { createServiceRoleClient } from '@/utils/supabase/server'
import { getWhatsAppProvider, normalizePhoneNumber, sendMetaWhatsAppTemplate } from '@/lib/whatsapp/provider'

/** Envía el template de bienvenida de Meta a un lead creado manualmente y prepara su conversación. */
export async function enviarBienvenidaLeadManual(
  supabase: ReturnType<typeof createServiceRoleClient>,
  leadId: string
): Promise<{ ok: true; enviado_a: string } | { ok: false; error: string }> {
  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, nombre, whatsapp, curso')
    .eq('id', leadId)
    .maybeSingle()

  if (error || !lead) return { ok: false, error: 'Lead no encontrado' }
  if (!lead.whatsapp) return { ok: false, error: 'Lead sin número WhatsApp' }

  const provider = getWhatsAppProvider()
  const nombre = lead.nombre?.trim() || 'ahí'
  const normalized = normalizePhoneNumber(lead.whatsapp)

  if (provider !== 'meta') return { ok: false, error: 'Solo Meta soportado para primer contacto' }

  try {
    await sendMetaWhatsAppTemplate({ to: normalized, templateName: 'windsor_bienvenida_lead_manual', parameters: [nombre] })
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const mensaje = `Hola ${nombre} 👋 Aquí te compartimos la información que nos solicitaste. Toca el botón para recibirla.`
  const now = new Date().toISOString()

  const { data: convExistente } = await supabase
    .from('whatsapp_conversaciones')
    .select('id')
    .eq('whatsapp', normalized)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let conversacionId = (convExistente as { id?: string } | null)?.id

  if (!conversacionId) {
    const { data: nuevaConv } = await supabase
      .from('whatsapp_conversaciones')
      .insert([{
        whatsapp: normalized,
        lead_id: lead.id,
        estado: 'abierta',
        modo_humano: false,
        fase: 'saludo',
        provider,
        ultimo_mensaje_at: now,
      }])
      .select('id')
      .maybeSingle()
    conversacionId = (nuevaConv as { id?: string } | null)?.id
  } else {
    await supabase
      .from('whatsapp_conversaciones')
      .update({ lead_id: lead.id, ultimo_mensaje_at: now })
      .eq('id', conversacionId)
  }

  if (conversacionId) {
    await supabase.from('whatsapp_mensajes').insert([{
      conversacion_id: conversacionId,
      rol: 'bot',
      contenido: mensaje,
      created_at: now,
    }])
  }

  return { ok: true, enviado_a: normalized }
}
