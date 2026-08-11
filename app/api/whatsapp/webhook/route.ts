import { createServiceRoleClient } from '@/utils/supabase/server'
import {
  getMetaConfig,
  getWhatsAppProvider,
  normalizePhoneNumber,
  sendMessengerMessage,
  sendMetaWhatsAppMessage,
  type WhatsAppProvider,
} from '@/lib/whatsapp/provider'
import { enviarBienvenidaLeadManual } from '@/lib/whatsapp/bienvenida'
import {
  quitarAcentos,
  matchOfertaEducativa,
  canonicalizarPrograma,
  esHabilidadesPsico,
  esLicenciatura,
  esVeranoOCorto,
  esBachillerato,
  esDiplomado,
  esInglesIdioma,
  tipoInscripcion,
  detectarPrograma,
  type TipoInscripcion,
  type OfertaMatchResult,
} from '@/lib/whatsapp/programas'
import { REGLAS_NEGOCIO } from '@/lib/whatsapp/reglasNegocio'

export const maxDuration = 60

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildTwiml(message: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'text/xml',
    },
  })
}

type IncomingWhatsAppMessage = {
  provider: WhatsAppProvider
  body: string
  from: string
  waNumber: string
  profileName: string
  messageSid?: string
  rawPayload: Record<string, unknown>
  referral?: Record<string, unknown>
  mediaKind?: 'audio' | 'image'
  mediaId?: string
}

const ADMIN_WA_ALERTA = '527471028306'

async function alertarAdminNuevoLead(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  leadId: string,
  fase: string
): Promise<void> {
  // Solo disparar una vez por lead
  const { data: yaEnviada } = await supabase
    .from('lead_activities')
    .select('id')
    .eq('lead_id', leadId)
    .eq('event_type', 'alerta_admin_enviada')
    .maybeSingle()
  if (yaEnviada) return

  const { data: lead } = await supabase
    .from('leads')
    .select('nombre, curso, whatsapp')
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) return

  const faseTextos: Record<string, { estado: string; accion: string }> = {
    accion:               { estado: 'Info enviada, revisando 👀',       accion: '👉 Puede responder pronto' },
    dudas:                { estado: 'Tiene dudas activas 💬',            accion: '👉 Bot en conversación' },
    inscripcion:          { estado: 'Solicitó inscripción 🔥',           accion: '👉 Listo para cerrar' },
    clase_prueba:         { estado: 'Quiere clase de prueba 🔥',         accion: '👉 Agéndala hoy' },
    asesor:               { estado: 'Pidió hablar con asesor 👋',        accion: '👉 Te está esperando, llámale' },
    info_enviada:         { estado: 'Info enviada, sin respuesta 📵',    accion: '👉 Considera llamarle' },
    seguimiento:          { estado: 'Bot en seguimiento',                accion: '👉 Esperando respuesta' },
  }
  const { estado, accion } = faseTextos[fase] ?? { estado: 'En conversación', accion: '' }
  const nombre = lead.nombre?.trim() || 'Sin nombre'
  const programa = lead.curso?.trim() || 'Programa pendiente'
  const telefono = (lead.whatsapp || '').replace(/\D/g, '').replace(/^52/, '')

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
    await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: lineas.join('\n') })
    await supabase.from('lead_activities').insert([{
      lead_id: leadId,
      actor_id: null,
      event_type: 'alerta_admin_enviada',
      title: 'Alerta admin enviada',
      detail: `Estado: ${estado}`,
      meta: { fase, enviado_a: ADMIN_WA_ALERTA },
    }])
  } catch (e) {
    console.error('[alertarAdminNuevoLead]', e)
  }
}

async function logBotMessageAndUpdateFase(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  conversacionId: string,
  message: string,
  nextFase?: string,
  leadId?: string | null
) {
  await supabase.from('whatsapp_mensajes').insert([
    { conversacion_id: conversacionId, rol: 'bot', contenido: message },
  ])
  const update: { ultimo_mensaje_at: string; fase?: string; estado?: string } = {
    ultimo_mensaje_at: new Date().toISOString(),
  }
  if (nextFase) update.fase = nextFase
  if (nextFase === 'cerrado' || nextFase === 'perdido') {
    update.estado = 'cerrada'
  } else if (nextFase) {
    update.estado = 'abierta'
  }
  await supabase
    .from('whatsapp_conversaciones')
    .update(update)
    .eq('id', conversacionId)

  // Alerta al admin cuando el bot envía la info por primera vez a un lead nuevo
  if (leadId && nextFase && ['accion', 'inscripcion', 'clase_prueba', 'asesor'].includes(nextFase)) {
    alertarAdminNuevoLead(supabase, leadId, nextFase).catch(() => {})
  }

  // Mover stage del lead automáticamente según la fase del bot
  if (leadId && nextFase) {
    const FASE_A_STAGE: Record<string, string> = {
      accion:       'primer_contacto',
      examen:       'examen_ubicacion',
      clase_prueba: 'clase_muestra',
      inscripcion:  'inscripcion_pendiente',
    }
    const nuevoStage = FASE_A_STAGE[nextFase]
    if (nuevoStage) {
      // Para primer_contacto solo asignar si el lead no tiene stage aún
      // Para las demás fases, siempre avanzar (no retroceder)
      const ORDEN_STAGES = ['primer_contacto', 'examen_ubicacion', 'clase_muestra', 'inscripcion_pendiente', 'inscrito']
      if (nuevoStage === 'primer_contacto') {
        await supabase.from('leads').update({ stage: nuevoStage }).eq('id', leadId).is('stage', null)
      } else {
        const { data: lead } = await supabase.from('leads').select('stage').eq('id', leadId).maybeSingle()
        const posActual = ORDEN_STAGES.indexOf(lead?.stage || '')
        const posNuevo = ORDEN_STAGES.indexOf(nuevoStage)
        if (posNuevo > posActual) {
          await supabase.from('leads').update({ stage: nuevoStage }).eq('id', leadId)
        }
      }
    }
  }
}

type ConversationRow = {
  id: string
  modo_humano?: boolean | null
  fase?: string | null
}

type FlowRule = {
  match?: string | null
  contains?: string | null
  answer?: string | null
  response?: string | null
  use_rag?: boolean | null
  type?: string | null
}

type FlowConfig = {
  rules?: FlowRule[] | null
}

type LeadSnapshot = {
  id?: string
  nombre?: string | null
  email?: string | null
  curso?: string | null
  stage?: string | null
  whatsapp?: string | null
}

const AGENDAR_BASE = 'https://crm.windsor.edu.mx/agendar/hola@windsor.edu.mx'

function buildAgendarLink(tipo: string, nombre?: string | null, email?: string | null, programa?: string | null, telefono?: string | null): string {
  const p = new URLSearchParams({ tipo })
  if (nombre) p.set('nombre', nombre)
  if (email) p.set('email', email)
  if (programa) p.set('programa', programa)
  if (telefono) p.set('telefono', telefono)
  return `${AGENDAR_BASE}?${p.toString()}`
}
const BOT_SIGNATURE = 'Instituto Windsor'

function hasLeadName(nombre: string | null | undefined, whatsapp: string | null | undefined) {
  let value = String(nombre || '').trim()
  // Normalizar: abreviaciones con punto (Ma. → Ma, Dr. → Dr) y punto final
  value = value.replace(/\b([A-ZÁÉÍÓÚ]{1,3})\.\s*/g, '$1 ').replace(/\.\s*$/, '').trim()
  if (!value || value.length < 2) return false
  if (value === String(whatsapp || '').trim()) return false
  if (/@/.test(value)) return false
  // Rechazar si tiene más de 4 palabras (nombres reales tienen máx 4)
  if (value.split(/\s+/).length > 4) return false
  // Rechazar si contiene dígitos
  if (/\d/.test(value)) return false
  // Rechazar si contiene signos de puntuación o interrogación (es una frase)
  if (/[¿?¡!,;:.\/\\]/.test(value)) return false
  // Rechazar si contiene emojis o caracteres no válidos en un nombre
  if (!/^[\p{L}\s'\-]+$/u.test(value)) return false
  // Rechazar palabras que claramente no son nombres propios
  const noNombres = /^(hola|buenas?|buen|d[ií]a|tardes?|noches?|info|informaci[oó]n|costos?|precios?|horarios?|quiero|quisiera|necesito|ayuda|gracias|ok|s[ií]|no|nada|nope|oye|hey|buenos|saludos|permiso|disculp|por\s+favor|favor|buen[oa]s?\s+d[ií]as?|buen[oa]s?\s+tardes?|buen[oa]s?\s+noches?)$/i
  if (noNombres.test(value.trim())) return false
  return true
}

function hasLeadEmail(email: string | null | undefined) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

function detectarPreguntaDireccion(msg: string): boolean {
  return /d[oó]nde (est[aá]n?|queda|se encuentra[n]?|los encuentro|quedan?)|cu[aá]l es la direcci[oó]n|direcci[oó]n|c[oó]mo llego|c[oó]mo llegar|d[oó]nde (los|les|te) encuentr|ubicaci[oó]n.*(plantel|instala|escuela|curso)|plantel.*(ubicaci[oó]n|d[oó]nde|c[oó]mo llegar)|ir a.*(pagar|pago|inscrib|plantel|instala)|visitar.*(plantel|instala|escuela)/i.test(msg)
}

function hasLeadProgram(curso: string | null | undefined) {
  const value = String(curso || '').trim().toLowerCase()
  return !!value && value !== 'whatsapp - instituto windsor' && value !== 'messenger - instituto windsor'
}

function getNextDataPhase(lead: LeadSnapshot | null | undefined, whatsapp: string) {
  if (!hasLeadName(lead?.nombre, whatsapp)) return 'saludo'
  if (!hasLeadProgram(lead?.curso)) return 'programa'
  if (!hasLeadEmail(lead?.email)) return 'correo'
  return 'info_enviada'
}

function getStageForPhase(phase: string | null | undefined) {
  switch (phase) {
    case 'saludo':
      return 'contactado'
    case 'programa':
    case 'correo':
      return 'contactado'
    case 'info_enviada':
    case 'dudas':
    case 'accion':
    case 'seguimiento':
    case 'convenios':
      return 'interesado'
    case 'cerrado':
      return 'cerrado'
    case 'perdido':
      return 'perdido'
    default:
      return null
  }
}

function isMetaWebhookPayload(payload: unknown) {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      'object' in payload &&
      (payload as { object?: string }).object === 'whatsapp_business_account'
  )
}

function isMessengerWebhookPayload(payload: unknown) {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      'object' in payload &&
      (payload as { object?: string }).object === 'page'
  )
}

function parseMessengerPayload(payload: unknown): IncomingWhatsAppMessage | null {
  const entry = Array.isArray((payload as { entry?: unknown[] }).entry)
    ? ((payload as { entry: unknown[] }).entry[0] as { messaging?: unknown[] } | undefined)
    : undefined
  const messaging = Array.isArray(entry?.messaging) ? entry?.messaging?.[0] : null
  if (!messaging || typeof messaging !== 'object') return null

  const m = messaging as {
    sender?: { id?: string }
    message?: {
      text?: string
      quick_reply?: { payload?: string }
      attachments?: Array<{ type?: string }>
    }
    postback?: { payload?: string; title?: string }
  }

  const psid = m.sender?.id
  if (!psid) return null

  const rawPayloadObj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const base = {
    provider: 'messenger' as const,
    from: psid,
    waNumber: psid,
    profileName: '',
    rawPayload: rawPayloadObj,
  }

  if (m.postback?.title || m.postback?.payload) {
    return { ...base, body: m.postback.title || m.postback.payload || '' }
  }

  if (m.message?.quick_reply?.payload) {
    return { ...base, body: m.message.quick_reply.payload }
  }

  if (m.message?.text) {
    return { ...base, body: m.message.text }
  }

  if (Array.isArray(m.message?.attachments) && m.message.attachments.length > 0) {
    return { ...base, body: '__MEDIA__' }
  }

  return null
}

// ─── NOTIFICACIONES AL ASESOR ────────────────────────────────────────────────

type NotifyEvent =
  | 'lead_pide_humano'
  | 'inscripcion_confirmada'
  | 'examen_confirmado'
  | 'cita_agendada'
  | 'nuevo_lead'
  | 'lead_perdido_reescribio'

const NOTIFY_LABELS: Record<NotifyEvent, string> = {
  lead_pide_humano:      '🙋 Lead pide hablar con un asesor',
  inscripcion_confirmada:'🎉 Lead confirmó pago y documentos',
  examen_confirmado:     '📝 Lead confirmó que realizó el examen de ubicación',
  cita_agendada:         '📅 Lead agendó una cita',
  nuevo_lead:            '👋 Nuevo lead por WhatsApp',
  lead_perdido_reescribio: '⚠️ Lead marcado como perdido/cerrado volvió a escribir',
}

async function notifyAsesor(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  leadId: string,
  evento: NotifyEvent,
  leadNombre: string | null | undefined,
  leadWhatsapp: string | null | undefined,
  leadPrograma: string | null | undefined,
  primerMensaje?: string | null
) {
  try {
    // 1. Registrar en lead_activities (visible en CRM)
    await supabase.from('lead_activities').insert([{
      lead_id: leadId,
      actor_id: null,
      event_type: evento,
      title: NOTIFY_LABELS[evento],
      detail: [
        leadNombre ? `Lead: ${leadNombre}` : null,
        leadPrograma ? `Programa: ${leadPrograma}` : null,
        leadWhatsapp ? `WhatsApp: ${leadWhatsapp}` : null,
      ].filter(Boolean).join(' | '),
      meta: { source: 'bot', evento },
    }])

    // 2. Obtener el asesor asignado al lead y su número de WhatsApp
    const { data: lead } = await supabase
      .from('leads')
      .select('asignado_a')
      .eq('id', leadId)
      .maybeSingle()

    if (!lead?.asignado_a) return

    const { data: perfil } = await supabase
      .from('profiles')
      .select('whatsapp, nombre')
      .eq('id', lead.asignado_a)
      .maybeSingle()

    const asesorWhatsapp = perfil?.whatsapp as string | null | undefined
    if (!asesorWhatsapp) return

    // 3. Enviar WhatsApp al asesor
    const msgAsesor = [
      NOTIFY_LABELS[evento],
      leadNombre ? `👤 ${leadNombre}` : null,
      leadPrograma ? `📚 ${leadPrograma}` : null,
      leadWhatsapp ? `📱 ${leadWhatsapp}` : null,
      primerMensaje ? `💬 "${primerMensaje}"` : null,
    ].filter(Boolean).join('\n')

    const provider = getWhatsAppProvider()
    if (provider === 'meta') {
      const metaConfig = getMetaConfig()
      if (metaConfig) {
        await sendMetaWhatsAppMessage({ to: asesorWhatsapp, body: msgAsesor })
        // Copia al admin en eventos críticos
        if (evento === 'inscripcion_confirmada' && asesorWhatsapp !== ADMIN_WA_ALERTA) {
          await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: msgAsesor }).catch(() => {})
        }
      }
    } else {
      // Twilio
      const accountSid = process.env.TWILIO_ACCOUNT_SID
      const authToken = process.env.TWILIO_AUTH_TOKEN
      const from = process.env.TWILIO_WHATSAPP_FROM
      if (accountSid && authToken && from) {
        await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
            },
            body: new URLSearchParams({
              From: `whatsapp:${from}`,
              To: `whatsapp:${asesorWhatsapp}`,
              Body: msgAsesor,
            }).toString(),
          }
        )
      }
    }
  } catch (e) {
    console.error('[notifyAsesor]', evento, e)
  }
}

/** Asignación por horario de turno — hora de México (America/Mexico_City) */
async function getDefaultAssigneeId(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>
): Promise<string | null> {
  try {
    const mxNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
    const day = mxNow.getDay()   // 0=Dom 1=Lun 2=Mar 3=Mié 4=Jue 5=Vie 6=Sáb
    const mins = mxNow.getHours() * 60 + mxNow.getMinutes()

    const { data: perfiles } = await supabase.from('profiles').select('id, nombre')
    const get = (n: string) =>
      perfiles?.find((p: any) => p.nombre?.toLowerCase().includes(n.toLowerCase()))?.id ?? null

    const aide  = get('aide')
    const edgar = get('edgar')
    const irene = get('irene')

    // ── Roll de guardias sábados enero–julio 2026 ────────────────────────────
    const rollSabados: Record<string, string | null> = {
      '2026-01-10': aide,  '2026-01-17': irene, '2026-01-24': edgar,
      '2026-01-31': aide,  '2026-02-07': irene, '2026-02-14': edgar,
      '2026-02-21': aide,  '2026-02-28': irene, '2026-03-07': edgar,
      '2026-03-14': aide,  '2026-03-21': irene, '2026-03-28': edgar,
      // 04-abr y 11-abr: Semana Santa (festivos)
      '2026-04-18': aide,  '2026-04-25': irene, '2026-05-02': edgar,
      '2026-05-09': aide,  '2026-05-16': irene, '2026-05-23': edgar,
      '2026-05-30': aide,  '2026-06-06': irene, '2026-06-13': edgar,
      '2026-06-20': aide,  '2026-06-27': irene, '2026-07-04': edgar,
      '2026-07-11': aide,  '2026-07-18': irene,
    }

    const getSabKey = (date: Date): string => {
      const d = new Date(date)
      const dow = d.getDay()
      // días a retroceder para llegar al sábado de esa semana
      const offset = dow === 6 ? 0 : dow === 0 ? 1 : dow + 1
      d.setDate(d.getDate() - offset)
      const y  = d.getFullYear()
      const mo = String(d.getMonth() + 1).padStart(2, '0')
      const da = String(d.getDate()).padStart(2, '0')
      return `${y}-${mo}-${da}`
    }

    const getSabAsesor = (date: Date): string | null =>
      rollSabados[getSabKey(date)] ?? aide

    // ── Asignar al asesor que retome antes ──────────────────────────────────
    //
    // Horario completo:
    //   Lun/Mié/Vie  mat 8-15: Aide   | vesp 16-20:30: Irene
    //   Mar/Jue      mat 8-15: Edgar  | vesp 16-20:30: Irene
    //   Sáb          mat 8-15: Roll   | tarde: sin cobertura → Aide (lunes)
    //   Dom          sin cobertura    → Aide (lunes)
    //   Entre turnos (15-16h, Lun-Vie): Irene abre en <1h

    // Sábado
    if (day === 6) {
      if (mins < 15 * 60) return getSabAsesor(mxNow)  // turno sáb activo
      return aide                                        // sáb tarde/noche → abre Aide el lunes
    }

    // Domingo → Aide abre el lunes
    if (day === 0) return aide

    // Lunes–Viernes
    const matAsesor = [1, 3, 5].includes(day) ? aide : edgar  // Lun/Mié/Vie=Aide, Mar/Jue=Edgar

    if (mins < 8 * 60)   return matAsesor   // madrugada → abre el matutino de hoy
    if (mins < 15 * 60)  return matAsesor   // turno matutino activo
    if (mins < 16 * 60)  return irene       // entre turnos (15-16h) → Irene abre en <1h
    if (mins < 20 * 60 + 30) return irene  // turno vespertino activo

    // Después de 20:30: asesor del matutino del día siguiente
    if (day === 5) return getSabAsesor(mxNow)  // Vie noche → roll del sábado
    // Lun→Mar=Edgar, Mar→Mié=Aide, Mié→Jue=Edgar, Jue→Vie=Aide
    return [1, 3].includes(day) ? edgar : aide

  } catch (e) {
    console.error('[getDefaultAssigneeId] error:', e)
    const { data } = await supabase.from('profiles').select('id').eq('rol', 'admin').limit(1).maybeSingle()
    return (data?.id as string | undefined) ?? null
  }
}

async function parseIncomingWhatsAppMessage(
  request: Request
): Promise<IncomingWhatsAppMessage | null> {
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const payload = await request.json().catch(() => null)

    if (isMessengerWebhookPayload(payload)) {
      return parseMessengerPayload(payload)
    }

    if (!isMetaWebhookPayload(payload)) return null

    const entry = Array.isArray((payload as { entry?: unknown[] }).entry)
      ? ((payload as { entry: unknown[] }).entry[0] as
          | { changes?: unknown[] }
          | undefined)
      : undefined
    const change = Array.isArray(entry?.changes)
      ? ((entry?.changes?.[0] as { value?: unknown }) || null)
      : null
    const value =
      change &&
      typeof change === 'object' &&
      'value' in change &&
      typeof change.value === 'object'
        ? (change.value as {
            contacts?: Array<{ profile?: { name?: string } }>
            messages?: Array<{
              from?: string
              text?: { body?: string }
              type?: string
            }>
            statuses?: unknown[]
          })
        : null

    // Webhooks de estado de entrega (delivered/read/failed) de Meta — antes se
    // ignoraban por completo (ni se registraban ni se avisaba de fallos). Un
    // mensaje "aceptado" por nuestro endpoint /send puede fallar después en
    // silencio (ej. fuera de la ventana de 24h) y nunca nos enterábamos.
    if (Array.isArray(value?.statuses) && value.statuses.length > 0) {
      for (const raw of value.statuses) {
        const s = raw as { status?: string; recipient_id?: string; id?: string; errors?: Array<{ code?: number; title?: string; message?: string }> }
        if (s?.status === 'failed') {
          const errDetail = s.errors?.map(e => `[${e.code}] ${e.title || e.message || ''}`).join(' | ') || 'sin detalle'
          console.error(`[WhatsApp status] Falló la entrega a ${s.recipient_id} (wamid ${s.id}): ${errDetail}`)
          try {
            await sendMetaWhatsAppMessage({
              to: ADMIN_WA_ALERTA,
              body: `⚠️ Un mensaje de WhatsApp NO se entregó a ${s.recipient_id || 'desconocido'}.\nMotivo: ${errDetail}`,
            })
          } catch (alertErr) {
            console.error('[WhatsApp status] Error avisando fallo de entrega:', alertErr)
          }
        }
      }
      return null
    }

    const message = Array.isArray(value?.messages) ? value?.messages?.[0] : null
    if (!message || !message.from) return null

    const profileName = value?.contacts?.[0]?.profile?.name || ''
    const normalizedFrom = normalizePhoneNumber(message.from)
    const rawPayloadObj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const referral = (message as Record<string, unknown>).referral as Record<string, unknown> | undefined

    if (message.type !== 'text' || !message.text?.body) {
      // Quick Reply button tap
      if (message.type === 'button') {
        const buttonText = (message as Record<string, unknown> & { button?: { text?: string; payload?: string } }).button?.text
          || (message as Record<string, unknown> & { button?: { text?: string; payload?: string } }).button?.payload
          || ''
        if (buttonText) {
          return {
            provider: 'meta',
            body: buttonText,
            from: normalizedFrom,
            waNumber: normalizedFrom,
            profileName,
            rawPayload: rawPayloadObj,
            referral,
          }
        }
      }
      // Mensajes multimedia (audio, imagen, video, sticker, etc.)
      const mediaTypes = ['audio', 'image', 'video', 'sticker', 'document', 'voice']
      const msgType = message.type || ''
      if (mediaTypes.includes(msgType)) {
        const msgAny = message as Record<string, unknown>
        const mediaKind: 'audio' | 'image' | undefined =
          msgType === 'audio' || msgType === 'voice' ? 'audio' : msgType === 'image' ? 'image' : undefined
        const mediaObj = mediaKind
          ? (msgAny[msgType === 'voice' ? 'audio' : msgType] as { id?: string } | undefined)
          : undefined
        return {
          provider: 'meta',
          body: '__MEDIA__',
          from: normalizedFrom,
          waNumber: normalizedFrom,
          profileName,
          rawPayload: rawPayloadObj,
          referral,
          mediaKind,
          mediaId: mediaObj?.id,
        }
      }
      return null
    }

    return {
      provider: 'meta',
      body: message.text.body,
      from: normalizedFrom,
      waNumber: normalizedFrom,
      profileName,
      rawPayload: rawPayloadObj,
      referral,
    }
  }

  const formData = await request.formData()
  const body = (formData.get('Body') as string | null) ?? ''
  const from = (formData.get('From') as string | null) ?? ''
  const waId = (formData.get('WaId') as string | null) ?? ''
  const profileName = (formData.get('ProfileName') as string | null) ?? ''
  const messageSid = (formData.get('MessageSid') as string | null) ?? undefined
  const numMedia = parseInt((formData.get('NumMedia') as string | null) ?? '0', 10)
  const normalizedFrom = normalizePhoneNumber(waId || from || '')

  return {
    provider: 'twilio',
    body: numMedia > 0 && !body.trim() ? '__MEDIA__' : body,
    from: normalizePhoneNumber(from),
    waNumber: normalizedFrom,
    profileName,
    messageSid,
    rawPayload: Object.fromEntries(formData.entries()),
  }
}

async function buildProviderResponse(
  provider: WhatsAppProvider,
  message: string,
  waNumber: string
) {
  if (provider === 'meta') {
    if (waNumber) {
      await sendMetaWhatsAppMessage({ to: waNumber, body: message })
    }
    return Response.json({ ok: true })
  }

  if (provider === 'messenger') {
    if (waNumber) {
      await sendMessengerMessage({ to: waNumber, body: message })
    }
    return Response.json({ ok: true })
  }

  return buildTwiml(message)
}

