import { createServiceRoleClient } from '@/utils/supabase/server'
import {
  getWhatsAppProvider,
  normalizePhoneNumber,
  sendMetaWhatsAppTemplate,
} from '@/lib/whatsapp/provider'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const { lead_id } = await request.json()
  if (!lead_id) return Response.json({ error: 'lead_id requerido' }, { status: 400 })

  const supabase = createServiceRoleClient()

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, nombre, whatsapp, curso')
    .eq('id', lead_id)
    .maybeSingle()

  if (error || !lead) return Response.json({ error: 'Lead no encontrado' }, { status: 404 })
  if (!lead.whatsapp) return Response.json({ error: 'Lead sin número WhatsApp' }, { status: 400 })

  const provider = getWhatsAppProvider()
  const nombre = lead.nombre?.trim() || 'ahí'
  const normalized = normalizePhoneNumber(lead.whatsapp)

  try {
    if (provider === 'meta') {
      await sendMetaWhatsAppTemplate({ to: normalized, templateName: 'windsor_bienvenida_lead_manual', parameters: [nombre] })
    } else {
      return Response.json({ error: 'Solo Meta soportado para primer contacto' }, { status: 400 })
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return Response.json({ error: msg, numero_intentado: normalized }, { status: 500 })
  }

  const mensaje = `Hola ${nombre} 👋 Aquí te compartimos la información que nos solicitaste. Toca el botón para recibirla.`
  const now = new Date().toISOString()

  // Verificar si ya existe conversación para este número
  const { data: convExistente } = await supabase
    .from('whatsapp_conversaciones')
    .select('id')
    .eq('whatsapp', normalized)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let conversacionId = convExistente?.id

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
    conversacionId = nuevaConv?.id
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

  return Response.json({ ok: true, enviado_a: normalized })
}
