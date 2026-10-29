import type { SupabaseClient } from '@supabase/supabase-js'
import { ADMIN_WA_ALERTA } from './atencion'
import { DATOS_DIPLOMADOS } from './reglasNegocio'
import { esDiplomado } from './programas'
import { sendMetaWhatsAppMessage } from './provider'
import { dentroHorarioMexico } from './seguimiento-motor'

export function plazosRevision(env: Record<string, string | undefined> = process.env) {
  const recordatorio = Number(env.REVISION_RECORDATORIO_HORAS || 4)
  const reactivar = Number(env.REVISION_REACTIVAR_HORAS || 20)
  return Number.isFinite(recordatorio) && Number.isFinite(reactivar) && recordatorio > 0 && reactivar > recordatorio && reactivar < 23
    ? { recordatorio, reactivar } : { recordatorio: 4, reactivar: 20 }
}

export type RevisionPendiente = {
  id: string; whatsapp: string; lead_id: string | null; provider: string | null
  revision_codigo: string | null; revision_timeout_desde_at: string | null
  revision_recordatorio_at: string | null; revision_timeout_claim_at: string | null
  revision_draft: string | null; modo_humano: boolean; tomado_por: string | null
}

// La siguiente corrida es una hora después; si cae de noche, buscar la primera
// corrida en horario conservando los minutos del cron (p. ej. :35).
export function siguienteCorridaRevision(ahora: Date) {
  const siguiente = new Date(ahora.getTime() + 3600_000)
  while (!dentroHorarioMexico(siguiente)) siguiente.setTime(siguiente.getTime() + 3600_000)
  return siguiente
}

export function accionRevision(c: RevisionPendiente, ahora: Date, plazos = plazosRevision(), ultimoUsuarioAt?: string | null) {
  if (!dentroHorarioMexico(ahora)) return null
  if (!c.revision_timeout_desde_at || !c.revision_codigo || !c.modo_humano || c.tomado_por || c.revision_draft) return null
  const horas = (ahora.getTime() - Date.parse(c.revision_timeout_desde_at)) / 3600_000
  if (horas >= plazos.reactivar) return 'reactivar'
  // Última oportunidad del cron antes del cierre de la ventana del USUARIO.
  // Se conserva el margen de seguridad de 30 min del motor ordinario.
  const cierre = Date.parse(ultimoUsuarioAt || '') + 23.5 * 3600_000
  if (Number.isFinite(cierre) && siguienteCorridaRevision(ahora).getTime() >= cierre) return 'reactivar'
  if (horas >= plazos.recordatorio && !c.revision_recordatorio_at) return 'recordatorio'
  return null
}

// Solo hechos ya presentes en el sistema. No intenta contestar la duda pendiente
// con un borrador del LLM ni afirma que Harold la haya confirmado.
export function respuestaRevisionVencida(curso?: string | null) {
  const programa = curso && !/instituto windsor|desconocido/i.test(curso) ? ` sobre *${curso}*` : ''
  const conocido = esDiplomado(curso)
    ? `El diplomado es en línea con clases en vivo. Su duración es de ${DATOS_DIPLOMADOS.duracion}`
    : 'El formulario de inscripción está en https://www.windsor.edu.mx/solicitud-de-inscripcion'
  return `Seguimos por aquí para ayudarte${programa}. 😊\n\n${conocido}\n\n¿Te puedo ayudar con algo más?`
}