// ─── INFO_MSGS: fuente de verdad por programa (igual que el lab) ─────────────
// Para programas conocidos usamos esto directamente — sin GPT/RAG —
// para garantizar que siempre incluya promo y sea consistente.

const INFO_MSGS: Record<string, string> = {
  'Inglés para adultos': `¡Con gusto! 😊 Te comparto la información de nuestro curso de *Inglés para adultos*:

*🎓 Inglés para adultos*
Dirigido a: 13 años en adelante | Modalidad: Presencial y Online
Duración: 5 meses (10 meses en sabatino)

*🕐 Horarios presenciales:* Matutino 10-12h, Vespertino 17-19h, Sabatino 9-13h
*🕐 Horarios online:* Vespertino 17-19h, Sabatino 9-13h

*💰 Inversión:*
• Inscripción: $750 → *$375 con promo* (50% de descuento)
• Mensualidad matutino/vespertino: $1,070 (Básico a Pre-Intermedio) o $1,190 (Intermedio Avanzado en adelante)
• Mensualidad sabatino: $990 o $1,010
• Material (libros): aprox. $900 aparte

🎓 Obtienes diploma con validez oficial.

Las clases inician en *septiembre*, pero *puedes inscribirte desde ahora* para asegurar tu lugar 😊`,

  'Inglés para niños': `¡Con gusto! 😊 Te comparto la información de nuestro curso de *Inglés para niños*:

*🎓 Inglés para niños*
Dirigido a: 4 a 12 años | Modalidad: Presencial y Online
Duración: 5 meses (10 meses en sabatino)

*🕐 Horarios presenciales:* Martes a jueves 13-14h o 17-18h, Sabatino 9-13h
*🕐 Horarios online:* Lunes a jueves 17-18h, Sabatino 9-13h

*💰 Inversión:*
• Inscripción: $800 → *$400 con promo* (50% de descuento)
• Mensualidad: $780
• Material: aprox. $700 aparte

🎓 Obtienes diploma con validez oficial.

Las clases inician en *septiembre*, pero *puedes inscribirte desde ahora* para asegurar tu lugar 😊`,

  'Psicología': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Psicología:

*🎓 Licenciatura en Psicología*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Salud, educación, medio ambiente, producción, consumo y convivencia social.

📄 Plan de estudios: https://drive.google.com/file/d/12o2Xiao5gBGMIr1R5nzbNQzViUzuOKPo/view`,

  'Licenciatura en Inglés': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Inglés:

*🎓 Licenciatura en Inglés*
Modalidad: Presencial | Duración: 3 años (9 cuatrimestres)

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Docente, traductor, asesor editorial, call centers, centros de investigación y organismos internacionales.

📄 Plan de estudios: https://drive.google.com/file/d/1NZeL0KEroyx0eVFeAKSaxgr5bnjjKR_Z/view`,

  'Licenciatura en Inglés online': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Inglés Online:

*🎓 Licenciatura en Inglés*
Modalidad: Online | Duración: 3 años (9 cuatrimestres)

*🕐 Horarios:* La materia de inglés se cursa en línea lunes y martes de 7:00pm a 9:00pm. Las materias complementarias se cursan en sesiones sabatinas, con horario por materia de aprox. 8:30am a 3:30pm.

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Docente, traductor, asesor editorial, call centers, centros de investigación y organismos internacionales.

📄 Plan de estudios: https://drive.google.com/file/d/1wy4BiHspFFBZ3d1dBfO0ki-koDhR3MNg/view`,

  'Administración turística': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Administración Turística:

*🎓 Licenciatura en Administración Turística*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Agencias de viajes, hoteles, resorts, operadores turísticos, eventos y convenciones.

📄 Plan de estudios: https://drive.google.com/file/d/18QTS1qOE5DDJuI--RCqhuIv89hPv0DiK/view`,

  'Administración turística online': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Administración Turística Online:

*🎓 Licenciatura en Administración Turística*
Modalidad: Online | Duración: 3 años

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Agencias de viajes, hoteles, resorts, operadores turísticos, eventos y convenciones.

📄 Plan de estudios: https://drive.google.com/file/d/1JEhS0iVIkATLicd6wqGqUXcHyB_lzT4C/view`,

  'Relaciones públicas y mercadotecnia': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Relaciones Públicas y Mercadotecnia:

*🎓 Licenciatura en Relaciones Públicas y Mercadotecnia*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*✨ Incluye 3 certificaciones:* Marketing digital, creación de páginas web y diseño gráfico.

*💼 Campo laboral:* Agencias de publicidad, marketing, medios de comunicación, gobierno, tecnología, entretenimiento.

📄 Plan de estudios: https://drive.google.com/file/d/1GtQPIwHcopnkvfBh4oQpUNZw0ekkyayf/view`,

  'Relaciones públicas y mercadotecnia online': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Relaciones Públicas y Mercadotecnia Online:

*🎓 Licenciatura en Relaciones Públicas y Mercadotecnia*
Modalidad: Online | Duración: 3 años

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*✨ Incluye 3 certificaciones:* Marketing digital, creación de páginas web y diseño gráfico.

*💼 Campo laboral:* Agencias de publicidad, marketing, medios de comunicación, gobierno, tecnología, entretenimiento.

📄 Plan de estudios: https://drive.google.com/file/d/18VDNvOjsG39KdHr31VxfYHlJJC83TKgt/view`,

  'Bachillerato': `¡Excelente elección! 😊 Te comparto la información de nuestra Prepa Windsor:

*🎓 Bachillerato — Prepa Windsor*
Modalidad: Presencial | Duración: 2 años

*🕐 Horarios:* Matutino y Vespertino

*💰 Inversión:*
• Inscripción cuatrimestral: $1,100
• Mensualidad: $1,800
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$1,100~ → $550 (50% de descuento)
• Mensualidad: ~$1,800~ → $1,440 (20% de descuento)

📄 Más información: https://drive.google.com/file/d/1txVAaLEpi-WPTybWtSKKMu3mn6fC5TkK/view`,

  'Cursos de verano niños': `👋 ¡Hola! Gracias por tu interés en *My Best Summer 2026* de Instituto Windsor. ☀️

📅 *Fechas:* Del 20 de julio al 07 de agosto.

👧🧒 Contamos con grupos por edades:

🔹 *Kids* (4 a 6 años)
• Idiomas (Inglés y Francés)
• Origami
• Arte y pintura
• Ritmo y movimiento musical
• Repostería
• Kung Fu

🔹 *Juniors* (7 a 9 años)
• Idiomas
• Repostería
• Robótica
• Origami
• Arte y pintura
• Diseño de videojuegos
• Ritmo y movimiento musical
• Kung Fu

🔹 *Seniors* (10 a 12 años)
• Arte y pintura
• Robótica
• Idiomas
• Kung Fu
• Origami
• Repostería
• Diseño de videojuegos

🕘 *Horario:* De 9:00 a.m. a 1:30 p.m.

🍽️ *Cafetería:* Las instalaciones cuentan con servicio de cafetería, el cual opera de manera independiente. Los paquetes y costos los podrás consultar directamente con ellos — lo que sí podemos confirmar es que ofrecen opciones especiales para los cursos de verano.

🚌 Los viernes realizamos salidas especiales al Zoológico, Museo La Avispa y Bomberos.

📍 *Ubicación:* Calle Sofía Tena #1, Col. Viguri.

💰 *Inversión:* $1,650 MXN + $300 materiales.
💳 *Pago:* Puedes apartar tu lugar con el 50% y cubrir el resto al inicio del curso.

🚨 *Inscripciones abiertas | Cupo limitado*`,

  'Cursos de verano adultos': `👋 ¡Hola! Gracias por tu interés en *My Best Summer* para Adolescentes y Adultos de Instituto Windsor. 🌟

📅 *Fechas:* Del 20 de julio al 07 de agosto.

Ofrecemos cursos Extra Intensivos de Idiomas para que avances tu nivel en pocas semanas.

🇬🇧 *Inglés*

🔹 Beginner X Intensivo
🕘 9:00 a.m. a 12:00 p.m. o 1:00 p.m. a 4:00 p.m.

🔹 Elementary X Intensivo
🕐 1:00 p.m. a 4:00 p.m.

🔹 Pre-Intermediate X Intensivo
🕐 1:00 p.m. a 4:00 p.m.

🇫🇷 *Francés Intensivo*
🕐 1:00 p.m. a 3:00 p.m.

🇮🇹 *Italiano Intensivo*
🕐 1:00 p.m. a 3:00 p.m.

💰 *Inversión:* $1,700 MXN por curso.
📚 Manual para cursos de inglés: $150 MXN adicionales.

📍 *Ubicación:* Calle Sofía Tena #1, Col. Viguri.

🚨 *Inscripciones abiertas | Cupo limitado*`,

  'Habilidades para la práctica psicoterapéutica': `📚 Te comparto la información de nuestro curso *Habilidades para la práctica psicoterapéutica*:

Existen diversas habilidades básicas para el correcto desarrollo de la labor clínica del psicólogo, que no siempre se desarrollan en la formación tradicional. Este curso desarrolla el análisis, la evaluación, el moldeamiento verbal y la dirección de actividades para brindar intervenciones psicoterapéuticas confiables y eficientes.

*🎯 Objetivo:* Que el estudiante desarrolle habilidades de análisis conductual en el área clínica, para predecir, explicar e intervenir de manera eficiente ante distintos problemas psicológicos.

*📋 Competencias a desarrollar:*
• Análisis conductual aplicado
• Análisis de casos clínicos
• Análisis de la conducta verbal y no verbal
• Moldeamiento verbal
• Regulación y autorregulación de las emociones
• Estrategias conductuales y emocionales en tratamientos multidisciplinares

*👨‍🏫 Responsable:* Psic. Carlos Manuel Palacios Pita

*🗓️ Duración:* 4 módulos de 3 sesiones cada uno (4 semanas), lunes a miércoles de 3:00 p.m. a 4:30 p.m.
1️⃣ Introducción y habilidades básicas — 20 al 22 de julio
2️⃣ Análisis funcional aplicado — 27 al 29 de julio
3️⃣ Moldeamiento verbal — 3 al 5 de agosto
4️⃣ Autorregulación emocional — 10 al 12 de agosto

*💰 Costo* (incluye constancia):
• Alumnos Windsor: $300
• Público en general: $400

🚨 *Cupo limitado:* mínimo 10, máximo 25 participantes.`,
}

const VALOR_POR_PROGRAMA: Record<string, number> = {
  'Inglés para adultos': 990,
  'Inglés para niños': 780,
  'Licenciatura en Inglés': 1925,
  'Licenciatura en Inglés online': 1925,
  'Psicología': 1925,
  'Relaciones públicas y mercadotecnia': 1925,
  'Relaciones públicas y mercadotecnia online': 1925,
  'Administración turística': 1925,
  'Administración turística online': 1925,
  'Bachillerato': 1440,
  'Francés': 990,
  'Italiano': 990,
  'Cursos de verano niños': 1650,
  'Cursos de verano adultos': 1700,
  'Habilidades para la práctica psicoterapéutica': 400,
}

function getValorPrograma(programa: string | null | undefined): number | null {
  if (!programa) return null
  return VALOR_POR_PROGRAMA[programa] ?? null
}

// ─── Comando "registro" — alta rápida de leads vía WhatsApp ──────────────────
// Cualquiera puede mandarle al bot: "registro, Nombre, correo, WhatsApp, oferta educativa"
// El bot confirma antes de guardar para evitar errores en la oferta educativa
// (de eso depende que el bot pueda mandar la info correcta después).

const OFERTAS_REGISTRO_VALIDAS = [
  'Inglés para adultos',
  'Inglés para niños',
  'Psicología',
  'Licenciatura en Inglés',
  'Licenciatura en Inglés online',
  'Administración turística',
  'Administración turística online',
  'Relaciones públicas y mercadotecnia',
  'Relaciones públicas y mercadotecnia online',
  'Bachillerato',
  'Cursos de verano niños',
  'Cursos de verano adultos',
  'Habilidades para la práctica psicoterapéutica',
]

/** Normaliza un número escrito a mano (10 dígitos sin lada país) — igual que normalizarWhatsapp() en crm.jsx. */
function normalizarWhatsappManual(num: string): string {
  let n = num.replace(/\s+/g, '').replace(/[^\d+]/g, '')
  if (!n.startsWith('+')) {
    const digits = n.replace(/\D/g, '')
    if (digits.length === 10) n = `+52${digits}`
    else n = `+${digits}`
  }
  return n
}

const ASESOR_AUTOMATICO = '(automático según turno)'

/** Busca un asesor por nombre (coincidencia parcial, igual criterio que getDefaultAssigneeId). */
async function matchAsesor(
  supabase: ReturnType<typeof createServiceRoleClient>,
  texto: string
): Promise<{ id: string; nombre: string } | null> {
  const norm = texto.trim().toLowerCase()
  if (!norm) return null
  const { data: perfiles } = await supabase.from('profiles').select('id, nombre')
  const match = (perfiles || []).find((p: { nombre?: string | null }) => {
    const n = (p.nombre || '').toLowerCase()
    return n.includes(norm) || (n && norm.includes(n.split(' ')[0]))
  }) as { id: string; nombre: string } | undefined
  return match ? { id: match.id, nombre: match.nombre } : null
}

async function listaNombresAsesores(supabase: ReturnType<typeof createServiceRoleClient>): Promise<string> {
  const { data: perfiles } = await supabase.from('profiles').select('nombre').not('nombre', 'is', null)
  return (perfiles || []).map((p: { nombre?: string | null }) => p.nombre).filter(Boolean).join(', ')
}

type PartesRegistro = {
  nombre: string | null
  correo: string | null
  whatsappRaw: string | null
  ofertaRaw: string | null
  asesorRaw: string | null
}

/** Clasifica los datos del comando "registro" sin importar el orden en que se manden:
 * WhatsApp y correo se detectan por patrón, la oferta por palabra clave, y el asesor
 * (si lo hay) probando los textos restantes contra los perfiles. Lo que quede es el nombre. */
async function clasificarPartesRegistro(
  supabase: ReturnType<typeof createServiceRoleClient>,
  partes: string[]
): Promise<PartesRegistro> {
  const restantes: string[] = []
  let whatsappRaw: string | null = null
  let correo: string | null = null
  let ofertaRaw: string | null = null

  for (const parte of partes) {
    const soloDigitos = parte.replace(/\D/g, '')
    const soloTexto = parte.replace(/[\s\-+]/g, '')
    if (!whatsappRaw && soloDigitos.length >= 10 && soloDigitos.length === soloTexto.length) {
      whatsappRaw = parte
      continue
    }
    if (!correo && /\S+@\S+\.\S+/.test(parte)) {
      correo = parte
      continue
    }
    if (!ofertaRaw) {
      const r = matchOfertaEducativa(parte)
      if (r.match || r.ambiguous) {
        ofertaRaw = parte
        continue
      }
    }
    restantes.push(parte)
  }

  let nombre: string | null = null
  let asesorRaw: string | null = null

  if (restantes.length <= 1) {
    nombre = restantes[0] || null
  } else {
    // probar de derecha a izquierda cuál de los restantes es un asesor conocido
    let idxAsesor = -1
    for (let i = restantes.length - 1; i >= 0; i--) {
      if (await matchAsesor(supabase, restantes[i])) { idxAsesor = i; break }
    }
    if (idxAsesor >= 0) {
      asesorRaw = restantes[idxAsesor]
      nombre = restantes.filter((_, i) => i !== idxAsesor).join(' ') || null
    } else {
      nombre = restantes.join(' ')
    }
  }

  return { nombre, correo, whatsappRaw, ofertaRaw, asesorRaw }
}

type FaseRegistro = 'registro_confirmar' | 'registro_cancelado' | 'registro_listo'

