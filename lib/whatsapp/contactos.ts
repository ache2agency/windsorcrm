export type TipoContacto = 'alumno' | 'prospecto'

export function clasificarContacto(texto: string, actual: TipoContacto = 'prospecto', manual = false, inscrito = false): TipoContacto {
  if (manual) return actual
  if (inscrito) return 'alumno'
  const t = texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const claseHoy = !/muestra|prueba/.test(t) && /(?:hoy|dia de hoy).{0,25}(?:habra|hay|tenemos).{0,12}clases?|(?:habra|hay|tenemos).{0,12}clases?.{0,15}hoy/.test(t)
  const calificacion = !/calificacion(?:es)?\s+(?:minima|aprobatoria)/.test(t) && /(?:envio|enviar|mando|recibi)\s+(?:la |las |mi |mis )?calificacion|\bmis? calificaciones?\b|\bla calificacion de (?!ingles|curso|diploma|examen)[a-z]+/.test(t)
  const alumno = claseHoy || calificacion ||
    /constancia.{0,65}(?:estoy\s+(?:cursando|estudiando|haciendo\s+(?:el\s+)?curso)|estoy\s+en\s+el\s+curso)|(?:ya pague|comprobante|mi pago).{0,15}(?:de |la |mi )?mensualidad|(?:pago|pagar).{0,10}mi mensualidad|mi (?:hijo|hija).{0,15}(?:esta|estudia|cursa).{0,12}(?:windsor|(?:(?:su|el) grupo|(?:su|la) clase) de (?:ingles|windsor))|mi (?:maestro|maestra|profesor|profesora|grupo) de (?:windsor|ingles)|regularizacion.{0,60}(?:no asisti|no asistio|mes que)/.test(t)
  if (alumno) return 'alumno'
  // Un mensaje comercial claro corrige una clasificación automática anterior.
  // Las respuestas neutras (p. ej. "gracias") no convierten un alumno en venta.
  const prospecto = /muestra|prueba|primaria|secundaria|preescolar|\bgrado\b|calificacion(?:es)?\s+(?:minima|aprobatoria)|(?:quiero|quisiera|busco|quiere|interesa).{0,50}(?:informacion|curso|ingles|inscrib)|recomiendan|cuanto (?:cuesta|pago|voy a pagar)|\bprecio|\bcostos?\b/.test(t)
  return prospecto ? 'prospecto' : actual
}
export const etiquetaContacto = (tipo?: string | null) => tipo === 'alumno' ? '🎓 ALUMNO' : '🆕 PROSPECTO'
