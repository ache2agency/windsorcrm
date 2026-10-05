// "Conversaciones doradas" — casos reales de bugs ya corregidos en windsorcrm,
// convertidos en pruebas de regresión rápidas y gratis (no llaman a GPT, solo
// prueban las funciones puras de lib/whatsapp/programas.ts). Correr antes de
// cualquier cambio grande al bot: `npm run test:clasificacion`.
//
// Cada caso referencia el bug real que lo originó — si un caso falla, es que
// algo que ya se había arreglado se rompió otra vez.

import {
  matchOfertaEducativa,
  canonicalizarPrograma,
  detectarPrograma,
  tipoInscripcion,
  esLicenciatura,
  esDiplomado,
  cambioDePrograma,
  PROGRAMAS_DIPLOMADO,
} from '../lib/whatsapp/programas'
import { noQuiereEmail, esPreguntaDelLead } from '../lib/whatsapp/captura'
import { construirSystemPrompt } from '../lib/whatsapp/promptBot'
import { diplomadoUnicoEnRespuesta, urlPlanDiplomado, limpiarFormatoWhatsApp } from '../lib/whatsapp/planesDiplomado'

type Caso = { nombre: string; got: unknown; want: unknown; bug?: string }

const casos: Caso[] = [
  // Caso Karen Nava (15-jul) — "habilidades para la práctica psicoterapéutica"
  // se confundía con "Psicología" genérico, lo que la routeaba al flujo de
  // licenciatura equivocado y terminó en el bot inventando datos bancarios.
  {
    nombre: 'psicoterapéutica no es Psicología genérica',
    got: matchOfertaEducativa('habilidades para la práctica psicoterapéutica').match,
    want: 'Habilidades para la práctica psicoterapéutica',
    bug: 'windsorcrm_bug_ia_alucina_datos_bancarios',
  },
  {
    nombre: 'psicología sola sí es la licenciatura',
    got: matchOfertaEducativa('quiero información de psicología').match,
    want: 'Psicología',
  },
  {
    nombre: 'canonicalizarPrograma prioriza el texto original sobre el resumen de GPT',
    got: canonicalizarPrograma('psicología', 'quiero el curso de habilidades para la practica psicoterapeutica'),
    want: 'Habilidades para la práctica psicoterapéutica',
    bug: 'windsorcrm_bug_ia_alucina_datos_bancarios',
  },
  {
    nombre: 'tipoInscripcion de habilidades psicoterapéutica no es licenciatura',
    got: tipoInscripcion('Habilidades para la práctica psicoterapéutica'),
    want: 'habilidades',
    bug: 'windsorcrm_bug_ia_alucina_datos_bancarios',
  },

  // Caso Alan (14-jul) / Jussara (04-jul) — "Francés"/"Italiano" sueltos deben
  // ir al proceso de inscripción corto de verano, NO al de licenciatura.
  {
    nombre: 'Francés suelto usa proceso de verano, no licenciatura',
    got: tipoInscripcion('Francés'),
    want: 'verano',
    bug: 'windsorcrm_tipoinscripcion_fix',
  },
  {
    nombre: 'Francés no es licenciatura',
    got: esLicenciatura('Francés'),
    want: false,
    bug: 'windsorcrm_tipoinscripcion_fix',
  },
  {
    nombre: 'Cursos de verano niños usa proceso de verano',
    got: tipoInscripcion('Cursos de verano niños'),
    want: 'verano',
  },

  // Principio de diseño explícito de Harold: ante un curso no reconocido,
  // el bot debe escalar, NUNCA adivinar un proceso de inscripción.
  {
    nombre: 'curso no reconocido escala en vez de adivinar',
    got: tipoInscripcion('Programa que no existe en ninguna lista'),
    want: 'desconocido',
    bug: 'windsorcrm_tipoinscripcion_fix',
  },

  // Ambigüedad niño/adulto — nunca debe adivinar uno de los dos.
  {
    nombre: 'inglés sin calificador queda ambiguo',
    got: matchOfertaEducativa('inglés').ambiguous,
    want: true,
  },
  {
    nombre: 'verano sin calificador queda ambiguo',
    got: matchOfertaEducativa('verano').ambiguous,
    want: true,
  },
  {
    nombre: 'inglés para niños no es ambiguo',
    got: matchOfertaEducativa('inglés para niños').match,
    want: 'Inglés para niños',
  },

  // detectarPrograma (detección en mensaje suelto, usada para detectar
  // cambio de tema a media conversación) — antes divergía entre webhook y lab.
  {
    nombre: 'detectarPrograma reconoce psicoterapéutica',
    got: detectarPrograma('me interesa la practica psicoterapeutica'),
    want: 'Habilidades para la práctica psicoterapéutica',
    bug: 'windsorcrm_bug_promo_convenio (LAB BOT desincronizado)',
  },
  {
    nombre: 'detectarPrograma distingue licenciatura en inglés online',
    got: detectarPrograma('quiero la licenciatura en inglés en línea'),
    want: 'Licenciatura en Inglés online',
  },
  {
    nombre: 'detectarPrograma reconoce el programa aunque venga junto al nombre en el mismo mensaje',
    got: detectarPrograma('Yarely Romero Gatica \nLicenciatura en Ingles'),
    want: 'Licenciatura en Inglés',
    bug: 'windsorcrm_falsa_negacion_programas_ago07 — sin esto, GPT llegó a negar que existiera la Licenciatura en Inglés',
  },

  // Diplomados — lista cerrada + keyword "diplomado" como señal adicional.
  {
    nombre: 'Contabilidad está en la lista cerrada de diplomados',
    got: esDiplomado('Contabilidad'),
    want: true,
  },
  {
    nombre: 'cualquier curso con la palabra diplomado cuenta como diplomado',
    got: esDiplomado('Diplomado en algo nuevo no listado'),
    want: true,
  },

  // Caso David (+527471647980, 08-ago) — detectarPrograma() no tenía NINGUNA regla
  // para diplomados, así que leads.curso nunca se actualizaba al hablar de uno a
  // media conversación. Quedó pegado en "Administración turística" (su primera
  // pregunta) y el bot le mandó documentos de inscripción de licenciatura por error
  // cuando llevaba rato preguntando por el Diplomado en Contabilidad.
  {
    nombre: 'detectarPrograma reconoce un diplomado mencionado a media conversación',
    got: detectarPrograma('¿entonces no hay presencial para el Diplomado en Contabilidad?'),
    want: 'Diplomado en Contabilidad',
    bug: 'windsorcrm_fixes_estructurales_jul24 (caso David, 08-ago)',
  },
  {
    nombre: 'tipoInscripcion de un diplomado detectado es diplomado, no licenciatura',
    got: tipoInscripcion(detectarPrograma('quiero el diplomado en contabilidad')),
    want: 'diplomado',
    bug: 'windsorcrm_fixes_estructurales_jul24 (caso David, 08-ago)',
  },
  {
    // Antes de este fix, un diplomado con nombre parecido a una licenciatura se
    // habría clasificado mal si se revisaban las categorías genéricas primero
    // (ej. "psicolog" matchea el regex de la licenciatura de Psicología).
    nombre: 'un diplomado con nombre parecido a una licenciatura no se confunde con la licenciatura',
    got: matchOfertaEducativa('me interesa el diplomado en psicología educativa').match,
    want: 'Diplomado en Psicología educativa',
  },
  // Campaña Meta de diplomados (29-sep-2026): el mensaje prellenado de 2 de los 9
  // anuncios no se reconocía ("Piscología" en la lista y "de la Salud" vs "de Salud").
  ...([
    ['Terapia Ocupacional', 'Terapia ocupacional'],
    ['Epidemiología', 'Epidemiología'],
    ['Farmacología', 'Farmacología'],
    ['Psicología Educativa', 'Psicología educativa'],
    ['Psicología Criminológica', 'Psicología criminológica'],
    ['Administración de Instituciones de Salud', 'Administración de Instituciones de Salud'],
    ['Administración de Recursos Humanos', 'Administración de recursos humanos'],
    ['Administración de Restaurantes', 'Administración de restaurantes'],
    ['Enseñanza del Idioma Inglés', 'Enseñanza del idioma inglés'],
  ] as const).map(([anuncio, canonico]) => ({
    nombre: `mensaje del anuncio de ${anuncio} se reconoce`,
    got: detectarPrograma(`¿Podrías darme más información sobre el Diplomado en ${anuncio}, por favor?`),
    want: `Diplomado en ${canonico}`,
  })),
  {
    nombre: 'la variante web "de la Salud" también se reconoce',
    got: detectarPrograma('info del diplomado en administración de instituciones de la salud'),
    want: 'Diplomado en Administración de Instituciones de Salud',
  },
  {
    nombre: 'leads viejos guardados con el typo "Piscología criminológica" siguen siendo diplomado',
    got: tipoInscripcion('Piscología criminológica'),
    want: 'diplomado',
  },
  {
    nombre: 'diplomado de tecnología se reconoce con la palabra diplomado',
    got: detectarPrograma('me interesa el diplomado de ciberseguridad'),
    want: 'Diplomado en Ciberseguridad',
  },
  {
    nombre: 'IA en la educación no se confunde con el de Inteligencia Artificial',
    got: detectarPrograma('diplomado en integración de la inteligencia artificial en la educación'),
    want: 'Diplomado en Integración de la Inteligencia Artificial en la Educación',
  },
  {
    nombre: 'mencionar "inteligencia artificial" sin decir diplomado no secuestra la conversación',
    got: detectarPrograma('¿en la licenciatura en inglés usan inteligencia artificial?'),
    want: 'Licenciatura en Inglés',
  },
  // Caso prueba del anuncio de Tanatología (1-oct-2026) — la respuesta del bot dio
  // precios y duración pero nunca el plan de estudios del diplomado.
  {
    nombre: 'todos los diplomados del catálogo tienen plan de estudios',
    got: PROGRAMAS_DIPLOMADO.filter(n => !urlPlanDiplomado(n)),
    want: [],
  },
  {
    nombre: 'respuesta sobre Tanatología → manda su plan',
    got: diplomadoUnicoEnRespuesta('¡Hola Anel! Claro, aquí tienes más información sobre el **Diplomado en Tanatología**:'),
    want: 'Tanatología',
  },
  {
    nombre: 'IA en la educación no cuenta también como Inteligencia Artificial',
    got: diplomadoUnicoEnRespuesta('El Diplomado en Integración de la Inteligencia Artificial en la Educación dura 120 horas'),
    want: 'Integración de la Inteligencia Artificial en la Educación',
  },
  {
    nombre: 'alias del anuncio (de la Salud) → plan del canónico',
    got: diplomadoUnicoEnRespuesta('Diplomado en Administración de Instituciones de la Salud'),
    want: 'Administración de Instituciones de Salud',
  },
  {
    nombre: 'menú con varios diplomados → no manda ningún PDF',
    got: diplomadoUnicoEnRespuesta('Diplomados de Salud:\n•Tanatología\n•Gerontología\n•Enfermería'),
    want: null,
  },
  {
    nombre: 'sin la palabra diplomado → no manda PDF',
    got: diplomadoUnicoEnRespuesta('En la licenciatura llevas materias de contabilidad'),
    want: null,
  },
  {
    nombre: 'negritas Markdown → formato WhatsApp',
    got: limpiarFormatoWhatsApp('**Modalidad:**\n### Costos\n*ya bien*'),
    want: '*Modalidad:*\n*Costos*\n*ya bien*',
  },
  // ── Diplomado "pegajoso" (🚩 +527411319500, Nutrición, 2-oct-2026): tras la ficha, el bot
  // perdía el contexto de diplomado y contestaba con datos de licenciatura/presencial.
  {
    nombre: '"¿el diplomado es presencial?" no cambia el curso al genérico Diplomado',
    got: cambioDePrograma('Diplomado en Nutrición y Dietética', '¿el diplomado es presencial?'),
    want: null,
    bug: 'diplomados-contexto 3-oct',
  },
  {
    nombre: 'lead de diplomado de psicología que dice "soy psicóloga" sigue en el diplomado',
    got: cambioDePrograma('Diplomado en Psicología Criminológica', '¿me sirve si soy psicóloga?'),
    want: null,
  },
  {
    nombre: 'lead de diplomado que pide explícitamente la licenciatura sí cambia',
    got: cambioDePrograma('Diplomado en Nutrición y Dietética', 'y la licenciatura en psicología cuánto cuesta?'),
    want: 'Psicología',
  },
  {
    nombre: 'lead de diplomado que nombra otro diplomado sí cambia',
    got: cambioDePrograma('Diplomado en Nutrición y Dietética', 'y el diplomado en tanatología?'),
    want: 'Diplomado en Tanatología',
  },
  {
    nombre: 'lead de licenciatura conserva el cambio de programa de siempre',
    got: cambioDePrograma('Psicología', 'mejor administración turística'),
    want: 'Administración turística',
  },
  {
    nombre: '"Mándame la información por esté medio" (acento de más) = no quiere dar correo',
    got: noQuiereEmail('Mándame la información por esté medio porfavor'),
    want: true,
    bug: 'diplomados-contexto 3-oct (+527411319500)',
  },
  {
    nombre: '"por aquí está bien" = no quiere dar correo',
    got: noQuiereEmail('por aquí está bien'),
    want: true,
  },
  {
    nombre: '"Me puedes explicar el modelo mixto" en fase correo es pregunta',
    got: esPreguntaDelLead('Me puedes explicar la el modelo mixto'),
    want: true,
  },
  {
    nombre: '"Y el costó" es pregunta',
    got: esPreguntaDelLead('Y el costó'),
    want: true,
  },
  {
    nombre: '"si claro" no es pregunta (sigue pidiendo correo)',
    got: [esPreguntaDelLead('si claro'), noQuiereEmail('si claro')],
    want: [false, false],
  },
  {
    nombre: 'un correo no es pregunta',
    got: esPreguntaDelLead('jose.perez@gmail.com'),
    want: false,
  },
  {
    nombre: 'prompt de diplomado incluye PROGRAMA ACTIVO y la inscripción sin descuento',
    got: (() => {
      const p = construirSystemPrompt({ fase: 'accion', leadData: { nombre: 'José', curso: 'Diplomado en Nutrición y Dietética' }, ragContext: '', savedBotPrompt: '' })
      return [p.includes('PROGRAMA ACTIVO'), p.includes('$700 MXN aparte'), p.includes('NO TIENE DESCUENTO NUNCA'), p.includes('RECORDATORIO FINAL')]
    })(),
    want: [true, true, true, true],
  },
  {
    nombre: 'info_enviada de diplomado no pide tachar la inscripción',
    got: construirSystemPrompt({ fase: 'info_enviada', leadData: { curso: 'Diplomado en Enseñanza del idioma inglés' }, ragContext: '', savedBotPrompt: '' }).includes('~$PRECIO_ORIGINAL~'),
    want: false,
    bug: 'diplomados-contexto 3-oct (+529212670886, $700→$490)',
  },
  {
    nombre: 'prompt de licenciatura no cambia (sin bloque de diplomado, conserva formato de promo)',
    got: (() => {
      const p = construirSystemPrompt({ fase: 'info_enviada', leadData: { curso: 'Psicología' }, ragContext: '', savedBotPrompt: '' })
      return [p.includes('PROGRAMA ACTIVO'), p.includes('~$PRECIO_ORIGINAL~')]
    })(),
    want: [false, true],
  },
]

let fallos = 0
for (const c of casos) {
  const gotStr = JSON.stringify(c.got)
  const wantStr = JSON.stringify(c.want)
  const ok = gotStr === wantStr
  if (!ok) fallos++
  console.log(`${ok ? '✅' : '❌'} ${c.nombre}${c.bug ? ` [${c.bug}]` : ''}`)
  if (!ok) console.log(`   esperado: ${wantStr}\n   obtenido: ${gotStr}`)
}

console.log(`\n${casos.length - fallos}/${casos.length} casos pasaron.`)
if (fallos > 0) {
  console.log(`\n⚠️  ${fallos} caso(s) fallaron — probablemente un fix viejo se rompió.`)
  process.exit(1)
}
