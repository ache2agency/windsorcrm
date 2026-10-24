// Fases de conversación que antes se guardaban todas como 'seguimiento' (oct-2026).
// Se separaron solo para que el CRM muestre qué pasa con el lead; la lógica del bot
// las sigue tratando como 'seguimiento' (ver faseLogica), así que el flujo no cambia.
export const FASES_TIPO_SEGUIMIENTO = [
  'seguimiento',   // legado / GPT / campañas
  'inscribiendo',  // "ya pagué", "ya llené", eligió presencial/online
  'pendiente',     // el bot no reconoció el programa y alertó a un asesor
  'con_asesor',    // un asesor le escribió (plantilla o conversación nueva desde el CRM)
  'vacante',       // busca trabajo, no es prospecto
  'archivado',     // "quizás más adelante"
] as const

export function faseLogica(fase: string): string {
  return (FASES_TIPO_SEGUIMIENTO as readonly string[]).includes(fase) ? 'seguimiento' : fase
}

// Fases en las que el lead espera a una persona: si un asesor le escribe, pasa a 'con_asesor'.
export const FASES_ESPERAN_ASESOR = ['pendiente', 'asesor']

// Etiqueta de una palabra para el CRM.
export const ETIQUETA_FASE: Record<string, string> = {
  saludo: 'Saludo',
  programa: 'Programa',
  verano_disambig: 'Programa',
  datos: 'Programa',
  info_programa: 'Programa',
  correo: 'Correo',
  info_enviada: 'Info',
  dudas: 'Dudas',
  convenios: 'Dudas',
  accion: 'Decidiendo',
  examen: 'Examen',
  clase_prueba: 'Clase',
  inscripcion_programa: 'Inscribiéndose',
  inscripcion: 'Inscribiéndose',
  inscripcion_pendiente: 'Inscribiéndose',
  inscribiendo: 'Inscribiéndose',
  asesor: 'Pendiente',     // el lead pidió hablar con una persona
  pendiente: 'Pendiente',
  con_asesor: 'Asesor',
  archivado: 'Archivado',
  vacante: 'Vacante',
  seguimiento: 'Seguimiento',
  cerrado: 'Cerrada',      // se despidió; NO significa inscrito
  perdido: 'Perdido',
  nota: 'Nota',
}

export function etiquetaFase(fase: string | null | undefined): string {
  if (!fase) return 'Sin fase'
  return ETIQUETA_FASE[fase] || fase
}
