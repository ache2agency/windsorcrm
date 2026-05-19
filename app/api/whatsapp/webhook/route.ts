import { createServiceRoleClient } from '@/utils/supabase/server'
import {
  getMetaConfig,
  getWhatsAppProvider,
  normalizePhoneNumber,
  sendMetaWhatsAppMessage,
  type WhatsAppProvider,
} from '@/lib/whatsapp/provider'

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
  const value = String(nombre || '').trim()
  if (!value || value.length < 2) return false
  if (value === String(whatsapp || '').trim()) return false
  if (/@/.test(value)) return false
  // Rechazar si tiene más de 4 palabras (nombres reales tienen máx 4)
  if (value.split(/\s+/).length > 4) return false
  // Rechazar si contiene dígitos
  if (/\d/.test(value)) return false
  // Rechazar si contiene signos de puntuación o interrogación (es una frase)
  if (/[¿?¡!,;:.\/\\]/.test(value)) return false
  // Rechazar palabras que claramente no son nombres propios
  const noNombres = /^(hola|buenas?|buen|d[ií]a|tardes?|noches?|info|informaci[oó]n|costos?|precios?|quiero|quisiera|necesito|ayuda|gracias|ok|s[ií]|no|nada|nope|oye|hey|buenos|saludos|permiso|disculp)$/i
  if (noNombres.test(value.trim())) return false
  return true
}

function hasLeadEmail(email: string | null | undefined) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

