import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMetaWhatsAppMessage } from './provider'

// Mismo mecanismo de seguimiento-motor: profiles.whatsapp → Meta + actividad CRM.
// Los fallos del envío se propagan al llamador; nunca se envían links de Storage.
export async function avisarInscripcion(db: SupabaseClient, id: string) {
  const { data: solicitud, error } = await db.from('inscripciones').select('lead_id, programa').eq('id', id).single()
  if (error || !solicitud) throw new Error('Solicitud no encontrada para aviso')
  const { data: lead } = await db.from('leads').select('id,nombre,whatsapp,curso,asignado_a').eq('id', solicitud.lead_id).single()
  if (!lead) throw new Error('Lead no encontrado para aviso')
  const { data: perfil } = lead.asignado_a
    ? await db.from('profiles').select('whatsapp').eq('id', lead.asignado_a).maybeSingle()
    : { data: null }
  let destino = perfil?.whatsapp
  if (!destino) {
    const { data: admin } = await db.from('profiles').select('whatsapp').eq('rol', 'admin').not('whatsapp', 'is', null).limit(1).maybeSingle()
    destino = admin?.whatsapp
  }
  if (!destino) throw new Error('Sin WhatsApp de asesor o coordinación')
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.windsor.edu.mx'
  await sendMetaWhatsAppMessage({ to: destino, body: [
    '📋 Solicitud de inscripción recibida · Windsor',
    `Lead: ${lead.nombre || lead.whatsapp}`, `WhatsApp: ${lead.whatsapp}`,
    `Programa: ${lead.curso || solicitud.programa}`,
    'Revisa los datos y documentos en el CRM. El pago aún no está validado.',
    `${base}/inscripciones/${id}`,
  ].join('\n') })
  const { error: activityError } = await db.from('lead_activities').insert({ lead_id: lead.id, actor_id: null,
    event_type: 'inscripcion_aviso_asesor', title: 'Aviso de inscripción al asesor',
    detail: 'Solicitud recibida; revisar documentos en el CRM.', meta: { inscripcion_id: id, source: 'formulario_inscripcion' } })
  if (activityError) throw new Error('No se registró el aviso')
  return 'enviado'
}
