import { intentarAvanzarEtapaBot } from '@/lib/crm/etapas-bot'
import { avisarAdmin } from '@/lib/whatsapp/avisos-admin'
import { templateBloqueado } from '@/lib/whatsapp/entregas'
import { ADMIN_WA_ALERTA } from '@/lib/whatsapp/atencion'
import { textoTemplateEnviado } from '@/lib/whatsapp/template-registro'
import { ejecutarRevisionesPendientes } from '@/lib/whatsapp/revision-timeout'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { normalizePhoneNumber, sendMetaWhatsAppMessage, sendMetaWhatsAppTemplate } from '@/lib/whatsapp/provider'
import { hasLeadName } from '@/lib/whatsapp/nombres'
import {
  decidirSeguimientoAutomatico,
  esCanalInternoSeguimiento,
  datoPendienteSeguimiento,
  recordatorioDatoReciente,
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
  const msg = [
    '🆕 PROSPECTO · 📌 Seguimiento automático Windsor',
    `Regla: ${decision.reglaId}`,
    lead.nombre ? `Lead: ${lead.nombre}` : null,
    lead.curso ? `Programa: ${lead.curso}` : null,
    lead.whatsapp ? `WhatsApp: ${lead.whatsapp}` : null,
    decision.detalle,
  ].filter(Boolean).join('\n')
  if (dryRun) return `dry aviso a ${maskPhone(ADMIN_WA_ALERTA)}`
  await avisarAdmin(supabase, msg)
  await supabase.from('lead_activities').insert([{
    lead_id: lead.id,
    actor_id: null,
    event_type: 'seguimiento_motor_aviso_asesor',
    title: 'Aviso a Harold',
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
  if (esCanalInternoSeguimiento(conv.whatsapp) || esCanalInternoSeguimiento(lead.whatsapp)) {
    return { accion: 'omitido', detalle: 'canal interno de asesores' }
  }
  const raw = {
    seguimiento_motor: {
      datoPendiente: decision.reglaId === 'nuevo_3h_dato' ? datoPendienteSeguimiento(conv.fase) : null,
      reglaId: decision.reglaId,
      etapa: decision.etapa,
      carril: decision.carril,
      accion: decision.accion,
      templateName: decision.templateName || null,
      templateParams: decision.templateParams || [],
    },
  }

  if (decision.accion === 'aviso_asesor') {
    const aviso = await avisarAsesor(supabase, lead, decision, dryRun)
    return { accion: dryRun ? 'dry_aviso_asesor' : 'aviso_asesor', detalle: aviso }
  }

  if (decision.accion === 'perder') return { accion: 'omitido', detalle: 'Perdido lo marca un asesor; no se cierra automáticamente.' }

  if ((decision.accion === 'archivar') && !cierresAutomaticosActivos()) {
    return { accion: `cierre_apagado_${decision.accion}`, detalle: `${decision.detalle} (cierres automaticos apagados)` }
  }

  if (decision.accion === 'archivar') {
    if (!dryRun) {
      const etapa = await intentarAvanzarEtapaBot(supabase, lead.id, decision.nuevoStage || 'archivado')
      if (etapa !== null && etapa !== 'archivado') return { accion: 'omitido', detalle: 'Etapa protegida: requiere decisión humana.' }
      await supabase.from('whatsapp_conversaciones').update({
        fase: decision.nuevaFase,
        estado: 'abierta',
      }).eq('id', conv.id)
      await supabase.from('lead_activities').insert([{
        lead_id: lead.id,
        actor_id: null,
        event_type: 'seguimiento_motor_archivado',
        title: 'Lead archivado',
        detail: decision.detalle,
        meta: raw.seguimiento_motor,
      }])
    }
    return { accion: dryRun ? `dry_${decision.accion}` : decision.accion, detalle: decision.detalle }
  }

  if (decision.accion === 'texto') {
    if (!decision.mensaje) throw new Error('Decision texto sin mensaje')
    if (!dryRun) {
      const { data: actual, error: tipoError } = await supabase.from('whatsapp_conversaciones').select('tipo_contacto').eq('id', conv.id).maybeSingle()
      if (tipoError) throw tipoError
      if (actual?.tipo_contacto === 'alumno') return { accion: 'omitido', detalle: 'alumno: sin venta automática' }
      const sent = await sendMetaWhatsAppMessage({ to: conv.whatsapp, body: decision.mensaje })
      await supabase.from('whatsapp_mensajes').insert([{
        conversacion_id: conv.id,
        rol: 'bot',
        contenido: decision.mensaje,
        raw_payload: { ...raw, wamid: sent.id },
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
      if (await templateBloqueado(supabase, conv.whatsapp, decision.templateName)) return { accion: 'omitido', detalle: 'template bloqueado por entrega fallida' }
      const { data: actual, error: tipoError } = await supabase.from('whatsapp_conversaciones').select('tipo_contacto').eq('id', conv.id).maybeSingle()
      if (tipoError) throw tipoError
      if (actual?.tipo_contacto === 'alumno') return { accion: 'omitido', detalle: 'alumno: sin venta automática' }
      const textoReal = await textoTemplateEnviado(decision.templateName, decision.templateParams || [])
      const enviado = await sendMetaWhatsAppTemplate({
        to: conv.whatsapp,
        templateName: decision.templateName,
        parameters: decision.templateParams || [],
      })
      await supabase.from('whatsapp_mensajes').insert([{
        conversacion_id: conv.id,
        rol: 'bot',
        contenido: textoReal || `[Template: ${decision.templateName}]`,
        raw_payload: { ...raw, wamid: enviado.id, template_body_resolved: Boolean(textoReal) },
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
    return Response.json({ ok: true, dryRun, revisiones: [], omitido: `fuera de horario (${hora}h Mexico)` })
  }
  const supabase = createServiceRoleClient()
  let revisiones
  try { revisiones = await ejecutarRevisionesPendientes(supabase, dryRun, ahora, sendMetaWhatsAppMessage, body => avisarAdmin(supabase, body)) }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Error revisiones' }, { status: 500 }) }

  // Cargar todas las páginas ANTES de enviar: los envíos cambian ultimo_mensaje_at.
  // El id desempata fechas iguales/nulas y evita páginas con orden indeterminado.
  const convs = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('whatsapp_conversaciones')
      .select('id, whatsapp, lead_id, fase, provider, estado, modo_humano, revision_codigo, ultimo_mensaje_at, tipo_contacto')
      .in('estado', ['abierta', 'cerrada'])
      .in('fase', FASES_QUERY)
      .order('ultimo_mensaje_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    convs.push(...(data || []))
    if (!data || data.length < pageSize) break
  }

  const inicioDiaMx = inicioDiaMexicoIso(ahora)
  const resultados: Array<Record<string, unknown>> = []
  const decisiones: Array<{
    conv: (typeof convs)[number]
    lead: LeadRow
    decision: DecisionSeguimiento
    orden: number
  }> = []

  // Concurrencia acotada para que quitar el límite no multiplique la duración serial.
  for (let offset = 0; offset < convs.length; offset += 10) {
    await Promise.all(convs.slice(offset, offset + 10).map(async (conv, index) => {
      const base = { conversacion_id: conv.id, whatsapp: maskPhone(conv.whatsapp), fase: conv.fase }
      const omit = (detalle: string) => resultados.push({ ...base, accion: 'omitido', detalle })

      if (esCanalInternoSeguimiento(conv.whatsapp)) { omit('canal interno de asesores'); return }
      if (conv.tipo_contacto === 'alumno') { omit('alumno: sin venta automática'); return }
      if (!faseEsDeMotor(conv.fase)) { omit('fase fuera del motor'); return }
      if (conv.provider === 'messenger') { omit('messenger sin templates WhatsApp'); return }
      if (conv.modo_humano) { omit('modo humano'); return }
      if (conv.revision_codigo) { omit('esperando revision de asesor'); return }

      const { data: msgs, error: mensajesError } = await supabase
        .from('whatsapp_mensajes')
        .select('rol, contenido, created_at, raw_payload')
        .eq('conversacion_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(60)
      if (mensajesError) { omit('error consultando mensajes'); return }
      const mensajes = (msgs || []) as MensajeRow[]
      const ultimo = mensajes[0]
      if (!ultimo) { omit('sin mensajes'); return }

      const fase = String(conv.fase || 'saludo')
      const faseAsesor = ['pendiente', 'asesor', 'con_asesor'].includes(fase)
      if (!faseAsesor && ultimo.rol !== 'bot') { omit('el lead contesto o no espera bot'); return }
      if (faseAsesor && ultimo.rol !== 'usuario') { omit('asesor/bot ya contesto'); return }
      if (yaTieneEnvioHoy(mensajes, inicioDiaMx)) { omit('ya tuvo seguimiento automatico hoy'); return }

      const ultimoUsuario = mensajes.find((m) => m.rol === 'usuario')
      if (!ultimoUsuario) { omit('sin mensaje de usuario'); return }
      const lead = await buscarLead(supabase, conv)
      if (!lead) { omit('sin lead'); return }
      if (esCanalInternoSeguimiento(lead.whatsapp)) { omit('canal interno de asesores'); return }

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
      if (!decision) { omit(`sin regla (${horasDesdeLead.toFixed(1)}h)`); return }
      if (decision.reglaId === 'nuevo_3h_dato') {
        // Consultar el intervalo completo: el lead puede haber respondido y el
        // recordatorio anterior puede quedar fuera de los últimos 60 mensajes.
        const desde = new Date(ahora.getTime() - 24 * 3600_000).toISOString()
        let bloquear = false
        for (let inicio = 0; ; inicio += 500) {
          const { data: recordatorios, error: recordatoriosError } = await supabase
            .from('whatsapp_mensajes')
            .select('rol, contenido, created_at, raw_payload')
            .eq('conversacion_id', conv.id)
            .eq('rol', 'bot')
            .eq('raw_payload->seguimiento_motor->>reglaId', 'nuevo_3h_dato')
            .gte('created_at', desde)
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(inicio, inicio + 499)
          if (recordatoriosError) { omit('error consultando recordatorios'); return }
          if (recordatorioDatoReciente(recordatorios || [], fase, ahora)) { bloquear = true; break }
          if (!recordatorios || recordatorios.length < 500) break
        }
        if (bloquear) { omit('recordatorio del mismo dato hace menos de 24h'); return }
      }
      if (yaDisparoRegla(mensajes, decision.reglaId, ultimoUsuario.created_at)) { omit(`regla ya disparada: ${decision.reglaId}`); return }
      if (diasDesdeLead > 30 && tieneCualquierSeguimientoTrasLead(mensajes, ultimoUsuario.created_at)) {
        omit('backlog >30 dias ya recibio un seguimiento')
        return
      }

      if (decision.accion === 'template' && decision.templateName && await templateBloqueado(supabase, conv.whatsapp, decision.templateName)) { omit('template bloqueado por entrega fallida'); return }
      decisiones.push({ conv, lead, decision, orden: offset + index })
    }))
  }

  // Contar en BD, no en memoria: el cupo se comparte entre las corridas del día.
  const finDiaMx = new Date(new Date(inicioDiaMx).getTime() + 24 * 3600_000).toISOString()
  const { count: enviadosHoy, error: conteoError } = await supabase
    .from('whatsapp_mensajes')
    .select('id', { count: 'exact', head: true })
    .eq('rol', 'bot')
    .eq('raw_payload->seguimiento_motor->>accion', 'template')
    .gte('created_at', inicioDiaMx)
    .lt('created_at', finDiaMx)
  if (conteoError || enviadosHoy === null) {
    return Response.json({ error: conteoError?.message || 'No se pudo contar templates de hoy' }, { status: 500 })
  }
  const configurado = process.env.SEGUIMIENTO_MOTOR_MAX_TEMPLATES_DIA?.trim()
  const limiteDia = configurado && /^\d+$/.test(configurado) && Number.isSafeInteger(Number(configurado))
    ? Number(configurado) : 40
  const cupoDisponible = Math.max(0, limiteDia - enviadosHoy)
  // Restaurar el orden de la consulta: la latencia de evaluación no da prioridad.
  decisiones.sort((a, b) => a.orden - b.orden)
  const templates = decisiones.filter(({ decision }) => decision.accion === 'template')
  const seleccionados = templates.slice(0, cupoDisponible)
  for (const { conv, lead, decision } of templates.slice(cupoDisponible)) {
    resultados.push({
      conversacion_id: conv.id, whatsapp: maskPhone(conv.whatsapp), fase: conv.fase,
      lead_id: lead.id, accion: 'omitido', regla: decision.reglaId,
      detalle: 'tope diario de templates',
    })
  }
  const ejecutar = async ({ conv, lead, decision }: (typeof decisiones)[number]) => {
    const base = { conversacion_id: conv.id, whatsapp: maskPhone(conv.whatsapp), fase: conv.fase }
    try {
      const ejec = await ejecutarDecision({ supabase, conv, lead, decision, dryRun })
      resultados.push({
        ...base, lead_id: lead.id, accion: ejec.accion, regla: decision.reglaId,
        etapa: decision.etapa, carril: decision.carril, detalle: ejec.detalle,
      })
    } catch (e) {
      resultados.push({ ...base, accion: 'error', regla: decision.reglaId, detalle: e instanceof Error ? e.message : String(e) })
    }
  }
  const otras = decisiones.filter(({ decision }) => decision.accion !== 'template')
  for (let offset = 0; offset < otras.length; offset += 10) {
    await Promise.all(otras.slice(offset, offset + 10).map(ejecutar))
  }
  // Templates en serie: ningún grupo paralelo puede gastar el mismo cupo.
  // Un intento fallido no se reemplaza en esta corrida para no sobreenviar.
  for (const preparada of seleccionados) await ejecutar(preparada)

  const activos = resultados.filter((r) => !['omitido'].includes(String(r.accion)))
  return Response.json({
    ok: true,
    dryRun,
    horaMexico: hora,
    revisiones,
    templates: { limiteDia, enviadosHoy, cupoDisponible, propuestos: templates.length,
      seleccionados: seleccionados.length, diferidos: templates.length - seleccionados.length },
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
