/**
 * Templates de WhatsApp aprobados en Meta WhatsApp Manager (cuenta "Institución educativa",
 * business_id 2078975105711953). Todos "Active - Quality pending" al verificarse.
 * Usan {{1}} como placeholder del primer nombre del lead — Meta no permite alterar el body.
 */

export type TemplateAprobadoKey =
  | 'windsor_inscripcion_pendiente_'
  | 'windsor_promo'
  | 'seguimiento_general'
  | 'windsor_reactivacion_seguimiento'
  | 'windsor_bienvenida_lead_manual'

export interface TemplateAprobado {
  name: TemplateAprobadoKey
  category: 'Marketing' | 'Utility'
  label: string
  body: string
}

export const TEMPLATES_APROBADOS: TemplateAprobado[] = [
  {
    name: 'windsor_inscripcion_pendiente_',
    category: 'Marketing',
    label: 'Inscripción pendiente',
    body: 'Hola {{1}}, tu lugar en Instituto Windsor está casi apartado. Solo falta completar el proceso de inscripción. ¿Necesitas ayuda con algún documento o los datos de pago? 😊',
  },
  {
    name: 'windsor_promo',
    category: 'Marketing',
    label: 'Promoción vigente',
    body: 'Hola {{1}} 😊. Tenemos una promoción vigente en Instituto Windsor y nos encantaría que la aprovecharas. ¿Te compartimos los detalles?',
  },
  {
    name: 'seguimiento_general',
    category: 'Marketing',
    label: 'Seguimiento general',
    body: 'Hola {{1}} 👋 ¿Pudiste revisar la información que te compartimos sobre Instituto Windsor? Si tienes alguna duda, con gusto te ayudamos. 😊',
  },
  {
    name: 'windsor_reactivacion_seguimiento',
    category: 'Marketing',
    label: 'Reactivación · aún tienes lugar',
    body: 'Hola {{1}} 👋 Aún tienes lugar en nuestra promoción de este mes en Instituto Windsor 🎉 Escríbenos por este medio y te ayudamos a completar tu inscripción antes de que se acabe el cupo.',
  },
  {
    name: 'windsor_bienvenida_lead_manual',
    category: 'Utility',
    label: 'Reenviar información solicitada',
    body: 'Hola {{1}} 👋 Aquí te comparto la información que nos solicitaste. Toca el botón para recibirla.',
  },
]

export function obtenerTemplateAprobado(name: string): TemplateAprobado | undefined {
  return TEMPLATES_APROBADOS.find((t) => t.name === name)
}

export function renderizarTemplate(body: string, primerNombre: string): string {
  return body.replace(/\{\{1\}\}/g, primerNombre || 'ahí')
}
