import { tipoInscripcion } from './programas'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cargarRuta,guardarRuta } from './ruta-servicio'
import { capturarEntrada, faseParaRuta, inferirEdad, marcar, normalizar, preguntaPendiente, siguientePaso, temasDuda, type LeadRuta } from './ruta'
import { urlInscripcion } from '../inscripcion/enlace'
import { hasLeadName } from './nombres'
const hasLeadProgram = (c?:string|null) => !!c && !/instituto windsor|sin definir/i.test(c) && (/^curso de ingl[eé]s$/i.test(c)||tipoInscripcion(c)!=='desconocido')

export type DependenciasRuta={
  detectarPrograma:(t:string)=>string|null;
  info:(curso:string,lead:LeadRuta)=>Promise<string>;
  duda:(texto:string,lead:LeadRuta)=>Promise<string>;
  catalogo?:(texto:string,lead:LeadRuta)=>string|null;
  agenda?:(texto:string)=>string;
}
export function datosEntrada(lead:LeadRuta,texto:string,detectarPrograma:DependenciasRuta['detectarPrograma']):Partial<LeadRuta> {
  const t=normalizar(texto); const datos:Partial<LeadRuta>={}
  const email=texto.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  if(email) datos.email=email
  // No confundir preguntas, decisiones, saludos ni programas con nombres.
  const nombre=texto.match(/(?:me llamo|mi nombre es|soy)\s+([\p{L} .'-]{2,70})/iu)?.[1]?.trim()
  const esNombreSolo=siguientePaso(lead.ruta!)===2 && !/[?@\d]/.test(texto) && !/hola|buen|quiero|inscrib|curso|ingles|licenciatura|diplomado|gracias|hasta|adios|necesito|precio|horario|informacion/.test(t) && texto.trim().split(/\s+/).length<=5
  if((nombre||esNombreSolo) && hasLeadName(nombre||texto,lead.whatsapp||'')) datos.nombre=nombre||texto.trim()
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
export async function responderRuta(db:SupabaseClient,id:string,texto:string,dep:DependenciasRuta) {
  let lead=await cargarRuta(db,id)
  if(!hasLeadName(lead.nombre,lead.whatsapp||'')) lead.nombre=null
  if(!hasLeadProgram(lead.curso)) lead.curso=null
  if(lead.ruta?.salida==='perdido'||lead.ruta?.salida==='vacante') return null
  const now=new Date().toISOString()
  const textoRuta=lead.ruta?.pasos[6]?.estado==='cumplido' && /^b[).]?$/i.test(texto.trim())?'quiero inscribirme':texto
  const datos=datosEntrada(lead,textoRuta,dep.detectarPrograma)
  let {ruta}=capturarEntrada(lead,textoRuta,datos,now)
  lead=await guardarRuta(db,lead,ruta,datos)
  if(ruta.salida||ruta.persona) return {mensaje:ruta.salida==='vacante'?'Gracias por tu interés. El área de personal revisará tu solicitud.':'Gracias. Una persona dará seguimiento a tu solicitud.',fase:faseParaRuta(ruta)}
  let mensaje='';let link=false;let convenio=false
  if(ruta.pasos[6]?.estado==='cumplido' && /^(?:a[).]?|tengo dudas)$/i.test(texto.trim())) return {mensaje:'Con gusto, ¿cuál es tu duda?',fase:faseParaRuta(ruta)}
  if(ruta.pasos[6]?.estado==='cumplido' && (/^c[).]?$/i.test(texto.trim())||/agendar.*examen|clase de prueba/i.test(texto))) {
    if(dep.agenda) return {mensaje:dep.agenda(texto),fase:faseParaRuta(ruta)}
    const tipo=/clase/i.test(texto)?'clase_prueba':'examen_ubicacion'
    const url=new URL('/agendar/hola@windsor.edu.mx',process.env.NEXT_PUBLIC_APP_URL||'https://crm.windsor.edu.mx');url.searchParams.set('tipo',tipo);url.searchParams.set('whatsapp',lead.whatsapp||'');url.searchParams.set('nombre',lead.nombre||'')
    return {mensaje:`Agenda aquí: ${url}. Al confirmar tu cita se registrará en tu ruta.`,fase:faseParaRuta(ruta)}
  }
  const eleccionConvenio=ruta.dudas.includes('convenio')&&/^\d{1,2}[).]?$/.test(texto.trim())
  const pregunta=temasDuda(texto).length>0||/[?¿]/.test(texto)||eleccionConvenio
  // Responder dudas con el RAG existente; su salida jamás cambia el estado de la ruta.
  if(pregunta) {mensaje=await dep.duda(texto,lead);convenio=(temasDuda(texto).includes('convenio')||eleccionConvenio)&&ruta.pasos[6]?.estado==='cumplido'}
  if(siguientePaso(ruta)===6) {
    mensaje += `${mensaje?'\n\n':''}${await dep.info(lead.curso!,lead)}`
    if(ruta.quiereInscribirse) {mensaje+=`\n\nCompleta tu formulario aquí:\n${urlInscripcion(lead.curso,lead.whatsapp,lead.nombre)}`;link=true}
    // Se confirma después de entregar la respuesta, no al construirla.
    ruta={...ruta,infoPendiente:true}
    lead=await guardarRuta(db,lead,ruta)
  } else if(siguientePaso(ruta)===13 && ruta.quiereInscribirse) {
    link=true
    mensaje+=`${mensaje?'\n\n':''}Completa el formulario de tu programa aquí:\n${urlInscripcion(lead.curso,lead.whatsapp,lead.nombre)}`
  } else {
    const pendiente=siguientePaso(ruta)===4 && !/curso de ingles/i.test(normalizar(lead.curso||'')) ? dep.catalogo?.(texto,lead)||preguntaPendiente(ruta,lead) : preguntaPendiente(ruta,lead)
    mensaje+=`${mensaje?'\n\n':''}${pendiente}`
    if(siguientePaso(ruta)===14||siguientePaso(ruta)===15) mensaje+=`\n${urlInscripcion(lead.curso,lead.whatsapp,lead.nombre)}`
  }
  return {mensaje,fase:faseParaRuta(ruta),info:!!ruta.infoPendiente,link,convenio}
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