/** Registra el mensaje del usuario + la respuesta del bot en la pseudo-conversación de "registro" (sin lead_id) y responde. */
async function finalizarRegistro(
  supabase: ReturnType<typeof createServiceRoleClient>,
  waNumber: string,
  provider: WhatsAppProvider,
  originalText: string,
  mensaje: string,
  nuevaFase: FaseRegistro
): Promise<Response> {
  const now = new Date().toISOString()
  const { data: conv } = await supabase
    .from('whatsapp_conversaciones')
    .select('id')
    .eq('whatsapp', waNumber)
    .order('ultimo_mensaje_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let conversacionId = (conv as { id?: string } | null)?.id
  if (!conversacionId) {
    const { data: nueva } = await supabase
      .from('whatsapp_conversaciones')
      .insert([{ whatsapp: waNumber, lead_id: null, estado: 'cerrada', fase: nuevaFase, provider, ultimo_mensaje_at: now }])
      .select('id')
      .single()
    conversacionId = (nueva as { id?: string } | null)?.id
  } else {
    await supabase
      .from('whatsapp_conversaciones')
      .update({ fase: nuevaFase, estado: 'cerrada', ultimo_mensaje_at: now })
      .eq('id', conversacionId)
  }

  if (conversacionId) {
    await supabase.from('whatsapp_mensajes').insert([
      { conversacion_id: conversacionId, rol: 'usuario', contenido: originalText },
      { conversacion_id: conversacionId, rol: 'bot', contenido: mensaje },
    ])
  }

  return buildProviderResponse(provider, mensaje, waNumber)
}

/** Comando "memoria" — el mensaje es una nota de Harold para el asistente de IA (no una
 * pregunta de cliente que el bot deba responder). Bypassea todo el flujo normal: no llama
 * a GPT, no crea/actualiza leads, solo registra el mensaje y confirma brevemente para que
 * quede disponible para consultarlo después. */
async function handleMemoriaCommand(
  supabase: ReturnType<typeof createServiceRoleClient>,
  provider: WhatsAppProvider,
  waNumber: string,
  originalText: string
): Promise<Response | null> {
  const trimmed = originalText.trim()
  if (!/^memoria\b/i.test(trimmed)) return null

  const now = new Date().toISOString()
  const { data: conv } = await supabase
    .from('whatsapp_conversaciones')
    .select('id')
    .eq('whatsapp', waNumber)
    .order('ultimo_mensaje_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let conversacionId = (conv as { id?: string } | null)?.id
  if (!conversacionId) {
    const { data: nueva } = await supabase
      .from('whatsapp_conversaciones')
      .insert([{ whatsapp: waNumber, lead_id: null, estado: 'cerrada', fase: 'nota', provider, ultimo_mensaje_at: now }])
      .select('id')
      .single()
    conversacionId = (nueva as { id?: string } | null)?.id
  } else {
    await supabase.from('whatsapp_conversaciones').update({ ultimo_mensaje_at: now }).eq('id', conversacionId)
  }

  const ack = '📝 Guardado — no lo voy a responder, queda registrado.'
  if (conversacionId) {
    await supabase.from('whatsapp_mensajes').insert([
      { conversacion_id: conversacionId, rol: 'usuario', contenido: trimmed },
      { conversacion_id: conversacionId, rol: 'bot', contenido: ack },
    ])
  }

  return buildProviderResponse(provider, ack, waNumber)
}

const REGISTRO_AFIRMATIVO = /^(s[ií]|confirmar|correcto|ok|dale|exacto)\b/i
const REGISTRO_NEGATIVO = /^(no|cancelar|cancela)\b/i
const REGISTRO_FORMATO_AYUDA = 'Formato:\n\nregistro, Nombre completo, correo, WhatsApp, oferta educativa, asesor (opcional)\n\nEj: registro, Juan Pérez, juan@email.com, 7471234567, inglés para adultos\nEj con asesor: registro, Juan Pérez, juan@email.com, 7471234567, inglés para adultos, Edgar'

/** Si el mensaje es el comando "registro" o la respuesta a una confirmación pendiente, lo maneja y responde. Si no, regresa null y el flujo normal del bot continúa. */
async function handleRegistroCommand(
  supabase: ReturnType<typeof createServiceRoleClient>,
  provider: WhatsAppProvider,
  waNumber: string,
  originalText: string
): Promise<Response | null> {
  const trimmed = originalText.trim()
  // Exige además el formato de comas (3+) para no confundir una frase real de un prospecto
  // que por casualidad empiece con "registro" (ej. "Registro de mi hija, ¿es necesario?")
  const esComandoRegistro = /^registro\b/i.test(trimmed) && trimmed.split(',').length >= 4

  const { data: convRegistro } = await supabase
    .from('whatsapp_conversaciones')
    .select('id, fase')
    .eq('whatsapp', waNumber)
    .eq('fase', 'registro_confirmar')
    .order('ultimo_mensaje_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!esComandoRegistro && !convRegistro) return null

  if (esComandoRegistro) {
    const partesCrudas = trimmed.replace(/^registro\b[,:]?\s*/i, '').split(',').map((p) => p.trim()).filter(Boolean)
    const { nombre, correo, whatsappRaw, ofertaRaw, asesorRaw } = await clasificarPartesRegistro(supabase, partesCrudas)

    if (!nombre || !whatsappRaw || !ofertaRaw) {
      return finalizarRegistro(supabase, waNumber, provider, originalText, `No reconocí el formato. ${REGISTRO_FORMATO_AYUDA}`, 'registro_cancelado')
    }

    const digits = whatsappRaw.replace(/\D/g, '')
    if (digits.length < 10) {
      return finalizarRegistro(supabase, waNumber, provider, originalText, `El WhatsApp "${whatsappRaw}" no parece válido (necesita 10 dígitos). Vuelve a mandar *registro* con el número correcto.`, 'registro_cancelado')
    }

    const ofertaResultado = matchOfertaEducativa(ofertaRaw)
    if (ofertaResultado.ambiguous) {
      return finalizarRegistro(supabase, waNumber, provider, originalText, `"${ofertaRaw}" es ambiguo — especifica si es para niños o adultos (ej. "inglés para adultos" o "verano niños"). Vuelve a mandar *registro*.`, 'registro_cancelado')
    }
    if (!ofertaResultado.match) {
      return finalizarRegistro(supabase, waNumber, provider, originalText, `No reconozco la oferta educativa "${ofertaRaw}". Usa una de estas:\n\n${OFERTAS_REGISTRO_VALIDAS.join('\n')}\n\nVuelve a mandar *registro* con el nombre correcto.`, 'registro_cancelado')
    }
    const ofertaMatch = ofertaResultado.match

    let asesorTexto = ASESOR_AUTOMATICO
    if (asesorRaw) {
      const asesorMatch = await matchAsesor(supabase, asesorRaw)
      if (!asesorMatch) {
        const validos = await listaNombresAsesores(supabase)
        return finalizarRegistro(supabase, waNumber, provider, originalText, `No reconozco al asesor "${asesorRaw}". Usa uno de estos:\n\n${validos}\n\nVuelve a mandar *registro* con el nombre correcto, o sin asesor para asignación automática.`, 'registro_cancelado')
      }
      asesorTexto = asesorMatch.nombre
    }

    const draft = `📋 Confirma estos datos:\nNombre: ${nombre}\nCorreo: ${correo || '(sin correo)'}\nWhatsApp: ${digits}\nOferta educativa: ${ofertaMatch}\nAsesor: ${asesorTexto}\n\n¿Es correcto? Responde *sí* para guardar o *no* para cancelar.`
    return finalizarRegistro(supabase, waNumber, provider, originalText, draft, 'registro_confirmar')
  }

  // Hay una confirmación pendiente — este mensaje debe ser sí/no
  if (REGISTRO_NEGATIVO.test(trimmed)) {
    return finalizarRegistro(supabase, waNumber, provider, originalText, 'Cancelado. Puedes volver a mandar *registro* con los datos correctos.', 'registro_cancelado')
  }

  if (REGISTRO_AFIRMATIVO.test(trimmed)) {
    const { data: ultimoBotMsg } = await supabase
      .from('whatsapp_mensajes')
      .select('contenido')
      .eq('conversacion_id', (convRegistro as { id: string }).id)
      .eq('rol', 'bot')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const draftTexto = (ultimoBotMsg as { contenido?: string } | null)?.contenido || ''
    const nombre = /Nombre:\s*(.+)/.exec(draftTexto)?.[1]?.trim()
    const correoLinea = /Correo:\s*(.+)/.exec(draftTexto)?.[1]?.trim()
    const whatsappLinea = /WhatsApp:\s*(.+)/.exec(draftTexto)?.[1]?.trim()
    const ofertaLinea = /Oferta educativa:\s*(.+)/.exec(draftTexto)?.[1]?.trim()
    const asesorLinea = /Asesor:\s*(.+)/.exec(draftTexto)?.[1]?.trim()

    if (!nombre || !whatsappLinea || !ofertaLinea) {
      return finalizarRegistro(supabase, waNumber, provider, originalText, `No encontré los datos pendientes. ${REGISTRO_FORMATO_AYUDA}`, 'registro_cancelado')
    }

    const correo = correoLinea === '(sin correo)' ? '' : (correoLinea || '')
    const whatsappNuevoLead = normalizarWhatsappManual(whatsappLinea)
    const valor = getValorPrograma(ofertaLinea) ?? 0

    let asignadoA: string | null = null
    if (asesorLinea && asesorLinea !== ASESOR_AUTOMATICO) {
      const asesorMatch = await matchAsesor(supabase, asesorLinea)
      asignadoA = asesorMatch?.id ?? await getDefaultAssigneeId(supabase)
    } else {
      asignadoA = await getDefaultAssigneeId(supabase)
    }

    const { data: existente } = await supabase
      .from('leads')
      .select('id')
      .eq('whatsapp', whatsappNuevoLead)
      .maybeSingle()

    if ((existente as { id?: string } | null)?.id) {
      const updateData: Record<string, unknown> = { nombre, email: correo, curso: ofertaLinea, valor }
      if (asesorLinea && asesorLinea !== ASESOR_AUTOMATICO && asignadoA) updateData.asignado_a = asignadoA
      await supabase.from('leads').update(updateData).eq('id', (existente as { id: string }).id)
    } else {
      const { data: nuevoLead } = await supabase.from('leads').insert([{
        nombre,
        email: correo,
        whatsapp: whatsappNuevoLead,
        curso: ofertaLinea,
        valor,
        stage: 'contactado',
        fecha: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }),
        origen: 'registro_wa',
        ...(asignadoA ? { asignado_a: asignadoA } : {}),
      }]).select('id').maybeSingle()

      const nuevoLeadId = (nuevoLead as { id?: string } | null)?.id
      if (nuevoLeadId) await enviarBienvenidaLeadManual(supabase, nuevoLeadId)
    }

    return finalizarRegistro(supabase, waNumber, provider, originalText, `✅ Registrado: ${nombre} · ${ofertaLinea} · ${whatsappLinea}`, 'registro_listo')
  }

  // Respuesta no clara — recordar la pregunta pendiente
  const { data: ultimoBotMsg2 } = await supabase
    .from('whatsapp_mensajes')
    .select('contenido')
    .eq('conversacion_id', (convRegistro as { id: string }).id)
    .eq('rol', 'bot')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const recordatorio = `${(ultimoBotMsg2 as { contenido?: string } | null)?.contenido || REGISTRO_FORMATO_AYUDA}\n\n(Responde *sí* o *no*)`
  return finalizarRegistro(supabase, waNumber, provider, originalText, recordatorio, 'registro_confirmar')
}

/** CTA siempre en código, nunca delegado a GPT */
function buildCTA(programa: string | null | undefined): string {
  if (esInglesIdioma(programa)) {
    // El examen de ubicación es opcional — nunca debe bloquear la inscripción
    return `\n\n¿Cómo te gustaría continuar?\n*A)* Tengo dudas 🤔\n*B)* Quiero inscribirme ✍️\n*C)* Agendar mi examen de ubicación gratuito (opcional) 📝`
  }
  return `\n\n¿Cómo te gustaría continuar?\n*A)* Tengo dudas 🤔\n*B)* Quiero inscribirme ✍️`
}

/** Detecta si el mensaje es SOLO la letra de opción (con puntuación simple opcional) —
 * evita falsos positivos de \bx\b contra palabras sueltas comunes en español (ej. la
 * preposición "a" dentro de una frase normal como "voy a dejar mis documentos"). */
function esSoloLetra(msg: string, letra: string): boolean {
  return new RegExp(`^\\s*${letra}[).,!:]?\\s*$`, 'i').test(msg)
}

function eligeB(msg: string): boolean {
  const m = msg.toLowerCase()
  return esSoloLetra(msg, 'b') || /opci[oó]n.*b|\b2\b|quiero inscrib|inscribirme/.test(m)
}

function eligeA(msg: string): boolean {
  const m = msg.toLowerCase()
  return esSoloLetra(msg, 'a') || /opci[oó]n.*a|\b1\b|tengo duda|más duda|tengo preguntas/.test(m)
}

/** Examen de ubicación — solo aplica a cursos de idiomas y es opcional, nunca sustituye a "quiero inscribirme" */
function eligeExamenUbicacion(msg: string): boolean {
  const m = msg.toLowerCase()
  return esSoloLetra(msg, 'c') || /opci[oó]n.*c|\b3\b|quiero.*clase|clase.*prueba|agendar.*examen|examen.*ubicaci[oó]n|quiero.*agendar|prueba.*gratuita/.test(m)
}

/** Detecta programa específico en el mensaje (igual que lab) — nunca retorna "inglés" genérico */
/** Detecta email en el mensaje */
function detectarEmail(msg: string): string | null {
  const match = msg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return match ? match[0] : null
}

/** Detecta si el usuario no quiere dar correo */
function noQuiereEmail(msg: string): boolean {
  const m = msg.toLowerCase()
  if (/no (lo )?ten(go)?|sin correo|no.*correo|no.*email|no.*mail|no quiero|no doy|no hay|no pos|nop/i.test(m)) return true
  if (/por este medio|por aqu[ií]|as[ií] est[aá] bien|no uso|no manejo/i.test(m)) return true
  if (/\b(solo|s[oó]lo|nada m[aá]s|nom[aá]s)\b.*(informaci[oó]n|info|eso)/i.test(m)) return true
  if (!m.includes('@') && /^(info|siguiente|dale|ok|omite|salta|después|despues|luego|no|nada|sin|omitir|skip)$/i.test(m.trim())) return true
  return false
}

// ─── CONVENIOS ───────────────────────────────────────────────────────────────

const CONVENIOS_LISTA_MSG = `Sí, contamos con convenios vigentes con las siguientes instituciones:

1. Subsecretaría de Educación Básica y PRONI
2. SUSPEG Central
3. Sección VII
4. Sección 36 de Salud
5. Tribunal Electoral del Estado de Guerrero
6. Colegios de Bachilleres del Estado de Guerrero
7. Secretaría de Migrantes y Asuntos Internacionales
8. Secretaría de Gestión Integral y Protección Civil
9. SITMABEG
10. Sindicato del Metro CD. México
11. Egresados Windsor
12. Instituto Tecnológico de Chilpancingo
13. Secundaria Técnica No. 81

¿A cuál de estas instituciones perteneces? 😊`

const CONVENIOS_DETALLE: Record<string, string> = {
  proni: `*Convenio: Subsecretaría de Educación Básica y PRONI*
Beneficiarios: Trabajador, hijos y cónyuges

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 25% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 30% descuento
☀️ *Verano 2026:* 20% descuento (nuevo ingreso)`,

  suspeg: `*Convenio: SUSPEG Central*
Beneficiarios: Trabajador, hijos y cónyuges | Vigencia: 15-Dic-2025

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 25% descuento
📚 *Cursos libres:* 40% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 30% descuento
☀️ *Verano 2026:* 20% descuento (nuevo ingreso)`,

  seccion7: `*Convenio: Sección VII*
Beneficiarios: Trabajador, hijos y cónyuges | Vigencia: Marzo 2027

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 25% descuento
📚 *Cursos libres:* 40% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 30% descuento
☀️ *Verano 2026:* 20% descuento (nuevo ingreso)`,

  seccion36: `*Convenio: Sección 36 de Salud*
Beneficiarios: Trabajador, hijos y cónyuges | Vigencia: Noviembre 2025

📌 *Inscripción:* 30% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 25% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 25% descuento
☀️ *Verano 2026:* 20% descuento (nuevo ingreso)`,

  tribunal: `*Convenio: Tribunal Electoral del Estado de Guerrero*
Beneficiarios: Trabajador, hijos y cónyuges | Vigencia: Marzo 2026

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 20% descuento
☀️ *Verano 2026:* 20% descuento (nuevo ingreso)`,

  cobach: `*Convenio: Colegios de Bachilleres del Estado de Guerrero*
Beneficiarios: Trabajadores, hijos y estudiantes de planteles | Vigencia: Marzo 2027

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 30% descuento
☀️ *Verano 2026:* 20% descuento (nuevo ingreso)`,

  migrantes: `*Convenio: Secretaría de Migrantes y Asuntos Internacionales*
Beneficiarios: Trabajadores, hijos y estudiantes de planteles | Vigencia: Mayo 2026

📌 *Inscripción:* 40% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 30% descuento
☀️ *Verano 2026:* 20% descuento (nuevo ingreso)`,

  proteccioncivil: `*Convenio: Secretaría de Gestión Integral y Protección Civil*
Beneficiarios: Trabajadores, hijos y estudiantes de planteles | Vigencia: Sep-2027

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 20% descuento
☀️ *Verano 2026:* 20% descuento (nuevo ingreso)`,

  sitmabeg: `*Convenio: SITMABEG*
Beneficiarios: Trabajadores, hijos y estudiantes de planteles | Vigencia: Mayo 2027

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 20% descuento
☀️ *Verano 2026:* 20% descuento (nuevo ingreso)`,

  metro: `*Convenio: Sindicato del Metro CD. México*
Beneficiarios: Trabajadores e hijos | Vigencia: Ene-2027

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 20% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 20% descuento
☀️ *Verano 2026:* 20% descuento (nuevo ingreso)`,

  egresados: `*Convenio: Egresados Instituto Windsor*
Beneficiarios: Egresados de Licenciaturas | Vigencia: Permanente

📌 *Inscripción:* Condonación nuevo ingreso | 50% reingreso
📚 *Licenciatura:* No aplica
📚 *Cursos libres:* 50% descuento
🎓 *Preparatoria:* No aplica
🎓 *Maestría:* 25% descuento
☀️ *Verano 2026:* 20% descuento (nuevo ingreso)`,

  itech: `*Convenio: Instituto Tecnológico de Chilpancingo*
Beneficiarios: Alumnos ITECH

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* No aplica
🎓 *Maestría:* 20% descuento
☀️ *Verano 2026:* No aplica`,

  sec81: `*Convenio: Secundaria Técnica No. 81*
Beneficiarios: Alumnos

📌 *Inscripción:* 50% nuevo ingreso
📚 *Licenciatura:* No aplica
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* No aplica
🎓 *Maestría:* No aplica
☀️ *Verano 2026:* No aplica`,
}

/** Detecta si el usuario pregunta por revalidación de materias cursadas en otra institución.
 * Incluye typos comunes (ej. "balidar" en vez de "revalidar" — caso real Isabel 2026-08-10,
 * donde el bot ignoró la pregunta y solo mandó los pasos de inscripción normales). */
function detectarRevalidacion(msg: string): boolean {
  const norm = quitarAcentos(msg).toLowerCase()
  if (/revalida|balida|convalida/.test(norm)) return true
  if (/materias?\s+(ya\s+)?(cursad|aprobad|vist)/.test(norm)) return true
  if (/semestres?\s+(ya\s+)?(cursad|aprobad|vist)/.test(norm)) return true
  if (/(ya\s+(estudi|curs)\w*\s+.{0,30}(otra\s+(escuela|universidad|instituci|prepa)|semestre))/.test(norm)) return true
  return false
}

/** Proceso real de revalidación: nunca confirma ni niega de antemano si se aceptará —
 * solo pide el kardex para que un asesor lo evalúe. Ver memoria/instrucción del caso Isabel. */
const REVALIDACION_MATERIAS_MSG = `Para revisar si podemos revalidarte materias que ya cursaste en otra institución, por favor envía tu *kardex oficial* (donde aparezcan las materias que ya cursaste) al correo 📧 *hola@windsor.edu.mx*, incluyendo:

• Tu nombre completo
• Tu número de WhatsApp

En cuanto lo envíes, confírmanoslo por aquí para darle seguimiento. Un asesor revisará tu kardex y te dirá qué materias aplican. 😊`

/** Detecta si el mensaje es alguien buscando trabajo/vacante docente, NO un prospecto de inscripción */
function detectarConsultaVacante(msg: string): boolean {
  return /vacante|plaza docente|buscan\s+(maestros?|profesor(a)?|docentes?)|solicit(o|an|ud)\s+.*(empleo|trabajo|maestro|profesor|docente)|trabajar\s+como\s+(maestro|profesor|docente)|dar\s+clases\s+(en|para)\s+(su|la)\s+(instituci|escuela|colegio)|postularme|contratando\s+(personal|maestros?|docentes?)|env[ií]o\s+.*(cv|curr[ií]culum)|curr[ií]culum\s+vitae|reclutamiento|recursos\s+humanos/i.test(msg)
}

const VACANTE_DOCENTE_MSG = `¡Hola! Para el tema de la vacante docente, te invitamos a visitarnos directamente en nuestras instalaciones:

📍 *Chilpancingo:* Sofía Tena #1, Col. Viguri
📍 *Iguala:* Ignacio Zaragoza 99, Col. Centro

🕐 *Horarios:* Lun–Vie 8:00–14:00 y 17:00–20:00 | Sáb 8:00–14:00

Con gusto te atendemos ahí.`

/** Detecta si el mensaje pregunta sobre convenios */
function detectarPreguntaConvenio(msg: string): boolean {
  return /convenio|descuento.*trabajo|trabajo.*descuento|precio.*especial|especial.*precio|sindicato|trabajo en|trabajo.*gobierno|gobierno.*trabajo|empleado.*estado|estado.*empleado|precio.*instituci|instituci.*precio|soy.*maestro|maestro.*descuento|descuento.*maestro|beneficio.*trabajo|trabajo.*beneficio/i.test(msg)
}

/** Detecta qué institución menciona el usuario y retorna la clave de CONVENIOS_DETALLE */
function detectarInstitucionConvenio(msg: string): string | null {
  const m = msg.toLowerCase()
  if (/proni|educaci[oó]n b[aá]sica|subsecretar/i.test(m)) return 'proni'
  if (/suspeg/i.test(m)) return 'suspeg'
  if (/secci[oó]n.*vii|secci[oó]n.*7\b|secci[oó]n 7[^2-9]|maestros.*secci[oó]n|secci[oó]n.*maestros/i.test(m)) return 'seccion7'
  if (/secci[oó]n.*36|36.*salud|salud.*36/i.test(m)) return 'seccion36'
  if (/tribunal electoral/i.test(m)) return 'tribunal'
  if (/cobach|colegio.*bachiller|bachiller.*colegio/i.test(m)) return 'cobach'
  if (/migrante|asuntos internacionales/i.test(m)) return 'migrantes'
  if (/protecci[oó]n civil|gesti[oó]n integral/i.test(m)) return 'proteccioncivil'
  if (/sitmabeg/i.test(m)) return 'sitmabeg'
  if (/metro.*cdmx|metro.*ciudad|sindicato.*metro|metro cd/i.test(m)) return 'metro'
  if (/egresado|ya termin[eé]|ya estudi[eé]|gradu/i.test(m)) return 'egresados'
  if (/tecnol[oó]gico.*chilpancingo|itech|tec.*chilpancingo/i.test(m)) return 'itech'
  if (/secundaria.*t[eé]cnica.*81|sec\.?\s*t[eé]c\.?\s*81|^\s*13\s*$/.test(m)) return 'sec81'
  // números del 1-13 que corresponden a la lista
  if (/^\s*1\s*$/.test(m.trim())) return 'proni'
  if (/^\s*2\s*$/.test(m.trim())) return 'suspeg'
  if (/^\s*3\s*$/.test(m.trim())) return 'seccion7'
  if (/^\s*4\s*$/.test(m.trim())) return 'seccion36'
  if (/^\s*5\s*$/.test(m.trim())) return 'tribunal'
  if (/^\s*6\s*$/.test(m.trim())) return 'cobach'
  if (/^\s*7\s*$/.test(m.trim())) return 'migrantes'
  if (/^\s*8\s*$/.test(m.trim())) return 'proteccioncivil'
  if (/^\s*9\s*$/.test(m.trim())) return 'sitmabeg'
  if (/^\s*10\s*$/.test(m.trim())) return 'metro'
  if (/^\s*11\s*$/.test(m.trim())) return 'egresados'
  if (/^\s*12\s*$/.test(m.trim())) return 'itech'
  if (/^\s*13\s*$/.test(m.trim())) return 'sec81'
  return null
}

// ─── GPT-4o como cerebro del bot ─────────────────────────────────────────────

const CATALOGO_OFERTA = `¿Cuál de nuestras ofertas educativas te interesa?

🔴PRESENCIALES

🔵BACHILLERATO

🔵LICENCIATURAS

•Licenciatura en Inglés
•Relaciones públicas y mercadotecnia
•Administracion turística
•Psicologia

🔵MAESTRIAS

•Innovación empresarial
•Multiculturalidad y plurilingüismo

🔵CURSOS DE IDIOMAS

•Inglés para adultos
•Inglés para niños
•Francés
•Italiano

🔵CURSOS Y TALLERES

•Habilidades para la práctica psicoterapéutica

🔴EN LINEA

•Cursos de Inglés
•Licenciatura en inglés
•Relaciones públicas y mercadotecnia
•Administracion turística

🔵DIPLOMADOS

•Administración de Instituciones de la Salud
•Administración de recursos humanos
•Administración de restaurantes
•Análisis y Evaluación de Políticas Públicas
•Comunicación y Liderazgo en el Sector Público
•Comunicación y Liderazgo empresarial
•Competencias educativas
•Comunicación y Gobierno Digital
•Contabilidad
•Creación y dirección de franquicias
•Ciencias del deporte
•Enfermería
•Epidemiología
•Equidad de genero y diversidad sexual
•Farmacología
•Gamificación educativa
•Gerontología
•Innovación y Gobierno Digital
•Mindfulness
•Nutrición deportiva
•Nutrición y Dietética
•Políticas y Procesos de Participación Ciudadana
•Piscología criminológica
•Psicología educativa
•Realidad Virtual
•Salud pública
•Tecnología educativa
•Terapia ocupacional
•Tanatología
•Enseñanza del idioma inglés
•Enseñanza del idioma español`

const INSCRIPCION_VERANO_NINOS_MSG = `¡Perfecto! ☀️ El proceso de inscripción a *My Best Summer* es muy sencillo:

*📄 Documentos necesarios:*
• Acta de nacimiento
• Comprobante de pago

*💳 Pago:* Puedes apartar tu lugar con el 50% hoy y cubrir el resto al inicio del curso.
🏦 Datos bancarios: https://drive.google.com/file/d/1Hj9rRk1zHMWGnG_CjF287W-hxY2AoTe9/view?usp=drivesdk

*📦 Material:* tiene un costo de $300 (ya incluido) y se paga en efectivo directamente en las instalaciones.

*📋 Puedes inscribirte de dos formas:*

*A) En línea* 💻
Llena el formulario de inscripción y adjunta tus documentos:
📝 https://forms.gle/fvxiekCtLb7KNz2U8
Confírmanos aquí por WhatsApp cuando lo hayas completado.

*B) Presencial* 🏫
Visítanos con tus documentos — el pago lo puedes realizar directamente en las instalaciones, a la cuenta bancaria que te compartimos arriba:
📍 Chilpancingo: Sofía Tena #1, Col. Viguri
📍 Iguala: Ignacio Zaragoza 99, Col. Centro
🕐 Lun–Vie 8:00–14:00 y 17:00–20:00 | Sáb 8:00–14:00

🚨 *¡Cupo limitado!* Asegura tu lugar pronto. 😊`

const INSCRIPCION_VERANO_ADULTOS_MSG = `¡Perfecto! ☀️ El proceso de inscripción a *My Best Summer* es muy sencillo:

*📄 Documentos necesarios:*
• Acta de nacimiento
• Comprobante de pago

*💳 Pago:* Puedes apartar tu lugar con el 50% hoy y cubrir el resto al inicio del curso.
🏦 Datos bancarios: https://drive.google.com/file/d/1Hj9rRk1zHMWGnG_CjF287W-hxY2AoTe9/view?usp=drivesdk

*📦 Manual (solo cursos de inglés):* tiene un costo de $150 y se paga en efectivo directamente en las instalaciones.

*📋 Puedes inscribirte de dos formas:*

*A) En línea* 💻
Llena el formulario de inscripción y adjunta tus documentos:
📝 https://forms.gle/fvxiekCtLb7KNz2U8
Confírmanos aquí por WhatsApp cuando lo hayas completado.

*B) Presencial* 🏫
Visítanos con tus documentos — el pago lo puedes realizar directamente en las instalaciones, a la cuenta bancaria que te compartimos arriba:
📍 Chilpancingo: Sofía Tena #1, Col. Viguri
📍 Iguala: Ignacio Zaragoza 99, Col. Centro
🕐 Lun–Vie 8:00–14:00 y 17:00–20:00 | Sáb 8:00–14:00

🚨 *¡Cupo limitado!* Asegura tu lugar pronto. 😊`

const INSCRIPCION_LICS_MSG = `🎉 ¡Felicidades por tomar esta decisión!

¿Cómo prefieres hacer tu inscripción?

*A)* En línea desde aquí 💻
*B)* Presencial en las instalaciones 🏫`

const INSCRIPCION_ONLINE_MSG = `¡Perfecto! Aquí está todo lo que necesitas:

*📄 Documentos necesarios:*
1. Acta de nacimiento
2. Certificado de bachillerato
3. Comprobante de pago de inscripción

*🏦 Información bancaria:*
https://drive.google.com/file/d/1Hj9rRk1zHMWGnG_CjF287W-hxY2AoTe9/view?usp=drivesdk

*📋 Pasos a seguir:*
1️⃣ Realiza el pago de inscripción con los datos bancarios del enlace anterior.
2️⃣ Ingresa a https://www.windsor.edu.mx/solicitud-de-inscripcion y llena la *Solicitud de Inscripción para Licenciaturas* — ahí podrás adjuntar tus documentos directamente.
3️⃣ Confírmanos aquí por WhatsApp cuando hayas completado el formulario.
4️⃣ Un asesor revisará todo y confirmará tu inscripción. 😊`

const INSCRIPCION_BACHILLERATO_MSG = `🔴PROCESO DE INSCRIPCIÓN BACHILLERATO 🔴

Antes que nada permítenos felicitarte por tomar acción en tu proceso de crecimiento profesional y personal, estamos seguros que has tomado la decisión correcta y nos dará mucho gusto acompañarte en este proceso.

Para empezar tu proceso de inscripción vas a necesitar los siguientes archivos:

Acta de nacimiento, el archivo debe llevar el siguiente nombre:
Acta de nacimiento (tu nombre)

Certificado de secundaria, el archivo debe llevar el siguiente nombre:
Certificado de secundaria (tu nombre)

Comprobante de pago, el archivo debe llevar el siguiente nombre:
Comprobante de pago (tu nombre)

Haz clic en la liga para descargar la información de nuestra cuenta bancaria:
https://drive.google.com/file/d/1Hj9rRk1zHMWGnG_CjF287W-hxY2AoTe9/view?usp=drivesdk

🔵¿Ya tienes todos los documentos?

Por favor, sigue las indicaciones para completar tu inscripción.

1️⃣ Ingresar a https://www.windsor.edu.mx/solicitud-de-inscripcion y llenar la "solicitud de inscripción bachillerato / licenciatura"

2️⃣ Envíanos un mensaje por este medio cuando hayas terminado.

Listo, ya eres parte de la familia Windsor 🎉🎉🎉

¡¡BIENVENID@!!`

const INSCRIPCION_DIPLOMADO_MSG = `🔴PROCESO DE INSCRIPCIÓN DIPLOMADOS🔴

1️⃣ Enviar documentación escaneada al correo hola@windsor.edu.mx (copia de Acta de Nacimiento)

2️⃣ Ingresar a https://www.windsor.edu.mx/solicitud-de-inscripcion y llenar la solicitud de inscripción.

3️⃣ Una vez recibida la solicitud, te enviamos una referencia y la cuenta a la que harás tu pago.

Listo, ya eres parte de la familia Windsor 🎉🎉🎉

¡¡BIENVENID@!!`

const INSCRIPCION_IDIOMA_MSG = `🔴PROCESO DE INSCRIPCIÓN CURSOS DE IDIOMAS🔴

Antes que nada permítenos felicitarte por tomar acción en tu proceso de crecimiento profesional y personal, estamos seguros que has tomado la decisión correcta y nos dará mucho gusto acompañarte en este proceso.

Para empezar tu proceso de inscripción vas a necesitar los siguientes archivos:

Acta de nacimiento, el archivo debe llevar el siguiente nombre:
Acta de nacimiento (tu nombre)

Comprobante de pago, el archivo debe llevar el siguiente nombre:
Comprobante de pago (tu nombre)

Haz clic en la liga para descargar la información de nuestra cuenta bancaria:
https://drive.google.com/file/d/1Hj9rRk1zHMWGnG_CjF287W-hxY2AoTe9/view?usp=drivesdk

🔵¿Ya tienes todos los documentos?

Por favor, sigue las indicaciones para completar tu inscripción.

1️⃣ Ingresar a https://www.windsor.edu.mx/solicitud-de-inscripcion y llenar la "solicitud de inscripción cursos de idiomas"

2️⃣ Envíanos un mensaje por este medio cuando hayas terminado.

Listo, ya eres parte de la familia Windsor 🎉🎉🎉

¡¡BIENVENID@!!`

const INSCRIPCION_DESCONOCIDA_MSG = `¡Perfecto! 🎉 Para darte el proceso de inscripción exacto de tu programa, permíteme confirmarlo un momento con un asesor. En breve te contactamos. 😊`

/** Mensaje de inscripción para un tipo ya conocido (no llamar con 'desconocido': ese caso se maneja aparte, con alerta a Harold). */
function mensajeInscripcionPara(tipo: Exclude<TipoInscripcion, 'desconocido'>, curso?: string | null): string {
  switch (tipo) {
    case 'verano': return (curso || '').toLowerCase().includes('adulto') ? INSCRIPCION_VERANO_ADULTOS_MSG : INSCRIPCION_VERANO_NINOS_MSG
    case 'habilidades': return INSCRIPCION_HABILIDADES_MSG
    case 'bachillerato': return INSCRIPCION_BACHILLERATO_MSG
    case 'diplomado': return INSCRIPCION_DIPLOMADO_MSG
    case 'idioma': return INSCRIPCION_IDIOMA_MSG
    case 'licenciatura': return INSCRIPCION_LICS_MSG
  }
}

async function alertarProgramaNoReconocido(nombreLead: string | null | undefined, waNumber: string, curso: string | null | undefined) {
  try {
    await sendMetaWhatsAppMessage({
      to: ADMIN_WA_ALERTA,
      body: `⚠️ Programa no reconocido en flujo de inscripción: "${curso || '(vacío)'}"\nLead: ${nombreLead || waNumber} (${waNumber})\n\nAgrégalo a la lista correspondiente en lib/whatsapp/programas.ts (PROGRAMAS_LICENCIATURA, PROGRAMAS_VERANO_CORTO o PROGRAMAS_DIPLOMADO).`,
    })
  } catch (err) {
    console.error('[INSCRIPCION] Error alertando programa no reconocido:', err)
  }
}

const INSCRIPCION_HABILIDADES_MSG = `¡Perfecto! 😊 Para inscribirte al curso *Habilidades para la práctica psicoterapéutica* solo necesitas:

1️⃣ Llenar este formulario: https://docs.google.com/forms/d/e/1FAIpQLSf2QqhL5xo-C35_g2suWzMpX0oWpdvZS082DPHNksY-CcPNBQ/viewform
2️⃣ Realizar tu pago en efectivo directamente en las instalaciones ($300 alumnos Windsor / $400 público)

Confírmanos aquí cuando hayas completado el formulario. 🎉`

function buildInscripcionPresencialMsg(nombre?: string | null, email?: string | null, programa?: string | null, telefono?: string | null): string {
  const link = buildAgendarLink('inscripcion', nombre, email, programa, telefono)
  return `¡Perfecto! Para tu inscripción presencial necesitas traer los siguientes documentos:

📄 Acta de Nacimiento (original y 2 copias)
📄 Certificado de Bachillerato (original y 2 copias)
📄 2 Copias de la CURP (al 200%)
📷 6 Fotografías tamaño infantil blanco y negro
📁 1 Sobre-bolsa tamaño oficio plastificado
📝 Llenar la solicitud de inscripción

Te esperamos en cualquiera de nuestros planteles:

🏢 *Chilpancingo:* Sofía Tena #1, Col. Viguri
🏢 *Iguala:* Ignacio Zaragoza 99, Col. Centro

🕐 *Horarios:* Lun–Vie 8:00–14:00 y 17:00–20:00 | Sáb 8:00–14:00

👉 Agenda tu visita aquí:
${link}`
}

// Pendiente: agregar link del PDF del examen cuando el usuario lo proporcione
const EXAMEN_UBICACION_MSG = `¡Perfecto! 😊 El examen de ubicación es completamente *gratuito* y te tomará solo unos minutos.

Por favor haz clic en la liga, revisa el manual y sigue los pasos indicados:

📄 https://drive.google.com/file/d/1Ej1ZXKYnqFIi9J0SVrRyBHmAb-ohZ7A_/view?usp=sharing

Al finalizar, en la parte superior de la pantalla tendrás tu puntaje — toma una foto y envíanosla por este medio. 📸

Una vez que lo termines, te agendaremos tu clase de prueba gratuita. 🎓`

function buildClasePruebaMsg(nombre?: string | null, email?: string | null, programa?: string | null, telefono?: string | null): string {
  const link = buildAgendarLink('clase_prueba', nombre, email, programa, telefono)
  return `¡Excelente! 🎉 Ahora te invitamos a vivir una *clase de prueba gratuita*.

Tendrás la oportunidad de conocer a tu profesor(a), la metodología y a tus futuros compañeros — sin compromiso.

👉 Agenda tu clase aquí:
${link}

¿Te animas? 😊`
}

type GptBotResult = {
  respuesta: string
  siguienteFase: string
  nombre: string | null
  email: string | null
  programa: string | null
  telefono: string | null
  requestedHuman: boolean
  noInterest: boolean
  necesitaRevision?: boolean
}

/** Descarga un archivo multimedia de WhatsApp (Meta) usando el media id. */
async function getMetaMediaBuffer(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const { accessToken } = getMetaConfig()
  if (!accessToken) return null
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v23.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!metaRes.ok) return null
    const metaData = await metaRes.json()
    const url = metaData?.url as string | undefined
    const mimeType = (metaData?.mime_type as string | undefined) || 'application/octet-stream'
    if (!url) return null

    const fileRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!fileRes.ok) return null
    const arrayBuffer = await fileRes.arrayBuffer()
    return { buffer: Buffer.from(arrayBuffer), mimeType }
  } catch (e) {
    console.error('[getMetaMediaBuffer]', e)
    return null
  }
}

