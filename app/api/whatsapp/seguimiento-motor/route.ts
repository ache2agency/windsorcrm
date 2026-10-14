import { createServiceRoleClient } from '@/utils/supabase/server'
import { normalizePhoneNumber, sendMetaWhatsAppMessage, sendMetaWhatsAppTemplate } from '@/lib/whatsapp/provider'
import { hasLeadName } from '@/lib/whatsapp/nombres'
import {
  decidirSeguimientoAutomatico,
  dentroHorarioMexico,
  faseEsDeMotor,
  horaMexico,
  inicioDiaMexicoIso,
  type ContextoSeguimiento,
  type DecisionSeguimiento,
} from '@/lib/whatsapp/seguimiento-motor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type MensajeRow = {
  rol: 'usuario' | 'bot' | 'agente'
  contenido: string | null
  created_at: string
  raw_payload?: Record<string, unknown> | null
}

type LeadRow = {
  id: string
  nombre: string | null
  whatsapp: string | null
  curso: string | null
  stage: string | null
  asignado_a: string | null
}

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.replace(/\\n$/, '').trim()
  if (!secret) return false
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() === secret
  return request.headers.get('x-cron-secret') === secret
}

function msHoras(desde: string, ahora: Date): number {
  return (ahora.getTime() - new Date(desde).getTime()) / 3600_000
}

function maskPhone(value: string | null | undefined): string {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length <= 4) return '****'
  return `${digits.slice(0, 4)}***${digits.slice(-2)}`
}

function rawSeguimiento(raw: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const payload = raw?.seguimiento_motor
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
}

function yaTieneEnvioHoy(mensajes: MensajeRow[], inicioDiaMxIso: string): boolean {
  return mensajes.some((m) => m.rol === 'bot' && m.created_at >= inicioDiaMxIso && Boolean(rawSeguimiento(m.raw_payload)))
}

function yaDisparoRegla(mensajes: MensajeRow[], reglaId: string, afterIso: string): boolean {
  return mensajes.some((m) => {
    const raw = rawSeguimiento(m.raw_payload)
    return m.rol === 'bot' && m.created_at > afterIso && raw?.reglaId === reglaId
  })
}

function tieneCualquierSeguimientoTrasLead(mensajes: MensajeRow[], afterIso: string): boolean {
  return mensajes.some((m) => m.rol === 'bot' && m.created_at > afterIso && Boolean(rawSeguimiento(m.raw_payload)))
}

const PREGUNTA_PENDIENTE: Record<string, RegExp> = {
  saludo: /c[oó]mo te llamas|tu nombre|con qui[eé]n tengo el gusto/i,
  correo: /correo/i,
  programa: /qu[eé] programa|cu[aá]l.{0,40}te interesa/i,
}

function quedoEsperandoDato(fase: string, contenidoBot: string): boolean {
  const re = PREGUNTA_PENDIENTE[fase]
  if (!re) return false
  const parrafos = contenidoBot.trim().split(/\n\s*\n/)
  const cierre = parrafos[parrafos.length - 1] || ''
  return re.test(cierre)
}

function yaRecibioInfoONoOfrecemos(mensajesBot: string[]): boolean {
  return mensajesBot.some((c) =>
    /\$\s?\d/.test(c) || (/inscripci[oó]n|mensualidad|colegiatura/i.test(c) && c.length > 300) ||
    /no (ofrecemos|contamos con|tenemos|manejamos)/i.test(c)
  )
}

function tieneProgramaReal(curso: string | null | undefined): boolean {
  const c = (curso || '').trim().toLowerCase()
  return !!c && c !== 'whatsapp - instituto windsor' && c !== 'messenger - instituto windsor'
}

