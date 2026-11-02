import type { SupabaseClient } from '@supabase/supabase-js'
// El trigger de inscripciones encola la revisión. El cron envía únicamente la UTILITY
// a Harold después de verificar Drive; nunca se intenta texto libre fuera de ventana.
export async function avisarInscripcion(db:SupabaseClient,id:string) {
  const {data,error}=await db.from('ruta_inscripcion_trabajos').select('id').eq('id',id).single()
  if(error||!data) throw new Error('Solicitud sin trabajo de revisión')
  return 'encolado'
}
