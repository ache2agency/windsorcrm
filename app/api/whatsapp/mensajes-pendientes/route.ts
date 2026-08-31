import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import {
  normalizePhoneNumber,
  sendMetaWhatsAppTemplate,
  sendMetaWhatsAppMessage,
  getWhatsAppProvider,
  type WhatsAppProvider,
} from '@/lib/whatsapp/provider'

export const dynamic = 'force-dynamic'

function isAdmin(request: Request): boolean {
  // Misma lógica que el resto del CRM — cualquier usuario autenticado con service role puede operar
  return true
}

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  const supabase = createServiceRoleClient()

  let leadIdsPermitidos: string[] | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('rol')
      .eq('id', user.id)
      .maybeSingle()

    const esAdmin = profile?.rol === 'admin'

    if (!esAdmin) {
      const { data: leadsAsignados } = await supabase
        .from('leads')
        .select('id')
        .eq('asignado_a', user.id)
      leadIdsPermitidos = (leadsAsignados || []).map(l => l.id)
    }
  }

  let query = supabase
    .from('mensajes_pendientes')
    .select('*')
    .eq('estado', 'pendiente')
    .order('creado_at', { ascending: true })

  if (leadIdsPermitidos !== null) {
    if (leadIdsPermitidos.length === 0) {
      return Response.json({ mensajes: [] })
    }
    query = query.in('lead_id', leadIdsPermitidos)
  }

  const { data, error } = await query

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const mensajes = data || []
  const convIds = [...new Set(mensajes.map(m => m.conversacion_id).filter(Boolean))]

  const ultimosMensajesUsuario: Record<string, { at: string; contenido: string }> = {}

  if (convIds.length > 0) {
    const { data: userMsgs } = await supabase
      .from('whatsapp_mensajes')
      .select('conversacion_id, created_at, contenido')
      .in('conversacion_id', convIds)
      .eq('rol', 'usuario')
      .order('created_at', { ascending: false })

    for (const msg of userMsgs || []) {
      if (!ultimosMensajesUsuario[msg.conversacion_id]) {
        ultimosMensajesUsuario[msg.conversacion_id] = {
          at: msg.created_at,
          contenido: msg.contenido,
        }
      }
    }
  }

  const ahora = Date.now()
  const enriquecidos = mensajes.map(m => {
    const ultimoAt = ultimosMensajesUsuario[m.conversacion_id]?.at || null
    const enVentana = ultimoAt ? (ahora - new Date(ultimoAt).getTime()) < 24 * 60 * 60 * 1000 : false
    return {
      ...m,
      ultimo_usuario_at: ultimoAt,
      ultimo_usuario_msg: ultimosMensajesUsuario[m.conversacion_id]?.contenido || null,
      en_ventana_24h: enVentana,
    }
  })

  return Response.json({ mensajes: enriquecidos })
}

export async function POST(request: Request) {
  const supabase = createServiceRoleClient()
  const body = await request.json()
  const { id, accion, mensaje_editado } = body

  if (!id || !['enviar', 'descartar'].includes(accion)) {
    return Response.json({ error: 'Parámetros inválidos' }, { status: 400 })
  }

  const { data: msg, error: fetchError } = await supabase
    .from('mensajes_pendientes')
    .select('*')
    .eq('id', id)
    .eq('estado', 'pendiente')
    .maybeSingle()

  if (fetchError || !msg) {
    return Response.json({ error: 'Mensaje no encontrado' }, { status: 404 })
  }

  if (accion === 'descartar') {
    await supabase
      .from('mensajes_pendientes')
      .update({ estado: 'descartado', procesado_at: new Date().toISOString() })
      .eq('id', id)
    return Response.json({ ok: true, accion: 'descartado' })
  }

  // Enviar
  const textoFinal = (mensaje_editado || msg.mensaje).trim()
  const provider = getWhatsAppProvider()
  const to = normalizePhoneNumber(msg.whatsapp)

  // Guard defensivo: Messenger no tiene templates pre-aprobados, este endpoint solo sabe mandar vía Meta/Twilio
  if (msg.conversacion_id) {
    const { data: convCheck } = await supabase
      .from('whatsapp_conversaciones')
      .select('provider')
      .eq('id', msg.conversacion_id)
      .maybeSingle()
    if ((convCheck as { provider?: string } | null)?.provider === 'messenger') {
      return Response.json({ error: 'Mensaje pendiente de canal Messenger — no se puede enviar como template de WhatsApp' }, { status: 400 })
    }
  }

  try {
    let textoParaHistorial = textoFinal
    if (msg.template_name && !mensaje_editado) {
      // Obtener params — si no hay en BD, construir con nombre del lead
      let params: string[]
      if (msg.template_params) {
        params = Array.isArray(msg.template_params) ? msg.template_params : JSON.parse(msg.template_params)
      } else {
        const primerNombre = (msg.nombre || '').trim().split(/\s+/)[0] || 'amig@'
        params = [primerNombre]
      }
      await sendMetaWhatsAppTemplate({ to, templateName: msg.template_name, parameters: params })
      // Guardar historial con nombre sustituido (no {{nombre}} literal)
      textoParaHistorial = textoFinal
        .replace('{{nombre}}', params[0] || '')
        .replace('{{1}}', params[0] || '')
    } else {
      // Si el texto crudo tiene {{nombre}} sin sustituir, reemplazarlo antes de enviar
      const primerNombre = (msg.nombre || '').trim().split(/\s+/)[0] || 'amig@'
      textoParaHistorial = textoFinal
        .replace('{{nombre}}', primerNombre)
        .replace('{{1}}', primerNombre)
      await sendMetaWhatsAppMessage({ to, body: textoParaHistorial })
    }

    // Guardar en historial de conversación
    if (msg.conversacion_id) {
      await supabase.from('whatsapp_mensajes').insert([{
        conversacion_id: msg.conversacion_id,
        rol: 'bot',
        contenido: textoParaHistorial,
      }])
      // Si la conv estaba en una fase inicial, avanzarla a 'accion' para que no reaparezca como "sin info"
      const FASES_INICIALES = ['saludo', 'programa', 'correo', 'verano_disambig']
      const { data: convActual } = await supabase
        .from('whatsapp_conversaciones')
        .select('fase')
        .eq('id', msg.conversacion_id)
        .maybeSingle()
      const faseActual = (convActual as { fase?: string } | null)?.fase || ''
      const nuevaFase = FASES_INICIALES.includes(faseActual) ? 'accion' : faseActual
      await supabase
        .from('whatsapp_conversaciones')
        .update({ ultimo_mensaje_at: new Date().toISOString(), fase: nuevaFase })
        .eq('id', msg.conversacion_id)
    }

    // Registrar intento para no re-procesar
    if (msg.lead_id && msg.etapa && msg.intento) {
      await supabase.from('reactivacion_intentos').insert([{
        lead_id: msg.lead_id,
        etapa: msg.etapa,
        intento: msg.intento,
        enviado_at: new Date().toISOString(),
      }])
    }

    await supabase
      .from('mensajes_pendientes')
      .update({ estado: 'enviado', procesado_at: new Date().toISOString() })
      .eq('id', id)

    return Response.json({ ok: true, accion: 'enviado' })
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
