import { TEXTO_HORARIO_ATENCION } from './reglasNegocio'
// Propuesta inicial de la tarea 10-bis: Harold debe confirmar estas dos fechas.
export const INHABILES_PROPUESTOS_2026=['2026-11-02','2026-11-16']
export function diasInhabiles(env:Record<string,string|undefined>=process.env):string[] {
  // Una lista vacía explícita desactiva la propuesta; nunca tomar fechas de un LLM.
  const valor=env.WINDSOR_DIAS_INHABILES
  const lista=valor===undefined?INHABILES_PROPUESTOS_2026:valor.split(',').map(s=>s.trim())
  return lista.filter(s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s)
}
export function horarioAtencion(ahora=new Date(),env:Record<string,string|undefined>=process.env):string {
  const dia=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(ahora)
  return diasInhabiles(env).includes(dia)?`Hoy (${dia}) no hay atención en plantel por día inhábil. Horario habitual en días hábiles: ${TEXTO_HORARIO_ATENCION}`:`Horario habitual en días hábiles: ${TEXTO_HORARIO_ATENCION}`
}
export const INICIO_INGLES_NINOS='La inscripción a Inglés para niños está abierta todo el año. Pueden incorporarse al grupo actual y el profesor les ayuda a ponerse al corriente. Los grupos totalmente nuevos inician a principios de año; la fecha exacta está por confirmar.'

export function avisoVisitaInhabil(texto:string,ahora=new Date(),env:Record<string,string|undefined>=process.env):string|null {
 const t=texto.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
 const base=new Date(ahora)
 if(/pasado manana/.test(t)) base.setUTCDate(base.getUTCDate()+2)
 else if(/manana/.test(t)) base.setUTCDate(base.getUTCDate()+1)
 else if(!/hoy/.test(t)) return null
 const dia=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(base)
 return diasInhabiles(env).includes(dia)?`El día de tu visita (${dia}) no hay atención en plantel por día inhábil. Podemos recibirte en un día hábil. ${horarioAtencion(base,env)}`:null
}
