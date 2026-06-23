import twilio from 'twilio'
import { createServiceRoleClient } from '@/utils/supabase/server'
import {
  getTwilioConfig,
  getWhatsAppProvider,
  normalizePhoneNumber,
  sendMetaWhatsAppMessage,
  sendMetaWhatsAppTemplate,
  type WhatsAppProvider,
} from '@/lib/whatsapp/provider'
import {
  DIAS_SILENCIO_POR_ETAPA,
  esTrackA,
  HORAS_MIN_ENTRE_INTENTOS,
  normalizarEtapaReactivacion,
  obtenerMensajeReactivacion,
  obtenerMensajeReactivacion20h,
  type ReactivationStageKey,
} from '@/lib/whatsapp/reactivacion-messages'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function esNombreValido(nombre: string | null | undefined): boolean {
  const n = (nombre || '').trim()
  if (!n || n.length < 2 || n.length > 50) return false
  if (n.split(/\s+/).length > 4) return false
  if (/[¿?¡!,;]/.test(n)) return false
  if (!/^[\p{L}\s'\-]+$/u.test(n)) return false
  return true
}

const STAGES_PARA_BUSCAR = [
  'primer_contacto',
  'contactado',
  'examen_ubicacion',
  'clase_muestra',
  'segundo_contacto',
  'seguimiento',
  'promocion_enviada',
  'promo_enviada',
  'inscripcion_pendiente',
  'tercer_contacto',
]

type ConvRow = {
  id: string
  provider: string | null
  ultimo_mensaje_at: string | null
  whatsapp: string
}

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7).trim() === secret
  }
  const h = request.headers.get('x-cron-secret')
  return h === secret
}

function msDesde(fecha: Date): number {
  return Date.now() - fecha.getTime()
}

function diasDesde(fecha: Date): number {
  return msDesde(fecha) / (24 * 60 * 60 * 1000)
}