export async function ejecutarRevisionesPendientes(
  db: SupabaseClient, dryRun: boolean, ahora = new Date(),
  enviar = sendMetaWhatsAppMessage,
) {
  // Defensa adicional para invocaciones directas, incluso dry-run: cero envíos,
  // reservas o consultas de revisiones de madrugada.
  if (!dentroHorarioMexico(ahora)) return []
  const plazos = plazosRevision()
  const rows: RevisionPendiente[] = []
  // Paginación antes de mutar. No consulta ni modifica revisiones legacy sin marca.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('whatsapp_conversaciones')
      .select('id,whatsapp,lead_id,provider,revision_codigo,revision_timeout_desde_at,revision_recordatorio_at,revision_timeout_claim_at,revision_draft,modo_humano,tomado_por')
      .not('revision_timeout_desde_at', 'is', null).not('revision_codigo', 'is', null)
      .order('id').range(offset, offset + 499)
    if (error) throw new Error(`Revisiones: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < 500) break
  }
  const resultados = []
  for (const row of rows) {
    if (!row.revision_timeout_desde_at || !row.revision_codigo || !row.modo_humano || row.tomado_por || row.revision_draft) continue
    if (row.provider === 'messenger' || row.provider === 'twilio') continue
    const { data: ultimo, error: ultimoError } = await db.from('whatsapp_mensajes').select('created_at')
      .eq('conversacion_id', row.id).eq('rol', 'usuario').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (ultimoError) { resultados.push({ conversacion_id: row.id, accion: 'error_revision', detalle: ultimoError.message }); continue }
    const accion = accionRevision(row, ahora, plazos, ultimo?.created_at)
    if (!accion || row.provider === 'messenger' || row.provider === 'twilio') continue
    if (dryRun) { resultados.push({ conversacion_id: row.id, accion: `dry_revision_${accion}` }); continue }
    const { data, error } = await db.rpc('reclamar_revision_timeout', {
      p_id: row.id, p_codigo: row.revision_codigo, p_desde: row.revision_timeout_desde_at,
      p_recordatorio_horas: plazos.recordatorio, p_reactivar_horas: plazos.reactivar,
    })
    if (error) { resultados.push({ conversacion_id: row.id, accion: 'error_revision', detalle: error.message }); continue }
    const claimed = data?.[0] as RevisionPendiente | undefined
    if (!claimed) continue // Otra corrida o Harold atendieron esta revisión.
    let texto = '', raw: Record<string, unknown> = {}, finalAccion: string = accion
    try {
      // Una respuesta de Harold invalida la reserva; no enviar borradores antiguos.
      const { data: vigente, error: vigenteError } = await db.from('whatsapp_conversaciones')
        .select('revision_codigo,revision_timeout_claim_at,revision_timeout_desde_at,revision_draft,modo_humano,tomado_por')
        .eq('id', row.id).maybeSingle()
      if (vigenteError) throw vigenteError
      if (!vigente || vigente.revision_codigo !== claimed.revision_codigo || !vigente.revision_timeout_desde_at || vigente.revision_draft || !vigente.modo_humano || vigente.tomado_por) continue
      if (accion === 'recordatorio') {
        texto = `⏰ Revisión pendiente *[${claimed.revision_codigo!.toUpperCase()}]*\nLead: ${row.whatsapp}\nResponde: ${claimed.revision_codigo!.toUpperCase()}: tu explicación aquí`
        await enviar({ to: ADMIN_WA_ALERTA, body: texto })
      } else {
        // Volver a consultar antes del envío: el lead puede escribir mientras se
        // reclama la revisión y abrir una ventana nueva.
        const { data: reciente, error: recienteError } = await db.from('whatsapp_mensajes').select('created_at')
          .eq('conversacion_id', row.id).eq('rol', 'usuario').order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (recienteError) throw recienteError
        const ventana = reciente && ahora.getTime() - Date.parse(reciente.created_at) < 23.5 * 3600_000
        if (!ventana) finalAccion = 'reactivar_sin_ventana'
        else {
          const { data: lead, error: leadError } = row.lead_id
            ? await db.from('leads').select('curso').eq('id', row.lead_id).maybeSingle()
            : { data: null, error: null }
          if (leadError) throw leadError
          texto = respuestaRevisionVencida(lead?.curso)
          const sent = await enviar({ to: row.whatsapp, body: texto })
          raw = { wamid: sent.id, seguimiento_motor: { accion: 'texto', reglaId: 'revision_timeout_reactivar' }, revision_timeout: { codigo: row.revision_codigo, desde: row.revision_timeout_desde_at } }
        }
      }
      const { data: terminado, error: finError } = await db.rpc('terminar_revision_timeout', {
        p_id: row.id, p_codigo: row.revision_codigo, p_claim: claimed.revision_timeout_claim_at,
        p_accion: finalAccion, p_texto: texto, p_raw: raw, p_exito: true,
      })
      if (finError || !terminado) throw new Error(finError?.message || 'La revisión cambió durante el envío')
      resultados.push({ conversacion_id: row.id, accion: `revision_${finalAccion}` })
    } catch (err) {
      await db.rpc('terminar_revision_timeout', { p_id: row.id, p_codigo: row.revision_codigo,
        p_claim: claimed.revision_timeout_claim_at, p_accion: finalAccion, p_texto: '', p_raw: {}, p_exito: false })
      resultados.push({ conversacion_id: row.id, accion: 'error_revision', detalle: err instanceof Error ? err.message : String(err) })
    }
  }
  return resultados
}
