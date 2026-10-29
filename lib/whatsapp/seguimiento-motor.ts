import { esDiplomado, tipoInscripcion } from './programas'
import { esTrackA, obtenerMensajeReactivacion20h } from './reactivacion-messages'
import { buildMensajeDudasDiplomado20h, buildMensajeReactivacionDiplomado20h } from './reactivacion-diplomados'
import { INFO_MSGS, buildCTA } from './infoMsgs'
import { urlInscripcion } from '../inscripcion/enlace'

// Migración gradual (Harold 16-oct): mientras INSCRIPCION_FORMULARIO_BOT no sea 'on',
// el bot sigue mandando la página de Windsor con los Google Forms; el formulario nuevo
// (/inscripcion/...) solo lo comparten los asesores a mano para probarlo.
export function formularioNuevoEnBot() {
  return process.env.INSCRIPCION_FORMULARIO_BOT?.trim() === 'on'
}

export function mensajeDocumentosInscripcion(lead: LeadSeguimiento) {
  if (!formularioNuevoEnBot()) {
    return `¡Perfecto! 😊 Sube tus documentos en el formulario de inscripción de tu programa:\nhttps://www.windsor.edu.mx/solicitud-de-inscripcion\n\nCuando lo termines, avísanos por aquí para que un asesor revise tu proceso.`
  }
  return `¡Perfecto! 😊 Completa tu solicitud y sube tus documentos aquí:\n${urlInscripcion(lead.curso, lead.whatsapp, lead.nombre)}\n\nAl enviarla, un asesor revisará tus documentos y pago para continuar tu inscripción.`
}

export type CarrilSeguimiento = 'A' | 'B' | 'C'
export type TipoAccionSeguimiento = 'texto' | 'template' | 'archivar' | 'perder' | 'aviso_asesor'

export type LeadSeguimiento = {
  nombre?: string | null
  whatsapp?: string | null
  curso?: string | null
  stage?: string | null
}

export type ContextoSeguimiento = {
  fase: string
  lead: LeadSeguimiento
  horasDesdeLead: number
  horasDesdeBot: number
  diasDesdeLead: number
  dentroVentana24h: boolean
  ultimoBotFuePreguntaDato?: boolean
  yaRecibioInfo?: boolean
  yaTienePrograma?: boolean
  yaTieneNombre?: boolean
  ultimoTextoUsuario?: string | null
  ahora?: Date
}

export type DecisionSeguimiento = {
  accion: TipoAccionSeguimiento
  reglaId: string
  etapa: string
  carril: CarrilSeguimiento
  detalle: string
  mensaje?: string
  templateName?: string
  templateParams?: string[]
  nuevaFase?: string
  nuevoStage?: string
  avisoAsesor?: boolean
}

export const FASES_MOTOR_SEGUIMIENTO = [
  'saludo',
  'programa',
  'correo',
  'info_enviada',
  'dudas',
  'accion',
  'seguimiento',
  'examen',
  'clase_prueba',
  'inscripcion',
  'inscripcion_pendiente',
  'inscribiendo',
  'pendiente',
  'asesor',
  'con_asesor',
  'archivado',
  'cerrado',
]

const FASES_NUEVO = new Set(['saludo', 'programa', 'correo'])
const FASES_INFORMADO = new Set(['info_enviada', 'dudas', 'accion', 'seguimiento'])
const FASES_AGENDADO = new Set(['examen', 'clase_prueba'])
const FASES_INSCRIBIENDO = new Set(['inscripcion', 'inscripcion_pendiente', 'inscribiendo'])
const FASES_ASESOR = new Set(['pendiente', 'asesor', 'con_asesor'])
const FASES_ARCHIVADO = new Set(['archivado', 'cerrado'])
const FASES_EXCLUIDAS = new Set(['perdido', 'inscrito', 'vacante', 'nota'])

export function horaMexico(date: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    hour: 'numeric',
    hour12: false,
  }).format(date)) % 24
}

export function dentroHorarioMexico(date: Date): boolean {
  const h = horaMexico(date)
  return h >= 8 && h < 21
}

