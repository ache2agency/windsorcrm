import type { SupabaseClient } from '@supabase/supabase-js'

// La sesión se verifica en el route handler. El cliente session aplica RLS a leads.
// Los documentos viven en el Drive de Windsor: se devuelven los links de la carpeta
// del alumno y su ficha PDF (abrirlos exige una cuenta con acceso a esa carpeta).
export async function consultarInscripcion(db: SupabaseClient, session: SupabaseClient, id: string) {
  const { data: solicitud, error } = await db.from('inscripciones').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error('No pudimos cargar la solicitud.')
  if (!solicitud) return null
  const { data: lead, error: leadError } = await session.from('leads').select('id').eq('id', solicitud.lead_id).maybeSingle()
  if (leadError || !lead) return null
  const documentos = (solicitud.documentos as { tipo: string; url?: string }[])
    .filter(d => typeof d.url === 'string' && d.url.startsWith('https://drive.google.com/'))
    .map(d => ({ tipo: d.tipo, url: d.url as string }))
  return { id, programa: solicitud.programa, datos: solicitud.datos, created_at: solicitud.created_at, documentos }
}
