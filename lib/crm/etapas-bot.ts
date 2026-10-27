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
