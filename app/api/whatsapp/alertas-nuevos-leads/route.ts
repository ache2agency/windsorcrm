import { createServiceRoleClient } from '@/utils/supabase/server'
import { sendMetaWhatsAppMessage } from '@/lib/whatsapp/provider'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ADMIN_WHATSAPP = '527471028306'
const MINUTOS_ESPERA = 15
const VENTANA_MAX_MIN = 25

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() === secret
  return request.headers.get('x-cron-secret') === secret
}

function faseATexto(fase: string | null): { estado: string; accion: string } {
  switch (fase) {
    case 'saludo':
      return { estado: 'Recién llegó, bot respondiendo', accion: '' }
    case 'programa':
      return { estado: 'Explorando programas', accion: '' }
    case 'correo':
      return { estado: 'Bot pidiendo correo', accion: '' }
    case 'info_enviada':
      return { estado: 'Info enviada, sin respuesta 📵', accion: '👉 Considera llamarle' }
    case 'accion':
      return { estado: 'Revisando la info', accion: '👉 Puede responder pronto' }
    case 'dudas':
      return { estado: 'Tiene dudas activas 💬', accion: '👉 Bot en conversación' }
    case 'inscripcion':
      return { estado: 'Solicitó inscripción 🔥', accion: '👉 Listo para cerrar' }
    case 'clase_prueba':
      return { estado: 'Quiere clase de prueba 🔥', accion: '👉 Agéndala hoy' }
    case 'seguimiento':
      return { estado: 'Bot en seguimiento', accion: '👉 Esperando respuesta' }
    case 'asesor':
      return { estado: 'Pidió hablar con asesor 👋', accion: '👉 Te está esperando, llámale' }
    case 'perdido':
      return { estado: 'No interesado por ahora', accion: '' }
    case 'cerrado':
      return { estado: 'Conversación cerrada', accion: '' }
    default:
      return { estado: 'En conversación', accion: '' }
  }
}

export async function GET(request: Request) {
  return POST(request)
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const ahora = new Date()
  const hace15 = new Date(ahora.getTime() - MINUTOS_ESPERA * 60 * 1000).toISOString()
  const hace25 = new Date(ahora.getTime() - VENTANA_MAX_MIN * 60 * 1000).toISOString()

  // Leads creados hace 15-25 min
  const { data: leads } = await supabase
    .from('leads')
    .select('id, nombre, curso, whatsapp')
    .gte('created_at', hace25)
    .lte('created_at', hace15)

  if (!leads?.length) {
    return Response.json({ ok: true, procesados: 0 })
  }

  const resultados: { lead_id: string; accion: string }[] = []

  for (const lead of leads) {
    // Verificar que no se haya enviado ya la alerta
    const { data: alertaExistente } = await supabase
      .from('lead_activities')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('event_type', 'alerta_admin_enviada')
      .maybeSingle()

    if (alertaExistente) {
      resultados.push({ lead_id: lead.id, accion: 'omitido — alerta ya enviada' })
      continue
    }

    // Obtener estado actual de la conversación
    const { data: conv } = await supabase
      .from('whatsapp_conversaciones')
      .select('fase, modo_humano')
      .eq('lead_id', lead.id)
      .order('ultimo_mensaje_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { estado, accion } = faseATexto(conv?.fase ?? null)
    const nombre = lead.nombre?.trim() || 'Sin nombre'
    const programa = lead.curso?.trim() || 'Programa pendiente'
    const telefono = lead.whatsapp?.replace(/\D/g, '').replace(/^52/, '') || ''

    const lineas = [
      '*🆕 Nuevo lead — Windsor*',
      '',
      `👤 ${nombre}`,
      `📚 ${programa}`,
      telefono ? `📱 ${telefono}` : null,
      '',
      `💬 *Estado:* ${estado}`,
      accion || null,
    ].filter((l): l is string => l !== null)

    try {
      await sendMetaWhatsAppMessage({ to: ADMIN_WHATSAPP, body: lineas.join('\n') })

      // Marcar alerta como enviada en lead_activities
      await supabase.from('lead_activities').insert([{
        lead_id: lead.id,
        actor_id: null,
        event_type: 'alerta_admin_enviada',
        title: 'Alerta admin enviada',
        detail: `Estado: ${estado}`,
        meta: { fase: conv?.fase, enviado_a: ADMIN_WHATSAPP },
      }])

      resultados.push({ lead_id: lead.id, accion: 'alerta_enviada' })
    } catch (e) {
      resultados.push({ lead_id: lead.id, accion: `error: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return Response.json({ ok: true, procesados: resultados.length, resultados })
}
