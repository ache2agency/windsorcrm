// Detección determinística de lo que el lead contesta en la fase 'correo' (sin GPT).
// Vivía dentro del webhook; se movió aquí para poder probarla en test:clasificacion.

import { quitarAcentos } from './programas'

export function detectarEmail(msg: string): string | null {
  const match = msg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return match ? match[0] : null
}

/** Detecta si el usuario no quiere dar correo (o pide la info por WhatsApp).
 * Se compara sin acentos: "Mándame la información por esté medio" (acento de más) no
 * coincidía con "por este medio", el bot se quedaba atorado en fase 'correo' y todas las
 * preguntas siguientes se contestaban sin base de conocimiento (🚩 +527411319500, 2-oct-2026). */
export function noQuiereEmail(msg: string): boolean {
  const m = quitarAcentos(msg).toLowerCase()
  if (/no (lo )?ten(go)?|sin correo|no.*correo|no.*email|no.*mail|no quiero|no doy|no hay|no pos|nop/i.test(m)) return true
  if (/por (este|ese|el) medio|por\s*a\s*qui|por\s*aca|por whats|por wa\b|por (este|el) chat|por mensaje|as[ií] esta bien|no uso|no manejo/i.test(m)) return true
  if (/\b(solo|nada mas|noma?s)\b.*(informacion|info|eso)/i.test(m)) return true
  if (!m.includes('@') && /^(info|siguiente|dale|ok|omite|salta|despues|luego|no|nada|sin|omitir|skip)$/i.test(m.trim())) return true
  return false
}

/** El lead hizo una pregunta concreta (costos, horario, modalidad, fechas...) en vez de
 * contestar lo que se le pidió. En fase 'correo' no hay que volver a pedir el correo e
 * ignorar la pregunta: se toma como "mándame la info por aquí" y se contesta con la ficha
 * del programa. */
export function esPreguntaDelLead(msg: string): boolean {
  const m = quitarAcentos(msg).toLowerCase().trim()
  if (!m || detectarEmail(m)) return false
  if (/\?/.test(m)) return true
  return /\b(cuanto|cuando|donde|como (es|son|funciona|seria)|que dias?|cual|cuales|costo|costos|precio|precios|mensualidad|inscripcion|horario|horarios|modalidad|presencial|en linea|online|duracion|dura|inicia|empieza|fecha|requisitos|informacion|info|explica|explicar|validez|rvoe)\b/.test(m)
}