function hasLeadProgram(curso: string | null | undefined) {
  const value = String(curso || '').trim().toLowerCase()
  return !!value && value !== 'whatsapp - instituto windsor'
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

// ─── NOTIFICACIONES AL ASESOR ────────────────────────────────────────────────

type NotifyEvent =
  | 'lead_pide_humano'
  | 'inscripcion_confirmada'
  | 'examen_confirmado'
  | 'cita_agendada'
  | 'nuevo_lead'

const NOTIFY_LABELS: Record<NotifyEvent, string> = {
  lead_pide_humano:      '🙋 Lead pide hablar con un asesor',
  inscripcion_confirmada:'🎉 Lead confirmó pago y documentos',
  examen_confirmado:     '📝 Lead confirmó que realizó el examen de ubicación',
  cita_agendada:         '📅 Lead agendó una cita',
  nuevo_lead:            '👋 Nuevo lead por WhatsApp',
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

    const message = Array.isArray(value?.messages) ? value?.messages?.[0] : null
    if (!message || !message.from) return null

    const profileName = value?.contacts?.[0]?.profile?.name || ''
    const normalizedFrom = normalizePhoneNumber(message.from)

    if (message.type !== 'text' || !message.text?.body) {
      // Mensajes multimedia (audio, imagen, video, sticker, etc.)
      const mediaTypes = ['audio', 'image', 'video', 'sticker', 'document', 'voice']
      if (mediaTypes.includes(message.type || '')) {
        return {
          provider: 'meta',
          body: '__MEDIA__',
          from: normalizedFrom,
          waNumber: normalizedFrom,
          profileName,
          rawPayload: payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {},
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
      rawPayload:
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : {},
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

  return buildTwiml(message)
}

// ─── INFO_MSGS: fuente de verdad por programa (igual que el lab) ─────────────
// Para programas conocidos usamos esto directamente — sin GPT/RAG —
// para garantizar que siempre incluya promo y sea consistente.

const INFO_MSGS: Record<string, string> = {
  'Inglés para adultos': `¡Excelente elección! 😊 Te comparto la información de nuestro Curso de Inglés:

*📚 Curso de Inglés para Adultos*
Dirigido a personas de 13 años en adelante

*🎓 Modalidad:* Presencial y Online

*🕐 Horarios presenciales:*
• Matutino: 10:00 - 12:00 hrs
• Vespertino: 17:00 - 19:00 hrs
• Sabatino: 09:00 - 13:00 hrs

*🛜 Horarios online:*
• Vespertino: 17:00 - 19:00 hrs
• Sabatino: 09:00 - 13:00 hrs

*⏳ Duración:* 5 meses (10 meses sabatino)

*💰 Inversión:*
• Inscripción: $750
• Mensualidad desde $990

*🎉 Promoción del mes:*
• Inscripción: ~$750~ → $375 (50% de descuento)
• ¡Primer mes gratis!

Al terminar obtienes un Diploma con validez oficial.`,

  'Inglés para niños': `¡Qué gran decisión para el futuro de tu hij@! 😊 Te comparto la información de nuestro Curso de Inglés para Niños:

*📚 Curso de Inglés para Niños*
Dirigido a niños de 4 a 12 años

*🎓 Modalidad:* Presencial y Online

*🕐 Horarios presenciales:*
• Martes a jueves: 13:00 - 14:00 hrs o 17:00 - 18:00 hrs
• Sabatino: 09:00 - 13:00 hrs

*🛜 Horarios online:*
• Lunes a jueves: 17:00 - 18:00 hrs
• Sabatino: 09:00 - 13:00 hrs

*⏳ Duración:* 5 meses

*💰 Inversión:*
• Inscripción: $800
• Mensualidad: $780

*🎉 Promoción del mes:*
• Inscripción: ~$800~ → $400 (50% de descuento)
• ¡Primer mes gratis!

Al terminar obtiene un Diploma con validez oficial.`,

  'Psicología': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Psicología:

*🎓 Licenciatura en Psicología*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300 (incluye credencial)
• Mensualidad: $2,750

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Salud, educación, medio ambiente, producción, consumo y convivencia social.

📄 Plan de estudios: https://drive.google.com/file/d/1mw16jhbwN3K2dBy3ajcb3qREOPVXZ9rb/view`,

  'Licenciatura en Inglés': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Inglés:

*🎓 Licenciatura en Inglés*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,150 (incluye credencial)
• Mensualidad: $2,750

*🎉 Promoción del mes:*
• Inscripción: ~$2,150~ → $645 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Docente, traductor, asesor editorial, call centers, centros de investigación y organismos internacionales.

📄 Plan de estudios: https://drive.google.com/file/d/1M_K1sIqh-8LgZdTsiAmIRMOkVIiTw295/view`,

  'Licenciatura en Inglés online': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Inglés Online:

*🎓 Licenciatura en Inglés*
Modalidad: Online | Duración: 3 años

*💰 Inversión:*
• Inscripción semestral: $2,150 (incluye credencial)
• Mensualidad: $2,750

*🎉 Promoción del mes:*
• Inscripción: ~$2,150~ → $645 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Docente, traductor, asesor editorial, call centers, centros de investigación y organismos internacionales.

📄 Plan de estudios: https://drive.google.com/file/d/1wy4BiHspFFBZ3d1dBfO0ki-koDhR3MNg/view`,

  'Administración turística': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Administración Turística:

*🎓 Licenciatura en Administración Turística*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,200 (incluye credencial)
• Mensualidad: $2,750

*🎉 Promoción del mes:*
• Inscripción: ~$2,200~ → $660 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Agencias de viajes, hoteles, resorts, operadores turísticos, eventos y convenciones.

📄 Plan de estudios: https://drive.google.com/file/d/1FMFbZ4pupnqkD_X1pBUcxlVo0HmRxUPb/view`,

  'Administración turística online': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Administración Turística Online:

*🎓 Licenciatura en Administración Turística*
Modalidad: Online | Duración: 3 años

*💰 Inversión:*
• Inscripción semestral: $2,200 (incluye credencial)
• Mensualidad: $2,750

*🎉 Promoción del mes:*
• Inscripción: ~$2,200~ → $660 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Agencias de viajes, hoteles, resorts, operadores turísticos, eventos y convenciones.

📄 Plan de estudios: https://drive.google.com/file/d/1JEhS0iVIkATLicd6wqGqUXcHyB_lzT4C/view`,

  'Relaciones públicas y mercadotecnia': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Relaciones Públicas y Mercadotecnia:

*🎓 Licenciatura en Relaciones Públicas y Mercadotecnia*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300 (incluye credencial)
• Mensualidad: $2,750

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*✨ Incluye 3 certificaciones:* Marketing digital, creación de páginas web y diseño gráfico.

*💼 Campo laboral:* Agencias de publicidad, marketing, medios de comunicación, gobierno, tecnología, entretenimiento.

📄 Plan de estudios: https://drive.google.com/file/d/1tv2023m30ZVHJRryfwhNm6tT9wICHvnZ/view`,

  'Relaciones públicas y mercadotecnia online': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Relaciones Públicas y Mercadotecnia Online:

*🎓 Licenciatura en Relaciones Públicas y Mercadotecnia*
Modalidad: Online | Duración: 3 años

*💰 Inversión:*
• Inscripción semestral: $2,300 (incluye credencial)
• Mensualidad: $2,750

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
• Inscripción cuatrimestral: $1,100 (incluye credencial)
• Mensualidad: $1,800

*🎉 Promoción del mes:*
• Inscripción: ~$1,100~ → $550 (50% de descuento)
• Mensualidad: ~$1,800~ → $1,440 (20% de descuento)

📄 Más información: https://drive.google.com/file/d/1txVAaLEpi-WPTybWtSKKMu3mn6fC5TkK/view`,
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
}

function getValorPrograma(programa: string | null | undefined): number | null {
  if (!programa) return null
  return VALOR_POR_PROGRAMA[programa] ?? null
}

/** Programas de idiomas (Track A): después del info van a examen de ubicación */
function esInglesIdioma(programa: string | null | undefined): boolean {
  return /ingl[eé]s para (ni[ñn]os?|adultos?)/i.test(programa || '')
}

/** CTA siempre en código, nunca delegado a GPT */
function buildCTA(programa: string | null | undefined): string {
  const opcionB = esInglesIdioma(programa)
    ? '*B)* Agendar mi examen de ubicación gratuito 📝'
    : '*B)* Quiero inscribirme ✍️'
  return `\n\n¿Cómo te gustaría continuar?\n*A)* Tengo dudas 🤔\n${opcionB}`
}

function eligeB(msg: string): boolean {
  const m = msg.toLowerCase()
  return /\bb\b|opci[oó]n.*b|\b2\b|quiero.*clase|clase.*prueba|quiero inscrib|inscribirme|agendar.*examen|examen.*ubicaci[oó]n|quiero.*agendar|prueba.*gratuita/.test(m)
}

function eligeA(msg: string): boolean {
  const m = msg.toLowerCase()
  return /\ba\b|opci[oó]n.*a|\b1\b|tengo duda|más duda|tengo preguntas/.test(m)
}

/** Detecta programa específico en el mensaje (igual que lab) — nunca retorna "inglés" genérico */
function detectarPrograma(msg: string): string | null {
  if (/ingl[eé]s para ni[ñn]os?|ni[ñn]os?.*ingl[eé]s|ingl[eé]s.*ni[ñn]os?/i.test(msg)) return 'Inglés para niños'
  if (/ingl[eé]s para adultos?|adultos?.*ingl[eé]s|ingl[eé]s.*adultos?/i.test(msg)) return 'Inglés para adultos'
  if (/licenciatura.*ingl[eé]s.*online|ingl[eé]s.*licenciatura.*online|\blic\b.*ingl[eé]s.*online/i.test(msg)) return 'Licenciatura en Inglés online'
  if (/licenciatura.*ingl[eé]s|ingl[eé]s.*licenciatura|\blic\b.*ingl[eé]s|ingl[eé]s.*\blic\b/i.test(msg)) return 'Licenciatura en Inglés'
  if (/psicolog|psico\b/i.test(msg)) return 'Psicología'
  if (/tur[ií]s.*(online|en l[ií]nea)|(online|en l[ií]nea).*tur[ií]s/i.test(msg)) return 'Administración turística online'
  if (/tur[ií]s|turism/i.test(msg)) return 'Administración turística'
  if (/(relaciones p[uú]blicas|mercadotecnia|\bmkt\b|marketing).*(online|en l[ií]nea)/i.test(msg)) return 'Relaciones públicas y mercadotecnia online'
  if (/relaciones p[uú]blicas|mercadotecnia|\bmkt\b|marketing/i.test(msg)) return 'Relaciones públicas y mercadotecnia'
  if (/franc[eé]s/i.test(msg)) return 'Francés'
  if (/italian/i.test(msg)) return 'Italiano'
  if (/innovaci[oó]n empresarial/i.test(msg)) return 'Maestría en Innovación empresarial'
  if (/multiculturalidad|pluriling/i.test(msg)) return 'Maestría en Multiculturalidad'
  if (/bachillerato/i.test(msg)) return 'Bachillerato'
  return null
}

/** Detecta email en el mensaje */
function detectarEmail(msg: string): string | null {
  const match = msg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return match ? match[0] : null
}

/** Detecta si el usuario no quiere dar correo */
function noQuiereEmail(msg: string): boolean {
  const m = msg.toLowerCase()
  if (/no ten|sin correo|no.*correo|no.*email|no.*mail|no quiero|no doy|no hay|no pos|nop/i.test(m)) return true
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
☀️ *Verano 2026:* 20% descuento`,

  suspeg: `*Convenio: SUSPEG Central*
Beneficiarios: Trabajador, hijos y cónyuges | Vigencia: 15-Dic-2025

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 25% descuento
📚 *Cursos libres:* 40% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 30% descuento
☀️ *Verano 2026:* 20% descuento`,

  seccion7: `*Convenio: Sección VII*
Beneficiarios: Trabajador, hijos y cónyuges | Vigencia: Marzo 2027

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 25% descuento
📚 *Cursos libres:* 40% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 30% descuento
☀️ *Verano 2026:* 20% descuento`,

  seccion36: `*Convenio: Sección 36 de Salud*
Beneficiarios: Trabajador, hijos y cónyuges | Vigencia: Noviembre 2025

📌 *Inscripción:* 30% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 25% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 25% descuento
☀️ *Verano 2026:* 20% descuento`,

  tribunal: `*Convenio: Tribunal Electoral del Estado de Guerrero*
Beneficiarios: Trabajador, hijos y cónyuges | Vigencia: Marzo 2026

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 20% descuento
☀️ *Verano 2026:* 20% descuento`,

  cobach: `*Convenio: Colegios de Bachilleres del Estado de Guerrero*
Beneficiarios: Trabajadores, hijos y estudiantes de planteles | Vigencia: Marzo 2027

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 30% descuento
☀️ *Verano 2026:* 20% descuento`,

  migrantes: `*Convenio: Secretaría de Migrantes y Asuntos Internacionales*
Beneficiarios: Trabajadores, hijos y estudiantes de planteles | Vigencia: Mayo 2026

📌 *Inscripción:* 40% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 30% descuento
☀️ *Verano 2026:* 20% descuento`,

  proteccioncivil: `*Convenio: Secretaría de Gestión Integral y Protección Civil*
Beneficiarios: Trabajadores, hijos y estudiantes de planteles | Vigencia: Sep-2027

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 20% descuento
☀️ *Verano 2026:* 20% descuento`,

  sitmabeg: `*Convenio: SITMABEG*
Beneficiarios: Trabajadores, hijos y estudiantes de planteles | Vigencia: Mayo 2027

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 30% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 20% descuento
☀️ *Verano 2026:* 20% descuento`,

  metro: `*Convenio: Sindicato del Metro CD. México*
Beneficiarios: Trabajadores e hijos | Vigencia: Ene-2027

📌 *Inscripción:* 50% nuevo ingreso | 30% reingreso
📚 *Licenciatura:* 20% descuento
📚 *Cursos libres:* 20% descuento
🎓 *Preparatoria:* 20% descuento
🎓 *Maestría:* 20% descuento
☀️ *Verano 2026:* 20% descuento`,

  egresados: `*Convenio: Egresados Instituto Windsor*
Beneficiarios: Egresados de Licenciaturas | Vigencia: Permanente

📌 *Inscripción:* Condonación nuevo ingreso | 50% reingreso
📚 *Licenciatura:* No aplica
📚 *Cursos libres:* 50% descuento
🎓 *Preparatoria:* No aplica
🎓 *Maestría:* 25% descuento
☀️ *Verano 2026:* 20% descuento`,

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
  if (/secundaria.*t[eé]cnica.*81|sec.*t[eé]cnica.*81|81/i.test(m)) return 'sec81'
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
•Verano adultos
•Verano niños

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
Si el prospecto hace una pregunta antes de dar su nombre (ej. "¿cuándo inician inscripciones?", "¿cuánto cuesta?"), respóndela brevemente con la información de la BASE y luego pide su nombre para continuar. No ignores la pregunta.
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
SIEMPRE termina el mensaje con exactamente estas dos opciones, sin excepción:
A) Tengo dudas sobre el programa
B) Quiero inscribirme
(Si el programa es inglés adultos, inglés niños o cualquier curso de idiomas, cambia B por: "B) Quiero agendar mi clase de prueba gratuita" y pon siguienteFase: accion)`,

    dudas: `Responde la duda con datos concretos de la BASE (costos, horarios, requisitos, etc.). Si la duda es sobre costos o precio, incluye siempre la promoción vigente con el porcentaje de descuento y el precio final (ej. "Inscripción: ~$2,300~ → $690 (70% de descuento)").
Si la pregunta es ambigua o indirecta, interpreta la intención del prospecto y busca en la BASE el tema más relacionado. Ejemplos:
- Si menciona que trabaja en alguna institución o pregunta por precio especial → busca convenios
- Si pregunta si el título "vale" o "sirve" → responde sobre RVOE y reconocimiento oficial
- Si pregunta qué necesita traer o si hay libros → responde sobre material
- Si pregunta cuánto tiempo o cuándo termina → responde sobre duración
Al terminar, vuelve a presentar:
A) Tengo más dudas
B) Quiero inscribirme [o "B) Quiero mi clase de prueba" si es inglés]
Si elige A → siguienteFase: dudas. Si elige B → siguienteFase: inscripcion (o clase_prueba si es inglés).`,

    accion: `Si el prospecto hace una pregunta (sobre costos, horarios, uniformes, materiales, requisitos, etc.), respóndela primero con datos concretos de la BASE y luego presenta las opciones. Si solo responde con A/B o no hace ninguna pregunta, presenta directamente las opciones.
Opciones a presentar:
- Si el programa es inglés (niños o adultos): A) Tengo dudas  B) Quiero agendar mi clase de prueba gratuita → siguienteFase: clase_prueba
- Para todos los demás programas: A) Tengo dudas  B) Quiero inscribirme → siguienteFase: inscripcion
Si elige A → siguienteFase: dudas.`,

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
Si quiere inscribirse → siguienteFase: inscripcion. Si quiere clase de prueba (solo inglés) → siguienteFase: clase_prueba.
Si no hay una pregunta clara, recuérdale amablemente el siguiente paso según su programa.`,
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
- Formato WhatsApp únicamente: usa *negrita* (un asterisco), nunca **negrita** ni encabezados con #.
- Mensajes cortos en fases de captura (saludo, correo). Más detallado en info_enviada y dudas.
- No vuelvas a pedir datos que ya tienes.
- Si da nombre + programa + correo juntos, captúralos todos.
- Si pide hablar con una persona, pon requestedHuman: true y siguienteFase: asesor.
- Si claramente no le interesa, pon noInterest: true.
- "programa": nombre que usó el prospecto, o null.
- "telefono": teléfono dado en este mensaje (en fase asesor), o null.
- PRECIOS: NUNCA calcules precios ni descuentos tú mismo. Copia los precios EXACTOS de la BASE DE CONOCIMIENTO tal como están escritos. Si la BASE no tiene el precio exacto, NO lo inventes — di que le darás el detalle cuando elija el programa específico.
- Si el prospecto pregunta por varias licenciaturas o programas en general (sin elegir uno), da solo una vista general muy breve (mención de programas, duración, existencia de promociones) y pide que elija uno específico para darle el detalle completo y exacto. No intentes resumir precios de múltiples programas.
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
  "noInterest": false
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
  }
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
  try {
    let leadSummary = ''
    let leadId: string | undefined
    let humanMode = false
    let currentFase = 'saludo'
    let conversacionIdOuter: string | undefined

    const incoming = await parseIncomingWhatsAppMessage(request)
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

    const provider = incoming.provider || getWhatsAppProvider()
    const originalText = incoming.body.trim().normalize('NFC')
    const text = originalText.toLowerCase()
    const waNumber = incoming.waNumber || ''
    const profileName = incoming.profileName || ''

    let leadSnapshot: LeadSnapshot | null = null

    // Crear lead y conversación automáticamente en Supabase con el número de WhatsApp
    if (waNumber) {
      try {
        const supabase = createServiceRoleClient()

        // Normalizamos el número como lo recibimos, sin transformarlo más
        const whatsappValue = waNumber

        // Verificar si ya existe un lead con este WhatsApp
        const { data: existingLead } = await supabase
          .from('leads')
          .select('id, nombre, email, curso, stage, whatsapp')
          .eq('whatsapp', whatsappValue)
          .maybeSingle()

        leadId = existingLead?.id as string | undefined
        leadSnapshot = (existingLead as LeadSnapshot | null) || null

        if (!leadId) {
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
          const defaultAssignee = await getDefaultAssigneeId(supabase)

          const { data: insertedLead } = await supabase
            .from('leads')
            .upsert(
              [
                {
                  nombre: '',
                  email: '',
                  whatsapp: whatsappValue,
                  curso: 'WhatsApp - Instituto Windsor',
                  valor: 0,
                  notas: `Lead creado automáticamente desde WhatsApp.${profileName ? ' Nombre WA: ' + profileName : ''}`,
                  stage: 'contactado',
                  fecha: today,
                  ...(defaultAssignee ? { asignado_a: defaultAssignee } : {}),
                },
              ],
              { onConflict: 'whatsapp', ignoreDuplicates: true }
            )
            .select('id, nombre, email, curso, stage, whatsapp')
            .maybeSingle()

          // Si upsert no devolvió nada (ya existía), buscar el lead existente
          const finalLead = insertedLead ?? (await supabase
            .from('leads')
            .select('id, nombre, email, curso, stage, whatsapp')
            .eq('whatsapp', whatsappValue)
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
                detail: 'Contacto entrante por WhatsApp.',
                meta: { source: 'whatsapp', provider },
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
          conversacionRow = existingConv
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
        } else {
          const { data: nuevaConv } = await supabase
            .from('whatsapp_conversaciones')
            .insert([
              {
                whatsapp: whatsappValue,
                lead_id: leadId ?? null,
                estado: 'abierta',
                fase: desiredPhase,
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

          // Anti-duplicados: esperar y verificar que no llegó un mensaje más reciente
          await new Promise(r => setTimeout(r, 800))
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

      // ── Fase saludo: captura de nombre en código (sin GPT) ─────────────────
      if (phase === 'saludo') {
        const words = originalText.trim().split(/\s+/)
        const isGreeting = /^\s*(hola|hey|ola|buenas|buenos|buen[oa])\b/i.test(originalText.trim())
        const hasProgramKeyword = /ingl[eé]s|psicolog|turism|relaciones|bachillerato|maestr[ií]a|diplomado|administraci[oó]n|idiom|franc[eé]s|italian/i.test(originalText)
        const hasDigits = /\d/.test(originalText)
        const hasQuestion = /\?/.test(originalText) || /^\s*(qu[eé]|c[oó]mo|cu[aá]ndo|cu[aá]nto|d[oó]nde|cu[aá]l|qui[eé]n|tienen?|hay|info|informaci[oó]n|cuanto|cuando|cual|quien|como|que)\b/i.test(originalText.trim())
        const looksLikeName = !isGreeting && !hasProgramKeyword && !hasDigits && !hasQuestion && !/@/.test(originalText) && words.length >= 1 && words.length <= 3

        if (looksLikeName) {
          const nombreCapturado = originalText.trim()
          if (leadId) {
            await supabase.from('leads').update({ nombre: nombreCapturado }).eq('id', leadId)
            leadSnapshot = { ...leadSnapshot, nombre: nombreCapturado } as LeadSnapshot
          }
          const greeting = `¡Hola ${nombreCapturado}! 😊 ¿Qué programa de Instituto Windsor te interesa?\n\n${CATALOGO_OFERTA}`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, greeting, 'programa')
          return buildProviderResponse(provider, greeting, waNumber)
        }
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

      // En cualquier fase: si pregunta por convenios → mostrar lista
      if (detectarPreguntaConvenio(originalText)) {
        await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, CONVENIOS_LISTA_MSG, 'convenios')
        return buildProviderResponse(provider, CONVENIOS_LISTA_MSG, waNumber)
      }

      // Detección global de "inglés" ambiguo — sin importar la fase, si no hay programa capturado aún
      if (!hasLeadProgram(leadSnapshot?.curso)) {
        const msgLower0 = originalText.toLowerCase()
        if (/ingl[eé]s/i.test(msgLower0) && !/ni[ñn]o|adulto|licenciatura|lic\b/i.test(msgLower0)) {
          const disambig = `Tenemos tres opciones de inglés, ¿cuál te interesa?\n\nA) Inglés para adultos\nB) Inglés para niños\nC) Licenciatura en Inglés`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, disambig, 'programa')
          return buildProviderResponse(provider, disambig, waNumber)
        }
      }

      // Fase programa: si el usuario ya nombró un programa, saltar catálogo; si no, catálogo hardcodeado
      if (phase === 'programa') {
        // A/B/C interceptor: respuestas a la disambiguación de inglés (respuesta de una letra)
        const msgTrimProg = originalText.trim()
        const msgLProg = msgTrimProg.toLowerCase()
        let programaIngles: string | null = null
        if (/^\s*a\s*$/.test(msgLProg) || /\badultos?\b/i.test(msgTrimProg)) programaIngles = 'Inglés para adultos'
        else if (/^\s*b\s*$/.test(msgLProg) || /\bni[ñn]os?\b/i.test(msgTrimProg)) programaIngles = 'Inglés para niños'
        else if (/^\s*c\s*$/.test(msgLProg)) programaIngles = 'Licenciatura en Inglés'

        if (programaIngles) {
          if (leadId) {
            await supabase.from('leads').update({ curso: programaIngles, ...(getValorPrograma(programaIngles) ? { valor: getValorPrograma(programaIngles) } : {}) }).eq('id', leadId)
            leadSnapshot = { ...leadSnapshot, curso: programaIngles } as LeadSnapshot
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

        // Detección de programa en código (sin GPT) — igual que lab
        const programaDetectado = detectarPrograma(originalText)
        if (programaDetectado) {
          if (leadId) {
            await supabase.from('leads').update({ curso: programaDetectado, ...(getValorPrograma(programaDetectado) ? { valor: getValorPrograma(programaDetectado) } : {}) }).eq('id', leadId)
            leadSnapshot = { ...leadSnapshot, curso: programaDetectado } as LeadSnapshot
          }
          const correoMsg = `¡Excelente elección! 😊 Para contarte todo sobre *${programaDetectado}*, ¿me compartes tu correo electrónico para darte seguimiento personalizado? 📧`
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, correoMsg, 'correo')
          return buildProviderResponse(provider, correoMsg, waNumber)
        }

        // Sin programa identificado — diferenciar entre categoría genérica, carrera no ofrecida, o mensaje ambiguo
        const nombreP = leadSnapshot?.nombre
        const msgTrimP = originalText.trim()

        // Caso 1: el usuario pidió una categoría genérica (ej: "licenciaturas", "maestrías")
        const categoriaGenerica = msgTrimP.match(/^licenciaturas?$/i)
          ? `Tenemos las siguientes licenciaturas:\n\n• Licenciatura en Inglés\n• Relaciones públicas y mercadotecnia\n• Administración turística\n• Psicología\n\n¿Cuál te interesa? 😊`
          : msgTrimP.match(/^maestr[ií]as?$/i)
          ? `Tenemos dos maestrías:\n\n• Maestría en Innovación empresarial\n• Maestría en Multiculturalidad y Plurilingüismo\n\n¿Cuál te interesa? 😊`
          : msgTrimP.match(/^diplomados?$/i)
          ? `Contamos con más de 30 diplomados en distintas áreas. ¿Me puedes decir cuál tema te interesa? Por ejemplo: salud, educación, negocios, tecnología... 😊`
          : msgTrimP.match(/^(cursos?|idiomas?)$/i)
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

      // ── Fase accion: elegir A (dudas) o B (inscripción/examen) ───────────────
      if (phase === 'accion') {
        if (eligeB(originalText)) {
          if (esInglesIdioma(leadSnapshot?.curso)) {
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, EXAMEN_UBICACION_MSG, 'examen', leadId)
            return buildProviderResponse(provider, EXAMEN_UBICACION_MSG, waNumber)
          } else {
            await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, INSCRIPCION_LICS_MSG, 'inscripcion', leadId)
            return buildProviderResponse(provider, INSCRIPCION_LICS_MSG, waNumber)
          }
        }
        if (eligeA(originalText)) {
          // Deja que GPT maneje la duda con RAG — sigue al bloque principal
        } else {
          // Si parece pregunta o mensaje largo → GPT con RAG (no repetir CTA ciegamente)
          const esRespuestaCorta = /^\s*[aAbBsSnNyY][iIoO]?\s*$/.test(originalText.trim())
          const parecePregunta = originalText.trim().endsWith('?') || originalText.trim().length > 12
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

      // Elección A/B de inscripción — interceptar antes de GPT cuando fase es inscripcion
      if (phase === 'inscripcion') {
        const msgI = originalText.toLowerCase()
        if (/\ba\b|en l[ií]nea|online|desde aqu[ií]|digital|virtual/i.test(msgI)) {
          await logBotMessageAndUpdateFase(supabase, conversacionIdOuter, INSCRIPCION_ONLINE_MSG, 'inscripcion')
          return buildProviderResponse(provider, INSCRIPCION_ONLINE_MSG, waNumber)
        }
        if (/\bb\b|mejor b|presencial|instalaci[oó]n|ir a|plantel|visitar/i.test(msgI)) {
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
        if (!esRespuestaCTA) {
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

      // Contexto RAG para otras fases
      let ragContext = ''
      try {
        const ragUrl = new URL('/api/rag/query', new URL(request.url).origin)
        const isInfoPhase = ['info_enviada', 'dudas', 'correo', 'seguimiento'].includes(phase)
        const matchCount = isInfoPhase ? 15 : 5
        const detectPrograma = (msg: string, fallback: string | null | undefined): string => {
          const m = msg.toLowerCase()
          if (/ni[ñn]o/i.test(m)) return 'Inglés para niños'
          if (/adulto/i.test(m)) return 'Inglés para adultos'
          if (/licenciatura.*ingl[eé]s|ingl[eé]s.*licenciatura|\blic\b.*ingl[eé]s|ingl[eé]s.*\blic\b/i.test(m)) return 'Licenciatura en Inglés'
          if (/franc[eé]s/i.test(m)) return 'Francés'
          if (/italian/i.test(m)) return 'Italiano'
          if (/psicolog/i.test(m)) return 'Psicología'
          if (/turism/i.test(m)) return 'Administración turística'
          if (/relaciones p[uú]blicas|mercadotecnia/i.test(m)) return 'Relaciones públicas y mercadotecnia'
          if (/innovaci[oó]n empresarial/i.test(m)) return 'Maestría en Innovación empresarial'
          if (/maestr[ií]a/i.test(m)) return 'maestrías'
          if (/licenciatura/i.test(m)) return 'licenciaturas'
          if (/diplomado/i.test(m)) return 'diplomados'
          return fallback || ''
        }
        const queryPrograma = (phase === 'dudas' || phase === 'seguimiento')
          ? detectPrograma(originalText, leadSnapshot?.curso)
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

      // Persistir datos capturados por GPT
      if (gpt.nombre && leadId && !hasLeadName(leadSnapshot?.nombre, waNumber)) {
        await supabase.from('leads').update({ nombre: gpt.nombre, stage: 'contactado' }).eq('id', leadId)
      }
      if (gpt.email && leadId) {
        await supabase.from('leads').update({ email: gpt.email }).eq('id', leadId)
      }
      if (gpt.programa && leadId) {
        await supabase.from('leads').update({ curso: gpt.programa, ...(getValorPrograma(gpt.programa) ? { valor: getValorPrograma(gpt.programa) } : {}) }).eq('id', leadId)
      }

      // Actualizar stage del lead según la fase destino
      const newStage = getStageForPhase(gpt.siguienteFase)
      if (newStage && leadId) {
        await supabase.from('leads').update({ stage: newStage }).eq('id', leadId)
      }

      // Si GPT avanza a programa, interceptar
      if (gpt.siguienteFase === 'programa') {
        if (gpt.nombre && leadId && !hasLeadName(leadSnapshot?.nombre, waNumber)) {
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
        // Si el usuario ya nombró un programa específico sin ambigüedad, saltar catálogo e ir a correo
        if (gpt.programa && leadId) {
          await supabase.from('leads').update({ curso: gpt.programa, ...(getValorPrograma(gpt.programa) ? { valor: getValorPrograma(gpt.programa) } : {}) }).eq('id', leadId)
          const correoMsg = gpt.respuesta || `¡Perfecto! Para contarte todo sobre ${gpt.programa}, ¿me compartes tu correo para darte seguimiento personalizado?`
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
      } else if (nextFase === 'inscripcion') {
        // Track B: proceso de inscripción con opción online o presencial
        botMessage = INSCRIPCION_LICS_MSG
      } else if (nextFase === 'inscripcion_online') {
        botMessage = INSCRIPCION_ONLINE_MSG
        nextFase = 'seguimiento'
      } else if (nextFase === 'inscripcion_presencial') {
        botMessage = buildInscripcionPresencialMsg(leadSnapshot?.nombre, leadSnapshot?.email, leadSnapshot?.curso, leadSnapshot?.whatsapp)
        nextFase = 'seguimiento'
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
    return buildProviderResponse(getWhatsAppProvider(), fallback, '')
  }
}