export function inicioDiaMexicoIso(date: Date): string {
  // No interpretar la hora de México como hora local del servidor (Vercel usa UTC).
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(date)
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)!.value
  const offset = valor('timeZoneName').replace('GMT', '') || 'Z'
  return new Date(`${valor('year')}-${valor('month')}-${valor('day')}T00:00:00${offset}`).toISOString()
}

export function clasificarCarril(curso: string | null | undefined): CarrilSeguimiento {
  if (esDiplomado(curso)) return 'C'
  if (esTrackA(curso)) return 'A'
  return 'B'
}

function primerNombre(nombre: string | null | undefined): string {
  return (nombre || '').trim().split(/\s+/)[0]?.replace(/[.,;:]+$/, '') || ''
}

function saludo(nombre: string | null | undefined): string {
  const n = primerNombre(nombre)
  return n ? `¡Hola ${n}! 😊` : '¡Hola! 😊'
}

function paramsNombreDiplomado(ctx: ContextoSeguimiento): string[] {
  const n = primerNombre(ctx.lead.nombre) || 'Windsor'
  return [n, ctx.lead.curso || 'tu diplomado']
}

function templateNombre(ctx: ContextoSeguimiento): string[] {
  return [primerNombre(ctx.lead.nombre) || 'Windsor']
}

function mensajeFichaPrograma(ctx: ContextoSeguimiento): DecisionSeguimiento | null {
  const curso = ctx.lead.curso || null
  const carril = clasificarCarril(curso)
  const base = decisionBase(ctx, 'nuevo_20h_ficha', 'Nuevo', carril)

  const diplomado = buildMensajeReactivacionDiplomado20h({
    curso,
    nombre: ctx.lead.nombre || null,
    whatsapp: ctx.lead.whatsapp || null,
  })
  if (diplomado) {
    return { ...base, accion: 'texto', mensaje: diplomado, nuevaFase: 'accion', detalle: '20h con plan/precio de diplomado' }
  }

  if (curso && INFO_MSGS[curso]) {
    const fichaSinSaludo = INFO_MSGS[curso].replace(/^[^\n]*\n\n/, '')
    return {
      ...base,
      accion: 'texto',
      mensaje: `${saludo(ctx.lead.nombre)} Te comparto la información que nos pediste:\n\n${fichaSinSaludo}${buildCTA(curso)}`,
      nuevaFase: 'accion',
      detalle: '20h con ficha del programa',
    }
  }

  return null
}

function mensaje20hInformado(ctx: ContextoSeguimiento): DecisionSeguimiento {
  const carril = clasificarCarril(ctx.lead.curso)
  const base = decisionBase(ctx, 'informado_20h_texto', 'Informado', carril)
  if (carril === 'C') {
    const msg = buildMensajeDudasDiplomado20h({
      curso: ctx.lead.curso || null,
      nombre: ctx.lead.nombre || null,
      whatsapp: ctx.lead.whatsapp || null,
    })
    if (msg) return { ...base, accion: 'texto', mensaje: msg, detalle: '20h diplomado: duda abierta sin reenviar líneas internas' }
  }
  return {
    ...base,
    accion: 'texto',
    mensaje: obtenerMensajeReactivacion20h(ctx.fase, carril === 'A', ctx.lead.nombre || ''),
    detalle: '20h informado dentro de ventana',
  }
}

function decisionBase(ctx: ContextoSeguimiento, reglaId: string, etapa: string, carril = clasificarCarril(ctx.lead.curso)): Omit<DecisionSeguimiento, 'accion' | 'detalle'> {
  return { reglaId, etapa, carril }
}