async function buscarLead(
  supabase: ReturnType<typeof createServiceRoleClient>,
  conv: { lead_id?: string | null; whatsapp: string }
): Promise<LeadRow | null> {
  if (conv.lead_id) {
    const { data } = await supabase
      .from('leads')
      .select('id, nombre, whatsapp, curso, stage, asignado_a')
      .eq('id', conv.lead_id)
      .maybeSingle()
    if (data) return data as LeadRow
  }
  const whatsapp = normalizePhoneNumber(conv.whatsapp)
  const { data } = await supabase
    .from('leads')
    .select('id, nombre, whatsapp, curso, stage, asignado_a')
    .eq('whatsapp', whatsapp)
    .maybeSingle()
  return (data as LeadRow | null) || null
}

async function avisarAsesor(
  supabase: ReturnType<typeof createServiceRoleClient>,
  lead: LeadRow,
  decision: DecisionSeguimiento,
  dryRun: boolean
): Promise<string> {
  if (!lead.asignado_a) return 'sin asesor asignado'
  const { data: perfil } = await supabase
    .from('profiles')
    .select('whatsapp, nombre')
    .eq('id', lead.asignado_a)
    .maybeSingle()
  const asesorWhatsapp = perfil?.whatsapp as string | null | undefined
  if (!asesorWhatsapp) return 'asesor sin whatsapp'
  const msg = [
    '📌 Seguimiento automático Windsor',
    `Regla: ${decision.reglaId}`,
    lead.nombre ? `Lead: ${lead.nombre}` : null,
    lead.curso ? `Programa: ${lead.curso}` : null,
    lead.whatsapp ? `WhatsApp: ${lead.whatsapp}` : null,
    decision.detalle,
  ].filter(Boolean).join('\n')
  if (dryRun) return `dry aviso a ${maskPhone(asesorWhatsapp)}`
  await sendMetaWhatsAppMessage({ to: asesorWhatsapp, body: msg })
  await supabase.from('lead_activities').insert([{
    lead_id: lead.id,
    actor_id: null,
    event_type: 'seguimiento_motor_aviso_asesor',
    title: 'Aviso al asesor',
    detail: decision.detalle,
    meta: { reglaId: decision.reglaId, source: 'seguimiento_motor' },
  }])
  return 'aviso enviado'
}

// Archivar/perder solo se ejecutan con SEGUIMIENTO_MOTOR_CIERRES=1 en Vercel (apagado por default).
function cierresAutomaticosActivos() {
  return process.env.SEGUIMIENTO_MOTOR_CIERRES?.trim() === '1'
}

