import { ALIAS_DIPLOMADO, normDiplomado, PROGRAMAS_DIPLOMADO } from '../whatsapp/programas'

export type Campo = { id: string; label: string; type?: 'text' | 'email' | 'date' | 'number' | 'tel'; required?: boolean; options?: string[] }
export const PROGRAMAS_INSCRIPCION = ['licenciaturas', 'cursos-libres', 'diplomados', 'verano'] as const
export type ProgramaInscripcion = typeof PROGRAMAS_INSCRIPCION[number]
// Verano en pausa (Harold 16-oct): se arranca con licenciaturas, cursos libres y
// diplomados; falta cotejar su Google Form. Mientras, su ruta da 404 y el bot
// sigue mandando la página anterior.
export const PROGRAMAS_PAUSADOS: readonly ProgramaInscripcion[] = ['verano']
export function esPrograma(value: string): value is ProgramaInscripcion {
  return PROGRAMAS_INSCRIPCION.includes(value as ProgramaInscripcion) && !PROGRAMAS_PAUSADOS.includes(value as ProgramaInscripcion)
}
// Mismo catálogo que usa el bot, en orden alfabético para encontrarlo rápido.
export const OPCIONES_DIPLOMADO = [...PROGRAMAS_DIPLOMADO].sort((a, b) => a.localeCompare(b, 'es'))

/** Convierte el curso del lead ("Diplomado en Tanatología", alias viejos) a la opción del select. */
export function diplomadoCanonico(curso: string | null | undefined): string {
  const c = normDiplomado((curso || '').replace(/^diplomado( en)?/i, ''))
  if (!c) return ''
  const alias = ALIAS_DIPLOMADO.find(([v]) => normDiplomado(v) === c)
  if (alias) return alias[1]
  return PROGRAMAS_DIPLOMADO.find(n => normDiplomado(n) === c) || ''
}

const identidad: Campo[] = [
  { id: 'nombres', label: 'Nombre(s)', required: true },
  { id: 'apellido_paterno', label: 'Apellido paterno', required: true },
  { id: 'apellido_materno', label: 'Apellido materno' },
  { id: 'email', label: 'Correo electrónico', type: 'email', required: true },
  { id: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date', required: true },
  { id: 'telefono_casa', label: 'Teléfono de casa', type: 'tel' },
  { id: 'whatsapp', label: 'Teléfono móvil / WhatsApp', type: 'tel', required: true },
]
const lengua: Campo[] = [
  { id: 'lengua_indigena', label: '¿Habla alguna lengua indígena?', options: ['No', 'Sí'], required: true },
  { id: 'lengua_cual', label: 'Si contestaste Sí, ¿cuál lengua indígena?' },
  { id: 'medio', label: '¿Por qué medio te enteraste de la escuela?', required: true },
]
const escolar: Campo[] = [
  { id: 'edad', label: 'Edad', type: 'number', required: true },
  { id: 'curp', label: 'CURP', required: true },
  { id: 'direccion', label: 'Dirección (calle y número)', required: true },
  { id: 'ciudad', label: 'Dirección (ciudad y municipio)', required: true },
  { id: 'tutor', label: 'Tutor (nombre completo, si corresponde)' },
  { id: 'parentesco', label: 'Parentesco' },
  { id: 'tutor_casa', label: 'Teléfono de casa del tutor', type: 'tel' },
  { id: 'tutor_movil', label: 'Teléfono móvil del tutor', type: 'tel' },
  { id: 'curso', label: 'Curso o carrera solicitada', required: true },
  { id: 'modalidad', label: 'Modalidad', required: true },
]
export const TITULOS: Record<ProgramaInscripcion, string> = {
  licenciaturas: 'Licenciaturas', 'cursos-libres': 'Cursos de idiomas / cursos libres', diplomados: 'Diplomados', verano: 'Cursos de verano',
}
// Fuente: primera fila de las pestañas de respuestas LIC, CL y DIPLOMADOS,
// consultadas el 14-oct-2026. No se consultaron respuestas individuales.
export function camposPrograma(programa: ProgramaInscripcion): Campo[] {
  if (programa === 'diplomados') return [...identidad,
    { id: 'ciudad', label: 'Ciudad de residencia', required: true },
    { id: 'estado', label: 'Estado de residencia', required: true },
    { id: 'pais', label: 'País de residencia', required: true },
    { id: 'curso', label: 'Diplomado solicitado', required: true, options: OPCIONES_DIPLOMADO }, ...lengua]
  // Verano usa provisionalmente el contrato CL: falta cotejar el formulario
  // original protegido por Google. Ver docs/INSCRIPCIONES.md antes del merge.
  const campos = [...identidad, ...escolar, ...lengua]
  if (programa === 'licenciaturas') campos.push(
    { id: 'preparatoria', label: 'Nombre de preparatoria', required: true },
    { id: 'preparatoria_ciudad', label: 'Ciudad donde cursaste la preparatoria', required: true },
    { id: 'cuota_inscripcion', label: 'Cuota de inscripción' },
    { id: 'plan_pago', label: 'Plan de pago' },
  )
  return campos
}
export function documentosPrograma(programa: ProgramaInscripcion) {
  const docs = [
    { id: 'acta', label: 'Acta de nacimiento', required: true },
    { id: 'comprobante', label: 'Comprobante de pago', required: true },
    { id: 'curp_documento', label: 'Documento CURP', required: false },
    { id: 'ine', label: 'INE (del alumno o tutor)', required: false },
  ]
  if (programa === 'licenciaturas') docs.push({ id: 'certificado', label: 'Certificado de bachillerato', required: true })
  return docs
}
// Las fotos se comprimen en el navegador antes de enviar (lib/inscripcion/comprimir.ts);
// los PDF llegan tal cual. El total debe caber bajo el límite de 4.5 MB de Vercel.
export const MAX_ARCHIVO = 1.5 * 1024 * 1024
export const MAX_SOLICITUD = 4 * 1024 * 1024