function decisionBacklogMayor30(ctx: ContextoSeguimiento, fase: string, carril: CarrilSeguimiento): DecisionSeguimiento | null {
  if (ctx.diasDesdeLead <= 30) return null

  if (FASES_NUEVO.has(fase)) {
    const templateName = ctx.yaTienePrograma ? 'windsor_bienvenida_lead_manual' : 'windsor_elige_programa'
    return {
      ...decisionBase(ctx, ctx.yaTienePrograma ? 'backlog30_nuevo_info' : 'backlog30_nuevo_menu', 'Nuevo', carril),
      accion: 'template',
      templateName,
      templateParams: templateName === 'windsor_bienvenida_lead_manual' ? templateNombre(ctx) : [],
      detalle: 'backlog >30 dias: un solo mensaje de rescate',
    }
  }

  if (FASES_INFORMADO.has(fase)) {
    return {
      ...decisionBase(ctx, carril === 'C' ? 'backlog30_informado_c' : 'backlog30_informado_ab', 'Informado', carril),
      accion: 'template',
      templateName: carril === 'C' ? 'windsor_diplomado_beneficios' : 'windsor_promo',
      templateParams: carril === 'C' ? paramsNombreDiplomado(ctx) : templateNombre(ctx),
      detalle: 'backlog >30 dias: un solo mensaje de rescate',
    }
  }

  if (FASES_AGENDADO.has(fase)) {
    return {
      ...decisionBase(ctx, 'backlog30_agendado', 'Agendado', 'A'),
      accion: 'template',
      templateName: 'windsor_examen_clase',
      templateParams: templateNombre(ctx),
      detalle: 'backlog >30 dias: un solo mensaje de rescate',
    }
  }

  if (FASES_INSCRIBIENDO.has(fase)) {
    return {
      ...decisionBase(ctx, 'backlog30_inscribiendo', 'Inscribiendose', carril),
      accion: 'template',
      templateName: 'windsor_inscripcion_pendiente_',
      templateParams: templateNombre(ctx),
      avisoAsesor: true,
      detalle: 'backlog >30 dias: un solo mensaje de rescate + aviso asesor',
    }
  }

  if (FASES_ARCHIVADO.has(fase)) {
    return {
      ...decisionBase(ctx, 'backlog30_archivado', 'Archivado', carril),
      accion: 'template',
      templateName: 'windsor_reactivacion_seguimiento',
      templateParams: templateNombre(ctx),
      detalle: 'backlog >30 dias: un solo mensaje de rescate',
    }
  }

  return null
}

