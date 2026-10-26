export type TipoContacto = 'alumno' | 'prospecto'
export function clasificarContacto(texto: string, actual: TipoContacto = 'prospecto', manual = false): TipoContacto {
  if (manual || actual === 'alumno') return actual
  const t = texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  return /(?:hoy|dia de hoy).{0,25}(?:habra|hay|tenemos).{0,12}clases?|(?:habra|hay|tenemos).{0,12}clases?.{0,15}hoy|(?:envio|enviar|mando|recibi|mi|la).{0,20}calificacion|constancia.{0,65}(?:estoy|cursando|haciendo|estudiando)|(?:ya pague|comprobante|mi pago).{0,15}(?:de |la |mi )?mensualidad|(?:pago|pagar).{0,10}mi mensualidad|mi (?:hijo|hija).{0,15}(?:esta en|estudia|grupo)|(?:mi|nuestro) (?:maestro|maestra|profesor|profesora|grupo)|regularizacion.{0,60}(?:no asisti|no asistio|mes que)/.test(t) ? 'alumno' : 'prospecto'
}
export const etiquetaContacto = (tipo?: string | null) => tipo === 'alumno' ? '🎓 ALUMNO' : '🆕 PROSPECTO'
export const esProspecto = (contacto: { tipo_contacto?: string | null }) => contacto.tipo_contacto !== 'alumno'
