import type { SupabaseClient } from '@supabase/supabase-js'
import { BUCKET_INSCRIPCIONES } from './config'

// La sesión se verifica en el route handler. El cliente session aplica RLS a leads.
export async function consultarInscripcion(db: SupabaseClient, session: SupabaseClient, id: string) {
  const { data: solicitud, error } = await db.from('inscripciones').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error('No pudimos cargar la solicitud.')
  if (!solicitud) return null
  const { data: lead, error: leadError } = await session.from('leads').select('id').eq('id', solicitud.lead_id).maybeSingle()
  if (leadError || !lead) return null
  const documentos = []
  for (const documento of solicitud.documentos as { tipo: string; path: string }[]) {
    if (!documento.path.startsWith(`${id}/`)) throw new Error('Documento inválido.')
    const { data, error: signingError } = await db.storage.from(BUCKET_INSCRIPCIONES).createSignedUrl(documento.path, 300, { download: true })
    if (signingError) throw new Error('No pudimos abrir los documentos.')
    documentos.push({ tipo: documento.tipo, url: data.signedUrl })
  }
  return { id, programa: solicitud.programa, datos: solicitud.datos, created_at: solicitud.created_at, documentos }
}
