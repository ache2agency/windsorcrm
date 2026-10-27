import type { SupabaseClient } from '@supabase/supabase-js'

export async function autorDeSesion(db: SupabaseClient, sessionUserId: string | null) {
  if (!sessionUserId) return { enviado_por: null, enviado_por_nombre: 'Sistema (envío interno)' }
  const { data, error } = await db.from('profiles').select('id,nombre,email,rol').eq('id', sessionUserId).maybeSingle()
  if (error) throw new Error('No se pudo consultar el perfil del asesor')
  if (!data || !['admin','vendedor'].includes(data.rol)) throw new Error('Falta perfil de asesor autorizado')
  return { enviado_por: sessionUserId, enviado_por_nombre: data.nombre?.trim() || data.email || 'Asesor' }
}
