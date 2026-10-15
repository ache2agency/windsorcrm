import { tipoInscripcion } from '../whatsapp/programas'
import type { ProgramaInscripcion } from './config'

export function urlInscripcion(curso?: string | null, whatsapp?: string | null, nombre?: string | null) {
  const tipo = tipoInscripcion(curso)
  const rutas: Partial<Record<typeof tipo, ProgramaInscripcion>> = {
    licenciatura: 'licenciaturas', diplomado: 'diplomados', idioma: 'cursos-libres', verano: 'verano', habilidades: 'cursos-libres',
  }
  const programa = /^(franc[eé]s|italiano)$/i.test((curso || '').trim()) ? 'cursos-libres' : rutas[tipo]
  // Bachillerato y programas no contemplados conservan la página de orientación.
  if (!programa) return 'https://www.windsor.edu.mx/solicitud-de-inscripcion'
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.windsor.edu.mx'
  const url = new URL(`/inscripcion/${programa}`, base)
  if (whatsapp) url.searchParams.set('wa', whatsapp)
  if (nombre) url.searchParams.set('nombre', nombre)
  if (curso) url.searchParams.set('curso', curso)
  return url.toString()
}
