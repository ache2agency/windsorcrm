import { hasLeadName } from './nombres'
import { ALIAS_DIPLOMADO, PROGRAMAS_DIPLOMADO, normDiplomado } from './programas'
import { urlPlanDiplomado } from './planesDiplomado'
import { DATOS_DIPLOMADOS } from './reglasNegocio'

function nombreCanonicoDiplomado(curso: string | null | undefined): string | null {
  const c = normDiplomado(String(curso || '').replace(/^diplomado\s+en\s+/i, ''))
  if (!c || c === 'diplomado') return null
  const alias = ALIAS_DIPLOMADO.find(([variante]) => normDiplomado(variante) === c)
  if (alias) return alias[1]
  return PROGRAMAS_DIPLOMADO.find((nombre) => normDiplomado(nombre) === c) || null
}

export function buildMensajeReactivacionDiplomado20h(params: {
  curso: string | null | undefined
  nombre: string | null | undefined
  whatsapp: string | null | undefined
}): string | null {
  const diplomado = nombreCanonicoDiplomado(params.curso)
  if (!diplomado) return null

  const planUrl = urlPlanDiplomado(diplomado)
  if (!planUrl) return null

  const primerNombre = hasLeadName(params.nombre, params.whatsapp)
    ? String(params.nombre).trim().split(/\s+/)[0].replace(/[.,;:]+$/, '')
    : ''
  const saludo = primerNombre ? `¡Hola ${primerNombre}! 😊` : '¡Hola! 😊'

  return `${saludo} Te comparto por aquí la información del *Diplomado en ${diplomado}*:

*Inversión regular:* ${DATOS_DIPLOMADOS.inversionRegular}
🎉 ${DATOS_DIPLOMADOS.promocionVigente}
*Plan de estudios:* ${planUrl}

Es 100% en línea con clases en vivo y empiezas en cuanto te inscribes. ¿Qué duda tienes?`
}

/** Toque 20 h para quien YA recibió la info del diplomado: no se reenvía la ficha, solo se
 * pregunta si quedó alguna duda (Harold 13-oct). */
export function buildMensajeDudasDiplomado20h(params: {
  curso: string | null | undefined
  nombre: string | null | undefined
  whatsapp: string | null | undefined
}): string | null {
  const diplomado = nombreCanonicoDiplomado(params.curso)
  if (!diplomado) return null

  const primerNombre = hasLeadName(params.nombre, params.whatsapp)
    ? String(params.nombre).trim().split(/\s+/)[0].replace(/[.,;:]+$/, '')
    : ''
  const saludo = primerNombre ? `¡Hola ${primerNombre}! 😊` : '¡Hola! 😊'

  return `${saludo} ¿Pudiste revisar la información del *Diplomado en ${diplomado}*? ¿Te quedó alguna duda? Con gusto te ayudo.`
}
