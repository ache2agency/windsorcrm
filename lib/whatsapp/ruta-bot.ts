import { mensajeDocumentosInscripcion } from './seguimiento-motor'
import { inscripcionDiplomadoFormularioMsg, mensajeInscripcionPara, INSCRIPCION_ONLINE_MSG, INSCRIPCION_DESCONOCIDA_MSG } from './inscripcion'
import { tipoInscripcion, esTextoPrograma } from './programas'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cargarRuta,guardarRuta } from './ruta-servicio'
import { esPlanDeVisita, capturarEntrada, faseParaRuta, inferirEdad, marcar, normalizar, preguntaPendiente, siguientePaso, temasDuda, type LeadRuta } from './ruta'
import { urlInscripcion } from '../inscripcion/enlace'
import { hasLeadName } from './nombres'
const hasLeadProgram = (c?:string|null) => !!c && !/instituto windsor|sin definir/i.test(c) && (/^curso de ingl[eé]s$/i.test(c)||tipoInscripcion(c)!=='desconocido')

export type DependenciasRuta={
  acuse?:string;
  catalogoGeneral?:string;
  vacante?:string;
  detectarPrograma:(t:string)=>string|null;
  info:(curso:string,lead:LeadRuta)=>Promise<string>;
  duda:(texto:string,lead:LeadRuta)=>Promise<string>;
  catalogo?:(texto:string,lead:LeadRuta)=>string|null;
  agenda?:(texto:string)=>string;
  inscripcionPresencial?:(lead:LeadRuta)=>string;
  visita?:(lead:LeadRuta,texto:string)=>string;
}
export function datosEntrada(lead:LeadRuta,texto:string,detectarPrograma:DependenciasRuta['detectarPrograma']):Partial<LeadRuta> {
  const t=normalizar(texto); const datos:Partial<LeadRuta>={}
  const email=texto.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  if(email) datos.email=email
  // No confundir preguntas, decisiones, saludos ni programas con nombres.
  const nombre=texto.match(/(?:me llamo|mi nombre es|soy)\s+([\p{L} .'-]{2,70})/iu)?.[1]?.trim()
  const esNombreSolo=!esTextoPrograma(texto) && !/^(info|precio|ok|si|no|a|b|c|necesito mas tiempo|si,? enviame la info|tengo dudas)$/i.test(t.trim()) && siguientePaso(lead.ruta!)===2 && !/[?@\d]/.test(texto) && !/hola|buen|quiero|inscrib|curso|ingles|licenciatura|diplomado|gracias|hasta|adios|necesito|precio|horario|informacion/.test(t) && texto.trim().split(/\s+/).length<=5
  if(!esTextoPrograma(nombre||texto) && (nombre||esNombreSolo) && hasLeadName(nombre||texto,lead.whatsapp||'')) datos.nombre=nombre||texto.trim()
  const programa=detectarPrograma(texto)
  if(programa) datos.curso=programa
  if(/ingles/.test(t) && !/licenciatura|maestria|diplomado|adulto|ninos|infantil/.test(t) && !lead.edad && !inferirEdad(texto) && !hasLeadProgram(lead.curso)) datos.curso='Curso de inglés'
  else if(/(?:curso de )?ingles/.test(t) && !hasLeadProgram(lead.curso)) datos.curso='Curso de inglés'
  if(/en linea|online|a distancia/.test(t)) datos.modalidad='En línea'
  else if(/presencial/.test(t)) datos.modalidad='Presencial'
  else if(/sabatino/.test(t)) datos.modalidad='Sabatino'
  const curso=datos.curso||lead.curso||''
  if(/ingles/.test(normalizar(curso)) && !/licenciatura|diplomado|maestria/.test(normalizar(curso))) {
    const edad=inferirEdad(texto)
    if(edad) {datos.edad=edad;datos.curso=edad<=12?'Inglés para niños':'Inglés para adultos'}
    else if(/adulto/.test(t)) datos.curso='Inglés para adultos'
    else if(/ninos|infantil/.test(t)) datos.curso='Inglés para niños'
  }
  return datos
}
async function construirRespuestaRuta(db:SupabaseClient,id:string,texto:string,dep:DependenciasRuta) {
  let lead=await cargarRuta(db,id)
  if(esTextoPrograma(lead.nombre||'')||!hasLeadName(lead.nombre,lead.whatsapp||'')) lead.nombre=null
  if(!hasLeadProgram(lead.curso)) lead.curso=null
  if(lead.ruta?.salida==='perdido'||lead.ruta?.salida==='vacante') return null
  if(lead.ruta?.pasos[13] && tipoInscripcion(lead.curso)==='licenciatura' && /^[ab][).]?$/i.test(texto.trim())) {
    return {mensaje:/^a/i.test(texto)?`${INSCRIPCION_ONLINE_MSG}\n\n${urlInscripcion(lead.curso,lead.whatsapp,lead.nombre)}`:dep.inscripcionPresencial?.(lead)||preguntaPendiente(lead.ruta,lead),fase:faseParaRuta(lead.ruta)}
  }
  const now=new Date().toISOString()
  const textoRuta=lead.ruta?.pasos[6] && /^b[).]?$/i.test(texto.trim())?'quiero inscribirme':/^(?:quiero apartar mi lugar|no tengo dudas|ya tengo mis documentos)$/i.test(texto.trim())?'quiero inscribirme':texto
  const inscripcion=()=>{
    const tipo=tipoInscripcion(lead.curso)
    if(tipo==='desconocido') return INSCRIPCION_DESCONOCIDA_MSG
    if(/^ya tengo mis documentos$/i.test(texto.trim())) return `${mensajeDocumentosInscripcion(lead)}\n${urlInscripcion(lead.curso,lead.whatsapp,lead.nombre)}`
    if(tipo==='diplomado') return inscripcionDiplomadoFormularioMsg(lead)
    return `${mensajeInscripcionPara(tipo,lead)}\n\n${urlInscripcion(lead.curso,lead.whatsapp,lead.nombre)}`
  }
  const entrada=textoRuta==='__MEDIA__'||textoRuta==='__LOCATION__'?'':textoRuta
  const pasoAntes=lead.ruta?siguientePaso(lead.ruta):null
  const captura=capturarEntrada(lead,textoRuta,datosEntrada(lead,entrada,dep.detectarPrograma),now)
  let {ruta}=captura;const {datos}=captura
  // Con la info ya entregada, "voy mañana" es decisión de inscribirse en persona: se confirma, no se vuelve a preguntar.
  const visita=!!ruta.pasos[6] && !ruta.salida && !ruta.persona && esPlanDeVisita(entrada)
  if(visita) ruta=capturarEntrada({...lead,ruta:{...ruta,quiereInscribirse:true,visita:{texto:entrada.slice(0,120),fecha:now}}},'',{},now).ruta
  lead=await guardarRuta(db,lead,ruta,datos)
  if(visita && dep.visita) return {mensaje:dep.visita(lead,entrada),fase:faseParaRuta(ruta)}
  // Tras confirmar la visita, un "ok, gracias" no debe recibir otra vez la pregunta pendiente.
  if(ruta.visita && /^(?:ok(?:ey)?|okay|gracias|muchas gracias|sale|va|perfecto|de acuerdo|si|claro|👍|🙏|🙌)(?:[\s,.!]+(?:gracias|muchas gracias|nos vemos|hasta manana))*[\s.!👍🙏😊]*$/.test(normalizar(entrada).trim())) return {mensaje:'¡Con gusto! Aquí estamos para lo que necesite 😊',fase:faseParaRuta(ruta)}
  const nombre=lead.nombre?` ${lead.nombre.split(' ')[0]}`:''
  if(ruta.salida||ruta.persona) return {mensaje:ruta.salida==='vacante'?(dep.vacante||'Gracias por tu interés. El área de personal revisará tu solicitud.'):ruta.persona?'Revisaremos tu solicitud.':/^quiz[aá]s? m[aá]s adelante/i.test(texto)?`¡Entendido${nombre}! Aquí seguimos, escríbenos cuando estés list@ para retomarlo. 😊`:/^a[uú]n lo estoy pensando/i.test(texto)?`¡Entendido${nombre}! Tómate tu tiempo. Si más adelante quieres retomarlo, escríbenos por aquí y con gusto te ayudamos. 😊`:/^tal vez el pr[oó]ximo a[ñn]o/i.test(texto)?`¡No hay problema${nombre}! Te quedamos atentos para el siguiente My Best Summer. ¡Que tengas un excelente día! ☀️`:`Entendido${nombre}, no hay problema. Si en algún momento cambias de opinión, aquí estaremos. ¡Que tengas un excelente día! 😊`,fase:faseParaRuta(ruta),revision:!!ruta.persona}
  let mensaje=texto==='__LOCATION__'?'Gracias por compartir tu ubicación.':texto==='__MEDIA__'?'Gracias por tu archivo. Para ayudarte con su contenido, escríbeme tu mensaje en texto.':'';let link=false;let convenio=false;let revision=false
  if(/^s[ií],?\s*env[ií]ame la info/i.test(texto.trim()) && !hasLeadProgram(lead.curso)) mensaje=`¡Claro! 😊 Para enviarte la información correcta, ¿qué programa te interesa?\n\n${dep.catalogoGeneral||INSCRIPCION_DESCONOCIDA_MSG}`
  if(/^(?:necesito m[aá]s tiempo)$/i.test(texto.trim())) mensaje='Claro, no hay problema. 😊 Te damos espacio y más adelante te recordamos el proceso para que puedas retomarlo sin empezar de cero.'
  if(/^(?:bachillerato|licenciaturas?|maestr[ií]as?|idiomas|diplomados?)$/i.test(texto.trim())) mensaje=dep.catalogo?.(texto,lead)||''
  if(/^(?:a[).]?|(?:sí,?\s*)?tengo dudas)$/i.test(texto.trim())) return {mensaje:`¡Claro que sí! 😊 Con gusto resuelvo tus dudas. ¿Qué quisiera saber sobre ${hasLeadProgram(lead.curso)?lead.curso:'el programa'}?${ruta.pasos[6]?'':`\n\n${preguntaPendiente(ruta,lead)}`}`,fase:faseParaRuta(ruta)}
  if(ruta.pasos[6] && (/^c[).]?$/i.test(texto.trim())||/agendar.*examen|clase de prueba/i.test(texto))) {
    if(dep.agenda) return {mensaje:dep.agenda(texto),fase:faseParaRuta(ruta)}
    const tipo=/clase/i.test(texto)?'clase_prueba':'examen_ubicacion'
    const url=new URL('/agendar/hola@windsor.edu.mx',process.env.NEXT_PUBLIC_APP_URL||'https://crm.windsor.edu.mx');url.searchParams.set('tipo',tipo);url.searchParams.set('whatsapp',lead.whatsapp||'');url.searchParams.set('nombre',lead.nombre||'')
    return {mensaje:`Agenda aquí: ${url}. Al confirmar tu cita se registrará en tu ruta.`,fase:faseParaRuta(ruta)}
  }
  const eleccionConvenio=ruta.dudas.includes('convenio')&&/^\d{1,2}[).]?$/.test(texto.trim())
  const pregunta=temasDuda(texto).length>0||/[?¿]/.test(texto)||eleccionConvenio
  // Responder dudas con el RAG existente; su salida jamás cambia el estado de la ruta.
  if(pregunta) {
    try {mensaje=await dep.duda(texto,lead);if(!mensaje.trim()) throw new Error('Duda sin respuesta');convenio=(temasDuda(texto).includes('convenio')||eleccionConvenio)&&!!ruta.pasos[6]}
    catch {revision=true}
  }
  if(siguientePaso(ruta)===6 || (/^s[ií],?\s*env[ií]ame la info/i.test(texto.trim()) && ruta.pasos[6] && hasLeadProgram(lead.curso))) {
    mensaje += `${mensaje?'\n\n':''}${await dep.info(lead.curso!,lead)}`
    if(ruta.quiereInscribirse) {mensaje+=`\n\n${inscripcion()}`;link=true}
    // Se confirma después de entregar la respuesta, no al construirla.
    ruta={...ruta,infoPendiente:true}
    lead=await guardarRuta(db,lead,ruta)
  } else if(siguientePaso(ruta)===13 && ruta.quiereInscribirse) {
    link=true
    mensaje+=`${mensaje?'\n\n':''}${inscripcion()}`
  } else {
    // Texto libre que no movió la ruta ni trajo datos: contestarlo en contexto en vez de repetir la pregunta.
    if(!mensaje && !revision && entrada.trim().split(/\s+/).length>=3 && Object.keys(datos).length===0 && siguientePaso(ruta)===pasoAntes) {
      try {mensaje=await dep.duda(entrada,lead);if(!mensaje.trim()) throw new Error('Respuesta vacía')} catch {revision=true;mensaje=''}
    }
    const pendiente=siguientePaso(ruta)===4 && !/curso de ingles/i.test(normalizar(lead.curso||'')) ? dep.catalogo?.(texto,lead)||preguntaPendiente(ruta,lead) : preguntaPendiente(ruta,lead)
    if(mensaje!==pendiente) mensaje+=`${mensaje?'\n\n':''}${pendiente}`
    if(siguientePaso(ruta)===14||siguientePaso(ruta)===15) mensaje+=`\n${urlInscripcion(lead.curso,lead.whatsapp,lead.nombre)}`
  }
  return {mensaje:dep.acuse?`${dep.acuse}\n\n${mensaje}`:mensaje,fase:faseParaRuta(ruta),info:!!ruta.infoPendiente,link,convenio,revision}
}
export async function confirmarEntregaRuta(db:SupabaseClient,id:string,entrega:{info?:boolean;link?:boolean;convenio?:boolean}) {
  let lead=await cargarRuta(db,id); let r=lead.ruta!;const now=new Date().toISOString()
  if(entrega.info) {r=marcar(r,6,'cumplido',now,'envio');r.infoPendiente=false}
  r=capturarEntrada({...lead,ruta:r},'',{},now).ruta
  if(entrega.link) r=marcar(r,13,'cumplido',now,'envio')
  if(entrega.convenio) r=marcar(r,8,'cumplido',now,'respuesta_convenio')
  r=capturarEntrada({...lead,ruta:r},'',{},now).ruta
  lead=await guardarRuta(db,lead,r)
  return lead
}

export async function reintentarConflicto<T>(accion:()=>Promise<T>):Promise<T> {
  for(let intento=0;;intento++) {
    try {return await accion()} catch(error) {
      if(intento>=2 || !(error instanceof Error) || !/Conflicto de ruta/i.test(error.message)) throw error
    }
  }
}
export function responderRuta(db:SupabaseClient,id:string,texto:string,dep:DependenciasRuta) {
  return reintentarConflicto(()=>construirRespuestaRuta(db,id,texto,dep))
}
