import type { SupabaseClient } from '@supabase/supabase-js'
import { esPrograma } from './config'
import { enviarAlDrive, type EnviarDrive } from './drive'
import { validarDatos, validarDocumentos } from './validacion'

export class LimiteInscripcion extends Error {}
export async function recibirInscripcion(db: SupabaseClient, form: FormData, claveLimite?: string, enviar: EnviarDrive = enviarAlDrive) {
  const programa = String(form.get('programa') || '')
  if (!esPrograma(programa)) throw new Error('Programa inválido.')
  if (form.get('website')) throw new Error('Solicitud inválida.')
  if (form.get('consentimiento') !== 'si') throw new Error('Debes aceptar el aviso de privacidad.')
  const id = String(form.get('solicitud_id') || '')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Identificador inválido. Recarga el formulario.')
  const datos = validarDatos(programa, Object.fromEntries(form.entries()))
  const archivos = await validarDocumentos(programa, form) // Todos antes de cualquier envío.
  const { data: previa, error: consultaError } = await db.from('inscripciones').select('id').eq('id', id).maybeSingle()
  if (consultaError) throw new Error('No pudimos iniciar tu solicitud. Inténtalo más tarde.')
  if (previa) return { id, nuevo: false }
  if (claveLimite) {
    const { data: permitido, error } = await db.rpc('limitar_inscripcion', { p_clave: claveLimite })
    if (error) throw new Error('No pudimos iniciar tu solicitud. Inténtalo más tarde.')
    if (!permitido) throw new LimiteInscripcion('Se alcanzó el límite de solicitudes. Inténtalo en una hora o contacta a tu asesor.')
  }
  // Primero Drive (idempotente por folio en el Apps Script) y luego el registro en el CRM:
  // si el RPC falla, el reintento con el mismo folio no duplica la fila ni la carpeta.
  const drive = await enviar({ id, programa, datos, archivos })
  const documentos = [
    { tipo: 'carpeta_drive', url: drive.carpeta },
    ...(drive.ficha ? [{ tipo: 'ficha_pdf', url: drive.ficha }] : []),
  ]
  const { data, error } = await db.rpc('registrar_inscripcion', {
    p_id: id, p_programa: programa, p_datos: datos, p_documentos: documentos,
    p_asesor: process.env.DEFAULT_LEAD_ASIGNADO_A || process.env.WHATSAPP_DEFAULT_ADMIN_USER_ID || null,
  })
  if (error) throw new Error('No pudimos registrar la solicitud. Inténtalo más tarde.')
  if (!data?.nuevo) return { id, nuevo: false }
  return { id, nuevo: true }
}
