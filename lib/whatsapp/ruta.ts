import { hasLeadName } from './nombres'
import { tipoInscripcion, modalidadesPrograma } from './programas'
// Catálogo compartido por bot, motor, Kanban y analítica. Añadir pasos no exige columnas nuevas.
export const PASOS = [
  ['Nuevo','Escribió por primera vez'], ['Nombre','Sabemos cómo se llama'],
  ['Correo','Correo para seguimiento'], ['Oferta educativa','Programa elegido; inglés incluye edad'],
  ['Modalidad','Presencial, en línea o sabatino'], ['Info enviada','Información y precios entregados'],
  ['Dudas','Preguntas después de la información'], ['Convenio o descuento','Revisión de beneficio aplicable'],
  ['Decidiendo','Tiene información para decidir'], ['Examen de ubicación agendado','Cita confirmada'],
  ['Clase de prueba agendada','Cita confirmada'], ['Asistió','Asistencia registrada'],
  ['Quiere inscribirse','Link de su programa entregado'], ['Formulario recibido','Solicitud vinculada por teléfono'],
  ['Documentos completos','Drive verificado contra requisitos'], ['Canalizado','Aviso UTILITY entregado a Harold'],
  ['Inscrito','Una persona confirmó la inscripción'],
].map(([nombre, descripcion], i) => ({ n: i + 1, nombre, descripcion, opcional: [7,8,10,11,12].includes(i + 1) }))
export const BLOQUES = [
  { nombre:'Contacto', pasos:[1,2,3,4,5], color:'#2C4A8C', bg:'#eef2fb' },
  { nombre:'Información', pasos:[6,7,8,9], color:'#c2410c', bg:'#ffedd5' },
  { nombre:'Agenda', pasos:[10,11,12], color:'#b45309', bg:'#fef3c7' },
  { nombre:'Inscripción', pasos:[13,14,15,16], color:'#15803d', bg:'#dcfce7' },
  { nombre:'Inscrito', pasos:[17], color:'#15803d', bg:'#dcfce7' },
]
export type EstadoPaso = { estado:'cumplido'|'saltado'; fecha:string; motivo?:string; fuente:string }
export type Ruta = {
  pasos: Record<string, EstadoPaso>; dudas:string[]; salida?:'archivado'|'perdido'|'vacante'|null;
  persona?:string|null; quiereInscribirse?:boolean; faltantes?:string[]; infoPendiente?:boolean;
}
export type LeadRuta = { id?:string; nombre?:string|null; email?:string|null; curso?:string|null; whatsapp?:string|null;
  modalidad?:string|null; edad?:number|null; stage?:string|null; paso?:number; ruta?:Ruta; ruta_version?:number;
  created_at?:string; asignado_a?:string; origen?:string; paso_desde?:string; updated_at?:string }