async function ejecutarDecision(params: {
  supabase: ReturnType<typeof createServiceRoleClient>
  conv: { id: string; whatsapp: string; fase: string | null }
  lead: LeadRow
  decision: DecisionSeguimiento
  dryRun: boolean
}) {
  const { supabase, conv, lead, decision, dryRun } = params
  const raw = {
    seguimiento_motor: {
      reglaId: decision.reglaId,
      etapa: decision.etapa,
      carril: decision.carril,
      accion: decision.accion,
      templateName: decision.templateName || null,
    },
  }

  if (decision.accion === 'aviso_asesor') {
    const aviso = await avisarAsesor(supabase, lead, decision, dryRun)
    return { accion: dryRun ? 'dry_aviso_asesor' : 'aviso_asesor', detalle: aviso }
  }

  if ((decision.accion === 'archivar' || decision.accion === 'perder') && !cierresAutomaticosActivos()) {
    return { accion: `cierre_apagado_${decision.accion}`, detalle: `${decision.detalle} (cierres automaticos apagados)` }
  }

  if (decision.accion === 'archivar' || decision.accion === 'perder') {
    if (!dryRun) {
      await supabase.from('whatsapp_conversaciones').update({
        fase: decision.nuevaFase,
        estado: decision.accion === 'perder' ? 'cerrada' : 'abierta',
      }).eq('id', conv.id)
      await supabase.from('leads').update({ stage: decision.nuevoStage }).eq('id', lead.id)
      await supabase.from('lead_activities').insert([{
        lead_id: lead.id,
        actor_id: null,
        event_type: decision.accion === 'perder' ? 'seguimiento_motor_perdido' : 'seguimiento_motor_archivado',
        title: decision.accion === 'perder' ? 'Lead marcado como perdido' : 'Lead archivado',
        detail: decision.detalle,
        meta: raw.seguimiento_motor,
      }])
    }
    return { accion: dryRun ? `dry_${decision.accion}` : decision.accion, detalle: decision.detalle }
  }

  if (decision.accion === 'texto') {
    if (!decision.mensaje) throw new Error('Decision texto sin mensaje')
    if (!dryRun) {
      await sendMetaWhatsAppMessage({ to: conv.whatsapp, body: decision.mensaje })
      await supabase.from('whatsapp_mensajes').insert([{
        conversacion_id: conv.id,
        rol: 'bot',
        contenido: decision.mensaje,
        raw_payload: raw,
      }])
      await supabase.from('whatsapp_conversaciones').update({
        ultimo_mensaje_at: new Date().toISOString(),
        ...(decision.nuevaFase ? { fase: decision.nuevaFase } : {}),
      }).eq('id', conv.id)
    }
    return { accion: dryRun ? 'dry_texto' : 'texto_enviado', detalle: decision.mensaje.slice(0, 180) }
  }

  if (decision.accion === 'template') {
    if (!decision.templateName) throw new Error('Decision template sin templateName')
    if (!dryRun) {
      await sendMetaWhatsAppTemplate({
        to: conv.whatsapp,
        templateName: decision.templateName,
        parameters: decision.templateParams || [],
      })
      await supabase.from('whatsapp_mensajes').insert([{
        conversacion_id: conv.id,
        rol: 'bot',
        contenido: `[Template: ${decision.templateName}]`,
        raw_payload: raw,
      }])
      await supabase.from('whatsapp_conversaciones').update({ ultimo_mensaje_at: new Date().toISOString() }).eq('id', conv.id)
      if (decision.avisoAsesor) await avisarAsesor(supabase, lead, decision, false)
    }
    return { accion: dryRun ? 'dry_template' : 'template_enviado', detalle: decision.templateName }
  }

  return { accion: 'omitido', detalle: 'accion no implementada' }
}

