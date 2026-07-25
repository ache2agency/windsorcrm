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
} from '../lib/whatsapp/programas'

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
