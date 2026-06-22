import { createServiceRoleClient } from '@/utils/supabase/server'
import {
  getWhatsAppProvider,
  sendMetaWhatsAppTemplate,
} from '@/lib/whatsapp/provider'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const { conversacion_id } = await request.json()
  if (!conversacion_id) return Response.json({ error: 'conversacion_id requerido' }, { status: 400 })

  const supabase = createServiceRoleClient()

  const { data: conv } = await supabase
    .from('whatsapp_conversaciones')
    .select('id, whatsapp, lead_id')
    .eq('id', conversacion_id)
    .maybeSingle()

  if (!conv) return Response.json({ error: 'Conversación no encontrada' }, { status: 404 })

  let nombre = 'amig@'
  if (conv.lead_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('nombre')
      .eq('id', conv.lead_id)
      .maybeSingle()
    if (lead?.nombre?.trim()) nombre = lead.nombre.trim()
  }

  const provider = getWhatsAppProvider()

  try {
    if (provider === 'meta') {
      await sendMetaWhatsAppTemplate({ to: conv.whatsapp, templateName: 'seguimiento_general', parameters: [nombre] })
    } else {
      return Response.json({ error: 'Solo Meta soportado para reactivación' }, { status: 400 })
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return Response.json({ error: msg }, { status: 500 })
  }

  const contenido = `Hola ${nombre} 👋 ¿Pudiste revisar la información que te compartimos? Si tienes alguna duda con gusto te ayudamos. 😊`
  const now = new Date().toISOString()

  await supabase.from('whatsapp_mensajes').insert([{
    conversacion_id: conv.id,
    rol: 'agente',
    contenido,
    created_at: now,
  }])

  await supabase
    .from('whatsapp_conversaciones')
    .update({ ultimo_mensaje_at: now, estado: 'abierta' })
    .eq('id', conv.id)

  return Response.json({ ok: true, contenido })
}
