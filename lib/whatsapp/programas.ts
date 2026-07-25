// Capa de clasificación de "qué programa/curso es este" — compartida entre
// el webhook de producción y el simulador (lab). Antes vivía duplicada (solo
// en webhook), así que los fixes ahí nunca se reflejaban en el simulador.
// Ver memoria windsorcrm_bug_promo_convenio (LAB BOT desincronizado).

export function quitarAcentos(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export type OfertaMatchResult = { match: string | null; ambiguous: boolean }

/** Reconoce la oferta educativa por palabras clave. Si reconoce la categoría pero falta
 * el calificador niños/adultos, marca ambiguous en vez de adivinar uno de los dos. */
export function matchOfertaEducativa(input: string): OfertaMatchResult {
  const norm = quitarAcentos(input.trim().toLowerCase())
  if (!norm) return { match: null, ambiguous: false }

  const esNino = /nin|kids?|infantil/.test(norm)
  const esAdulto = /adult/.test(norm)
  const esOnline = /online|virtual|distancia/.test(norm)

  if (/verano|summer/.test(norm)) {
    if (esNino) return { match: 'Cursos de verano niños', ambiguous: false }
    if (esAdulto) return { match: 'Cursos de verano adultos', ambiguous: false }
    return { match: null, ambiguous: true }
  }
  if (/ingles|english/.test(norm)) {
    if (/licenciatura|^lic\b/.test(norm)) return { match: esOnline ? 'Licenciatura en Inglés online' : 'Licenciatura en Inglés', ambiguous: false }
    if (esNino) return { match: 'Inglés para niños', ambiguous: false }
    if (esAdulto) return { match: 'Inglés para adultos', ambiguous: false }
    return { match: null, ambiguous: true }
  }
  if (/psicoterap|habilidades.*(practica|clinic)/.test(norm)) return { match: 'Habilidades para la práctica psicoterapéutica', ambiguous: false }
  if (/psicolog/.test(norm)) return { match: 'Psicología', ambiguous: false }
  if (/turis/.test(norm)) return { match: esOnline ? 'Administración turística online' : 'Administración turística', ambiguous: false }
  if (/relaciones publicas|mercadotecnia/.test(norm)) return { match: esOnline ? 'Relaciones públicas y mercadotecnia online' : 'Relaciones públicas y mercadotecnia', ambiguous: false }
  if (/bachillerato|prepa/.test(norm)) return { match: 'Bachillerato', ambiguous: false }

  return { match: null, ambiguous: false }
}

/** Canonicaliza el programa antes de guardarlo en leads.curso. GPT a veces normaliza
 * de más (ej. resume "habilidades para la práctica psicoterapéutica" como "psicología")
 * y pierde el matiz que decide a qué proceso de inscripción va el lead. Por eso se
 * prioriza el regex de matchOfertaEducativa() sobre el texto ORIGINAL del usuario —
 * más confiable que la extracción libre de GPT — y solo se usa gpt.programa tal cual
 * si el texto original no matchea nada conocido. */
export function canonicalizarPrograma(gptPrograma: string, textoOriginal: string): string {
  const deTexto = matchOfertaEducativa(textoOriginal)
  if (deTexto.match) return deTexto.match
  const deGpt = matchOfertaEducativa(gptPrograma)
  if (deGpt.match) return deGpt.match
  return gptPrograma
}

export const CURSO_HABILIDADES_PSICO = 'Habilidades para la práctica psicoterapéutica'

export function esHabilidadesPsico(curso: string | null | undefined): boolean {
  return (curso || '') === CURSO_HABILIDADES_PSICO
}

// Lista cerrada de licenciaturas — únicas que piden Acta de Nacimiento,
// Certificado de Bachillerato, CURP y fotografías. Todo lo que no esté
// aquí NO debe recibir ese proceso solo por descarte.
export const PROGRAMAS_LICENCIATURA = [
  'Psicología',
  'Licenciatura en Inglés',
  'Licenciatura en Inglés online',
  'Administración turística',
  'Administración turística online',
  'Relaciones públicas y mercadotecnia',
  'Relaciones públicas y mercadotecnia online',
]

export function esLicenciatura(curso: string | null | undefined): boolean {
  return PROGRAMAS_LICENCIATURA.includes(curso || '')
}

// Lista cerrada de cursos cortos/verano que NO son licenciatura y usan
// el proceso simple de My Best Summer (acta + comprobante de pago).
// Se mantiene explícita en vez de inferir "todo lo que no sea licenciatura"
// para no arrastrar programas nuevos o no contemplados a un proceso incorrecto.
export const PROGRAMAS_VERANO_CORTO = [
  'Cursos de verano niños',
  'Cursos de verano adultos',
  'Francés',
  'Italiano',
]

export function esVeranoOCorto(curso: string | null | undefined): boolean {
  const c = curso || ''
  if (PROGRAMAS_VERANO_CORTO.includes(c)) return true
  const cLower = c.toLowerCase()
  return cLower.includes('verano') || cLower.includes('my best summer')
}

export const CURSO_BACHILLERATO = 'Bachillerato'

export function esBachillerato(curso: string | null | undefined): boolean {
  return (curso || '') === CURSO_BACHILLERATO
}

// Lista cerrada de los diplomados del catálogo (más el keyword "diplomado" como
// señal explícita adicional, no un catch-all sobre curso genérico).
export const PROGRAMAS_DIPLOMADO = [
  'Administración de Instituciones de la Salud',
  'Administración de recursos humanos',
  'Administración de restaurantes',
  'Análisis y Evaluación de Políticas Públicas',
  'Comunicación y Liderazgo en el Sector Público',
  'Comunicación y Liderazgo empresarial',
  'Competencias educativas',
  'Comunicación y Gobierno Digital',
  'Contabilidad',
  'Creación y dirección de franquicias',
  'Ciencias del deporte',
  'Enfermería',
  'Epidemiología',
  'Equidad de genero y diversidad sexual',
  'Farmacología',
  'Gamificación educativa',
  'Gerontología',
  'Innovación y Gobierno Digital',
  'Mindfulness',
  'Nutrición deportiva',
  'Nutrición y Dietética',
  'Políticas y Procesos de Participación Ciudadana',
  'Piscología criminológica',
  'Psicología educativa',
  'Realidad Virtual',
  'Salud pública',
  'Tecnología educativa',
  'Terapia ocupacional',
  'Tanatología',
  'Enseñanza del idioma inglés',
  'Enseñanza del idioma español',
]

export function esDiplomado(curso: string | null | undefined): boolean {
  const c = curso || ''
  if (PROGRAMAS_DIPLOMADO.includes(c)) return true
  return /diplomado/i.test(c)
}

export function esInglesIdioma(programa: string | null | undefined): boolean {
  return /ingl[eé]s para (ni[ñn]os?|adultos?)/i.test(programa || '')
}

/**
 * Tipo de proceso de inscripción según el curso del lead.
 * 'desconocido' es intencional: ante un curso no contemplado en ninguna
 * lista, el bot NO debe adivinar (así se originó el bug de mandar
 * documentos de licenciatura a leads de cursos cortos) — debe escalar.
 */
export type TipoInscripcion = 'verano' | 'habilidades' | 'bachillerato' | 'diplomado' | 'idioma' | 'licenciatura' | 'desconocido'

export function tipoInscripcion(curso: string | null | undefined): TipoInscripcion {
  if (esHabilidadesPsico(curso)) return 'habilidades'
  if (esVeranoOCorto(curso)) return 'verano'
  if (esBachillerato(curso)) return 'bachillerato'
  if (esDiplomado(curso)) return 'diplomado'
  if (esInglesIdioma(curso)) return 'idioma'
  if (esLicenciatura(curso)) return 'licenciatura'
  return 'desconocido'
}

/** Detecta el programa mencionado en un mensaje suelto (no confundir con
 * canonicalizarPrograma, que normaliza lo que GPT ya extrajo). Se usa para
 * detectar cambios de tema a media conversación. Antes vivía duplicada en
 * webhook y lab con listas de regex que ya habían divergido entre sí. */
export function detectarPrograma(msg: string): string | null {
  if (/ingl[eé]s para ni[ñn]os?|ni[ñn]os?.*ingl[eé]s|ingl[eé]s.*ni[ñn]os?/i.test(msg)) return 'Inglés para niños'
  if (/ingl[eé]s para adultos?|adultos?.*ingl[eé]s|ingl[eé]s.*adultos?/i.test(msg)) return 'Inglés para adultos'
  if (/licenciatura.*ingl[eé]s.*online|ingl[eé]s.*licenciatura.*online|\blic\b.*ingl[eé]s.*online/i.test(msg)) return 'Licenciatura en Inglés online'
  if (/licenciatura.*ingl[eé]s|ingl[eé]s.*licenciatura|\blic\b.*ingl[eé]s|ingl[eé]s.*\blic\b/i.test(msg)) return 'Licenciatura en Inglés'
  if (/psicoterap|habilidades.*(pr[aá]ctica|cl[ií]nica).*psic/i.test(msg)) return 'Habilidades para la práctica psicoterapéutica'
  if (/psicolog|psico\b/i.test(msg)) return 'Psicología'
  if (/tur[ií]s.*(online|en l[ií]nea)|(online|en l[ií]nea).*tur[ií]s/i.test(msg)) return 'Administración turística online'
  if (/tur[ií]s|turism/i.test(msg)) return 'Administración turística'
  if (/(relaciones p[uú]blicas|mercadotecnia|\bmkt\b|marketing).*(online|en l[ií]nea)/i.test(msg)) return 'Relaciones públicas y mercadotecnia online'
  if (/relaciones p[uú]blicas|mercadotecnia|\bmkt\b|marketing/i.test(msg)) return 'Relaciones públicas y mercadotecnia'
  if (/franc[eé]s/i.test(msg)) return 'Francés'
  if (/italian/i.test(msg)) return 'Italiano'
  if (/innovaci[oó]n empresarial/i.test(msg)) return 'Maestría en Innovación empresarial'
  if (/multiculturalidad|pluriling/i.test(msg)) return 'Maestría en Multiculturalidad'
  if (/bachillerato/i.test(msg)) return 'Bachillerato'
  if (/verano|summer|my best summer/i.test(msg) && /ni[ñn]o|kid|infan|peque/i.test(msg)) return 'Cursos de verano niños'
  if (/verano|summer|my best summer/i.test(msg) && /adult|adolescen|joven|teen/i.test(msg)) return 'Cursos de verano adultos'
  return null
}