/** Transcribe una nota de voz con Whisper y devuelve el texto (o null si falla). */
async function transcribeAudioMessage(mediaId: string): Promise<string | null> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) return null
  const media = await getMetaMediaBuffer(mediaId)
  if (!media) return null
  try {
    const ext = media.mimeType.includes('mp4') ? 'mp4' : media.mimeType.includes('amr') ? 'amr' : 'ogg'
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(media.buffer)], { type: media.mimeType }), `audio.${ext}`)
    form.append('model', 'whisper-1')
    form.append('language', 'es')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      console.error('[transcribeAudioMessage] whisper error', await res.text().catch(() => ''))
      return null
    }
    const data = await res.json()
    const transcript = typeof data?.text === 'string' ? data.text.trim() : ''
    return transcript || null
  } catch (e) {
    console.error('[transcribeAudioMessage]', e)
    return null
  }
}

/** Describe una imagen recibida con GPT-4o vision y devuelve un texto usable como mensaje del usuario. */
async function describeImageMessage(mediaId: string): Promise<string | null> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) return null
  const media = await getMetaMediaBuffer(mediaId)
  if (!media) return null
  try {
    const base64 = media.buffer.toString('base64')
    const dataUrl = `data:${media.mimeType};base64,${base64}`
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Un lead de una escuela de idiomas (Instituto Windsor) envió esta imagen por WhatsApp. En 1-2 frases en español, describe qué contiene de forma útil para un asesor (ej. comprobante de pago con monto/folio, documento, captura de pantalla, foto personal, etc.). Si hay texto legible relevante (montos, fechas, folios, nombres), inclúyelo.',
              },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.error('[describeImageMessage] gpt error', await res.text().catch(() => ''))
      return null
    }
    const data = await res.json()
    const desc = data?.choices?.[0]?.message?.content?.trim()
    return desc ? `[Imagen] ${desc}` : null
  } catch (e) {
    console.error('[describeImageMessage]', e)
    return null
  }
}

async function getBotPrompt(): Promise<string> {
  try {
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from('whatsapp_flows')
      .select('config')
      .eq('activo', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const prompt = data?.config?.bot_prompt
    return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : ''
  } catch {
    return ''
  }
}

async function askGPT(params: {
  fase: string
  leadData: { nombre?: string | null; email?: string | null; curso?: string | null }
  userMessage: string
  ragContext: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<GptBotResult> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) throw new Error('No OPENAI_API_KEY')

  const faseInstruccion: Record<string, string> = {
    saludo: `Si el prospecto ya mencionó su nombre en este mensaje, extráelo en el campo "nombre" y avanza (siguienteFase: programa).
CRÍTICO — Nombres falsos: NUNCA extraigas como nombre palabras que no son nombres de persona. Las siguientes palabras NUNCA son nombres: Horarios, Info, Información, Costos, Precios, Hola, Buenas, Buenos, Gracias, Ok, Sí, No, Verano, Summer, Inglés, Licenciatura, Psicología, Bachillerato, Curso, Programa, Ayuda, Duda, Permiso, Saludos, Buenas noches, Buenos días. Si el prospecto manda solo una de estas palabras, NO la guardes como nombre — en su lugar, saluda y pide el nombre.
Si el prospecto hace una pregunta antes de dar su nombre:
- Si pregunta por precios, costos, mensualidades o descuentos: NO des precios específicos. Responde: "Tenemos buenas promociones vigentes — dame tu nombre y dime qué programa te interesa para darte los costos exactos 😊" y pide el nombre. Nunca inventes ni calcules precios en esta fase.
- Para otras preguntas (fechas de inicio, modalidad, duración, actividades): respóndelas brevemente con la BASE y luego pide su nombre para continuar.
No ignores la pregunta.
Si pregunta por varias licenciaturas o varios programas en general, menciona brevemente los programas disponibles y que hay promociones vigentes, pero NO intentes resumir precios de múltiples programas (podrías equivocarte). Pide su nombre y que elija un programa para darle el detalle exacto.
Si aún no ha dado su nombre ni hecho ninguna pregunta, saluda brevemente y pídelo.`,

    programa: `Ya tienes el nombre.
Si el prospecto dice "inglés" o "ingles" sin especificar más, NO asumas cuál — pregunta cuál de las tres opciones le interesa:
A) Inglés para adultos  B) Inglés para niños  C) Licenciatura en Inglés
En ese caso el campo "programa" debe ser null y siguienteFase: programa.
Si el prospecto mencionó un programa específico y sin ambigüedad (ej: "psicología", "inglés para niños", "maestría en innovación"), extráelo en el campo "programa" y responde brevemente confirmando su elección. siguienteFase: correo.
Si NO mencionó ningún programa, el campo "programa" debe ser null y pide amablemente que elija uno. siguienteFase: programa.
NO listes el catálogo tú mismo — eso se maneja de forma separada.`,

    correo: `El prospecto eligió un programa. ANTES de dar información del programa, pide su correo electrónico brevemente para dar seguimiento personalizado.
Si el prospecto proporciona un correo válido (debe contener @ y un dominio, ej. nombre@gmail.com), acusa recibo calurosamente — captura el email en el campo "email" del JSON y pon siguienteFase: info_enviada.
Si el mensaje NO contiene un correo válido (ej. responde "sí", "claro", "ok", "si claro", un nombre, o cualquier cosa sin @), NO avances — vuelve a pedir el correo con amabilidad, explicando que lo necesitas para enviarle la información. Deja "email": null y siguienteFase: correo.
Si explícitamente no quiere darlo o dice que no tiene, avanza de todas formas a info_enviada con "email": null.
No menciones el programa todavía — solo pide el correo.`,

    info_enviada: `Da la información del programa usando la BASE DE CONOCIMIENTO: duración, costos (inscripción y mensualidad), horarios, modalidad, certificaciones, campo laboral.
IMPORTANTE: SIEMPRE incluye la promoción vigente indicando el porcentaje de descuento y el precio final a pagar. Formatea así: "Inscripción: ~$PRECIO_ORIGINAL~ → $PRECIO_CON_DESCUENTO (X% de descuento)". Si la BASE no tiene el precio exacto con descuento, calcula el descuento a partir del porcentaje indicado.
NO incluyas el proceso de inscripción ni links de pago — eso se envía en otro paso.
SIEMPRE termina el mensaje con exactamente estas opciones, sin excepción:
A) Tengo dudas sobre el programa
B) Quiero inscribirme
(Si el programa es inglés adultos, inglés niños o cualquier curso de idiomas, agrega una tercera opción: "C) Quiero agendar mi examen de ubicación gratuito (opcional)". El examen es opcional y NUNCA sustituye a la opción B — quien quiera inscribirse debe poder hacerlo sin haberlo tomado)`,

    dudas: `Responde la duda con datos concretos de la BASE (costos, horarios, requisitos, etc.). Si la duda es sobre costos o precio, incluye siempre la promoción vigente con el porcentaje de descuento y el precio final (ej. "Inscripción: ~$2,300~ → $690 (70% de descuento)").
Si la pregunta es ambigua o indirecta, interpreta la intención del prospecto y busca en la BASE el tema más relacionado. Ejemplos:
- Si menciona que trabaja en alguna institución o pregunta por precio especial → busca convenios
- Si pregunta si el título "vale" o "sirve" → responde sobre RVOE y reconocimiento oficial
- Si pregunta qué necesita traer o si hay libros → responde sobre material
- Si pregunta cuánto tiempo o cuándo termina → responde sobre duración
Al terminar, vuelve a presentar:
A) Tengo más dudas
B) Quiero inscribirme
(Si es inglés adultos/niños, agrega: C) Quiero agendar mi examen de ubicación gratuito (opcional))
Si elige A → siguienteFase: dudas. Si elige B → siguienteFase: inscripcion. Si elige C (solo idiomas) → siguienteFase: examen.`,

    accion: `Si el prospecto hace una pregunta (sobre costos, horarios, uniformes, materiales, requisitos, etc.), respóndela primero con datos concretos de la BASE y luego presenta las opciones. Si solo responde con A/B/C o no hace ninguna pregunta, presenta directamente las opciones.
Opciones a presentar:
- Si el programa es inglés (niños o adultos): A) Tengo dudas  B) Quiero inscribirme  C) Quiero agendar mi examen de ubicación gratuito (opcional)
- Para todos los demás programas: A) Tengo dudas  B) Quiero inscribirme
El examen de ubicación (opción C) es opcional y NUNCA sustituye a la inscripción — no lo ofrezcas como si fuera el único camino.
Si elige A → siguienteFase: dudas. Si elige B → siguienteFase: inscripcion. Si elige C (solo idiomas) → siguienteFase: examen.`,

    asesor: `INFORMACIÓN DE CONTACTO DE LOS PLANTELES:
🏢 CHILPANCINGO: Sofía Tena #1, Col. Viguri | Tel: 747 472 8775 / 747 472 2466 / 747 491 4498
🏢 IGUALA: Ignacio Zaragoza 99, Col. Centro | Tel: 733 334 0498
Horarios: Lun–Vie 8:00–14:00 y 17:00–20:00 | Sáb 8:00–14:00

Flujo:
1. Si aún no mostraste los horarios: muéstralos y pregunta qué día y hora le viene mejor.
2. Si ya diste los horarios: pide su número de teléfono.
3. Si ya tienes el teléfono: confirma que un asesor lo llamará en ~1 hora desde uno de los números de los planteles.
Captura el teléfono en el campo "telefono" del JSON.`,

    seguimiento: `Responde cualquier pregunta del prospecto usando la BASE DE CONOCIMIENTO.
Si menciona un programa diferente al que tenía, da información sobre ese nuevo programa con entusiasmo.
Si pregunta sobre costos, horarios, requisitos, modalidad — responde con detalle usando la BASE.
Si la pregunta es ambigua o indirecta, interpreta la intención y busca en la BASE el tema más relacionado. Ejemplos:
- Si menciona que trabaja en alguna institución o pide precio especial → busca convenios vigentes
- Si pregunta si el título "vale" o "sirve" → responde sobre RVOE y reconocimiento oficial
- Si pregunta qué necesita traer o si hay libros → responde sobre material
- Si pregunta cuánto tiempo o cuándo termina → responde sobre duración
Si quiere inscribirse → siguienteFase: inscripcion. Si quiere el examen de ubicación (opcional, solo inglés) → siguienteFase: examen.
Si no hay una pregunta clara, recuérdale amablemente el siguiente paso según su programa.`,
    inscripcion_pendiente: `El lead está completando su inscripción a My Best Summer. Si hace una pregunta, respóndela PRIMERO antes de recordar los pasos:
- Diploma/certificado: "Sí, al concluir el nivel recibes un *Diploma avalado por la SEP* 🎓"
- Examen de colocación: "El examen es en línea, solo necesitas tu dispositivo con internet 📱 Te compartimos el link al inscribirte"
- Días del curso: lunes a viernes | Niños: 9:00–13:30 | Adultos: 9:00–12:00 o 13:00–16:00
- Materiales/útiles: el costo de $400 MXN de materiales ya incluye todo lo necesario
Si confirma que ya pagó o completó el formulario → siguienteFase: seguimiento.`,
    cerrado: 'La conversación está cerrada. Pregunta amablemente si puedes ayudarle en algo más. Si el prospecto pide hablar con alguien, quiere más información o retoma el interés, pon requestedHuman: true y siguienteFase: asesor.',
    perdido: 'El prospecto no estaba interesado. Si vuelve a escribir, responde con amabilidad.',
  }

  const savedBotPrompt = await getBotPrompt()

  const baseInstructions = savedBotPrompt ||
    `Eres un asesor comercial de Instituto Windsor (escuela en México) que atiende prospectos por WhatsApp.
Tu objetivo es generar confianza y llevar al prospecto a inscribirse.
Tono: amable, directo, como una persona real — no un robot.`

  const leadContext = [
    `Nombre: ${params.leadData.nombre || 'no capturado aún'}`,
    `Email: ${params.leadData.email || 'no capturado aún'}`,
    `Programa de interés: ${params.leadData.curso || 'no identificado aún'}`,
  ].join('\n')

  const systemPrompt = `${baseInstructions}

DATOS ACTUALES DEL PROSPECTO:
${leadContext}

FASE ACTUAL: ${params.fase}
QUÉ HACER AHORA: ${faseInstruccion[params.fase] ?? 'Responde de forma natural y útil.'}

${params.ragContext ? `BASE DE CONOCIMIENTO (úsala si es relevante):\n${params.ragContext}\n` : ''}
REGLAS:
${REGLAS_NEGOCIO}
- "siguienteFase": saludo, programa, correo, info_enviada, dudas, accion, asesor, inscripcion, clase_prueba, cerrado, perdido, seguimiento.

Responde ÚNICAMENTE con JSON válido:
{
  "respuesta": "mensaje que se enviará al prospecto por WhatsApp",
  "siguienteFase": "fase_siguiente",
  "nombre": null,
  "email": null,
  "programa": null,
  "telefono": null,
  "requestedHuman": false,
  "noInterest": false,
  "necesitaRevision": false
}`

  console.log('[BOT PROMPT] fase:', params.fase)
  console.log('[BOT SYSTEM PROMPT]', systemPrompt)
  console.log('[BOT USER MESSAGE]', params.userMessage)

  const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...(params.history || []),
        { role: 'user', content: params.userMessage },
      ],
      temperature: 0.6,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(13000),
  })

  if (!chatRes.ok) throw new Error(`OpenAI error ${chatRes.status}`)

  const data = await chatRes.json()
  const content = data.choices?.[0]?.message?.content || '{}'
  const parsed = JSON.parse(content)

  return {
    respuesta: typeof parsed.respuesta === 'string' && parsed.respuesta ? parsed.respuesta : 'Disculpa, ¿me repites?',
    siguienteFase: typeof parsed.siguienteFase === 'string' ? parsed.siguienteFase : params.fase,
    nombre: typeof parsed.nombre === 'string' ? parsed.nombre : null,
    email: typeof parsed.email === 'string' && parsed.email.includes('@') ? parsed.email : null,
    programa: typeof parsed.programa === 'string' ? parsed.programa : null,
    telefono: typeof parsed.telefono === 'string' ? parsed.telefono : null,
    requestedHuman: Boolean(parsed.requestedHuman),
    noInterest: Boolean(parsed.noInterest),
    necesitaRevision: Boolean(parsed.necesitaRevision),
  }
}

/** Arma el mensaje informativo de un programa + CTA, listo para fase 'accion'.
 * Usa INFO_MSGS si existe (caso común); si no (maestrías, diplomados, francés,
 * italiano), cae a RAG+GPT — mismo patrón que ya usan las fases 'correo' e
 * "interceptor global: cambio de programa" más abajo en este archivo. */
async function buildProgramInfoMessage(
  programa: string,
  requestUrl: string,
  leadData: { nombre?: string | null; email?: string | null },
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const infoMsg = INFO_MSGS[programa]
  if (infoMsg) {
    return infoMsg + buildCTA(programa)
  }
  let ragContext = ''
  try {
    const ragUrl = new URL('/api/rag/query', new URL(requestUrl).origin)
    const ragRes = await fetch(ragUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: `${programa} en Instituto Windsor: costos, horarios, duración, modalidad, certificaciones, campo laboral`, match_count: 15 }),
      signal: AbortSignal.timeout(8000),
    })
    if (ragRes.ok) {
      const rd = await ragRes.json()
      ragContext = typeof rd?.context === 'string' ? rd.context : rd?.answer || ''
    }
  } catch { /* sin RAG */ }
  const gpt = await askGPT({
    fase: 'info_enviada',
    leadData: { nombre: leadData.nombre, email: leadData.email, curso: programa },
    userMessage: 'Dame información del programa',
    ragContext,
    history,
  })
  return gpt.respuesta + buildCTA(programa)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const { verifyToken } = getMetaConfig()

  if (mode === 'subscribe' && token && verifyToken && token === verifyToken) {
    return new Response(challenge || '', { status: 200 })
  }

  return new Response('Forbidden', { status: 403 })
}

