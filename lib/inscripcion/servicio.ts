import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { BUCKET_INSCRIPCIONES, esPrograma } from './config'
import { validarDatos, validarDocumentos } from './validacion'

export class LimiteInscripcion extends Error {}
export async function recibirInscripcion(db: SupabaseClient, form: FormData, claveLimite?: string) {
  const programa = String(form.get('programa') || '')
  if (!esPrograma(programa)) throw new Error('Programa inválido.')
  if (form.get('website')) throw new Error('Solicitud inválida.')
  if (form.get('consentimiento') !== 'si') throw new Error('Debes aceptar el aviso de privacidad.')
  const id = String(form.get('solicitud_id') || '')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Identificador inválido. Recarga el formulario.')
  const datos = validarDatos(programa, Object.fromEntries(form.entries()))
  const archivos = await validarDocumentos(programa, form) // Todos antes de cualquier escritura.
  const { data: previa, error: consultaError } = await db.from('inscripciones').select('id').eq('id', id).maybeSingle()
  if (consultaError) throw new Error('No pudimos iniciar tu solicitud. Inténtalo más tarde.')
  if (previa) return { id, nuevo: false }
  if (claveLimite) {
    const { data: permitido, error } = await db.rpc('limitar_inscripcion', { p_clave: claveLimite })
    if (error) throw new Error('No pudimos iniciar tu solicitud. Inténtalo más tarde.')
    if (!permitido) throw new LimiteInscripcion('Se alcanzó el límite de solicitudes. Inténtalo en una hora o contacta a tu asesor.')
  }
  const documentos: { tipo: string; path: string }[] = []
  let finalizando = false
  try {
    for (const archivo of archivos) {
      const path = `${id}/${randomUUID()}.${archivo.extension}`
      const { error } = await db.storage.from(BUCKET_INSCRIPCIONES).upload(path, archivo.file, {
        contentType: archivo.contentType, upsert: false,
      })
      if (error) throw new Error('No pudimos guardar los documentos. Inténtalo más tarde.')
      documentos.push({ tipo: archivo.tipo, path })
    }
    finalizando = true
    const { data, error } = await db.rpc('registrar_inscripcion', {
      p_id: id, p_programa: programa, p_datos: datos, p_documentos: documentos,
      p_asesor: process.env.DEFAULT_LEAD_ASIGNADO_A || process.env.WHATSAPP_DEFAULT_ADMIN_USER_ID || null,
    })
    if (error) throw new Error('No pudimos registrar la solicitud. Inténtalo más tarde.')
    if (!data?.nuevo) {
      await db.storage.from(BUCKET_INSCRIPCIONES).remove(documentos.map(d => d.path))
      return { id, nuevo: false }
    }
  } catch (error) {
    // Solo objetos de este intento fallido, nunca documentos de una solicitud guardada.
    // Si se perdió la respuesta del RPC, pudo haber commit: conservar los objetos.
    if (!finalizando && documentos.length) await db.storage.from(BUCKET_INSCRIPCIONES).remove(documentos.map(d => d.path))
    throw error
  }
  return { id, nuevo: true }
}