async function enviarWhatsApp(
  to: string,
  body: string,
  provider: WhatsAppProvider,
  templateName?: string,
  templateParams?: string[]
): Promise<void> {
  const normalized = normalizePhoneNumber(to)
  if (provider === 'meta') {
    // Usar template si está disponible (mensajes fuera de ventana 24h)
    if (templateName && templateParams) {
      await sendMetaWhatsAppTemplate({ to: normalized, templateName, parameters: templateParams })
    } else {
      await sendMetaWhatsAppMessage({ to: normalized, body })
    }
    return
  }
  const { accountSid, authToken, fromNumber } = getTwilioConfig()
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('Faltan variables de entorno de Twilio')
  }
  const client = twilio(accountSid, authToken)
  const from = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`
  const toFormatted = `whatsapp:${normalized.replace(/^whatsapp:/i, '')}`
  await client.messages.create({ from, to: toFormatted, body })
}

function getTemplatePorEtapa(etapa: string, intento: number): string {
  if (etapa === 'inscripcion_pendiente') return 'windsor_inscripcion_pendiente_'
  if (intento === 2) return 'windsor_promocion'
  return 'seguimiento_general'
}

const HORAS_REACTIVACION_BOT = 20
const HORAS_VENTANA_MAX = 28 // ventana ampliada para cron diario (puede haber hasta 28h de silencio)

async function reactivarConversacionesBot(
  supabase: ReturnType<typeof createServiceRoleClient>,
  defaultProvider: WhatsAppProvider
): Promise<{ conversacion_id: string; accion: string; detalle?: string }[]> {
  const resultados: { conversacion_id: string; accion: string; detalle?: string }[] = []

  // Buscar conversaciones abiertas del bot con silencio entre 20 y 23 horas
  const ahora = new Date()
  const limiteMin = new Date(ahora.getTime() - HORAS_VENTANA_MAX * 60 * 60 * 1000).toISOString()
  const limiteMax = new Date(ahora.getTime() - HORAS_REACTIVACION_BOT * 60 * 60 * 1000).toISOString()

  const { data: conversaciones } = await supabase
    .from('whatsapp_conversaciones')
    .select('id, whatsapp, lead_id, fase, provider, ultimo_mensaje_at')
    .eq('estado', 'abierta')
    .eq('modo_humano', false)
    .gte('ultimo_mensaje_at', limiteMin)
    .lte('ultimo_mensaje_at', limiteMax)
    .not('fase', 'in', '("cerrado","perdido","seguimiento","inscrito")')

  for (const conv of conversaciones || []) {
    // Messenger no tiene templates pre-aprobados como WhatsApp — no encolar reactivación automática
    if (conv.provider === 'messenger') {
      resultados.push({ conversacion_id: conv.id, accion: 'omitido', detalle: 'canal messenger sin reactivación automática' })
      continue
    }

    // Verificar que el último mensaje fue del bot (usuario dejó de responder)
    const { data: ultimoMsg } = await supabase
      .from('whatsapp_mensajes')
      .select('rol')
      .eq('conversacion_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!ultimoMsg || ultimoMsg.rol !== 'bot') {
      resultados.push({ conversacion_id: conv.id, accion: 'omitido', detalle: 'último mensaje no es del bot' })
      continue
    }

    // Verificar que no se haya enviado ya una reactivación reciente (via reactivacion_intentos)
    if (conv.lead_id) {
      const { data: intentoReciente } = await supabase
        .from('reactivacion_intentos')
        .select('id')
        .eq('lead_id', conv.lead_id)
        .gte('enviado_at', limiteMin)
        .limit(1)
        .maybeSingle()
      if (intentoReciente) {
        resultados.push({ conversacion_id: conv.id, accion: 'omitido', detalle: 'reactivación ya registrada' })
        continue
      }
    }

    // Obtener nombre del lead y encolar (no enviar)
    if (conv.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('nombre, curso, stage')
        .eq('id', conv.lead_id)
        .maybeSingle()
      const rawNombre = lead?.nombre?.trim() || ''
      const nombre = esNombreValido(rawNombre) ? rawNombre : 'ahí'
      const trackA = esTrackA(lead?.curso)
      const mensaje = obtenerMensajeReactivacion20h(conv.fase || 'accion', trackA, nombre)

      const stageFinal = (lead?.stage === 'primer_contacto' || lead?.stage === 'contactado')
        ? 'segundo_contacto'
        : (lead?.stage || 'segundo_contacto')
      const etapaCanon20h = normalizarEtapaReactivacion(stageFinal)

      // Verificar que no haya ya un mensaje pendiente para este lead
      const { data: yaPendiente } = await supabase
        .from('mensajes_pendientes')
        .select('id')
        .eq('lead_id', conv.lead_id)
        .eq('estado', 'pendiente')
        .limit(1)
        .maybeSingle()

      if (yaPendiente) {
        resultados.push({ conversacion_id: conv.id, accion: 'omitido', detalle: 'ya tiene mensaje pendiente' })
        continue
      }

      const { error: insertErr } = await supabase.from('mensajes_pendientes').insert([{
        lead_id: conv.lead_id,
        conversacion_id: conv.id,
        whatsapp: conv.whatsapp,
        nombre,
        curso: lead?.curso || null,
        stage: lead?.stage || null,
        etapa: etapaCanon20h,
        intento: 1,
        template_name: 'seguimiento_general',
        template_params: [nombre],
        mensaje,
      }])

      if (insertErr) {
        resultados.push({ conversacion_id: conv.id, accion: 'error', detalle: insertErr.message })
      } else {
        resultados.push({ conversacion_id: conv.id, accion: 'encolado_20h' })
      }
    } else {
      resultados.push({ conversacion_id: conv.id, accion: 'omitido', detalle: 'sin lead_id' })
    }
  }

  return resultados
}

const HORAS_TERCER_CONTACTO = 24

async function moverATercerContacto(
  supabase: ReturnType<typeof createServiceRoleClient>,
  defaultProvider: WhatsAppProvider
): Promise<{ lead_id: string; accion: string; detalle?: string }[]> {
  const resultados: { lead_id: string; accion: string; detalle?: string }[] = []

  const hace24h = new Date(Date.now() - HORAS_TERCER_CONTACTO * 60 * 60 * 1000).toISOString()

  // Buscar leads en segundo_contacto cuya última reactivación fue hace más de 24h sin respuesta del usuario
  const { data: leads } = await supabase
    .from('leads')
    .select('id, nombre, whatsapp, curso, asignado_a')
    .eq('stage', 'segundo_contacto')
    .not('whatsapp', 'is', null)

  for (const lead of leads || []) {
    // Buscar conversación activa
    const { data: conv } = await supabase
      .from('whatsapp_conversaciones')
      .select('id, provider, whatsapp')
      .eq('lead_id', lead.id)
      .eq('estado', 'abierta')
      .order('ultimo_mensaje_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!conv) {
      resultados.push({ lead_id: lead.id, accion: 'omitido', detalle: 'sin conversación activa' })
      continue
    }

    // Verificar que el último intento de reactivación fue hace más de 24h
    const { data: ultimaReactivacion } = await supabase
      .from('reactivacion_intentos')
      .select('enviado_at')
      .eq('lead_id', lead.id)
      .order('enviado_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!ultimaReactivacion || ultimaReactivacion.enviado_at > hace24h) {
      resultados.push({ lead_id: lead.id, accion: 'omitido', detalle: 'reactivación reciente o sin reactivación' })
      continue
    }

    // Verificar que el usuario no respondió después de la reactivación
    const { data: respuestaUsuario } = await supabase
      .from('whatsapp_mensajes')
      .select('id')
      .eq('conversacion_id', conv.id)
      .eq('rol', 'usuario')
      .gt('created_at', ultimaReactivacion.enviado_at)
      .limit(1)
      .maybeSingle()

    if (respuestaUsuario) {
      resultados.push({ lead_id: lead.id, accion: 'omitido', detalle: 'usuario respondió después de la reactivación' })
      continue
    }

    // Mover a tercer_contacto
    await supabase.from('leads').update({ stage: 'tercer_contacto' }).eq('id', lead.id)

    // Registrar en lead_activities
    await supabase.from('lead_activities').insert([{
      lead_id: lead.id,
      actor_id: null,
      event_type: 'tercer_contacto',
      title: '📲 Lead sin respuesta — requiere contacto manual',
      detail: `Sin respuesta tras reactivación automática. Requiere intervención del asesor.`,
      meta: { source: 'cron_reactivacion' },
    }])

    // Notificar al asesor asignado por WhatsApp
    if (lead.asignado_a) {
      const { data: perfil } = await supabase
        .from('profiles')
        .select('whatsapp, nombre')
        .eq('id', lead.asignado_a)
        .maybeSingle()

      const asesorWhatsapp = perfil?.whatsapp as string | null
      if (asesorWhatsapp) {
        const nombre = lead.nombre?.trim() || 'Sin nombre'
        const programa = lead.curso || ''
        const msgAsesor = [
          '📲 Lead sin respuesta — contacto manual requerido',
          `👤 ${nombre}`,
          programa ? `📚 ${programa}` : null,
          `📱 ${lead.whatsapp}`,
          'El bot ya intentó reactivarlo. Por favor contáctalo directamente.',
        ].filter(Boolean).join('\n')

        const provider = (conv.provider as WhatsAppProvider | null) || defaultProvider
        try {
          await enviarWhatsApp(asesorWhatsapp, msgAsesor, provider)
        } catch (e) {
          console.error('[moverATercerContacto] notificación asesor', e)
        }
      }
    }

    resultados.push({ lead_id: lead.id, accion: 'movido_a_tercer_contacto' })
  }

  return resultados
}

export async function GET(request: Request) {
  return POST(request)
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'CRON_SECRET no configurado en el servidor' },
      { status: 500 }
    )
  }

  const supabase = createServiceRoleClient()
  const defaultProvider = getWhatsAppProvider()

  // Reactivación bot a las 20h (dentro de ventana WhatsApp)
  const resultadosBot = await reactivarConversacionesBot(supabase, defaultProvider)

  // Mover a tercer_contacto leads sin respuesta tras 24h en segundo_contacto
  const resultadosTercer = await moverATercerContacto(supabase, defaultProvider)

  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('id, nombre, whatsapp, curso, stage')
    .in('stage', STAGES_PARA_BUSCAR)
    .not('whatsapp', 'is', null)

  if (leadsError) {
    return Response.json({ error: leadsError.message }, { status: 500 })
  }

  const resultados: {
    lead_id: string
    accion: 'omitido' | 'enviado_intento_1' | 'enviado_intento_2' | 'encolado_intento_1' | 'encolado_intento_2' | 'archivado' | 'error'
    detalle?: string
  }[] = []

  for (const lead of leads || []) {
    const etapaCanon = normalizarEtapaReactivacion(lead.stage)
    if (!etapaCanon || !DIAS_SILENCIO_POR_ETAPA[etapaCanon]) {
      resultados.push({ lead_id: lead.id, accion: 'omitido', detalle: 'etapa no reactivable' })
      continue
    }

    const diasUmbral = DIAS_SILENCIO_POR_ETAPA[etapaCanon]
    let conv: ConvRow | null = null

    const { data: convByLead } = await supabase
      .from('whatsapp_conversaciones')
      .select('id, provider, ultimo_mensaje_at, whatsapp')
      .eq('lead_id', lead.id)
      .order('ultimo_mensaje_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (convByLead?.id) {
      conv = convByLead as ConvRow
    } else if (lead.whatsapp) {
      const w = normalizePhoneNumber(lead.whatsapp)
      const { data: convWa } = await supabase
        .from('whatsapp_conversaciones')
        .select('id, provider, ultimo_mensaje_at, whatsapp')
        .eq('whatsapp', w)
        .order('ultimo_mensaje_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (convWa?.id) conv = convWa as ConvRow
    }

    const conversacionId = conv?.id

    if (!conversacionId || !conv) {
      resultados.push({ lead_id: lead.id, accion: 'omitido', detalle: 'sin conversación WhatsApp' })
      continue
    }

    const { data: ultimoUsuario } = await supabase
      .from('whatsapp_mensajes')
      .select('created_at')
      .eq('conversacion_id', conversacionId)
      .eq('rol', 'usuario')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const ultimoUsuarioAt = ultimoUsuario?.created_at
      ? new Date(ultimoUsuario.created_at as string)
      : null
    const referenciaSilencio =
      ultimoUsuarioAt || (conv.ultimo_mensaje_at ? new Date(conv.ultimo_mensaje_at) : null)

    if (!referenciaSilencio) {
      resultados.push({ lead_id: lead.id, accion: 'omitido', detalle: 'sin fecha de referencia' })
      continue
    }

    if (diasDesde(referenciaSilencio) < diasUmbral) {
      resultados.push({ lead_id: lead.id, accion: 'omitido', detalle: 'silencio dentro del umbral' })
      continue
    }

    const { data: intentosRows } = await supabase
      .from('reactivacion_intentos')
      .select('intento, enviado_at')
      .eq('lead_id', lead.id)
      .eq('etapa', etapaCanon)
      .order('intento', { ascending: true })

    const intentos = intentosRows || []
    const maxIntento = intentos.length ? Math.max(...intentos.map((i) => i.intento)) : 0

    // Evitar doble envío si el pipeline 20h ya envió un intento reciente (guarda con etapa distinta)
    if (intentos.length === 0) {
      const { data: intentoRecienteAny } = await supabase
        .from('reactivacion_intentos')
        .select('enviado_at')
        .eq('lead_id', lead.id)
        .order('enviado_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (intentoRecienteAny?.enviado_at) {
        const horasDesde = msDesde(new Date(intentoRecienteAny.enviado_at as string)) / (60 * 60 * 1000)
        if (horasDesde < HORAS_MIN_ENTRE_INTENTOS) {
          resultados.push({ lead_id: lead.id, accion: 'omitido', detalle: 'intento reciente (otra etapa)' })
          continue
        }
      }
    }

    if (intentos.length >= 2) {
      await supabase.from('leads').update({ stage: 'archivado' }).eq('id', lead.id)
      await supabase.from('lead_activities').insert([
        {
          lead_id: lead.id,
          actor_id: null,
          event_type: 'reactivacion_archivado',
          title: 'Lead archivado',
          detail: 'Dos intentos de reactivación sin respuesta en la etapa actual.',
          meta: { etapa: etapaCanon, motivo: 'reactivacion' },
        },
      ])
      resultados.push({ lead_id: lead.id, accion: 'archivado' })
      continue
    }

    const siguienteIntento = (maxIntento + 1) as 1 | 2
    if (siguienteIntento > 2) {
      resultados.push({ lead_id: lead.id, accion: 'omitido', detalle: 'intento inválido' })
      continue
    }

    if (siguienteIntento === 2) {
      const primero = intentos.find((i) => i.intento === 1)
      if (!primero?.enviado_at) {
        resultados.push({ lead_id: lead.id, accion: 'omitido', detalle: 'falta intento 1' })
        continue
      }
      const horasDesdePrimero =
        msDesde(new Date(primero.enviado_at as string)) / (60 * 60 * 1000)
      if (horasDesdePrimero < HORAS_MIN_ENTRE_INTENTOS) {
        resultados.push({
          lead_id: lead.id,
          accion: 'omitido',
          detalle: `espera entre intentos (${HORAS_MIN_ENTRE_INTENTOS}h)`,
        })
        continue
      }
    }

    const rawNombrePipeline = lead.nombre?.trim() || ''
    const nombre = esNombreValido(rawNombrePipeline) ? rawNombrePipeline : 'ahí'
    const trackA = esTrackA(lead.curso)
    const mensaje = obtenerMensajeReactivacion(etapaCanon, siguienteIntento, trackA, nombre)
    const templateName = getTemplatePorEtapa(etapaCanon, siguienteIntento)
    const to = conv.whatsapp || lead.whatsapp

    // Verificar que no haya ya un mensaje pendiente para este lead
    const { data: yaPendiente } = await supabase
      .from('mensajes_pendientes')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('estado', 'pendiente')
      .limit(1)
      .maybeSingle()

    if (yaPendiente) {
      resultados.push({ lead_id: lead.id, accion: 'omitido', detalle: 'ya tiene mensaje pendiente' })
      continue
    }

    const { error: insertErr } = await supabase.from('mensajes_pendientes').insert([{
      lead_id: lead.id,
      conversacion_id: conversacionId,
      whatsapp: to!,
      nombre,
      curso: lead.curso || null,
      stage: lead.stage || null,
      etapa: etapaCanon,
      intento: siguienteIntento,
      template_name: templateName,
      template_params: [nombre],
      mensaje,
    }])

    if (insertErr) {
      resultados.push({ lead_id: lead.id, accion: 'error', detalle: insertErr.message })
    } else {
      resultados.push({
        lead_id: lead.id,
        accion: siguienteIntento === 1 ? 'encolado_intento_1' : 'encolado_intento_2',
      })
    }
  }

  return Response.json({
    ok: true,
    procesados: resultados.length + resultadosBot.length + resultadosTercer.length,
    reactivacion_bot_20h: resultadosBot,
    tercer_contacto: resultadosTercer,
    reactivacion_pipeline: resultados,
  })
}