export async function POST(request: Request) {
  let waNumber = ''
  try {
    let leadSummary = ''
    let leadId: string | undefined
    let humanMode = false
    let currentFase = 'saludo'
    let conversacionIdOuter: string | undefined

    let incoming = await parseIncomingWhatsAppMessage(request)
    if (!incoming) {
      return Response.json({ ok: true, ignored: true })
    }

    // Deduplicación por MessageSid de Twilio — evita procesar retries del webhook
    if (incoming.messageSid) {
      const supabaseDedup = createServiceRoleClient()
      const { data: existing } = await supabaseDedup
        .from('whatsapp_mensajes')
        .select('id')
        .eq('rol', 'usuario')
        .contains('raw_payload', { MessageSid: incoming.messageSid })
        .limit(1)
        .maybeSingle()
      if (existing?.id) {
        return incoming.provider === 'twilio'
          ? buildTwiml('')
          : Response.json({ ok: true, deduplicated: true })
      }
    }

    // Notas de voz e imágenes: transcribir / describir antes de procesar, para que
    // el mensaje fluya como texto normal por el resto del pipeline. Si falla, se
    // deja el sentinel '__MEDIA__' y sigue el fallback de "no podemos procesar".
    if (incoming.body === '__MEDIA__' && incoming.mediaId) {
      const resolvedText =
        incoming.mediaKind === 'audio'
          ? await transcribeAudioMessage(incoming.mediaId)
          : incoming.mediaKind === 'image'
            ? await describeImageMessage(incoming.mediaId)
            : null
      if (resolvedText) {
        incoming = { ...incoming, body: resolvedText }
      }
    }

    const provider = incoming.provider || getWhatsAppProvider()
    const originalText = incoming.body.trim().normalize('NFC')
    const text = originalText.toLowerCase()
    waNumber = incoming.waNumber || ''
    const profileName = incoming.profileName || ''
    const referral = incoming.referral

    // ── Comando "memoria" — nota para el asistente de IA, el bot no debe responder como si fuera cliente ──
    if (waNumber) {
      const supabaseMemoria = createServiceRoleClient()
      const memoriaResponse = await handleMemoriaCommand(supabaseMemoria, provider, waNumber, originalText)
      if (memoriaResponse) return memoriaResponse
    }

    // ── Comando "registro" — alta rápida de leads, bypassea el flujo normal de prospecto ──
    if (waNumber) {
      const supabaseRegistro = createServiceRoleClient()
      const registroResponse = await handleRegistroCommand(supabaseRegistro, provider, waNumber, originalText)
      if (registroResponse) return registroResponse
    }

    let leadSnapshot: LeadSnapshot | null = null

    // Crear lead y conversación automáticamente en Supabase con el número de WhatsApp
    if (waNumber) {
      try {
        const supabase = createServiceRoleClient()

        // Normalizamos el número como lo recibimos, sin transformarlo más
        const whatsappValue = waNumber
        const esMessenger = provider === 'messenger'
        const leadIdentityColumn = esMessenger ? 'messenger_psid' : 'whatsapp'

        // Verificar si ya existe un lead con este identificador (teléfono o PSID de Messenger)
        const { data: existingLead } = await supabase
          .from('leads')
          .select('id, nombre, email, curso, stage, whatsapp')
          .eq(leadIdentityColumn, whatsappValue)
          .maybeSingle()

        leadId = existingLead?.id as string | undefined
        leadSnapshot = (existingLead as LeadSnapshot | null) || null

        if (!leadId) {
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
          const defaultAssignee = await getDefaultAssigneeId(supabase)

          const origenLead = esMessenger ? 'messenger_bot' : referral ? 'meta_ads' : 'bot'
          const { data: insertedLead } = await supabase
            .from('leads')
            .upsert(
              [
                {
                  nombre: '',
                  email: '',
                  ...(esMessenger ? { messenger_psid: whatsappValue } : { whatsapp: whatsappValue }),
                  curso: esMessenger ? 'Messenger - Instituto Windsor' : 'WhatsApp - Instituto Windsor',
                  valor: 0,
                  notas: `Lead creado automáticamente desde ${esMessenger ? 'Messenger' : 'WhatsApp'}.${profileName ? ' Nombre WA: ' + profileName : ''}`,
                  stage: 'contactado',
                  fecha: today,
                  origen: origenLead,
                  ...(defaultAssignee ? { asignado_a: defaultAssignee } : {}),
                },
              ],
              { onConflict: leadIdentityColumn, ignoreDuplicates: true }
            )
            .select('id, nombre, email, curso, stage, whatsapp')
            .maybeSingle()

          // Si upsert no devolvió nada (ya existía), buscar el lead existente
          const finalLead = insertedLead ?? (await supabase
            .from('leads')
            .select('id, nombre, email, curso, stage, whatsapp')
            .eq(leadIdentityColumn, whatsappValue)
            .maybeSingle()).data

          leadId = finalLead?.id
          leadSnapshot = (finalLead as LeadSnapshot | null) || null

          if (leadId) {
            const { error: activityError } = await supabase.from('lead_activities').insert([
              {
                lead_id: leadId,
                actor_id: null,
                event_type: 'primer_contacto',
                title: 'Primer contacto',
                detail: esMessenger
                  ? 'Contacto entrante por Messenger.'
                  : referral ? 'Contacto entrante por WhatsApp desde anuncio de Meta Ads.' : 'Contacto entrante por WhatsApp.',
                meta: { source: esMessenger ? 'messenger' : 'whatsapp', provider, ...(referral ? { referral } : {}) },
              },
            ])
            if (activityError) {
              console.error('[webhook whatsapp] lead_activities primer_contacto', activityError)
            }
            // Notificar al asesor del nuevo lead
            await notifyAsesor(supabase, leadId, 'nuevo_lead',
              insertedLead?.nombre, whatsappValue, insertedLead?.curso, originalText)
          }
        }

        const desiredPhase = getNextDataPhase(leadSnapshot, whatsappValue)

        // Crear o reutilizar conversación de WhatsApp
        let conversacionId: string | undefined
        let conversacionRow: ConversationRow | null = null
        const { data: existingConv } = await supabase
          .from('whatsapp_conversaciones')
          .select('id, modo_humano, fase')
          .eq('whatsapp', whatsappValue)
          .order('ultimo_mensaje_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (existingConv?.id) {
          conversacionId = existingConv.id
          const nextConversationUpdate: {
            lead_id: string | null
            estado: string
            fase?: string
          } = {
            lead_id: leadId ?? null,
            estado:
              existingConv.fase === 'cerrado' || existingConv.fase === 'perdido'
                ? 'cerrada'
                : 'abierta',
          }
          if (
            existingConv.fase === 'saludo' ||
            existingConv.fase === 'programa' ||
            existingConv.fase === 'correo'
          ) {
            nextConversationUpdate.fase = desiredPhase
          }
          await supabase
            .from('whatsapp_conversaciones')
            .update(nextConversationUpdate)
            .eq('id', existingConv.id)
          // Refleja de inmediato el salto de fase (si hubo) para que el resto de
          // este mismo request use la fase nueva, no la vieja recién leída de la DB.
          conversacionRow = { ...existingConv, fase: nextConversationUpdate.fase ?? existingConv.fase }
        } else {
          const { data: nuevaConv } = await supabase
            .from('whatsapp_conversaciones')
            .insert([
              {
                whatsapp: whatsappValue,
                lead_id: leadId ?? null,
                estado: 'abierta',
                fase: desiredPhase,
                provider,
              },
            ])
            .select('id, modo_humano, fase')
            .single()
          conversacionId = nuevaConv?.id
          conversacionRow = nuevaConv || null
        }

        humanMode = Boolean(conversacionRow?.modo_humano)
        conversacionIdOuter = conversacionId
        currentFase = (conversacionRow?.fase as string) || 'saludo'

        // Registrar mensaje del usuario
        let myMessageId: string | undefined
        if (conversacionId) {
          const { data: insertedUserMsg } = await supabase.from('whatsapp_mensajes').insert([
            {
              conversacion_id: conversacionId,
              rol: 'usuario',
              contenido: originalText || '',
              raw_payload: incoming.rawPayload,
            },
          ]).select('id').single()

          myMessageId = insertedUserMsg?.id

          // actualizar timestamp de último mensaje
          await supabase
            .from('whatsapp_conversaciones')
            .update({ ultimo_mensaje_at: new Date().toISOString() })
            .eq('id', conversacionId)

          // Cancelar seguimientos pendientes — el lead respondió, la secuencia se cierra
          if (leadId) {
            await supabase
              .from('seguimientos')
              .update({ estado: 'cancelado', fecha_completado: new Date().toISOString() })
              .eq('lead_id', leadId)
              .eq('estado', 'pendiente')
          }

          // Anti-duplicados / debounce: esperar y verificar que no llegó un mensaje más
          // reciente. Antes eran 1.5s, insuficientes para agrupar mensajes seguidos del
          // lead (ej. dos preguntas con 8s de diferencia se procesaban por separado y
          // una podía escalar mientras la otra contestaba directo — ver caso reportado
          // 2026-08-06, +527472532394). Subido a 8s por decisión de Harold.
          await new Promise(r => setTimeout(r, 8000))
          const { data: latestUserMsg } = await supabase
            .from('whatsapp_mensajes')
            .select('id')
            .eq('conversacion_id', conversacionId)
            .eq('rol', 'usuario')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (latestUserMsg?.id && latestUserMsg.id !== myMessageId) {
            // Llegó un mensaje más reciente — ceder el procesamiento a esa instancia
            return provider === 'twilio'
              ? buildTwiml('')
              : Response.json({ ok: true })
          }
        }

        // Cargar resumen del lead para "memoria" del bot
        if (leadId) {
          const { data: lead } = await supabase
            .from('leads')
            .select('nombre, email, whatsapp, curso, stage, notas')
            .eq('id', leadId)
            .maybeSingle()

          if (lead) {
            const partes: string[] = []
            if (lead.nombre) partes.push(`Nombre: ${lead.nombre}`)
            if (lead.email) partes.push(`Email: ${lead.email}`)
            if (lead.whatsapp) partes.push(`WhatsApp: ${lead.whatsapp}`)
            if (lead.curso) partes.push(`Programa: ${lead.curso}`)
            if (lead.stage) partes.push(`Stage CRM: ${lead.stage}`)
            if (lead.notas) partes.push(`Notas: ${lead.notas}`)
            leadSummary = partes.join(' | ')
          }
        }
      } catch (e) {
        console.error('[webhook] Error creando lead/conversación:', e)
      }
    }

    // Si la conversación está en modo humano (tomada por un vendedor),
    // solo registramos el mensaje y NO respondemos automáticamente.
    if (humanMode) {
      return provider === 'meta'
        ? Response.json({ ok: true, humanMode: true })
        : new Response('', { status: 200 })
    }

    // Si la conversación quedó marcada como perdida/cerrada (ej. el lead pidió
    // cancelar o el bot dio por concluido el caso) y el lead vuelve a escribir,
    // NO seguir con el flujo automático de ventas — solo notificar a un asesor
    // para que decida cómo retomarla (puede ser sensible, ej. cancelaciones/reembolsos).
    if ((currentFase === 'perdido' || currentFase === 'cerrado') && leadId) {
      const supabasePerdido = createServiceRoleClient()
      await notifyAsesor(supabasePerdido, leadId, 'lead_perdido_reescribio',
        leadSnapshot?.nombre, waNumber, leadSnapshot?.curso, originalText).catch(() => {})
      return provider === 'meta'
        ? Response.json({ ok: true, perdidoReescribio: true })
        : new Response('', { status: 200 })
    }

    // ── Respuesta de Harold al bot (human-in-the-loop) ───────────────────────────
    const HAROLD_NUMBER = ADMIN_WA_ALERTA
    if (waNumber === HAROLD_NUMBER || waNumber === '+' + HAROLD_NUMBER) {
      const supabaseHL = createServiceRoleClient()

      // Patrón "A ok" → Harold aprueba un borrador
      const matchAprobacion = originalText.trim().match(/^([a-z])\s*ok\b/i)
      if (matchAprobacion) {
        const codigo = matchAprobacion[1].toLowerCase()
        const { data: convAprobacion } = await supabaseHL
          .from('whatsapp_conversaciones')
          .select('id, whatsapp, lead_id, revision_draft')
          .eq('revision_codigo', codigo)
          .order('revision_codigo_asignado_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()

        if ((convAprobacion as any)?.revision_draft) {
          const draft = (convAprobacion as any).revision_draft as string
          await sendMetaWhatsAppMessage({ to: (convAprobacion as any).whatsapp, body: draft })
          await supabaseHL.from('whatsapp_mensajes').insert([{
            conversacion_id: (convAprobacion as any).id,
            rol: 'bot',
            contenido: draft,
          }])
          await supabaseHL.from('whatsapp_conversaciones')
            .update({ revision_codigo: null, revision_draft: null, revision_codigo_asignado_at: null, modo_humano: false, ultimo_mensaje_at: new Date().toISOString() })
            .eq('id', (convAprobacion as any).id)
          await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: `✅ [${codigo.toUpperCase()}] Enviado.` })
        } else {
          await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: `⚠️ No encontré borrador para [${codigo.toUpperCase()}]. ¿Ya fue respondido?` })
        }
        return Response.json({ ok: true, haroldApproved: true })
      }

      // Patrón "A: explicación" → Harold explica, GPT redacta borrador
      const matchInstruccion = originalText.trim().match(/^([a-z]):\s*([\s\S]+)/i)
      if (matchInstruccion) {
        const codigo = matchInstruccion[1].toLowerCase()
        const instruccion = matchInstruccion[2].trim()

        const { data: convInstruccion } = await supabaseHL
          .from('whatsapp_conversaciones')
          .select('id, whatsapp, lead_id')
          .eq('revision_codigo', codigo)
          .order('revision_codigo_asignado_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()

        if (convInstruccion) {
          const { data: leadInfo } = await supabaseHL
            .from('leads')
            .select('nombre, curso')
            .eq('id', (convInstruccion as any).lead_id)
            .maybeSingle()

          const { data: lastUserMsg } = await supabaseHL
            .from('whatsapp_mensajes')
            .select('contenido')
            .eq('conversacion_id', (convInstruccion as any).id)
            .eq('rol', 'usuario')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          try {
            const draftPrompt = `Eres el bot de Instituto Windsor. El lead preguntó: "${(lastUserMsg as any)?.contenido || ''}". El asesor da esta información: "${instruccion}". Redacta un mensaje corto y amable para WhatsApp con esa información. Solo el mensaje, sin comillas, usa *negrita* para resaltar. Máximo 3 líneas.`
            const draftRes = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
              body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: draftPrompt }], temperature: 0.4, max_tokens: 200 }),
              signal: AbortSignal.timeout(8000),
            })
            const draftData = await draftRes.json()
            const draft = draftData.choices?.[0]?.message?.content?.trim() || instruccion

            await supabaseHL.from('whatsapp_conversaciones')
              .update({ revision_draft: draft })
              .eq('id', (convInstruccion as any).id)

            const nombre = (leadInfo as any)?.nombre || 'el lead'
            const preview = `✏️ *[${codigo.toUpperCase()}]* Borrador para ${nombre}:\n\n"${draft}"\n\n¿Envío? Responde *${codigo.toUpperCase()} ok* para confirmar.`
            await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: preview })
          } catch (e) {
            console.error('[Harold instruccion GPT]', e)
            await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: `⚠️ Error al generar borrador. Inténtalo de nuevo.` })
          }
        } else {
          await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: `⚠️ No encontré conversación pendiente para [${codigo.toUpperCase()}].` })
        }
        return Response.json({ ok: true, haroldInstruction: true })
      }

      // Flujo legado: buscar conversación en fase 'revisando' (backward compatibility)
      const { data: convRevisando } = await supabaseHL
        .from('whatsapp_conversaciones')
        .select('id, whatsapp, lead_id')
        .eq('fase', 'revisando')
        .order('ultimo_mensaje_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (convRevisando) {
        const respuestaHarold = originalText.trim()
        await supabaseHL.from('whatsapp_mensajes').insert([{
          conversacion_id: convRevisando.id,
          rol: 'agente',
          contenido: `[Revisado por Harold]: ${respuestaHarold}`,
        }])
        await sendMetaWhatsAppMessage({ to: convRevisando.whatsapp, body: respuestaHarold })
        await supabaseHL.from('whatsapp_conversaciones')
          .update({ fase: 'seguimiento', ultimo_mensaje_at: new Date().toISOString() })
          .eq('id', convRevisando.id)
        await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: `✅ Respuesta enviada al lead.` })
        return Response.json({ ok: true, haroldReply: true })
      }
      // Sin conversación en revisando → Harold consulta el CRM en lenguaje natural
      // Solo se activa si el mensaje empieza con "crm"
      if (!/^crm\b/i.test(originalText.trim())) {
        return Response.json({ ok: true, haroldIgnored: true })
      }
      const supabaseAd = createServiceRoleClient()
      const pregunta = originalText.trim().replace(/^crm\s*/i, '').trim() || 'dame un resumen general'

      // ── Shortcut: "crm pendientes" → reporte por asesor sin GPT ─────────────
      if (/^pendientes?\b/i.test(pregunta)) {
        try {
          const { data: pendientes } = await supabaseAd
            .from('seguimientos')
            .select('lead_id, lead_nombre, lead_whatsapp, lead_curso, tier, tipo')
            .eq('estado', 'pendiente')
            .order('tier', { ascending: true })

          if (!pendientes?.length) {
            await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: '✅ No hay seguimientos pendientes hoy.' })
            return Response.json({ ok: true, adminPendientes: true })
          }

          // Obtener asignaciones de leads
          const leadIds = [...new Set(pendientes.map((s: any) => s.lead_id))]
          const { data: leadsAsignados } = await supabaseAd
            .from('leads')
            .select('id, asignado_a')
            .in('id', leadIds)

          const { data: perfiles } = await supabaseAd
            .from('profiles')
            .select('id, nombre')

          const asesorNombre = (id: string | null) => {
            if (!id) return 'Sin asignar'
            const p = (perfiles || []).find((p: any) => p.id === id)
            return (p as any)?.nombre || 'Sin asignar'
          }

          const asignacionMap: Record<string, string> = {}
          for (const l of leadsAsignados || []) {
            asignacionMap[(l as any).id] = (l as any).asignado_a
          }

          const tipoEmoji: Record<string, string> = {
            llamada: '📞 Llamar a',
            mensaje_wa: '💬 Mensaje a',
            template: '📋 Template a',
          }

          // Agrupar por asesor
          const porAsesor: Record<string, { asesorNombre: string; items: string[] }> = {}
          for (const s of pendientes as any[]) {
            const aid = asignacionMap[s.lead_id] || null
            const nombre = asesorNombre(aid)
            if (!porAsesor[nombre]) porAsesor[nombre] = { asesorNombre: nombre, items: [] }
            const tel = (s.lead_whatsapp || '').replace(/\D/g, '').replace(/^52/, '')
            const emoji = tipoEmoji[s.tipo] || '➡️'
            const leadInfo = s.lead_nombre || '(sin nombre)'
            const curso = s.lead_curso ? ` — ${s.lead_curso}` : ''
            const telStr = s.tipo === 'llamada' && tel ? ` · ${tel}` : ''
            porAsesor[nombre].items.push(`  ${emoji} ${leadInfo}${telStr}${curso}`)
          }

          const ahora = new Date()
          const fechaStr = ahora.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
          const lineas = [`📋 *Pendientes del día — ${fechaStr}*\n`]

          for (const [nombre, grupo] of Object.entries(porAsesor)) {
            lineas.push(`👤 *${nombre}* (${grupo.items.length}):`)
            lineas.push(...grupo.items)
            lineas.push('')
          }

          await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: lineas.join('\n').trim() })
        } catch (e) {
          console.error('[CRM Pendientes Harold]', e)
          await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: '⚠️ Error consultando pendientes. Intenta de nuevo.' })
        }
        return Response.json({ ok: true, adminPendientes: true })
      }

      try {
        const ahora = new Date()
        const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).toISOString()
        const inicioAyer = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 1).toISOString()
        const hace48h = new Date(ahora.getTime() - 48 * 60 * 60 * 1000).toISOString()
        const hace7d = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

        const [
          { data: todosLeads },
          { data: nuevosHoy },
          { data: nuevosAyer },
          { data: nuevos7d },
          { data: convsSinRespuesta },
        ] = await Promise.all([
          supabaseAd.from('leads').select('nombre, whatsapp, curso, stage, created_at').order('created_at', { ascending: false }).limit(200),
          supabaseAd.from('leads').select('nombre, curso, stage').gte('created_at', inicioHoy),
          supabaseAd.from('leads').select('nombre, curso, stage').gte('created_at', inicioAyer).lt('created_at', inicioHoy),
          supabaseAd.from('leads').select('nombre, curso, stage').gte('created_at', hace7d),
          supabaseAd.from('whatsapp_conversaciones').select('whatsapp, fase, ultimo_mensaje_at').lt('ultimo_mensaje_at', hace48h).not('fase', 'in', '(cerrado,perdido)').limit(50),
        ])

        const porStage = (todosLeads || []).reduce((acc: Record<string, number>, l) => {
          const s = l.stage || 'sin_stage'; acc[s] = (acc[s] || 0) + 1; return acc
        }, {})

        const porCurso = (todosLeads || []).reduce((acc: Record<string, number>, l) => {
          const c = l.curso || 'sin_curso'; acc[c] = (acc[c] || 0) + 1; return acc
        }, {})

        const listaRecientes = (todosLeads || []).slice(0, 15)
          .map(l => `• ${l.nombre || '(sin nombre)'} | ${l.curso || '—'} | stage: ${l.stage || '—'} | ${new Date(l.created_at).toLocaleDateString('es-MX')}`)
          .join('\n')

        const listaHoy = (nuevosHoy || []).map(l => `• ${l.nombre || '(sin nombre)'} — ${l.curso || '—'} [${l.stage || '—'}]`).join('\n') || 'Ninguno'
        const listaAyer = (nuevosAyer || []).map(l => `• ${l.nombre || '(sin nombre)'} — ${l.curso || '—'} [${l.stage || '—'}]`).join('\n') || 'Ninguno'

        const contexto = `Fecha actual: ${ahora.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ${ahora.toLocaleTimeString('es-MX')}

TOTAL DE LEADS EN CRM: ${(todosLeads || []).length}

LEADS POR STAGE (etapa en el CRM):
${Object.entries(porStage).map(([s, n]) => `- ${s}: ${n}`).join('\n')}

LEADS POR CURSO/OFERTA:
${Object.entries(porCurso).map(([c, n]) => `- ${c}: ${n}`).join('\n')}

NUEVOS HOY (${(nuevosHoy || []).length}):
${listaHoy}

NUEVOS AYER (${(nuevosAyer || []).length}):
${listaAyer}

NUEVOS ESTA SEMANA: ${(nuevos7d || []).length}

CONVERSACIONES SIN RESPUESTA DEL LEAD EN +48H: ${(convsSinRespuesta || []).length}

ÚLTIMOS 15 LEADS REGISTRADOS:
${listaRecientes}

STAGES POSIBLES: primer_contacto, contactado, interesado, inscripcion_pendiente, inscrito, perdido`

        const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `Eres el asistente del CRM del Instituto Windsor. Harold te hace preguntas sobre los leads y tú respondes con los datos del CRM. Responde de forma concisa y directa para WhatsApp. Usa *negrita* para resaltar números importantes. Máximo 25 líneas. Si la pregunta no es sobre el CRM, di que solo puedes consultar datos del CRM.`,
              },
              {
                role: 'user',
                content: `Datos del CRM:\n${contexto}\n\nPregunta de Harold: ${pregunta}`,
              },
            ],
            temperature: 0.2,
            max_tokens: 600,
          }),
          signal: AbortSignal.timeout(10000),
        })

        const gptData = await gptRes.json()
        const respuestaCRM = gptData.choices?.[0]?.message?.content?.trim() || '⚠️ No pude generar la respuesta. Intenta de nuevo.'
        await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: respuestaCRM })
      } catch (e) {
        console.error('[CRM Query Harold]', e)
        await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: '⚠️ Error consultando el CRM. Intenta de nuevo.' })
      }
      return Response.json({ ok: true, adminQuery: true })
    }

    // ── Quick Reply: lead toca "Sí, envíame la info" ────────────────────────────
    if (/env[ií]ame\s*la\s*info/i.test(originalText) && conversacionIdOuter) {
      const supabaseQR = createServiceRoleClient()
      const curso = leadSnapshot?.curso
      const infoMsg = curso ? INFO_MSGS[curso] : null
      if (infoMsg) {
        const msgFull = infoMsg + buildCTA(curso)
        await logBotMessageAndUpdateFase(supabaseQR, conversacionIdOuter, msgFull, 'accion', leadId)
        return buildProviderResponse(provider, msgFull, waNumber)
      }
      // Fallback RAG+GPT para programas sin INFO_MSG (maestrías, diplomados, etc.)
      let ragQR = ''
      try {
        const ragUrlQR = new URL('/api/rag/query', new URL(request.url).origin)
        const ragResQR = await fetch(ragUrlQR.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: `${curso} en Instituto Windsor: costos, horarios, duración, modalidad`, match_count: 15 }),
          signal: AbortSignal.timeout(8000),
        })
        if (ragResQR.ok) {
          const rdQR = await ragResQR.json()
          ragQR = typeof rdQR?.context === 'string' ? rdQR.context : rdQR?.answer || ''
        }
      } catch { /* sin RAG */ }
      const gptQR = await askGPT({
        fase: 'info_enviada',
        leadData: { nombre: leadSnapshot?.nombre, email: leadSnapshot?.email, curso },
        userMessage: 'Dame información del programa',
        ragContext: ragQR,
        history: [],
      })
      const msgGptQR = gptQR.respuesta + buildCTA(curso)
      await logBotMessageAndUpdateFase(supabaseQR, conversacionIdOuter, msgGptQR, 'accion', leadId)
      return buildProviderResponse(provider, msgGptQR, waNumber)
    }

    // Mensaje multimedia (audio, imagen, video, etc.) — no podemos procesarlo
    if (originalText === '__MEDIA__') {
      const faseActual = currentFase
      const contextHint =
        faseActual === 'saludo' ? ' ¿Me puedes decir tu nombre?' :
        faseActual === 'programa' ? ' ¿Qué programa te interesa?' :
        faseActual === 'correo' ? ' ¿Me compartes tu correo electrónico?' : ''
      const audioMsg = `Lo sentimos, por el momento no podemos procesar notas de voz ni archivos multimedia. Por favor escríbenos tu mensaje en texto y con gusto te atendemos. 😊${contextHint}`
      if (conversacionIdOuter) {
        const supabase = createServiceRoleClient()
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, audioMsg)
      }
      return buildProviderResponse(provider, audioMsg, waNumber)
    }

    // Intentar aplicar flow de reglas (keyword-based) antes de la lógica fija/RAG
    let flowAnswer: string | null = null
    let flowUsesRag = false

    try {
      const supabaseFlow = createServiceRoleClient()
      const { data: flow } = await supabaseFlow
        .from('whatsapp_flows')
        .select('config')
        .eq('activo', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const cfg = (flow?.config as FlowConfig | null) ?? null
      const rules = Array.isArray(cfg?.rules) ? cfg.rules : []

      for (const rule of rules) {
        const matchText = ((rule.match || rule.contains || '') as string).toLowerCase().trim()
        if (!matchText) continue

        if (text.includes(matchText)) {
          if (rule.use_rag || rule.type === 'rag') {
            flowUsesRag = true
          } else {
            flowAnswer = (rule.answer as string) || (rule.response as string) || null
          }
          break
        }
      }
    } catch {
      // Si falla el flow, seguimos con la lógica normal
    }

    // Fallback: si tenemos número pero no conversación (ej. error en el try anterior), buscar conv existente
    if (waNumber && !conversacionIdOuter) {
      try {
        const supabaseFallback = createServiceRoleClient()
        const whatsappValue = waNumber
        const { data: convExistente } = await supabaseFallback
          .from('whatsapp_conversaciones')
          .select('id, modo_humano, fase, lead_id')
          .eq('whatsapp', whatsappValue)
          .order('ultimo_mensaje_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (convExistente?.id) {
          conversacionIdOuter = convExistente.id
          currentFase = (convExistente.fase as string) || 'saludo'
          humanMode = Boolean(convExistente.modo_humano)
          if (convExistente.lead_id && !leadId) leadId = convExistente.lead_id as string
        }
      } catch {
        // ignorar
      }
    }

    // Compatibilidad: fases antiguas se tratan como programa
    const phase = currentFase === 'datos' || currentFase === 'info_programa' ? 'programa' : currentFase

    // ── Flow de reglas por keyword (respuesta fija, sin GPT) ─────────────────
    if (flowAnswer && !flowUsesRag && conversacionIdOuter) {
      const supabaseFlow = createServiceRoleClient()
      await logBotMessageAndUpdateFase(supabaseFlow, conversacionIdOuter, flowAnswer)
      return buildProviderResponse(provider, flowAnswer, waNumber)
    }

    // ── Orquestación principal con GPT-4o ────────────────────────────────────
    if (conversacionIdOuter && waNumber) {
      const supabase = createServiceRoleClient()

      // Cargar historial de conversación (necesario para programa y fases posteriores)
      let convHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
      try {
        const { data: histMsgs } = await supabase
          .from('whatsapp_mensajes')
          .select('rol, contenido')
          .eq('conversacion_id', conversacionIdOuter)
          .order('created_at', { ascending: false })
          .limit(6)
        if (histMsgs) {
          convHistory = histMsgs
            .reverse()
            .map((m) => ({
              role: (m.rol === 'usuario' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: String(m.contenido || ''),
            }))
        }
      } catch { /* sin historial */ }

      // ── Fase saludo: detectar programa del mensaje inicial y captura de nombre ─
      if (phase === 'saludo') {
        // Guardar programa detectado desde primer mensaje (sin enviar info aún)
        if (leadId && (!hasLeadProgram(leadSnapshot?.curso))) {
          const progDetectado = detectarPrograma(originalText)
            ?? (/verano|summer|my best summer/i.test(originalText) && /adultos?|adolescen/i.test(originalText) ? 'Cursos de verano adultos' : null)
            ?? (/verano|summer|my best summer/i.test(originalText) && /ni[ñn]os?|kids?/i.test(originalText) ? 'Cursos de verano niños' : null)
          if (progDetectado) {
            await supabase.from('leads').update({ curso: progDetectado, ...(getValorPrograma(progDetectado) ? { valor: getValorPrograma(progDetectado) } : {}) }).eq('id', leadId)
            leadSnapshot = { ...leadSnapshot, curso: progDetectado } as LeadSnapshot
          }
        }

        const words = originalText.trim().split(/\s+/)
        const isGreeting = /^\s*(hola|hey|ola|buenas|buenos|buen[oa])\b/i.test(originalText.trim())
        const hasProgramKeyword = /ingl[eé]s|psicolog|turism|relaciones|bachillerato|maestr[ií]a|diplomado|administraci[oó]n|idiom|franc[eé]s|italian|verano|summer/i.test(originalText)
        const hasDigits = /\d/.test(originalText)
        const hasQuestion = /\?/.test(originalText) || /^\s*(qu[eé]|c[oó]mo|cu[aá]ndo|cu[aá]nto|d[oó]nde|cu[aá]l|qui[eé]n|tienen?|hay|info|informaci[oó]n|cuanto|cuando|cual|quien|como|que)\b/i.test(originalText.trim())
        const looksLikeName = !isGreeting && !hasProgramKeyword && !hasDigits && !hasQuestion && !/@/.test(originalText) && words.length >= 1 && words.length <= 3 && hasLeadName(originalText.trim(), waNumber)

        if (looksLikeName) {
          // Limpiar prefijos comunes: "Con X", "Soy X", "Me llamo X", "Es X"
          const nombreCapturado = originalText.trim()
            .replace(/^\s*(con\s+|soy\s+|me\s+llamo\s+|es\s+)/i, '')
            .replace(/^\s*(la\s+se[ñn]or[ai]\s+|el\s+se[ñn]or\s+|don\s+|do[ñn]a\s+|la\s+se[ñn]orita\s+)/i, '')
            .trim()
          if (leadId) {
            await supabase.from('leads').update({ nombre: nombreCapturado }).eq('id', leadId)
            leadSnapshot = { ...leadSnapshot, nombre: nombreCapturado } as LeadSnapshot
          }
          // Si ya se detectó el programa desde el primer mensaje, saltar catálogo e ir a correo
          if (hasLeadProgram(leadSnapshot?.curso)) {
            // Si el lead ya tenía correo capturado (ej. lead recurrente sin nombre válido aún),
            // no volver a pedirlo — ir directo a la info del programa
            if (hasLeadEmail(leadSnapshot?.email)) {
              const infoSaludo = await buildProgramInfoMessage(String(leadSnapshot?.curso || ''), request.url, { nombre: nombreCapturado, email: leadSnapshot?.email }, convHistory)
              await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, infoSaludo, 'accion', leadId)
              return buildProviderResponse(provider, infoSaludo, waNumber)
            }
            const askCorreo = `¡Hola ${nombreCapturado}! 😊 ¿Me compartes tu correo electrónico para darte seguimiento personalizado? 📧`
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, askCorreo, 'correo')
            return buildProviderResponse(provider, askCorreo, waNumber)
          }
          const greeting = `¡Hola ${nombreCapturado}! 😊 ¿Qué programa de Instituto Windsor te interesa?\n\n${CATALOGO_OFERTA}`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, greeting, 'programa')
          return buildProviderResponse(provider, greeting, waNumber)
        }

        // ── Mensaje fijo del botón de WhatsApp del sitio web: pedir nombre sin GPT ──
        const esMensajeSitioWeb = /p[aá]gina\s+web/i.test(originalText) && /oferta\s+educativa/i.test(originalText)
        if (esMensajeSitioWeb && !hasLeadProgram(leadSnapshot?.curso)) {
          const saludoSitioWeb = `¡Hola! 😊 Gracias por tu interés en Instituto Windsor. ¿Con quién tengo el gusto?`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, saludoSitioWeb, 'saludo')
          return buildProviderResponse(provider, saludoSitioWeb, waNumber)
        }

        // ── Bloque verano en saludo: manejo completo sin fallthrough al GPT ──────
        if (hasLeadProgram(leadSnapshot?.curso) && (leadSnapshot?.curso || '').includes('verano')) {
          // Intentar extraer nombre limpiando prefijos y sufijos comunes
          const textoSinPrefijo = originalText
            .replace(/^\s*(hola|hey|ola|buenas?|buen)\s*(d[ií]as?|tardes?|noches?)?\s*[!.,;]*\s*/i, '')
            .replace(/^\s*(excelente|buen)\s*(d[ií]a|tarde|noche)\s*[!.,;]*\s*/i, '')
            .replace(/^\s*(con\s+|soy\s+|me\s+llamo\s+|mi\s+nombre\s+es\s+)/i, '')
            .replace(/^\s*(la\s+se[ñn]or[ai]\s+|el\s+se[ñn]or\s+|don\s+|do[ñn]a\s+|la\s+se[ñn]orita\s+)/i, '')
            .replace(/\s*(a\s+sus?\s+[oó]rdenes?|para\s+servirle?|mucho\s+gusto|es\s+un\s+gusto|con\s+gusto)\s*[!.,;]*\s*$/i, '')
            .replace(/[.,;!?]+$/, '')
            .trim()

          const nombreExtraido = hasLeadName(textoSinPrefijo, waNumber)
            ? textoSinPrefijo
            : (looksLikeName ? originalText.trim() : null)

          if (nombreExtraido && leadId) {
            await supabase.from('leads').update({ nombre: nombreExtraido }).eq('id', leadId)
            leadSnapshot = { ...leadSnapshot, nombre: nombreExtraido } as LeadSnapshot
            // Si el lead ya tenía correo capturado, no volver a pedirlo — ir directo a la info del programa
            if (hasLeadEmail(leadSnapshot?.email)) {
              const infoVeranoSaludo = await buildProgramInfoMessage(String(leadSnapshot?.curso || ''), request.url, { nombre: nombreExtraido, email: leadSnapshot?.email }, convHistory)
              await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, infoVeranoSaludo, 'accion', leadId)
              return buildProviderResponse(provider, infoVeranoSaludo, waNumber)
            }
            const askCorreo = `¡Hola ${nombreExtraido}! 😊 ¿Me compartes tu correo electrónico para darte seguimiento personalizado? 📧`
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, askCorreo, 'correo')
            return buildProviderResponse(provider, askCorreo, waNumber)
          }

          // No se pudo extraer nombre — pedir una vez más (mensaje varía si ya se pidió antes)
          const lastBotMsg = convHistory.filter(m => m.role === 'assistant').pop()?.content || ''
          const yaPidioNombre = /con quién tengo el gusto/i.test(lastBotMsg)
          const preguntaNombre = yaPidioNombre
            ? `Disculpa, necesito tu nombre para poder ayudarte mejor. 😊 ¿Con quién tengo el gusto?`
            : `¡Hola! 😊 Gracias por tu interés en *My Best Summer 2026* de Instituto Windsor ☀️\n\n¿Con quién tengo el gusto?`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, preguntaNombre, 'saludo')
          return buildProviderResponse(provider, preguntaNombre, waNumber)
        }
      }

      // ── Interceptor de botones de template seguimiento_general ──────────────
      // Maneja las 3 respuestas rápidas del template de reactivación
      const msgTrimBtn = originalText.trim()
      if (/^(sí,?\s*tengo\s*dudas|si,?\s*tengo\s*dudas)[\s\S]*$/i.test(msgTrimBtn)) {
        const resp = `¡Claro que sí! 😊 Con gusto resuelvo tus dudas. ¿Qué quisiera saber sobre ${leadSnapshot?.curso || 'el programa'}?`
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, resp, 'dudas', leadId)
        return buildProviderResponse(provider, resp, waNumber)
      }
      if (/^no\s*tengo\s*dudas[\s\S]*$/i.test(msgTrimBtn)) {
        const tipoIns = tipoInscripcion(leadSnapshot?.curso)
        if (tipoIns === 'desconocido') {
          await alertarProgramaNoReconocido(leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, INSCRIPCION_DESCONOCIDA_MSG, 'seguimiento', leadId)
          return buildProviderResponse(provider, INSCRIPCION_DESCONOCIDA_MSG, waNumber)
        }
        const botMsg = mensajeInscripcionPara(tipoIns, leadSnapshot?.curso)
        const nextF = tipoIns === 'verano' ? 'inscripcion_pendiente' : 'inscripcion'
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, botMsg, nextF, leadId)
        // Asegurar que el stage del lead llegue a inscripcion_pendiente en Kanban
        if (leadId) await supabase.from('leads').update({ stage: 'inscripcion_pendiente' }).eq('id', leadId)
        return buildProviderResponse(provider, botMsg, waNumber)
      }
      if (/^no\s*me\s*interesa[\s\S]*$/i.test(msgTrimBtn)) {
        const nombre = leadSnapshot?.nombre ? ` ${leadSnapshot.nombre.split(' ')[0]}` : ''
        const resp = `Entendido${nombre}, no hay problema. Si en algún momento cambias de opinión, aquí estaremos. ¡Que tengas un excelente día! 😊`
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, resp, 'perdido', leadId)
        if (leadId) await supabase.from('leads').update({ stage: 'perdido' }).eq('id', leadId)
        return buildProviderResponse(provider, resp, waNumber)
      }

      // ── Interceptor de botones de template reactivacion_verano ──────────────
      if (/^quiero\s*apartar\s*mi\s*lugar[\s\S]*$/i.test(msgTrimBtn)) {
        const tipoIns = tipoInscripcion(leadSnapshot?.curso)
        if (tipoIns === 'desconocido') {
          await alertarProgramaNoReconocido(leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, INSCRIPCION_DESCONOCIDA_MSG, 'seguimiento', leadId)
          return buildProviderResponse(provider, INSCRIPCION_DESCONOCIDA_MSG, waNumber)
        }
        const botMsg = mensajeInscripcionPara(tipoIns, leadSnapshot?.curso)
        const nextF = tipoIns === 'verano' ? 'inscripcion_pendiente' : 'inscripcion'
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, botMsg, nextF, leadId)
        if (leadId) await supabase.from('leads').update({ stage: 'inscripcion_pendiente' }).eq('id', leadId)
        return buildProviderResponse(provider, botMsg, waNumber)
      }
      if (/^tal\s*vez\s*el\s*pr[oó]ximo\s*a[ñn]o[\s\S]*$/i.test(msgTrimBtn)) {
        const nombre = leadSnapshot?.nombre ? ` ${leadSnapshot.nombre.split(' ')[0]}` : ''
        const resp = `¡No hay problema${nombre}! Te quedamos atentos para el siguiente My Best Summer. ¡Que tengas un excelente día! ☀️`
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, resp, 'cerrado', leadId)
        if (leadId) await supabase.from('leads').update({ stage: 'archivado' }).eq('id', leadId)
        return buildProviderResponse(provider, resp, waNumber)
      }

      // ── Interceptor global de convenios ─────────────────────────────────────
      // Fase convenios: el prospecto ya vio la lista y menciona su institución
      if (phase === 'convenios') {
        const instKey = detectarInstitucionConvenio(originalText)
        if (instKey && CONVENIOS_DETALLE[instKey]) {
          const detalleMsg = `${CONVENIOS_DETALLE[instKey]}\n\n¿Te gustaría inscribirte o tienes alguna duda? 😊`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, detalleMsg, 'dudas')
          return buildProviderResponse(provider, detalleMsg, waNumber)
        }
        // No identificó institución — pedir que elija de la lista
        const reask = `No encontré esa institución en nuestra lista. ¿Puedes indicarme el número o nombre de tu institución?\n\n${CONVENIOS_LISTA_MSG}`
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, reask, 'convenios')
        return buildProviderResponse(provider, reask, waNumber)
      }

      // En cualquier fase: si busca trabajo/vacante docente, NO es un prospecto de
      // inscripción — se confunde fácil con las preguntas de convenio/descuento
      // ("soy maestro") si no se revisa primero. Ver bug de vacante mal enrutada.
      if (detectarConsultaVacante(originalText)) {
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, VACANTE_DOCENTE_MSG, 'seguimiento')
        return buildProviderResponse(provider, VACANTE_DOCENTE_MSG, waNumber)
      }

      // En cualquier fase: si pregunta por revalidación de materias de otra institución —
      // se revisa ANTES que convenios/institución específica porque "ya estudié en la UAGro"
      // puede matchear por error el detector de "egresados" de convenios (ver detectarInstitucionConvenio)
      // y responder con el descuento de egresados en vez del proceso real de revalidación.
      // Nunca confirmar ni negar de antemano si se aceptará — caso real Isabel 2026-08-10,
      // el bot ignoró la pregunta y solo mandó los pasos de inscripción normales.
      if (detectarRevalidacion(originalText)) {
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, REVALIDACION_MATERIAS_MSG, currentFase || phase, leadId)
        return buildProviderResponse(provider, REVALIDACION_MATERIAS_MSG, waNumber)
      }

      // En cualquier fase: si pregunta por convenios → mostrar lista
      if (detectarPreguntaConvenio(originalText)) {
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, CONVENIOS_LISTA_MSG, 'convenios')
        return buildProviderResponse(provider, CONVENIOS_LISTA_MSG, waNumber)
      }

      // En cualquier fase: si menciona una institución específica → mostrar detalle directo
      // Excluir mensajes que contengan @ (emails) para evitar falsos positivos por números en el email
      if (phase !== 'convenios' && !originalText.includes('@')) {
        const instKeyGlobal = detectarInstitucionConvenio(originalText)
        if (instKeyGlobal && CONVENIOS_DETALLE[instKeyGlobal]) {
          const detalleMsg = `${CONVENIOS_DETALLE[instKeyGlobal]}\n\n¿Te gustaría inscribirte o tienes alguna duda? 😊`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, detalleMsg, 'dudas')
          return buildProviderResponse(provider, detalleMsg, waNumber)
        }
      }

      // En cualquier fase: si pregunta por dirección / ubicación → responder con ambos planteles
      if (detectarPreguntaDireccion(originalText)) {
        const dirMsg = `Nos encontramos en:\n\n📍 *Chilpancingo:* Calle Sofía Tena #1, Col. Viguri\n📍 *Iguala:* Ignacio Zaragoza 99, Col. Centro\n\n🕐 *Horarios:* Lun–Vie 8:00–14:00 y 17:00–20:00 | Sáb 8:00–14:00`
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, dirMsg)
        return buildProviderResponse(provider, dirMsg, waNumber)
      }

      // En cualquier fase: si el lead aún no tiene programa capturado y el mensaje ya
      // menciona uno de forma inequívoca, capturarlo ya con el detector determinístico
      // (misma fuente de verdad que el resto del bot, ver lib/whatsapp/programas.ts) —
      // así el contexto que recibe GPT/RAG más abajo (leadData.curso, ragQuestion) ya
      // refleja el programa real y no puede alucinar que "no lo ofrecemos". Bug real
      // 2026-08-07: un lead mandó nombre+programa en el mismo mensaje durante fase
      // "saludo" (fase donde el catálogo/detector determinístico de "programa" nunca
      // corría) y GPT respondió negando que existiera la Licenciatura en Inglés.
      if (!hasLeadProgram(leadSnapshot?.curso)) {
        const progTemprano = detectarPrograma(originalText)
        if (progTemprano) {
          if (leadId) {
            await supabase.from('leads').update({ curso: progTemprano, ...(getValorPrograma(progTemprano) ? { valor: getValorPrograma(progTemprano) } : {}) }).eq('id', leadId)
          }
          leadSnapshot = { ...leadSnapshot, curso: progTemprano } as LeadSnapshot
        }
      }

      // Detección global de "inglés" ambiguo — sin importar la fase, si no hay programa capturado aún
      if (!hasLeadProgram(leadSnapshot?.curso)) {
        const msgLower0 = originalText.toLowerCase()
        if (/ingl[eé]s/i.test(msgLower0) && !/ni[ñn]o|adulto|licenciatura|lic\b/i.test(msgLower0)) {
          const disambig = `Tenemos tres opciones de inglés, ¿cuál te interesa?\n\nA) Inglés para adultos\nB) Inglés para niños\nC) Licenciatura en Inglés`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, disambig, 'programa')
          return buildProviderResponse(provider, disambig, waNumber)
        }
        if (/verano|summer|my best summer/i.test(msgLower0) && !/ni[ñn]o|kid|infan|adult|adolescen|joven|teen/i.test(msgLower0)) {
          const disambigVerano = `¡Qué buena elección! ☀️ My Best Summer tiene dos modalidades, ¿cuál te interesa?\n\nA) Niños (4 a 12 años)\nB) Adolescentes y adultos`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, disambigVerano, 'verano_disambig')
          return buildProviderResponse(provider, disambigVerano, waNumber)
        }
      }

      // En cualquier fase: igual que el "inglés ambiguo" de arriba, si preguntan por una
      // categoría genérica (licenciaturas/maestrías/diplomados) antes de tener un programa
      // capturado, responder con el catálogo real en vez de dejar que GPT+RAG improvise —
      // mismo bug de 2026-08-07: sin este check, "¿maestrías tienen?" fuera de fase
      // "programa" (única fase donde antes se manejaba este caso) caía al fallback de
      // GPT, que llegó a negar que existieran maestrías en Instituto Windsor.
      if (!hasLeadProgram(leadSnapshot?.curso)) {
        const msgNorm0 = quitarAcentos(originalText.trim()).toLowerCase()
        const categoriaGenerica0 = /licenciaturas?/.test(msgNorm0)
          ? `Tenemos las siguientes licenciaturas:\n\n• Licenciatura en Inglés\n• Relaciones públicas y mercadotecnia\n• Administración turística\n• Psicología\n\n¿Cuál te interesa? 😊`
          : /maestrias?/.test(msgNorm0)
          ? `Tenemos dos maestrías:\n\n• Maestría en Innovación empresarial\n• Maestría en Multiculturalidad y Plurilingüismo\n\n¿Cuál te interesa? 😊`
          : /diplomados?/.test(msgNorm0)
          ? `Contamos con más de 30 diplomados en distintas áreas. ¿Me puedes decir cuál tema te interesa? Por ejemplo: salud, educación, negocios, tecnología... 😊`
          : null
        if (categoriaGenerica0) {
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, categoriaGenerica0, 'programa')
          return buildProviderResponse(provider, categoriaGenerica0, waNumber)
        }
      }

      // Fase verano_disambig: A = niños, B = adultos
      if (phase === 'verano_disambig') {
        const msgLV = originalText.trim().toLowerCase()
        let programaVerano: string | null = null
        if (/^\s*a\s*$/.test(msgLV) || /ni[ñn]o|kid|infan/i.test(msgLV)) programaVerano = 'Cursos de verano niños'
        else if (/^\s*b\s*$/.test(msgLV) || /adult|adolescen|joven/i.test(msgLV)) programaVerano = 'Cursos de verano adultos'

        if (programaVerano) {
          if (leadId) {
            await supabase.from('leads').update({ curso: programaVerano, valor: getValorPrograma(programaVerano) ?? 0 }).eq('id', leadId)
            leadSnapshot = { ...leadSnapshot, curso: programaVerano } as LeadSnapshot
          }
          const infoV = INFO_MSGS[programaVerano] + buildCTA(programaVerano)
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, infoV, 'accion', leadId)
          return buildProviderResponse(provider, infoV, waNumber)
        }
        // Si no entiende la respuesta, repetir la pregunta
        const reaskV = `Por favor elige una opción:\n\nA) Niños (4 a 12 años)\nB) Adolescentes y adultos`
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, reaskV, 'verano_disambig', leadId)
        return buildProviderResponse(provider, reaskV, waNumber)
      }

      // Fase programa: si el usuario ya nombró un programa, saltar catálogo; si no, catálogo hardcodeado
      if (phase === 'programa') {
        // A/B/C interceptor: respuestas a la disambiguación de inglés (respuesta de una letra)
        const msgTrimProg = originalText.trim()
        const msgLProg = msgTrimProg.toLowerCase()
        let programaIngles: string | null = null
        if (/^\s*a\s*$/.test(msgLProg) || (/\badultos?\b/i.test(msgTrimProg) && !/verano|summer/i.test(msgLProg))) programaIngles = 'Inglés para adultos'
        else if (/^\s*b\s*$/.test(msgLProg) || (/\bni[ñn]os?\b/i.test(msgTrimProg) && !/verano|summer/i.test(msgLProg))) programaIngles = 'Inglés para niños'
        else if (/^\s*c\s*$/.test(msgLProg)) programaIngles = 'Licenciatura en Inglés'

        if (programaIngles) {
          if (leadId) {
            await supabase.from('leads').update({ curso: programaIngles, ...(getValorPrograma(programaIngles) ? { valor: getValorPrograma(programaIngles) } : {}) }).eq('id', leadId)
            leadSnapshot = { ...leadSnapshot, curso: programaIngles } as LeadSnapshot
          }
          // Si el lead ya tiene correo capturado, no volver a pedirlo — ir directo a la info del programa
          if (hasLeadEmail(leadSnapshot?.email)) {
            const infoIngles = await buildProgramInfoMessage(programaIngles, request.url, { nombre: leadSnapshot?.nombre, email: leadSnapshot?.email }, convHistory)
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, infoIngles, 'accion', leadId)
            return buildProviderResponse(provider, infoIngles, waNumber)
          }
          const ackIngles = `¡Excelente elección! 😊 Para contarte todo sobre *${programaIngles}*, ¿me compartes tu correo electrónico para darte seguimiento personalizado? 📧`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, ackIngles, 'correo')
          return buildProviderResponse(provider, ackIngles, waNumber)
        }

        // Inglés ambiguo (igual que lab) — antes de detectarPrograma
        if (/ingl[eé]s/i.test(originalText) && !/ni[ñn]o|adulto|licenciatura|lic\b/i.test(originalText)) {
          const disambig = `Tenemos tres opciones de inglés, ¿cuál te interesa?\n\nA) Inglés para adultos\nB) Inglés para niños\nC) Licenciatura en Inglés`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, disambig, 'programa')
          return buildProviderResponse(provider, disambig, waNumber)
        }

        // Verano ambiguo — A: niños, B: adultos
        if (/verano|summer|my best summer/i.test(originalText) && !/ni[ñn]o|kid|infan|adult|adolescen|joven|teen/i.test(originalText)) {
          const disambigVerano = `¡Qué buena elección! ☀️ My Best Summer tiene dos modalidades, ¿cuál te interesa?\n\nA) Niños (4 a 12 años)\nB) Adolescentes y adultos`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, disambigVerano, 'verano_disambig')
          return buildProviderResponse(provider, disambigVerano, waNumber)
        }

        // Respuesta A/B a la disambiguación de verano
        if (/^\s*a\s*$/.test(msgLProg) && /verano|summer/i.test(leadSnapshot?.curso || '')) {
          const pV = 'Cursos de verano niños'
          if (leadId) await supabase.from('leads').update({ curso: pV }).eq('id', leadId)
          leadSnapshot = { ...leadSnapshot, curso: pV } as LeadSnapshot
          if (hasLeadEmail(leadSnapshot?.email)) {
            const infoV = await buildProgramInfoMessage(pV, request.url, { nombre: leadSnapshot?.nombre, email: leadSnapshot?.email }, convHistory)
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, infoV, 'accion', leadId)
            return buildProviderResponse(provider, infoV, waNumber)
          }
          const ackV = `¡Perfecto! ☀️ Para contarte todo sobre *My Best Summer* para niños, ¿me compartes tu correo para darte seguimiento? 📧`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, ackV, 'correo')
          return buildProviderResponse(provider, ackV, waNumber)
        }
        if (/^\s*b\s*$/.test(msgLProg) && /verano|summer/i.test(leadSnapshot?.curso || '')) {
          const pV = 'Cursos de verano adultos'
          if (leadId) await supabase.from('leads').update({ curso: pV, valor: 1700 }).eq('id', leadId)
          leadSnapshot = { ...leadSnapshot, curso: pV } as LeadSnapshot
          if (hasLeadEmail(leadSnapshot?.email)) {
            const infoV = await buildProgramInfoMessage(pV, request.url, { nombre: leadSnapshot?.nombre, email: leadSnapshot?.email }, convHistory)
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, infoV, 'accion', leadId)
            return buildProviderResponse(provider, infoV, waNumber)
          }
          const ackV = `¡Perfecto! ☀️ Para contarte todo sobre *My Best Summer* para adolescentes y adultos, ¿me compartes tu correo para darte seguimiento? 📧`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, ackV, 'correo')
          return buildProviderResponse(provider, ackV, waNumber)
        }

        // Detección de programa en código (sin GPT) — igual que lab
        const programaDetectado = detectarPrograma(originalText)
        if (programaDetectado) {
          if (leadId) {
            await supabase.from('leads').update({ curso: programaDetectado, ...(getValorPrograma(programaDetectado) ? { valor: getValorPrograma(programaDetectado) } : {}) }).eq('id', leadId)
            leadSnapshot = { ...leadSnapshot, curso: programaDetectado } as LeadSnapshot
          }
          if (hasLeadEmail(leadSnapshot?.email)) {
            const infoDet = await buildProgramInfoMessage(programaDetectado, request.url, { nombre: leadSnapshot?.nombre, email: leadSnapshot?.email }, convHistory)
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, infoDet, 'accion', leadId)
            return buildProviderResponse(provider, infoDet, waNumber)
          }
          const correoMsg = `¡Excelente elección! 😊 Para contarte todo sobre *${programaDetectado}*, ¿me compartes tu correo electrónico para darte seguimiento personalizado? 📧`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, correoMsg, 'correo')
          return buildProviderResponse(provider, correoMsg, waNumber)
        }

        // Sin programa identificado — diferenciar entre categoría genérica, carrera no ofrecida, o mensaje ambiguo
        const nombreP = leadSnapshot?.nombre
        const msgTrimP = originalText.trim()

        // Caso 1: el usuario pidió una categoría genérica (ej: "licenciaturas", "maestrías").
        // Antes exigía que el mensaje fuera EXACTAMENTE esa palabra (^...$) — una pregunta
        // normal como "¿me da info de las licenciaturas?" no matcheaba y caía al catálogo
        // completo genérico (bug de pérdida de contexto). Ahora basta con que la mencione,
        // normalizando acentos igual que detectarPrograma().
        const msgNormP = quitarAcentos(msgTrimP).toLowerCase()
        const categoriaGenerica = /licenciaturas?/.test(msgNormP)
          ? `Tenemos las siguientes licenciaturas:\n\n• Licenciatura en Inglés\n• Relaciones públicas y mercadotecnia\n• Administración turística\n• Psicología\n\n¿Cuál te interesa? 😊`
          : /maestrias?/.test(msgNormP)
          ? `Tenemos dos maestrías:\n\n• Maestría en Innovación empresarial\n• Maestría en Multiculturalidad y Plurilingüismo\n\n¿Cuál te interesa? 😊`
          : /diplomados?/.test(msgNormP)
          ? `Contamos con más de 30 diplomados en distintas áreas. ¿Me puedes decir cuál tema te interesa? Por ejemplo: salud, educación, negocios, tecnología... 😊`
          : /\b(cursos?|idiomas?)\b/.test(msgNormP)
          ? `Ofrecemos cursos de:\n\n• Inglés para adultos\n• Inglés para niños\n• Francés\n• Italiano\n\n¿Cuál te interesa? 😊`
          : null

        if (categoriaGenerica) {
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, categoriaGenerica, 'programa')
          return buildProviderResponse(provider, categoriaGenerica, waNumber)
        }

        // Caso 2: parece una carrera o programa específico que no ofrecemos
        const pareceCarreraEspecifica =
          /m[eé]dic|enfermer|derecho|contadur|ingenier|arquitect|qu[ií]mic|biolog|nutric|odontolog|veterinar|farmac|f[ií]sica|matem|historia|filosof|geograf|econom|sociolog|antropolog|comunicaci[oó]n|periodis|artes?|diseño|música|danza|teatro|cine|fotograf/i.test(msgTrimP)

        if (pareceCarreraEspecifica) {
          const noOfrecemosMsg = `${nombreP ? `Disculpa ${nombreP}, ` : 'Disculpa, '}ese programa no forma parte de nuestra oferta educativa. 😊\n\nEstos son los programas que sí tenemos en Instituto Windsor:\n\n${CATALOGO_OFERTA}`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, noOfrecemosMsg, 'programa')
          return buildProviderResponse(provider, noOfrecemosMsg, waNumber)
        }

        // Caso 3: mensaje ambiguo o muy corto — repetir catálogo completo
        const botMessage = nombreP
          ? `¡Hola ${nombreP}! 😊 ¿Qué programa de Instituto Windsor te interesa?\n\n${CATALOGO_OFERTA}`
          : `¡Hola! 😊 ¿Qué programa de Instituto Windsor te interesa?\n\n${CATALOGO_OFERTA}`
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, botMessage, 'programa')
        return buildProviderResponse(provider, botMessage, waNumber)
      }

      // ── Pregunta sobre cursos de verano (no en saludo/correo — esos fases capturan datos primero) ──
      const leadEsVerano = (leadSnapshot?.curso || '').toLowerCase().includes('verano')
      const mensionVerano = /verano|summer|my best summer/i.test(originalText)
      const cambioVerano = leadEsVerano && /ni[ñn]os?|kids?|adultos?|adolescen/i.test(originalText)
      if ((mensionVerano || cambioVerano) && phase !== 'saludo' && phase !== 'correo') {
        // detectarPrograma() puede reconocer palabras sueltas (ej. "francés") que no son
        // programas de verano en sí, sino solo actividades dentro del paquete — aquí solo
        // nos sirve si cae exactamente en una de las dos modalidades de verano.
        const programaDetectado = detectarPrograma(originalText)
        const veranoProg = (programaDetectado === 'Cursos de verano niños' || programaDetectado === 'Cursos de verano adultos')
          ? programaDetectado
          : ((/ni[ñn]os?|kids?/i.test(originalText)) ? 'Cursos de verano niños'
             : (/adultos?|adolescen/i.test(originalText)) ? 'Cursos de verano adultos'
             : null)
        // Si es "cambioVerano" (mencionó niños/kids/adultos pero no dijo "verano" explícitamente)
        // y el programa detectado es el mismo que ya tiene el lead, no es un cambio real —
        // probablemente es una pregunta normal sobre su grupo. Dejar que la responda el GPT.
        const noEsCambioReal = cambioVerano && !mensionVerano && veranoProg === leadSnapshot?.curso
        if (veranoProg && !noEsCambioReal && INFO_MSGS[veranoProg]) {
          const infoVerano = INFO_MSGS[veranoProg] + buildCTA(veranoProg)
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, infoVerano, currentFase || phase, leadId)
          return buildProviderResponse(provider, infoVerano, waNumber)
        } else if (!veranoProg && !cambioVerano) {
          const disambigV = `¡Qué buena elección! ☀️ My Best Summer tiene dos modalidades, ¿cuál te interesa?\n\nA) Niños (4 a 12 años)\nB) Adolescentes y adultos`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, disambigV, 'verano_disambig', leadId)
          return buildProviderResponse(provider, disambigV, waNumber)
        }
      }

      // ── Fase accion: elegir A (dudas) o B (inscripción/examen) ───────────────
      if (phase === 'accion') {
        // El examen de ubicación es opcional (solo idiomas) y nunca debe bloquear
        // el acceso a "quiero inscribirme" — se revisa aparte, antes de eligeB.
        if (esInglesIdioma(leadSnapshot?.curso) && eligeExamenUbicacion(originalText)) {
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, EXAMEN_UBICACION_MSG, 'examen', leadId)
          return buildProviderResponse(provider, EXAMEN_UBICACION_MSG, waNumber)
        }
        if (eligeB(originalText)) {
          const tipoIns = tipoInscripcion(leadSnapshot?.curso)
          if (tipoIns === 'desconocido') {
            await alertarProgramaNoReconocido(leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, INSCRIPCION_DESCONOCIDA_MSG, 'seguimiento', leadId)
            return buildProviderResponse(provider, INSCRIPCION_DESCONOCIDA_MSG, waNumber)
          }
          const botMsgAccion = mensajeInscripcionPara(tipoIns, leadSnapshot?.curso)
          const nextFAccion = tipoIns === 'verano' ? 'inscripcion_pendiente' : 'inscripcion'
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, botMsgAccion, nextFAccion, leadId)
          return buildProviderResponse(provider, botMsgAccion, waNumber)
        }
        if (eligeA(originalText)) {
          // Deja que GPT maneje la duda con RAG — sigue al bloque principal
        } else {
          // Todavía no tenemos un nombre válido del lead — un mensaje corto tipo "Berenice Lopez"
          // no debe caer en el heurístico de "parece pregunta" (>12 caracteres) de más abajo,
          // que lo mandaría a GPT+RAG en vez de capturarlo como nombre. Se llega aquí sobre todo
          // cuando un mensaje manual salta la conversación directo a fase 'accion' sin haber
          // pasado por la captura de nombre normal de fase 'saludo'.
          const nombrePendiente = !hasLeadName(leadSnapshot?.nombre, waNumber)
          const words = originalText.trim().split(/\s+/)
          const isGreeting = /^\s*(hola|hey|ola|buenas|buenos|buen[oa])\b/i.test(originalText.trim())
          const hasProgramKeyword = /ingl[eé]s|psicolog|turism|relaciones|bachillerato|maestr[ií]a|diplomado|administraci[oó]n|idiom|franc[eé]s|italian|verano|summer/i.test(originalText)
          const hasQuestion = /\?/.test(originalText) || /\b(costo|precio|hora|horario|d[ií]a|cu[aá]n|qu[eé]|ubicaci[oó]n|direcci[oó]n|diploma|certificado|descuento|duraci[oó]n|materia|document|requisito|uniforme|nivel|becas?|mensualidad|inscripci[oó]n)\b/i.test(originalText)
          const looksLikeName = nombrePendiente && !isGreeting && !hasProgramKeyword && !hasQuestion && words.length <= 4 && hasLeadName(originalText.trim(), waNumber)

          if (looksLikeName) {
            const nombreCapturado = originalText.trim()
              .replace(/^\s*(con\s+|soy\s+|me\s+llamo\s+|es\s+)/i, '')
              .replace(/^\s*(la\s+se[ñn]or[ai]\s+|el\s+se[ñn]or\s+|don\s+|do[ñn]a\s+|la\s+se[ñn]orita\s+)/i, '')
              .trim()
            if (leadId) {
              await supabase.from('leads').update({ nombre: nombreCapturado }).eq('id', leadId)
              leadSnapshot = { ...leadSnapshot, nombre: nombreCapturado } as LeadSnapshot
            }
            const ctaConNombre = `¡Gracias, ${nombreCapturado}! 😊 ¿Cuál de estas opciones te interesa?${buildCTA(leadSnapshot?.curso)}`
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, ctaConNombre, 'accion', leadId)
            return buildProviderResponse(provider, ctaConNombre, waNumber)
          }

          // Si parece pregunta o mensaje largo → GPT con RAG (no repetir CTA ciegamente)
          const esRespuestaCorta = /^\s*[aAbBsSnNyY][iIoO]?\s*$/.test(originalText.trim())
          const parecePregunta = originalText.trim().endsWith('?')
            || originalText.trim().length > 12
            || /\b(costo|precio|hora|horario|d[ií]a|cu[aá]n|qu[eé]|ubicaci[oó]n|direcci[oó]n|diploma|certificado|descuento|duraci[oó]n|materia|document|requisito|uniforme|nivel|becas?|mensualidad|inscripci[oó]n)\b/i.test(originalText)
          if (!esRespuestaCorta && parecePregunta) {
            // Sigue al bloque principal de GPT+RAG
          } else {
            // Respuesta corta sin sentido: repetir CTA
            const ctaRepeat = buildCTA(leadSnapshot?.curso)
            const msg = `${leadSnapshot?.nombre ? leadSnapshot.nombre + ', ' : ''}¿cuál de estas opciones te interesa?${ctaRepeat}`
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msg, 'accion', leadId)
            return buildProviderResponse(provider, msg, waNumber)
          }
        }
      }

      // ── Fase info_enviada: usar INFO_MSG hardcodeado si existe ────────────────
      if (phase === 'info_enviada') {
        const infoMsg = leadSnapshot?.curso ? INFO_MSGS[leadSnapshot.curso] : null
        if (infoMsg) {
          const cta = buildCTA(leadSnapshot?.curso)
          const msgFull = infoMsg + cta
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msgFull, 'accion', leadId)
          return buildProviderResponse(provider, msgFull, waNumber)
        }
        // Fallback a RAG+GPT para maestrías, diplomados, francés, italiano
      }

      // Confirmación de inscripción verano — fase inscripcion_pendiente
      if (phase === 'inscripcion_pendiente') {
        // Si el usuario se despide o agradece, responder con cortesía sin repetir los pasos
        const textoGoodbye = originalText.trim()
        const esGoodbyeInscripcion = /gracias|muy amable|de nada|con gusto|est[aá] bien|okey|genial|excelente|perfecto/i.test(textoGoodbye)
          && textoGoodbye.length <= 30 && !/\?/.test(textoGoodbye)
        if (esGoodbyeInscripcion) {
          const despMsg = '¡Con gusto! 😊 Si tienes alguna duda o necesitas ayuda con los pasos de inscripción, aquí estaré. ¡Mucho éxito! ☀️'
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, despMsg)
          return buildProviderResponse(provider, despMsg, waNumber)
        }
        // Si elige presencial — solo indicar qué traer, sin pasos de pago en línea
        if (/presencial|instalaci[oó]n|ir a|plantel|visitar|en persona|de manera presencial/i.test(originalText)
          && !/examen|colocaci[oó]n|evaluaci[oó]n|ubicaci[oó]n/i.test(originalText)) {
          const nombre = leadSnapshot?.nombre ? ` ${leadSnapshot.nombre.split(' ')[0]}` : ''
          const msgP = `¡Perfecto${nombre}! 🏫 Para inscribirte presencialmente solo necesitas traer:\n\n📄 Acta de nacimiento\n💳 Tu pago (puedes pagar el 50% para apartar y el resto al inicio del curso)\n\nTe esperamos en:\n📍 *Chilpancingo:* Sofía Tena #1, Col. Viguri\n📍 *Iguala:* Ignacio Zaragoza 99, Col. Centro\n🕐 Lun–Vie 8:00–14:00 y 17:00–20:00 | Sáb 8:00–14:00\n\n¡Nos vemos pronto! ☀️😊`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msgP, 'seguimiento', leadId)
          return buildProviderResponse(provider, msgP, waNumber)
        }
        if (/ya.*llen[eé]|ya.*hice|ya.*complet|listo|ya.*pagu[eé]|ya.*realic[eé]|ya.*env[ií]|ya.*subi|ya.*adjunt/i.test(originalText)) {
          const nombreLead = leadSnapshot?.nombre || ''
          const msg = `¡Perfecto${nombreLead ? ' ' + nombreLead : ''}! 🎉 Ya recibimos tu confirmación. Un asesor revisará tu formulario y te confirmará tu lugar en My Best Summer en breve. ¡Nos vemos en julio! ☀️`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msg, 'seguimiento', leadId)
          if (leadId) {
            await notifyAsesor(supabase, leadId, 'inscripcion_confirmada',
              leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
          }
          return buildProviderResponse(provider, msg, waNumber)
        }
        // Si parece una pregunta → dejar caer al GPT para que la responda
        // Solo recordar pasos si es respuesta corta sin pregunta (sí, ok, entendido, etc.)
        const esPregunta = /\?/.test(originalText) || originalText.trim().length > 20
        if (!esPregunta) {
          const recordatorio = `Recuerda los pasos para completar tu inscripción:\n\n*A) En línea:*\n1️⃣ Realiza tu pago: https://drive.google.com/file/d/1Hj9rRk1zHMWGnG_CjF287W-hxY2AoTe9/view?usp=drivesdk\n2️⃣ Llena el formulario con tu comprobante: https://forms.gle/fvxiekCtLb7KNz2U8\n3️⃣ Confírmanos aquí cuando lo hayas completado.\n\n*B) Presencial:* Visítanos con tu acta de nacimiento — puedes pagar directamente en las instalaciones. 😊`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, recordatorio, 'inscripcion_pendiente', leadId)
          return buildProviderResponse(provider, recordatorio, waNumber)
        }
        // Si es pregunta → cae al GPT
      }

      // Elección A/B de inscripción — interceptar antes de GPT cuando fase es inscripcion
      if (phase === 'inscripcion') {
        // Si es lead de verano, nunca debe estar en fase inscripcion — redirigir al proceso correcto
        const cursoLowerInsc = (leadSnapshot?.curso || '').toLowerCase()
        if (cursoLowerInsc.includes('verano') || cursoLowerInsc.includes('my best summer')) {
          const msgVeranoInsc = cursoLowerInsc.includes('adulto') ? INSCRIPCION_VERANO_ADULTOS_MSG : INSCRIPCION_VERANO_NINOS_MSG
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msgVeranoInsc, 'inscripcion_pendiente', leadId)
          return buildProviderResponse(provider, msgVeranoInsc, waNumber)
        }
        // Habilidades para la práctica psicoterapéutica: no usa el flujo A/B de licenciaturas
        // (no pide acta de nacimiento ni certificado de bachillerato) — solo formulario + pago en efectivo
        if (esHabilidadesPsico(leadSnapshot?.curso)) {
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, INSCRIPCION_HABILIDADES_MSG, 'inscripcion', leadId)
          return buildProviderResponse(provider, INSCRIPCION_HABILIDADES_MSG, waNumber)
        }
        // Bachillerato y Diplomados tampoco usan el flujo A/B de licenciaturas —
        // cada uno tiene su propio proceso simple
        if (esBachillerato(leadSnapshot?.curso)) {
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, INSCRIPCION_BACHILLERATO_MSG, 'inscripcion', leadId)
          return buildProviderResponse(provider, INSCRIPCION_BACHILLERATO_MSG, waNumber)
        }
        if (esDiplomado(leadSnapshot?.curso)) {
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, INSCRIPCION_DIPLOMADO_MSG, 'inscripcion', leadId)
          return buildProviderResponse(provider, INSCRIPCION_DIPLOMADO_MSG, waNumber)
        }
        // Cursos de idiomas (inglés adultos/niños): tampoco usan el flujo A/B de
        // licenciaturas — el examen de ubicación es aparte y opcional
        if (esInglesIdioma(leadSnapshot?.curso)) {
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, INSCRIPCION_IDIOMA_MSG, 'inscripcion', leadId)
          return buildProviderResponse(provider, INSCRIPCION_IDIOMA_MSG, waNumber)
        }
        // A partir de aquí el flujo A/B (INSCRIPCION_ONLINE_MSG / buildInscripcionPresencialMsg)
        // pide Certificado de Bachillerato y CURP — solo aplica a licenciaturas. Si el curso
        // no está en la lista cerrada de licenciaturas, no adivinar: escalar.
        if (!esLicenciatura(leadSnapshot?.curso)) {
          await alertarProgramaNoReconocido(leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, INSCRIPCION_DESCONOCIDA_MSG, 'seguimiento', leadId)
          return buildProviderResponse(provider, INSCRIPCION_DESCONOCIDA_MSG, waNumber)
        }
        const msgI = originalText.toLowerCase()
        if (esSoloLetra(originalText, 'a') || /en l[ií]nea|online|desde aqu[ií]|digital|virtual/i.test(msgI)) {
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, INSCRIPCION_ONLINE_MSG, 'inscripcion')
          return buildProviderResponse(provider, INSCRIPCION_ONLINE_MSG, waNumber)
        }
        if (esSoloLetra(originalText, 'b') || /presencial|instalaci[oó]n|\bir a\b|plantel|visitar/i.test(msgI)) {
          const msgP = buildInscripcionPresencialMsg(leadSnapshot?.nombre, leadSnapshot?.email, leadSnapshot?.curso, leadSnapshot?.whatsapp)
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msgP, 'inscripcion')
          return buildProviderResponse(provider, msgP, waNumber)
        }
        if (/ya.*llen[eé]|ya.*hice|ya.*complet|listo|ya.*pagu[eé]|ya.*realic[eé]/i.test(msgI)) {
          const nombreLead = leadSnapshot?.nombre || ''
          const msg = `¡Perfecto${nombreLead ? ' ' + nombreLead : ''}! 🎉 Un asesor revisará tu información y confirmará tu inscripción en breve. ¡Bienvenid@ a la familia Windsor!`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msg, 'seguimiento')
          if (leadId) {
            await notifyAsesor(supabase, leadId, 'inscripcion_confirmada',
              leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
          }
          return buildProviderResponse(provider, msg, waNumber)
        }
      }

      // ── Fase correo: detección en código, sin GPT ────────────────────────────
      if (phase === 'correo') {
        const emailDetectado = detectarEmail(originalText)
        const quiereSkip = noQuiereEmail(originalText)

        if (emailDetectado || quiereSkip) {
          // Guardar email si se detectó
          if (emailDetectado && leadId) {
            await supabase.from('leads').update({ email: emailDetectado }).eq('id', leadId)
            leadSnapshot = { ...leadSnapshot, email: emailDetectado } as LeadSnapshot
          }
          const cursoInfo = leadSnapshot?.curso
          const infoMsgCorreo = cursoInfo ? INFO_MSGS[cursoInfo] : null
          if (infoMsgCorreo) {
            const ctaCorreo = buildCTA(cursoInfo)
            const ack = emailDetectado ? '¡Perfecto, ya tengo tu correo! 📧\n\n' : ''
            const msgFinal = ack + infoMsgCorreo + ctaCorreo
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msgFinal, 'accion', leadId)
            return buildProviderResponse(provider, msgFinal, waNumber)
          }
          // Fallback RAG+GPT para programas sin INFO_MSG (maestrías, diplomados, etc.)
          let ragCorreo = ''
          try {
            const ragUrlC = new URL('/api/rag/query', new URL(request.url).origin)
            const ragResC = await fetch(ragUrlC.toString(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ question: `${cursoInfo} en Instituto Windsor: costos, horarios, duración, modalidad`, match_count: 15 }),
              signal: AbortSignal.timeout(8000),
            })
            if (ragResC.ok) {
              const rdC = await ragResC.json()
              ragCorreo = typeof rdC?.context === 'string' ? rdC.context : rdC?.answer || ''
            }
          } catch { /* sin RAG */ }
          const gptCorreo = await askGPT({
            fase: 'info_enviada',
            leadData: { nombre: leadSnapshot?.nombre, email: emailDetectado || leadSnapshot?.email, curso: cursoInfo },
            userMessage: 'Dame información del programa',
            ragContext: ragCorreo,
            history: convHistory,
          })
          const ack2 = emailDetectado ? '¡Perfecto, ya tengo tu correo! 📧\n\n' : ''
          const msgFallback = ack2 + gptCorreo.respuesta + buildCTA(cursoInfo)
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msgFallback, 'accion', leadId)
          return buildProviderResponse(provider, msgFallback, waNumber)
        }

        // Aún no dio correo — GPT pide el correo amablemente
        const gptPideCorreo = await askGPT({
          fase: 'correo',
          leadData: { nombre: leadSnapshot?.nombre, email: leadSnapshot?.email, curso: leadSnapshot?.curso },
          userMessage: originalText,
          ragContext: '',
          history: convHistory,
        })
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, gptPideCorreo.respuesta, 'correo')
        return buildProviderResponse(provider, gptPideCorreo.respuesta, waNumber)
      }

      // ── Interceptor global: cambio de programa (igual que el lab) ────────────
      // Dispara en fases post-correo si se detecta un programa diferente al actual.
      // No dispara ante respuestas cortas de CTA (a, b, si, no).
      if (['info_enviada', 'dudas', 'accion', 'seguimiento', 'inscripcion', 'clase_prueba'].includes(phase)) {
        const esRespuestaCTA = /^\s*[aAbBsSnN][iIoO]?\s*$/.test(originalText)
        // No disparar si la mención del programa es contextual (pregunta sobre descuentos, convenios, o comparaciones)
        const esMencionContextual = /\b(si soy|siendo|como alumno|como estudiante|alumno de|estudiante de|egresado de|si tengo|teniendo|me gradué|yo estudié|estudio en|trabajo en|mi carrera|mi programa|hay descuento para|descuento para alumnos|descuento.*estudiante|beneficio.*alumno)\b/i.test(originalText)
        if (!esRespuestaCTA && !esMencionContextual) {
          // Usa detectarPrograma() como única fuente de verdad (sin duplicar lógica)
          const programaNuevoPC = detectarPrograma(originalText)
          const programaActualPC = (leadSnapshot?.curso || '').toLowerCase().trim()
          if (
            programaNuevoPC &&
            programaNuevoPC.toLowerCase() !== programaActualPC &&
            programaActualPC !== 'whatsapp - instituto windsor' &&
            programaActualPC !== ''
          ) {
            if (leadId) {
              await supabase.from('leads').update({ curso: programaNuevoPC, ...(getValorPrograma(programaNuevoPC) ? { valor: getValorPrograma(programaNuevoPC) } : {}) }).eq('id', leadId)
              leadSnapshot = { ...leadSnapshot, curso: programaNuevoPC } as LeadSnapshot
            }
            // Usar INFO_MSG hardcodeado si existe; fallback a RAG+GPT
            const infoMsgPC = INFO_MSGS[programaNuevoPC]
            if (infoMsgPC) {
              const ctaPC = buildCTA(programaNuevoPC)
              const msgPC = infoMsgPC + ctaPC
              await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msgPC, 'accion', leadId)
              return buildProviderResponse(provider, msgPC, waNumber)
            }
            // Fallback RAG+GPT para programas sin INFO_MSG
            let ragPC = ''
            try {
              const ragUrlPC = new URL('/api/rag/query', new URL(request.url).origin)
              const ragResPC = await fetch(ragUrlPC.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  question: `${programaNuevoPC} en Instituto Windsor: costos, horarios, duración, modalidad, certificaciones, campo laboral`,
                  match_count: 15,
                }),
                signal: AbortSignal.timeout(8000),
              })
              if (ragResPC.ok) {
                const rdPC = await ragResPC.json()
                ragPC = typeof rdPC?.context === 'string' ? rdPC.context : rdPC?.answer || ''
              }
            } catch { /* sin RAG */ }
            const gptPC = await askGPT({
              fase: 'info_enviada',
              leadData: { nombre: leadSnapshot?.nombre, email: leadSnapshot?.email, curso: programaNuevoPC },
              userMessage: 'Dame información del programa',
              ragContext: ragPC,
            })
            const msgPCFull = gptPC.respuesta + buildCTA(programaNuevoPC)
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msgPCFull, 'accion', leadId)
            return buildProviderResponse(provider, msgPCFull, waNumber)
          }
        }
      }

      // ── Interceptor verano en seguimiento/accion: si el lead pide info, mandar INFO_MSG directo ──
      if (['seguimiento', 'accion', 'dudas'].includes(phase)) {
        const cursoActual = leadSnapshot?.curso || ''
        const esVerano = cursoActual.includes('verano')
        // "sí/si/ok" solos son ambiguos — solo re-enviar info si hay intención explícita
        const pidioInfo = /\b(dale|info|informaci[oó]n|env[ií]a|manda|cu[eé]ntame|dime|quiero saber|qu[eé] incluye|qu[eé] ofrece|adelante|claro)\b/i.test(originalText)
          || /^(s[ií]|ok)\s*,?\s*(dale|env[ií]a|manda|claro|por favor|quiero|cuéntame)/i.test(originalText.trim())
        if (esVerano && pidioInfo && INFO_MSGS[cursoActual]) {
          const cta = buildCTA(cursoActual)
          const msgVerano = INFO_MSGS[cursoActual] + cta
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, msgVerano, 'accion', leadId)
          return buildProviderResponse(provider, msgVerano, waNumber)
        }
      }

      // ── Interceptor de despedida ─────────────────────────────────────────────
      // Si el usuario se despide, responder con cortesía y no seguir el flujo de ventas
      // NOTA: "buenos días/tardes/noches" se usan tanto para saludar como para despedirse —
      // se excluyen de esta lista para no despedir por error a un lead que apenas está saludando.
      const isGoodbye = /^\s*(gracias|adio?s|hasta luego|hasta pronto|bye|chao|chau|nos vemos|que pase(s)? (un )?(buen|excelente)|hasta ma[ñn]ana|de nada|con gusto|est[aá] bien|ok gracias|okey gracias|muchas gracias|muy amable|listo gracias)\s*[!.]*\s*$/i.test(originalText.trim())
      if (isGoodbye) {
        const despedidaMsg = '¡Con gusto! 😊 Si en algún momento tienes más preguntas sobre Instituto Windsor, aquí estaré. ¡Que tengas un excelente día! 🌟'
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, despedidaMsg)
        return buildProviderResponse(provider, despedidaMsg, waNumber)
      }

      // Contexto RAG para otras fases
      let ragContext = ''
      try {
        const ragUrl = new URL('/api/rag/query', new URL(request.url).origin)
        const isInfoPhase = ['info_enviada', 'dudas', 'correo', 'seguimiento'].includes(phase)
        const matchCount = isInfoPhase ? 15 : 5
        // Usa detectarPrograma() como única fuente de verdad (sin duplicar lógica) —
        // antes había una copia local aquí sin Bachillerato/Prepa, así que una pregunta
        // de seguimiento sobre Bachillerato caía al curso genérico del lead y el RAG
        // contestaba de forma genérica en vez de específica (ver bug reportado 2026-08-06,
        // caso +527472532394: el bot daba vueltas repitiendo el catálogo completo).
        const queryPrograma = (phase === 'dudas' || phase === 'seguimiento')
          ? (detectarPrograma(originalText) || leadSnapshot?.curso || '')
          : leadSnapshot?.curso || ''
        const ragQuestion = queryPrograma && (phase === 'dudas' || phase === 'seguimiento')
          ? `${queryPrograma} en Instituto Windsor: ${originalText}`
          : isInfoPhase && leadSnapshot?.curso
          ? `${leadSnapshot.curso} en Instituto Windsor: costos, horarios, duración, modalidad, certificaciones, campo laboral`
          : (leadSummary ? `${leadSummary}\n\n${originalText}` : originalText)
        const ragRes = await fetch(ragUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: ragQuestion, match_count: matchCount }),
          signal: AbortSignal.timeout(8000),
        })
        if (ragRes.ok) {
          const ragData = await ragRes.json()
          // Para info_enviada usamos contexto crudo para evitar doble resumen
          ragContext = phase === 'info_enviada'
            ? (typeof ragData?.context === 'string' ? ragData.context : ragData?.answer || '')
            : (ragData?.answer || '')
        }
      } catch { /* continuar sin RAG */ }

      // Llamada central a GPT-4o
      const gpt = await askGPT({
        fase: phase,
        leadData: {
          nombre: leadSnapshot?.nombre,
          email: leadSnapshot?.email,
          curso: leadSnapshot?.curso,
        },
        userMessage: originalText,
        ragContext,
        history: convHistory,
      })

      // Escalación por malentendidos consecutivos (5 turnos de bot sin avance de fase)
      const botTurnsInHistory = convHistory.filter(m => m.role === 'assistant').length
      const esMensajePositivo = /^\s*(s[ií]|claro|ok|okay|exacto|de acuerdo|perfecto|estoy interesado|me interesa|interesado|interesada|bien|buenas?\s+(tardes?|d[ií]as?|noches?)|hola|gracias|muchas gracias|genial|excelente|adelante|quiero|s[ií] quiero)\b/i.test(originalText.trim())
      if (botTurnsInHistory >= 5 && gpt.siguienteFase === phase && !gpt.requestedHuman && !gpt.noInterest && !esMensajePositivo) {
        const escalMsg = 'Parece que no te he podido ayudar bien por aquí. 😊 Déjame conectarte con uno de nuestros asesores que podrá orientarte mejor. ¡En breve te contactan!'
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, escalMsg)
        await supabase.from('whatsapp_conversaciones').update({ modo_humano: true }).eq('id', conversacionIdOuter)
        if (leadId) {
          await notifyAsesor(supabase, leadId, 'lead_pide_humano',
            leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
        }
        return buildProviderResponse(provider, escalMsg, waNumber)
      }

      // ── Human-in-the-loop: detectar incertidumbre en respuesta del GPT ──────────
      // Si GPT marcó necesitaRevision O si la respuesta contiene frases de incertidumbre
      const FRASES_INCERTIDUMBRE = [
        'no se menciona', 'no tengo información', 'no dispongo', 'no cuento con',
        'no tengo ese dato', 'no está en mi información', 'te recomendaría preguntar',
        'te recomendaría contactar', 'te recomendaría verificar', 'te recomendaría consultar',
        'no tengo certeza', 'no estoy seguro', 'no puedo confirmar',
        'información específica', 'parece que hay un error', 'no tengo los detalles',
        'contactar directamente', 'consultar directamente', 'preguntar directamente',
        'comunicarse directamente', 'llamar directamente', 'visita directamente',
        'es necesario comunicarse', 'te recomendamos llamar', 'comunícate directamente',
        'permíteme verificar', 'permíteme revisar', 'déjame verificar', 'déjame revisar',
        'déjame confirmar', 'lo confirmo en', 'un momento para verificar',
        'dame un momento', 'un momento para', 'espera un momento',
      ]
      const respuestaIncierta = gpt.necesitaRevision ||
        FRASES_INCERTIDUMBRE.some(f => gpt.respuesta.toLowerCase().includes(f))

      if (respuestaIncierta) {
        // Asignar código de a-z según cuántos pendientes hay. Un código solo cuenta como
        // "usado" si se asignó en las últimas 48h — evita que uno quede pegado para
        // siempre cuando Harold nunca llega a aprobarlo con "X ok" (bug real: 88
        // conversaciones acabaron compartiendo 'c' desde jun-2026 con el pool viejo de a-c).
        const CODIGOS_REVISION = 'abcdefghijklmnopqrstuvwxyz'.split('')
        let codigo = CODIGOS_REVISION[0]
        try {
          const hace48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
          const { data: pendientes } = await supabase
            .from('whatsapp_conversaciones')
            .select('revision_codigo')
            .not('revision_codigo', 'is', null)
            .gte('revision_codigo_asignado_at', hace48h)
          const usados = new Set((pendientes || []).map((c: any) => c.revision_codigo))
          codigo = CODIGOS_REVISION.find(c => !usados.has(c)) || CODIGOS_REVISION[CODIGOS_REVISION.length - 1]
        } catch { /* usar 'a' por defecto */ }

        // Mensaje al lead avisando que se escala con un asesor
        const msgEspera = `Déjame consultarlo con un asesor para darte la respuesta exacta 😊 En breve te respondemos.`
        await supabase.from('whatsapp_mensajes').insert([{
          conversacion_id: conversacionIdOuter,
          rol: 'bot',
          contenido: msgEspera,
        }])
        // modo_humano: true — antes la conversación quedaba "sin bloquear": el siguiente
        // mensaje del lead se procesaba de nuevo con GPT como si nada hubiera pasado,
        // pudiendo contestar cosas distintas/contradictorias a la pregunta ya escalada
        // (ver bug reportado 2026-08-06, caso +527472532394). Bloquear aquí es consistente
        // con el resto del código: es el mismo flag que ya usa la escalación por 5 turnos
        // sin avance (línea ~3733) y con cómo ya se resuelven manualmente estos casos en
        // la revisión diaria de 24h (mandando la corrección con modoHumano:false explícito).
        await supabase.from('whatsapp_conversaciones')
          .update({ modo_humano: true, ultimo_mensaje_at: new Date().toISOString() })
          .eq('id', conversacionIdOuter)
        // Guardar código en la conversación (columna aparte, puede no existir aún)
        try {
          await supabase.from('whatsapp_conversaciones')
            .update({ revision_codigo: codigo, revision_codigo_asignado_at: new Date().toISOString() })
            .eq('id', conversacionIdOuter)
        } catch { /* columna puede no existir aún — ver supabase/revision_pendiente.sql */ }

        // Alerta a Harold con código
        const nombreLead = leadSnapshot?.nombre || waNumber
        const programa = leadSnapshot?.curso || 'programa desconocido'
        const notif = `❓ *[${codigo.toUpperCase()}]* ${nombreLead} — ${programa}\n"${originalText}"\n\nResponde: ${codigo.toUpperCase()}: tu explicación aquí`
        try {
          await sendMetaWhatsAppMessage({ to: ADMIN_WA_ALERTA, body: notif })
        } catch (notifErr) {
          console.error('[REVISION] Error notificando a Harold:', notifErr)
        }
        return buildProviderResponse(provider, msgEspera, waNumber)
      }

      // Persistir datos capturados por GPT
      if (gpt.nombre && leadId && !hasLeadName(leadSnapshot?.nombre, waNumber) && hasLeadName(gpt.nombre, waNumber)) {
        await supabase.from('leads').update({ nombre: gpt.nombre, stage: 'contactado' }).eq('id', leadId)
      }
      if (gpt.email && leadId) {
        await supabase.from('leads').update({ email: gpt.email }).eq('id', leadId)
      }
      if (gpt.programa && leadId) {
        const cursoCanonico = canonicalizarPrograma(gpt.programa, originalText)
        await supabase.from('leads').update({ curso: cursoCanonico, ...(getValorPrograma(cursoCanonico) ? { valor: getValorPrograma(cursoCanonico) } : {}) }).eq('id', leadId)
      }

      // Actualizar stage del lead según la fase destino
      const newStage = getStageForPhase(gpt.siguienteFase)
      if (newStage && leadId) {
        await supabase.from('leads').update({ stage: newStage }).eq('id', leadId)
      }

      // Si GPT avanza a programa, interceptar
      if (gpt.siguienteFase === 'programa') {
        if (gpt.nombre && leadId && !hasLeadName(leadSnapshot?.nombre, waNumber) && hasLeadName(gpt.nombre, waNumber)) {
          await supabase.from('leads').update({ nombre: gpt.nombre, stage: 'contactado' }).eq('id', leadId)
        }
        // Si venimos de saludo sin nombre válido, volver a pedir nombre (no mostrar catálogo con teléfono)
        const nombreValido = hasLeadName(gpt.nombre || leadSnapshot?.nombre, waNumber)
        if (phase === 'saludo' && !nombreValido) {
          const askName = '¿Cómo te llamas? 😊 Así puedo ayudarte mejor.'
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, askName, 'saludo')
          return buildProviderResponse(provider, askName, waNumber)
        }
        // "inglés" ambiguo — preguntar cuál de las tres opciones
        const msgLower2 = originalText.toLowerCase()
        if (/ingl[eé]s/i.test(msgLower2) && !/ni[ñn]o|adulto|licenciatura|lic\b/i.test(msgLower2)) {
          const disambig = `Tenemos tres opciones de inglés, ¿cuál te interesa?\n\nA) Inglés para adultos\nB) Inglés para niños\nC) Licenciatura en Inglés`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, disambig, 'programa')
          return buildProviderResponse(provider, disambig, waNumber)
        }
        // Si el usuario ya nombró un programa específico sin ambigüedad, saltar catálogo e ir a correo.
        // Usa leadSnapshot?.curso como respaldo de gpt.programa: la captura determinística de
        // arriba (detectarPrograma, antes de llamar a GPT) ya lo puede haber guardado aunque GPT
        // no lo haya extraído en su JSON — mismo bug de fondo del 2026-08-07.
        const programaGPT = gpt.programa || leadSnapshot?.curso
        if (programaGPT && leadId) {
          const cursoCanonico = canonicalizarPrograma(programaGPT, originalText)
          await supabase.from('leads').update({ curso: cursoCanonico, ...(getValorPrograma(cursoCanonico) ? { valor: getValorPrograma(cursoCanonico) } : {}) }).eq('id', leadId)
          // Si el lead ya tiene correo capturado (de este mensaje vía GPT o de antes),
          // no volver a pedirlo — ir directo a la info del programa
          const emailYaCapturado = gpt.email || leadSnapshot?.email
          if (hasLeadEmail(emailYaCapturado)) {
            const infoGPT = await buildProgramInfoMessage(cursoCanonico, request.url, { nombre: gpt.nombre || leadSnapshot?.nombre, email: emailYaCapturado }, convHistory)
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, infoGPT, 'accion', leadId)
            return buildProviderResponse(provider, infoGPT, waNumber)
          }
          // Mensaje siempre determinístico, nunca gpt.respuesta: aquí es donde el bug real
          // ocurrió — GPT escribió una negación del programa en su "respuesta" libre a pesar
          // de que el programa sí se había identificado correctamente.
          const correoMsg = `¡Perfecto! 😊 Para contarte todo sobre *${cursoCanonico}*, ¿me compartes tu correo electrónico para darte seguimiento personalizado? 📧`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, correoMsg, 'correo')
          return buildProviderResponse(provider, correoMsg, waNumber)
        }
        // Sin programa identificado — diferenciar entre categoría genérica, carrera no ofrecida, o mensaje ambiguo
        const nombreMostrar = nombreValido ? (gpt.nombre || leadSnapshot?.nombre) : null
        const msgTrimGPT = originalText.trim()

        const categoriaGenericaGPT = msgTrimGPT.match(/^licenciaturas?$/i)
          ? `Tenemos las siguientes licenciaturas:\n\n• Licenciatura en Inglés\n• Relaciones públicas y mercadotecnia\n• Administración turística\n• Psicología\n\n¿Cuál te interesa? 😊`
          : msgTrimGPT.match(/^maestr[ií]as?$/i)
          ? `Tenemos dos maestrías:\n\n• Maestría en Innovación empresarial\n• Maestría en Multiculturalidad y Plurilingüismo\n\n¿Cuál te interesa? 😊`
          : msgTrimGPT.match(/^diplomados?$/i)
          ? `Contamos con más de 30 diplomados en distintas áreas. ¿Me puedes decir cuál tema te interesa? Por ejemplo: salud, educación, negocios, tecnología... 😊`
          : msgTrimGPT.match(/^(cursos?|idiomas?)$/i)
          ? `Ofrecemos cursos de:\n\n• Inglés para adultos\n• Inglés para niños\n• Francés\n• Italiano\n\n¿Cuál te interesa? 😊`
          : null

        if (categoriaGenericaGPT) {
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, categoriaGenericaGPT, 'programa')
          return buildProviderResponse(provider, categoriaGenericaGPT, waNumber)
        }

        const pareceCarreraEspecificaGPT =
          /m[eé]dic|enfermer|derecho|contadur|ingenier|arquitect|qu[ií]mic|biolog|nutric|odontolog|veterinar|farmac|f[ií]sica|matem|historia|filosof|geograf|econom|sociolog|antropolog|comunicaci[oó]n|periodis|artes?|diseño|música|danza|teatro|cine|fotograf/i.test(msgTrimGPT)

        if (pareceCarreraEspecificaGPT) {
          const noOfrecemosGPT = `${nombreMostrar ? `Disculpa ${nombreMostrar}, ` : 'Disculpa, '}ese programa no forma parte de nuestra oferta educativa. 😊\n\nEstos son los programas que sí tenemos en Instituto Windsor:\n\n${CATALOGO_OFERTA}`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, noOfrecemosGPT, 'programa')
          return buildProviderResponse(provider, noOfrecemosGPT, waNumber)
        }

        const botMessage = nombreMostrar
          ? `¡Hola ${nombreMostrar}! 😊 ¿Qué programa de Instituto Windsor te interesa?\n\n${CATALOGO_OFERTA}`
          : `¡Hola! 😊 ¿Qué programa de Instituto Windsor te interesa?\n\n${CATALOGO_OFERTA}`
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, botMessage, 'programa')
        return buildProviderResponse(provider, botMessage, waNumber)
      }

      // Interceptores de fases — mensajes hardcodeados
      let botMessage = gpt.respuesta
      let nextFase = gpt.siguienteFase

      if (nextFase === 'examen') {
        // Track A idiomas: enviar instrucciones de examen de ubicación
        botMessage = EXAMEN_UBICACION_MSG
      } else if (nextFase === 'clase_prueba') {
        // Track A idiomas: invitar a clase de prueba (después del examen)
        botMessage = buildClasePruebaMsg(leadSnapshot?.nombre, leadSnapshot?.email, leadSnapshot?.curso, leadSnapshot?.whatsapp)
        nextFase = 'clase_prueba'
      } else if (nextFase === 'inscripcion' && phase !== 'inscripcion') {
        // Track B: proceso de inscripción — según lista cerrada de programas, nunca por descarte
        const tipoInsGPT = tipoInscripcion(leadSnapshot?.curso)
        if (tipoInsGPT === 'desconocido') {
          await alertarProgramaNoReconocido(leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
          botMessage = INSCRIPCION_DESCONOCIDA_MSG
          nextFase = 'seguimiento'
        } else {
          botMessage = mensajeInscripcionPara(tipoInsGPT, leadSnapshot?.curso)
          nextFase = tipoInsGPT === 'verano' ? 'inscripcion_pendiente' : 'inscripcion'
        }
      } else if (nextFase === 'inscripcion_online') {
        botMessage = INSCRIPCION_ONLINE_MSG
        nextFase = 'seguimiento'
      } else if (nextFase === 'inscripcion_presencial') {
        // buildInscripcionPresencialMsg pide Certificado de Bachillerato y CURP — solo licenciaturas
        if (esLicenciatura(leadSnapshot?.curso)) {
          botMessage = buildInscripcionPresencialMsg(leadSnapshot?.nombre, leadSnapshot?.email, leadSnapshot?.curso, leadSnapshot?.whatsapp)
          nextFase = 'seguimiento'
        } else {
          const tipoInsPres = tipoInscripcion(leadSnapshot?.curso)
          if (tipoInsPres === 'desconocido') {
            await alertarProgramaNoReconocido(leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
            botMessage = INSCRIPCION_DESCONOCIDA_MSG
            nextFase = 'seguimiento'
          } else {
            botMessage = mensajeInscripcionPara(tipoInsPres, leadSnapshot?.curso)
            nextFase = tipoInsPres === 'verano' ? 'inscripcion_pendiente' : 'inscripcion'
          }
        }
      } else if (nextFase === 'inscripcion_confirmada') {
        const nombreLead = leadSnapshot?.nombre || ''
        botMessage = `¡Perfecto${nombreLead ? ' ' + nombreLead : ''}! 🎉 Recibimos tu información. Un asesor revisará todo y te confirmará tu inscripción en breve. ¡Bienvenid@ a la familia Windsor!`
        nextFase = 'seguimiento'
      }

      // Persistir teléfono si fue capturado en fase asesor
      if (gpt.telefono && leadId) {
        await supabase.from('leads').update({ whatsapp: gpt.telefono }).eq('id', leadId)
      }

      // Notificaciones al asesor según el evento
      if (leadId) {
        if (gpt.requestedHuman) {
          // Activar modo humano en la conversación
          await supabase
            .from('whatsapp_conversaciones')
            .update({ modo_humano: true })
            .eq('id', conversacionIdOuter)
          await notifyAsesor(supabase, leadId, 'lead_pide_humano',
            leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
        }
        if (nextFase === 'inscripcion_confirmada' || (phase === 'inscripcion' && /ya.*llen[eé]|ya.*hice|ya.*complet|listo|ya.*pagu[eé]|ya.*realic[eé]/i.test(originalText))) {
          await notifyAsesor(supabase, leadId, 'inscripcion_confirmada',
            leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
        }
        if (gpt.siguienteFase === 'clase_prueba') {
          await notifyAsesor(supabase, leadId, 'examen_confirmado',
            leadSnapshot?.nombre, waNumber, leadSnapshot?.curso)
        }
      }

      await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, botMessage, nextFase, leadId)
      return buildProviderResponse(provider, botMessage, waNumber)
    }

    // Sin conversación aún: saludo inicial
    if (waNumber && !conversacionIdOuter) {
      const answer = `Hola, gracias por comunicarte con ${BOT_SIGNATURE}. ¿Me compartes tu nombre, por favor?`
      return buildProviderResponse(provider, answer, waNumber)
    }

    return buildProviderResponse(provider, `Hola. Soy el asistente de ${BOT_SIGNATURE}. ¿En qué puedo ayudarte?`, waNumber)
  } catch (e) {
    console.error('[webhook whatsapp]', e)
    // Notificar al admin por WhatsApp del error
    try {
      const supabase = createServiceRoleClient()
      const { data: admins } = await supabase.from('profiles').select('whatsapp').eq('rol', 'admin')
      const errMsg = `⚠️ *Error en webhook Windsor*\n${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}\n🕐 ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`
      const provider = getWhatsAppProvider()
      for (const admin of (admins || [])) {
        const phone = admin.whatsapp as string | null
        if (!phone) continue
        if (provider === 'meta') {
          await sendMetaWhatsAppMessage({ to: phone, body: errMsg }).catch(() => {})
        } else {
          const sid = process.env.TWILIO_ACCOUNT_SID; const tok = process.env.TWILIO_AUTH_TOKEN; const from = process.env.TWILIO_WHATSAPP_FROM
          if (sid && tok && from) {
            await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}` },
              body: new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${phone}`, Body: errMsg }).toString(),
            }).catch(() => {})
          }
        }
      }
    } catch {}
    const fallback = 'Disculpa, tuvimos un detalle momentáneo. Escríbeme de nuevo y con gusto te respondo.'
    return buildProviderResponse(getWhatsAppProvider(), fallback, waNumber)
  }
}
