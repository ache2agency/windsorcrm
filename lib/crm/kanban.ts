// Siete etapas del MAPA_SEGUIMIENTO.md (decisiones Harold, 12-oct).
// Se conservan IDs de columnas existentes para compatibilidad con integraciones.
export const ETAPAS_KANBAN = [
  { id: 'primer_contacto', label: 'Nuevo', esperamos: 'Nombre + programa', color: '#2C4A8C', bg: '#eef2fb' },
  { id: 'segundo_contacto', label: 'Informado', esperamos: 'Que decida o pregunte', color: '#7c3aed', bg: '#ede9fe' },
  { id: 'examen_ubicacion', label: 'Agendado', esperamos: 'Que haga el examen o vaya a la clase · solo idiomas', color: '#b45309', bg: '#fef3c7' },
  { id: 'inscripcion_pendiente', label: 'Inscribiéndose', esperamos: 'Documentos + pago', color: '#92400e', bg: '#fef9c3' },
  { id: 'inscrito', label: 'Inscrito', esperamos: 'Bienvenida manual · cierre por asesor', color: '#15803d', bg: '#dcfce7' },
  { id: 'archivado', label: 'Archivado', esperamos: 'Reactivar más adelante', color: '#64748b', bg: '#f1f5f9' },
  { id: 'perdido', label: 'Perdido', esperamos: 'Sin seguimiento · decisión de un asesor', color: '#b91c1c', bg: '#fee2e2' },
] as const
export type EtapaKanban = typeof ETAPAS_KANBAN[number]['id']
const ALIAS: Record<string, EtapaKanban> = {
  nuevo: 'primer_contacto', contactado: 'primer_contacto', saludo: 'primer_contacto',
  informado: 'segundo_contacto', interesado: 'segundo_contacto', seguimiento: 'segundo_contacto',
  promocion_enviada: 'segundo_contacto', promo_enviada: 'segundo_contacto', tercer_contacto: 'segundo_contacto',
  agendado: 'examen_ubicacion', clase_muestra: 'examen_ubicacion', clase_prueba: 'examen_ubicacion',
  inscribiendose: 'inscripcion_pendiente', inscribiendo: 'inscripcion_pendiente', propuesta: 'inscripcion_pendiente',
  inscripcion: 'inscripcion_pendiente', cerrado: 'archivado',
}
export function normalizarEtapa(stage?: string | null): EtapaKanban {
  const s = String(stage || '').trim().toLowerCase()
  return ETAPAS_KANBAN.some(e => e.id === s) ? s as EtapaKanban : ALIAS[s] || 'primer_contacto'
}
export function esCursoIdioma(curso?: string | null) {
  const c = String(curso || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  return !/licenciatura|diplomado|maestria/.test(c) && /ingles|frances|italiano|idioma|verano|summer/.test(c)
}
export function etapaParaFase(fase?: string | null, curso?: string | null): EtapaKanban | null {
  if (['saludo','programa','correo','datos','info_programa','inscripcion_programa'].includes(fase || '')) return 'primer_contacto'
  if (['info_enviada','accion','dudas','seguimiento','convenios'].includes(fase || '')) return 'segundo_contacto'
  if (['examen','clase_prueba'].includes(fase || '')) return esCursoIdioma(curso) ? 'examen_ubicacion' : 'segundo_contacto'
  if (['inscripcion','inscripcion_pendiente','inscribiendo'].includes(fase || '')) return 'inscripcion_pendiente'
  if (['archivado','cerrado'].includes(fase || '')) return 'archivado'
  if (fase === 'perdido') return 'perdido' // Histórico/visual; el guard del bot lo rechaza.
  return null // Pendiente, asesor, con_asesor, vacante y nota no promueven tarjeta.
}
export function etapaTrasBot(actual: string | null | undefined, destino: string | null | undefined, curso?: string | null): EtapaKanban {
  const desde = normalizarEtapa(actual)
  if (!destino || ['inscrito','perdido'].includes(desde)) return desde
  const hasta = normalizarEtapa(destino)
  if (['inscrito','perdido'].includes(hasta)) return desde
  if (hasta === 'examen_ubicacion' && !esCursoIdioma(curso)) return desde
  // Archivado es reactivable: si el prospecto vuelve a escribir, retoma la
  // etapa que corresponde a la conversación y sale del conjunto inactivo.
  if (desde === 'archivado' && ['primer_contacto','segundo_contacto','examen_ubicacion','inscripcion_pendiente'].includes(hasta)) return hasta
  if (desde === 'inscripcion_pendiente' && hasta === 'archivado') return desde // El mapa dice que decide una persona.
  const ordenActivo: EtapaKanban[] = ['primer_contacto','segundo_contacto','examen_ubicacion','inscripcion_pendiente']
  if (hasta === 'archivado') return desde === 'archivado' ? desde : hasta
  return ordenActivo.indexOf(hasta) > ordenActivo.indexOf(desde) ? hasta : desde
}
// Solo para la migración inicial: combina historia comercial con la última fase,
// conservando la etapa más avanzada y los cierres explícitos de stage.
export function etapaMigrada(lead: { stage?: string | null; curso?: string | null }, fase?: string | null): EtapaKanban {
  let base = normalizarEtapa(lead.stage)
  if (base === 'inscrito' || base === 'perdido') return base
  if (base === 'examen_ubicacion' && !esCursoIdioma(lead.curso)) base = 'segundo_contacto'
  const porFase = etapaParaFase(fase, lead.curso)
  if (porFase === 'perdido') return 'perdido' // Backfill revisado/aplicado por Harold, no cierre automático nuevo.
  return etapaTrasBot(base, porFase, lead.curso)
}