async function run(request: Request) {
  if (!verifyCronSecret(request)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dry') === '1' || url.searchParams.get('dryRun') === '1'
  const ahora = new Date()
  const hora = horaMexico(ahora)
  if (!dryRun && !dentroHorarioMexico(ahora)) {
    return Response.json({ ok: true, dryRun, omitido: `fuera de horario (${hora}h Mexico)` })
  }

  const supabase = createServiceRoleClient()
  const { data: convs, error } = await supabase
    .from('whatsapp_conversaciones')
    .select('id, whatsapp, lead_id, fase, provider, estado, modo_humano, revision_codigo')
    .in('estado', ['abierta', 'cerrada'])
    .in('fase', FASES_QUERY)
    .limit(700)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const inicioDiaMx = inicioDiaMexicoIso(ahora)
  const resultados: Array<Record<string, unknown>> = []

  for (const conv of convs || []) {
    const base = { conversacion_id: conv.id, whatsapp: maskPhone(conv.whatsapp), fase: conv.fase }
    const omit = (detalle: string) => resultados.push({ ...base, accion: 'omitido', detalle })

    if (!faseEsDeMotor(conv.fase)) { omit('fase fuera del motor'); continue }
    if (conv.provider === 'messenger') { omit('messenger sin templates WhatsApp'); continue }
    if (conv.modo_humano) { omit('modo humano'); continue }
    if (conv.revision_codigo) { omit('esperando revision de asesor'); continue }

    const { data: msgs } = await supabase
      .from('whatsapp_mensajes')
      .select('rol, contenido, created_at, raw_payload')
      .eq('conversacion_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(60)
    const mensajes = (msgs || []) as MensajeRow[]
    const ultimo = mensajes[0]
    if (!ultimo) { omit('sin mensajes'); continue }

    const fase = String(conv.fase || 'saludo')
    const faseAsesor = ['pendiente', 'asesor', 'con_asesor'].includes(fase)
    if (!faseAsesor && ultimo.rol !== 'bot') { omit('el lead contesto o no espera bot'); continue }
    if (faseAsesor && ultimo.rol !== 'usuario') { omit('asesor/bot ya contesto'); continue }
    if (yaTieneEnvioHoy(mensajes, inicioDiaMx)) { omit('ya tuvo seguimiento automatico hoy'); continue }

    const ultimoUsuario = mensajes.find((m) => m.rol === 'usuario')
    if (!ultimoUsuario) { omit('sin mensaje de usuario'); continue }
    const lead = await buscarLead(supabase, conv)
    if (!lead) { omit('sin lead'); continue }

    const horasDesdeLead = msHoras(ultimoUsuario.created_at, ahora)
    const horasDesdeBot = ultimo.rol === 'bot' ? msHoras(ultimo.created_at, ahora) : horasDesdeLead
    const diasDesdeLead = horasDesdeLead / 24
    const mensajesBotAntes = mensajes.filter((m) => m.rol === 'bot').map((m) => m.contenido || '')
    const ctx: ContextoSeguimiento = {
      fase,
      lead: {
        nombre: hasLeadName(lead.nombre, lead.whatsapp || conv.whatsapp) ? lead.nombre : null,
        whatsapp: lead.whatsapp || conv.whatsapp,
        curso: lead.curso,
        stage: lead.stage,
      },
      horasDesdeLead,
      horasDesdeBot,
      diasDesdeLead,
      dentroVentana24h: horasDesdeLead < 23.5,
      ultimoBotFuePreguntaDato: ultimo.rol === 'bot' ? quedoEsperandoDato(fase, ultimo.contenido || '') : false,
      yaRecibioInfo: yaRecibioInfoONoOfrecemos(mensajesBotAntes),
      yaTienePrograma: tieneProgramaReal(lead.curso),
      yaTieneNombre: hasLeadName(lead.nombre, lead.whatsapp || conv.whatsapp),
      ultimoTextoUsuario: ultimoUsuario.contenido || null,
      ahora,
    }
    const decision = decidirSeguimientoAutomatico(ctx)
    if (!decision) { omit(`sin regla (${horasDesdeLead.toFixed(1)}h)`); continue }
    if (yaDisparoRegla(mensajes, decision.reglaId, ultimoUsuario.created_at)) { omit(`regla ya disparada: ${decision.reglaId}`); continue }
    if (diasDesdeLead > 30 && tieneCualquierSeguimientoTrasLead(mensajes, ultimoUsuario.created_at)) {
      omit('backlog >30 dias ya recibio un seguimiento')
      continue
    }

    try {
      const ejec = await ejecutarDecision({ supabase, conv, lead, decision, dryRun })
      resultados.push({
        ...base,
        lead_id: lead.id,
        accion: ejec.accion,
        regla: decision.reglaId,
        etapa: decision.etapa,
        carril: decision.carril,
        detalle: ejec.detalle,
      })
    } catch (e) {
      resultados.push({
        ...base,
        accion: 'error',
        regla: decision.reglaId,
        detalle: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const activos = resultados.filter((r) => !['omitido'].includes(String(r.accion)))
  return Response.json({
    ok: true,
    dryRun,
    horaMexico: hora,
    revisadas: resultados.length,
    acciones: activos.length,
    resultados: dryRun ? resultados : activos,
  })
}

const FASES_QUERY = [
  'saludo',
  'programa',
  'correo',
  'info_enviada',
  'dudas',
  'accion',
  'seguimiento',
  'examen',
  'clase_prueba',
  'inscripcion',
  'inscripcion_pendiente',
  'inscribiendo',
  'pendiente',
  'asesor',
  'con_asesor',
  'archivado',
  'cerrado',
]

export async function GET(request: Request) {
  return run(request)
}

export async function POST(request: Request) {
  return run(request)
}
