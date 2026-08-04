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
  const esOnline = /online|virtual|distancia|en linea/.test(norm)

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
  // Normaliza acentos igual que matchOfertaEducativa() — antes esta función comparaba
  // contra el texto crudo y un typo de acento (ej. "psicólogia" en vez de "psicología",
  // acento en la letra equivocada) rompía el match con regex tipo psicolog|psico\b,
  // causando que el bot no reconociera el programa que el lead ya había especificado
  // y reiniciara con el catálogo genérico completo.
  const norm = quitarAcentos(msg).toLowerCase()
  // esOnline se evalúa aparte (igual que matchOfertaEducativa) en vez de exigir que
  // "online"/"en línea" aparezca DESPUÉS del nombre del programa en el texto — un
  // mensaje como "En línea: licenciatura en inglés" (el calificador va primero) no
  // matcheaba ningún regex de "programa...online" y perdía la modalidad online.
  const esOnline = /online|virtual|distancia|en linea/.test(norm)
  if (/ingles para nin|nin.*ingles|ingles.*nin/.test(norm)) return 'Inglés para niños'
  if (/ingles para adult|adult.*ingles|ingles.*adult/.test(norm)) return 'Inglés para adultos'
  if (/licenciatura.*ingles|ingles.*licenciatura|\blic\b.*ingles|ingles.*\blic\b/.test(norm)) return esOnline ? 'Licenciatura en Inglés online' : 'Licenciatura en Inglés'
  if (/psicoterap|habilidades.*(practica|clinica).*psic/.test(norm)) return 'Habilidades para la práctica psicoterapéutica'
  if (/psicolog|psico\b/.test(norm)) return 'Psicología'
  if (/turis|turism/.test(norm)) return esOnline ? 'Administración turística online' : 'Administración turística'
  if (/relaciones publicas|mercadotecnia|\bmkt\b|marketing/.test(norm)) return esOnline ? 'Relaciones públicas y mercadotecnia online' : 'Relaciones públicas y mercadotecnia'
  if (/frances/.test(norm)) return 'Francés'
  if (/italian/.test(norm)) return 'Italiano'
  if (/innovacion empresarial/.test(norm)) return 'Maestría en Innovación empresarial'
  if (/multiculturalidad|pluriling/.test(norm)) return 'Maestría en Multiculturalidad'
  if (/bachillerato/.test(norm)) return 'Bachillerato'
  if (/verano|summer|my best summer/.test(norm) && /nino|kid|infan|peque/.test(norm)) return 'Cursos de verano niños'
  if (/verano|summer|my best summer/.test(norm) && /adult|adolescen|joven|teen/.test(norm)) return 'Cursos de verano adultos'
  return null
}
