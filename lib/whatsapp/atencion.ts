export const ADMIN_WA_ALERTA = '527471028306'
export const MENSAJE_ESPERA = 'Déjame confirmarlo y te respondo en breve 😊'

// También se aplica al texto persistido: el CRM debe mostrar lo mismo que se envía.
export function quitarPromesasAsesor(texto: string): string {
  return /asesor(?:es)?\s+(?:te\b|revis|confirm|contact|llama)|te\s+(?:marco|llamo|llamar[aá]|contactar[aá]n)|\bllamadas?\b|te\s+(?:paso|conecto)\s+con|en breve te contact|consultarlo con un asesor/i.test(texto)
    ? MENSAJE_ESPERA : texto
}