export const normalizar = (s:string) => s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
export const bloqueDe = (n:number) => BLOQUES.find(b=>b.pasos.includes(n)) || BLOQUES[0]
export function rutaVacia():Ruta { return { pasos:{}, dudas:[] } }
export function marcar(ruta:Ruta, n:number, estado:EstadoPaso['estado'], fecha:string, fuente:string, motivo?:string):Ruta {
  if (n===17 && fuente!=='persona') throw new Error('Inscrito requiere una persona')
  const anterior = ruta.pasos[n] as EstadoPaso|undefined
  if (anterior?.estado==='cumplido' || (anterior?.estado===estado)) return ruta
  if (estado==='saltado' && !motivo) throw new Error('Todo salto requiere motivo')
  return { ...ruta, pasos:{...ruta.pasos,[n]:{estado,fecha,fuente,...(motivo?{motivo}:{})}} }
}
export const pasoActual = (r:Ruta) => Math.max(1,...Object.keys(r.pasos).filter(k=>r.pasos[k].estado==='cumplido').map(Number))
export const siguientePaso = (r:Ruta) => PASOS.find(p=>!r.pasos[p.n])?.n ?? null
export function temasDuda(texto:string):string[] {
  const t=normalizar(texto)
  return Object.entries({horario:/horario|hora |sabado|domingo/,precio:/precio|costo|cuanto|mensualidad|pago/,
    requisitos:/requisito|documento|acta|certificado/,ubicación:/ubicacion|direccion|donde|domicilio/,
    convenio:/convenio|descuento|beca|suspeg/,inicio:/cuando|inicio|empieza|inicia/}).filter(([,rx])=>(rx as RegExp).test(t)).map(([k])=>k)
}
export function faseParaRuta(r:Ruta):string {
  if(r.salida==='archivado') return 'archivado'
  if(r.salida==='perdido'||r.salida==='vacante') return r.salida
  const n=siguientePaso(r)
  return n===2?'saludo':n===3?'correo':n===4||n===5?'programa':n===6?'info_enviada':n&&n>=13?'inscribiendo':'accion'
}
export function preguntaPendiente(r:Ruta, lead:LeadRuta):string {
  const n=siguientePaso(r)
  if(n===2) return '¿Me compartes tu nombre?'
  if(n===3) return '¿Me compartes tu correo electrónico?'
  if(n===4) return /ingles/.test(normalizar(lead.curso||'')) && !lead.edad ? '¿Para qué edad es el curso?' : '¿Qué programa te interesa? Bachillerato, licenciaturas, maestrías, idiomas o diplomados.'
  if(n===5) { const opciones=modalidadesPrograma(lead.curso); return opciones ? `¿Qué modalidad prefieres: ${opciones.join(' / ')}?` : '¿En qué modalidad te interesa estudiar?' }
  if(n===6) return 'Te comparto la información del programa.'
  if(n===7||n===8||n===9) return '¿Tienes alguna duda o quieres iniciar tu inscripción? Si tienes convenio o beca, dime cuál para revisarlo.'
  if(n===10||n===11||n===12) return '¿Quieres agendar examen de ubicación, clase de prueba o iniciar tu inscripción?'
  if(n===13) return '¿Quieres iniciar tu inscripción?'
  if(n===14) return 'Completa el formulario de tu programa para continuar tu inscripción.'
  if(n===15) return `Para continuar faltan: ${(r.faltantes||['revisión de documentos en Drive']).join(', ')}.`
  if(n===16) return 'Tus documentos están completos; está pendiente el aviso al área de inscripciones.'
  if(n===17) return 'El área de inscripciones revisará el pago y te dará la bienvenida.'
  return 'Tu inscripción está confirmada. ¿En qué te ayudo?'
}
// Este reductor nunca infiere cumplimiento por la intención "ya pagué". Solo evidencia de sistema.
export function capturarEntrada(lead:LeadRuta, texto:string, datos:Partial<LeadRuta>, ahora:string):{ruta:Ruta; datos:Partial<LeadRuta>} {
  let r:Ruta=structuredClone(lead.ruta||rutaVacia()); const t=normalizar(texto)
  const l={...lead,...datos}
  const opciones=modalidadesPrograma(l.curso)
  if(opciones?.length===1) {datos={...datos,modalidad:opciones[0]};l.modalidad=opciones[0]}
  if(r.persona && personaVencida(r.persona,ahora)) r.persona=null
  if(r.salida==='archivado' && texto.trim()) r.salida=null
  if(r.salida==='perdido'||r.salida==='vacante') return {ruta:r,datos:{}}
  const mark=(n:number)=>{r=marcar(r,n,'cumplido',ahora,'bot')}
  const skip=(n:number,motivo:string)=>{r=marcar(r,n,'saltado',ahora,'bot',motivo)}
  mark(1)
  if(hasLeadName(l.nombre,l.whatsapp)) mark(2)
  if(l.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email) && r.pasos[2]) mark(3)
  if(r.pasos[3] && l.curso && tipoInscripcion(l.curso)!=='desconocido' && !/^(licenciaturas?|diplomados?|maestrias?|idiomas?)$/i.test(normalizar(l.curso)) && !/instituto windsor|sin definir/i.test(l.curso) && (!/ingles/.test(normalizar(l.curso)) || /licenciatura|diplomado|maestria/.test(normalizar(l.curso)) || l.edad || /adultos|ninos/.test(normalizar(l.curso)))) mark(4)
  if(l.modalidad && r.pasos[4]) mark(5)
  const temas=temasDuda(texto); r.dudas=[...new Set([...r.dudas,...temas])]
  if(temas.length && r.pasos[6]?.estado==='cumplido') mark(7)
  if(/quiero inscrib|me (quiero )?inscrib|inscribirme|registrarme|ya tengo mis documentos/.test(t)) r.quiereInscribirse=true
  // "No, gracias" a secas: con la info ya enviada equivale a "no tengo dudas" (sigue la ruta); antes de la info es un rechazo.
  const noGracias=/^no,? gracias[.!\s]*$/.test(t.trim())
  if(r.pasos[6]?.estado==='cumplido' && (noGracias || /no (tengo |hay )?dudas|todo claro|no tengo convenio|sin convenio|lo (voy a )?pensar|estoy pensando/.test(t))) {
    for(const n of [7,8]) if(!r.pasos[n]) skip(n,'El lead no reportó dudas ni convenio pendiente')
    mark(9)
  }
  // Si lo que se pidió fue el correo, "no, gracias" es negarse a darlo: se salta y la ruta sigue.
  if(noGracias && !r.pasos[6] && siguientePaso(r)===3) skip(3,'El lead prefirió no dar su correo')
  const rechazo = (noGracias && !r.pasos[6] && !r.pasos[3]?.motivo?.includes('prefirió no dar')) || !/[?¿]/.test(t) && !temas.length && !/no (tengo |hay )?dudas/.test(t) && /^(?:(?:ya )?no me interesa|ya no quiero|ya no,? gracias|mas adelante te escribo|quizas? mas adelante|aun lo estoy pensando|tal vez el proximo ano)(?:[, ]+gracias)?[.!\s]*$/.test(t.trim())
  if(rechazo) r.salida='archivado'
  // Rechazo requiere revisión humana para Perdido; el bot conserva el paso y detiene seguimiento.
  if(/(?:quiero|quisiera|necesito|puedo|podria) hablar con (?:un |una |el |la )?(?:asesor|persona|humano)|(?:me puede|puede|podria|que me) llamar (?:alguien|un asesor|una persona)|no quiero hablar con (?:un |el )?bot/.test(t)) r.persona=ahora
  if(/busco trabajo|solicito empleo|vacantes? (?:de|para) (?:maestr[oa]|docente)|(?:estan|estais) contratando/.test(t)) r.salida='vacante'
  if(r.quiereInscribirse && r.pasos[6]?.estado==='cumplido') {
    for(const n of [7,8,9,10,11,12]) if(!r.pasos[n]) skip(n,n>=10?'Agenda opcional: eligió inscripción directa':'Eligió inscribirse sin esta interacción')
  }
  return {ruta:r,datos}
}
export function inferirEdad(texto:string):number|null {
  const m=normalizar(texto).match(/(?:^|\b)(\d{1,3})\s*(?:anos|anitos|$)/)
  const n=m?Number(m[1]):0; return n>=1&&n<=110?n:null
}
export const equivalenciaFase:Record<string,number|null> = {
  saludo:1,programa:2,verano_disambig:4,datos:2,info_programa:4,correo:2,info_enviada:6,dudas:7,
  convenios:8,accion:9,examen:9,clase_prueba:9,inscripcion_programa:4,inscripcion:13,inscripcion_pendiente:13,
  inscribiendo:13,asesor:null,pendiente:null,con_asesor:null,archivado:null,vacante:null,seguimiento:null,cerrado:null,perdido:null,
}

// Se invoca solo sin modo humano activo; fechas históricas desconocidas no bloquean.
export function personaVencida(persona:string, ahora:string):boolean {
 const fecha=Date.parse(persona);return !Number.isFinite(fecha)||Date.parse(ahora)-fecha>=20*3600_000
}
