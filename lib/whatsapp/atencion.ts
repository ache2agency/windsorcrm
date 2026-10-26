export const ADMIN_WA_ALERTA = '527471028306'
export const MENSAJE_ESPERA = 'Déjame confirmarlo y te respondo en breve 😊'

// Solo detector de promesas en la salida de la IA: activa revisión con código.
// Nunca usarlo como filtro general sobre textos fijos o respuestas aprobadas.
export function quitarPromesasAsesor(texto: string): string {
  return /asesor(?:es)?\s+(?:te\b|revis|confirm|contact|llama)|te\s+(?:marco|llamo|llamar[aá]|contactar[aá]n)|\bllamadas?\b|te\s+(?:paso|conecto)\s+con|en breve te contact|consultarlo con un asesor/i.test(texto)
    ? MENSAJE_ESPERA : texto
}
