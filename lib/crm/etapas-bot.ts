import type { SupabaseClient } from '@supabase/supabase-js'
import { etapaParaFase } from './kanban'

// La comparación final se hace bajo lock de fila en SQL, no con un snapshot
// de la conversación: así una pregunta de precio no deshace un cierre humano.
export async function avanzarEtapaBot(db: SupabaseClient, leadId: string, etapa: string) {
  const { data, error } = await db.rpc('avanzar_etapa_bot', { p_lead_id: leadId, p_etapa: etapa })
  if (error) throw new Error(`No se pudo avanzar etapa del bot: ${error.message}`)
  return data as string | null
}
export async function avanzarPorFase(db: SupabaseClient, leadId: string, fase: string) {
  const { data, error } = await db.from('leads').select('curso').eq('id', leadId).maybeSingle()
  if (error) throw error
  const etapa = etapaParaFase(fase, data?.curso)
  return etapa ? avanzarEtapaBot(db, leadId, etapa) : null
}

// Las etapas son una mejora de CRM; un fallo al persistirlas nunca debe
// cancelar la respuesta de WhatsApp ni el registro de una cita/seguimiento.
export async function intentarAvanzarEtapaBot(db: SupabaseClient, leadId: string, etapa: string) {
  try {
    return await avanzarEtapaBot(db, leadId, etapa)
  } catch (error) {
    return registrarFalloEtapa(db, leadId, etapa, error)
  }
}

export async function intentarAvanzarPorFase(db: SupabaseClient, leadId: string, fase: string) {
  try {
    return await avanzarPorFase(db, leadId, fase)
  } catch (error) {
    return registrarFalloEtapa(db, leadId, fase, error)
  }
}

async function registrarFalloEtapa(db: SupabaseClient, leadId: string, destino: string, error: unknown) {
  const detalle = error instanceof Error ? error.message : String(error)
  console.error('[kanban] No se pudo mover la etapa; se continúa el flujo', { leadId, destino, error: detalle })
  try {
    const { error: activityError } = await db.from('lead_activities').insert([{
      lead_id: leadId,
      actor_id: null,
      event_type: 'kanban_error_etapa',
      title: 'No se pudo actualizar la etapa del Kanban',
      detail: `Destino ${destino}; respuesta y seguimiento continúan. ${detalle}`.slice(0, 1000),
      meta: { destino },
    }])
    if (activityError) console.warn('[kanban] No se pudo guardar la actividad del fallo', activityError.message)
  } catch (activityError) {
    console.warn('[kanban] Error registrando actividad de etapa', activityError)
  }
  return null
}