export function decidirSeguimientoAutomatico(ctx: ContextoSeguimiento): DecisionSeguimiento | null {
  const fase = String(ctx.fase || '').trim() || 'saludo'
  const carril = clasificarCarril(ctx.lead.curso)

  if (esCanalInternoSeguimiento(ctx.lead.whatsapp)) return null
  if (FASES_EXCLUIDAS.has(fase)) return null
  if (ctx.lead.stage && ['perdido', 'inscrito'].includes(ctx.lead.stage)) return null

  if (FASES_ASESOR.has(fase)) {
    if (ctx.horasDesdeLead >= 2) {
      return {
        ...decisionBase(ctx, 'asesor_2h_alerta', 'Pendiente/Asesor', carril),
        accion: 'aviso_asesor',
        avisoAsesor: true,
        detalle: 'asesor sin respuesta humana en 2h',
      }
    }
    return null
  }

  const backlog = decisionBacklogMayor30(ctx, fase, carril)
  if (backlog) return backlog

  if (FASES_NUEVO.has(fase)) {
    if (ctx.diasDesdeLead >= 5) {
      return { ...decisionBase(ctx, 'nuevo_dia5_archivar', 'Nuevo', carril), accion: 'archivar', nuevaFase: 'archivado', nuevoStage: 'archivado', detalle: 'Nuevo sin respuesta al dia 5' }
    }
    if (ctx.diasDesdeLead >= 2) {
      const templateName = ctx.yaTienePrograma ? 'windsor_bienvenida_lead_manual' : 'windsor_elige_programa'
      return {
        ...decisionBase(ctx, ctx.yaTienePrograma ? 'nuevo_dia2_template_info' : 'nuevo_dia2_template_menu', 'Nuevo', carril),
        accion: 'template',
        templateName,
        templateParams: templateName === 'windsor_bienvenida_lead_manual' ? templateNombre(ctx) : [],
        detalle: ctx.yaTienePrograma ? 'dia 2 con programa conocido' : 'dia 2 sin programa conocido',
      }
    }
    if (ctx.dentroVentana24h && ctx.horasDesdeLead >= 20) {
      const ficha = ctx.yaTienePrograma ? mensajeFichaPrograma(ctx) : null
      if (ficha) return ficha
      return {
        ...decisionBase(ctx, 'nuevo_20h_menu', 'Nuevo', carril),
        accion: 'texto',
        mensaje: `${saludo(ctx.lead.nombre)} Con gusto te comparto la información. ¿Qué programa te interesa?\n\n• Bachillerato\n• Licenciaturas\n• Maestrías\n• Idiomas\n• Diplomados`,
        nuevaFase: 'programa',
        detalle: '20h sin programa: menu de oferta',
      }
    }
    if (ctx.dentroVentana24h && ctx.horasDesdeBot >= 3 && ctx.ultimoBotFuePreguntaDato && !ctx.yaRecibioInfo) {
      const dato = fase === 'saludo' ? 'tu nombre' : fase === 'correo' ? 'tu correo (si prefieres, te atiendo por aqui)' : 'que programa te interesa'
      return {
        ...decisionBase(ctx, 'nuevo_3h_dato', 'Nuevo', carril),
        accion: 'texto',
        mensaje: `${saludo(ctx.lead.nombre)} Para ayudarte mejor, me faltaria confirmar ${dato}.`,
        detalle: '3h pidiendo dato pendiente',
      }
    }
    return null
  }

  if (FASES_INFORMADO.has(fase)) {
    if (ctx.diasDesdeLead >= 10) {
      return { ...decisionBase(ctx, 'informado_dia10_archivar', 'Informado', carril), accion: 'archivar', nuevaFase: 'archivado', nuevoStage: 'archivado', detalle: 'Informado sin respuesta al dia 10' }
    }
    if (ctx.diasDesdeLead >= 7) {
      return {
        ...decisionBase(ctx, carril === 'C' ? 'informado_c_dia7_template' : 'informado_ab_dia7_template', 'Informado', carril),
        accion: 'template',
        templateName: carril === 'C' ? 'windsor_diplomado_beneficios' : 'windsor_promo',
        templateParams: carril === 'C' ? paramsNombreDiplomado(ctx) : templateNombre(ctx),
        detalle: 'dia 7 informado',
      }
    }
    if (ctx.diasDesdeLead >= 3) {
      return {
        ...decisionBase(ctx, carril === 'C' ? 'informado_c_dia3_template' : 'informado_ab_dia3_template', 'Informado', carril),
        accion: 'template',
        templateName: carril === 'C' ? 'windsor_diplomado_seguimiento' : 'seguimiento_general',
        templateParams: carril === 'C' ? paramsNombreDiplomado(ctx) : templateNombre(ctx),
        detalle: 'dia 3 informado',
      }
    }
    if (ctx.dentroVentana24h && ctx.horasDesdeLead >= 20) return mensaje20hInformado(ctx)
    return null
  }

  if (FASES_AGENDADO.has(fase)) {
    if (ctx.diasDesdeLead >= 7) {
      return { ...decisionBase(ctx, 'agendado_dia7_archivar', 'Agendado', 'A'), accion: 'archivar', nuevaFase: 'archivado', nuevoStage: 'archivado', detalle: 'Agendado sin respuesta al dia 7' }
    }
    if (ctx.diasDesdeLead >= 2) {
      return {
        ...decisionBase(ctx, 'agendado_dia2_template', 'Agendado', 'A'),
        accion: 'template',
        templateName: 'windsor_examen_clase',
        templateParams: templateNombre(ctx),
        detalle: 'dia 2 examen/clase',
      }
    }
    if (ctx.dentroVentana24h && ctx.horasDesdeLead >= 20) {
      return {
        ...decisionBase(ctx, 'agendado_20h_texto', 'Agendado', 'A'),
        accion: 'texto',
        mensaje: `${saludo(ctx.lead.nombre)} ¿Ya agendaste tu examen de ubicación? Este mes es gratis (normalmente cuesta $100) y nos ayuda a colocarte en el nivel correcto. ¿Te comparto el link?`,
        detalle: '20h examen gratis',
      }
    }
    return null
  }

  if (FASES_INSCRIBIENDO.has(fase)) {
    const pidioMasTiempo = /necesito\s+m[aá]s\s+tiempo/i.test(ctx.ultimoTextoUsuario || '')
    if (pidioMasTiempo && ctx.diasDesdeLead >= 7) {
      return {
        ...decisionBase(ctx, 'inscribiendo_mas_tiempo_dia7', 'Inscribiendose', carril),
        accion: 'template',
        templateName: 'windsor_inscripcion_pendiente_',
        templateParams: templateNombre(ctx),
        detalle: 'recordatorio a 7 dias por necesito mas tiempo',
      }
    }
    if (ctx.diasDesdeLead >= 3) {
      return {
        ...decisionBase(ctx, 'inscribiendo_dia3_template_alerta', 'Inscribiendose', carril),
        accion: 'template',
        templateName: 'windsor_inscripcion_pendiente_',
        templateParams: templateNombre(ctx),
        avisoAsesor: true,
        detalle: 'dia 3 inscribiendose + aviso asesor',
      }
    }
    if (ctx.dentroVentana24h && ctx.horasDesdeLead >= 20) {
      return {
        ...decisionBase(ctx, 'inscribiendo_20h_texto', 'Inscribiendose', carril),
        accion: 'texto',
        mensaje: obtenerMensajeReactivacion20h('inscripcion', carril === 'A', ctx.lead.nombre || ''),
        detalle: '20h proceso de inscripcion',
      }
    }
    return null
  }

  if (FASES_ARCHIVADO.has(fase)) {
    if (ctx.diasDesdeLead >= 90) {
      return { ...decisionBase(ctx, 'archivado_dia90_perder', 'Archivado', carril), accion: 'perder', nuevaFase: 'perdido', nuevoStage: 'perdido', detalle: 'Archivado/cerrado dia 90' }
    }
    if (ctx.diasDesdeLead >= 60) {
      return { ...decisionBase(ctx, 'archivado_dia60_promo', 'Archivado', carril), accion: 'template', templateName: 'windsor_promo', templateParams: templateNombre(ctx), detalle: 'Archivado/cerrado dia 60' }
    }
    if (ctx.diasDesdeLead >= 30) {
      return { ...decisionBase(ctx, 'archivado_dia30_reactivacion', 'Archivado', carril), accion: 'template', templateName: 'windsor_reactivacion_seguimiento', templateParams: templateNombre(ctx), detalle: 'Archivado/cerrado dia 30' }
    }
  }

  return null
}

