// Plan de estudios (PDF en Drive) de cada diplomado del catálogo. Antes no existía:
// las licenciaturas mandan su PDF desde INFO_MSGS, pero los diplomados responden por
// GPT+RAG y nunca incluían el plan (caso 1-oct-2026, prueba del anuncio de
// Tanatología: dio precios y duración pero no el PDF).
//
// Fuente: carpeta de Drive "Diplomados 2026" (16Bzi6eWHDv4nmEv1JY_AKXhX_HD7euv0),
// la misma a la que apuntan los botones "Plan de Estudios" de windsor.edu.mx.
// Llaves = nombres exactos de PROGRAMAS_DIPLOMADO (test:clasificacion verifica que
// no falte ninguno).

import { PROGRAMAS_DIPLOMADO, ALIAS_DIPLOMADO, normDiplomado } from './programas'

const DRIVE_ID_PLAN_DIPLOMADO: Record<string, string> = {
  'Salud pública': '1V8m9rOoVgyZhRc2Ik4zGYp_OJO4Fos2Q',
  'Nutrición y Dietética': '1uh6z-Kt-2C6Ig4XAC53I0IvUgTxBHwuq',
  'Nutrición deportiva': '1YCmijSTLNxHes1ffXgPR2PIBUTeYn2K0',
  'Ciencias del deporte': '16dUYho08pkwYbzp5ISF1thRzDlqBtEzR',
  'Enfermería': '1hnsvxjSkZVLC9lfXN2vt3I9kPmpHIEkx',
  'Farmacología': '10VmTr-H8lOu2urlEkC8A1D9rX5WBEakH',
  'Epidemiología': '1eY9exZqG7PSlXAe-7_rXP0NoJblPhlN8',
  'Gerontología': '1vYu11l8_AtcFXVIVk_j_SOIz2hTRfVau',
  'Integración de la Inteligencia Artificial en la Educación': '1VLqhw41iGQifa-Wcsd_0h5J9yb3mrt1y',
  'Enseñanza del idioma español': '1_p7JeFBxxlAXlqiEO1iuhO7kaHPewtIZ',
  'Enseñanza del idioma inglés': '11Mg5Lyr7B9m_6H3UxZUs4DCRTREVG9h2',
  'Competencias educativas': '1UPFCPEEyxdjz_IvO5AsUCrcdTh0wCAY6',
  'Tecnología educativa': '1zpGKJuznwx0TU0rdeGfQaUubdCAK3j3V',
  'Gamificación educativa': '1v6YbFF03uuMOw2i4P0UWhkE_l_4ABQmO',
  'Psicología educativa': '1Eqs2u2Lbl2sSeegBXkCR39V7XeWJYxsg',
  'Psicología criminológica': '1seVza32JkRmxwrcN0EQhalAchIq_Kch8',
  'Equidad de genero y diversidad sexual': '1K5-vepnAs4jN1YsO4pW7-HB2kXd1S2_4',
  'Terapia ocupacional': '1UCuR3tLYmQijxcCkQaWGE56pkih2ilIA',
  'Mindfulness': '1SLrGTRorKiuewcseezJwUEKHbU88_KC2',
  'Tanatología': '16OGCI6_hS8vsK0JpYdgfTL6S6FuU8hn5',
  'Innovación y Transformación del Talento Humano': '1xrjQXHn1PfM9mGZKxwrZVAX2nTX-gCL9',
  'Administración de recursos humanos': '1aViJY8DpwFnr94qlNHtygVKVq2SDiKIf',
  'Comunicación Estratégica y Liderazgo Empresarial': '19xTEQKStAhLBCXNhQ9sMszIKNEE401Ql',
  'Administración de Instituciones de Salud': '1wdfhEsc3skB-76la-DsbdKjUQmISlQxf',
  'Contabilidad': '1ge8CvVEPKfOY9A7iadt7pZb9QmSXEiC5',
  'Creación y dirección de franquicias': '1K8zjuNQAq8mp4swgfgnHGLcbDcl8-ypU',
  'Administración de restaurantes': '1n3NWHtj4SMqrsgxfxtg99opdGg-tSU6X',
  'Administración Pública': '1ddDI7V8EXC746qFm60Qh_wvor6JWmDr6',
  'Innovación y Gobierno Digital': '1OEiljo7r7iHB-XbfHwlp0Bf2LJK5aXxi',
  'Comunicación y Liderazgo en el Sector Público': '1mEtVY6Otv-3UXHWD865nKlLG08BsDQb_',
  'Políticas y Procesos de Participación Ciudadana': '1lGV9VPo44OC-IWNy4l5WG6mDJ_W7PwS1',
  'Análisis y Evaluación de Políticas Públicas': '16I_7oqS-psSJEAz1rsMEUrlP0DuabALA',
  'Realidad Virtual': '1xTucvL47weB5E1KeRSQjYNJXJ1xCg04O',
  'Inteligencia Artificial': '1vfwrkrVSeqV-gP6UE7VZUfpAfTrNJoNm',
  'Ciberseguridad': '1wj3mTmXiK57YlspjM9HHQZ2CErLAXrXZ',
  'Criptomonedas': '1H_CeXFivvt4Gl5ObFwx2znmRQQnlME-l',
  'Análisis de Datos': '1j-5XaNTVmKgKx11FPvVFNifew4JXrZ2d',
  'Machine Learning': '1SILxFcaFsLa_KVyZpwBXfmxrFeSLvdWJ',
  'Blockchain': '1nzaUj6CpK7AIOOiiNu8oDMRD4GH8HirQ',
  'Cloud Computing': '1GGTx5s_IYeJts013HzHQEQgoT0mVmVCY',
}

export function driveIdPlanDiplomado(nombre: string): string | null {
  return DRIVE_ID_PLAN_DIPLOMADO[nombre] ?? null
}

export function urlPlanDiplomado(nombre: string): string | null {
  const id = driveIdPlanDiplomado(nombre)
  return id ? `https://drive.google.com/file/d/${id}/view` : null
}

/** Diplomado del que habla una respuesta del bot, si es exactamente uno. Los nombres
 * largos se consumen primero para que "Integración de la Inteligencia Artificial en la
 * Educación" no cuente también como "Inteligencia Artificial". Si el texto menciona
 * varios (catálogo, menú por área) o no dice "diplomado", regresa null: no se manda
 * ningún PDF en vez de adivinar cuál. */
export function diplomadoUnicoEnRespuesta(texto: string): string | null {
  let norm = normDiplomado(texto.replace(/\*/g, ''))
  if (!/diplomado/.test(norm)) return null
  const candidatos: Array<[string, string]> = [
    ...ALIAS_DIPLOMADO,
    ...PROGRAMAS_DIPLOMADO.map(n => [n, n] as [string, string]),
  ].sort((a, b) => b[0].length - a[0].length)
  const encontrados = new Set<string>()
  for (const [variante, canonico] of candidatos) {
    const v = normDiplomado(variante)
    if (norm.includes(v)) {
      encontrados.add(canonico)
      norm = norm.split(v).join(' ')
    }
  }
  return encontrados.size === 1 ? [...encontrados][0] : null
}

/** WhatsApp usa *un* asterisco para negrita; GPT a veces responde con Markdown
 * (**negrita**, ### títulos) aunque REGLAS_NEGOCIO lo prohíbe, y el lead ve los
 * asteriscos sueltos (110 de 957 mensajes del bot, semana al 1-oct-2026). */
export function limpiarFormatoWhatsApp(texto: string): string {
  return texto
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
}