export function faseEsDeMotor(fase: string | null | undefined): boolean {
  return FASES_MOTOR_SEGUIMIENTO.includes(String(fase || '').trim())
}

export function requiereLinkInscripcion(curso: string | null | undefined): boolean {
  return tipoInscripcion(curso) !== 'desconocido'
}

// Canal operativo; aceptar formato Meta, E.164 y el prefijo mexicano heredado.
export function esCanalInternoSeguimiento(whatsapp: string | null | undefined): boolean {
  const digits = String(whatsapp || '').replace(/\D/g, '').replace(/^521(?=\d{10}$)/, '52')
  return digits === '527474722466'
}

export function datoPendienteSeguimiento(fase: string | null): 'nombre' | 'correo' | 'programa' {
  return fase === 'saludo' ? 'nombre' : fase === 'correo' ? 'correo' : 'programa'
}

export function recordatorioDatoReciente(
  mensajes: Array<{ created_at: string; contenido: string | null; raw_payload?: Record<string, unknown> | null }>,
  fase: string,
  ahora: Date,
): boolean {
  const dato = datoPendienteSeguimiento(fase)
  return mensajes.some((m) => {
    const raw = m.raw_payload?.seguimiento_motor as Record<string, unknown> | undefined
    if (raw?.reglaId !== 'nuevo_3h_dato') return false
    // Compatibilidad con envíos anteriores a datoPendiente.
    const tipo = raw.datoPendiente || (/tu nombre/i.test(m.contenido || '') ? 'nombre'
      : /tu correo/i.test(m.contenido || '') ? 'correo' : 'programa')
    return tipo === dato && ahora.getTime() - new Date(m.created_at).getTime() < 24 * 3600_000
  })
}
