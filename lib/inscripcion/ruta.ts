import type { SupabaseClient } from '@supabase/supabase-js'
import { documentosPrograma, type ProgramaInscripcion } from './config'
import { cargarRuta,guardarRuta } from '../whatsapp/ruta-servicio'
import { marcar, type Ruta } from '../whatsapp/ruta'
import { normalizarWhatsapp } from './validacion'
import { createHash } from 'node:crypto'

export function folioGoogle(pestana:string,fila:number) {
  const h=createHash('sha256').update(`windsor-google:${pestana}:${fila}`).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`
}
export function faltantesDocumentos(programa:ProgramaInscripcion,tipos:string[]) {
  return documentosPrograma(programa).filter(d=>d.required&&!tipos.includes(d.id)).map(d=>d.label)
}
export function rutaFormulario(r:Ruta,fecha:string) {
  if(r.salida==='archivado') r={...r,salida:null}
  // Un formulario es evidencia posterior real. Cada dato no observado queda saltado con motivo.
  for(let n=1;n<14;n++) if(!r.pasos[n]) r=marcar(r,n,'saltado',fecha,'formulario','Solicitud recibida fuera del flujo del bot; paso sin evidencia')
  return marcar(r,14,'cumplido',fecha,'formulario')
}
export async function recibirGoogleForm(db:SupabaseClient,payload:{programa:ProgramaInscripcion;pestana:string;fila:number;datos:Record<string,string>;carpeta:string;ficha?:string}) {
  const whatsapp=normalizarWhatsapp(payload.datos.whatsapp)
  const id=/^[0-9a-f-]{36}$/i.test(payload.datos._folio||'')?payload.datos._folio:folioGoogle(payload.pestana,payload.fila)
  const {data,error}=await db.rpc('registrar_inscripcion',{
    p_id:id,p_programa:payload.programa,p_datos:{...payload.datos,whatsapp},p_documentos:[{tipo:'carpeta_drive',url:payload.carpeta},{tipo:'origen_sheet',pestana:payload.pestana,fila:payload.fila}],p_asesor:null,
  })
  if(error) throw new Error(error.message)
  await encolarRevision(db,id,data.lead_id,payload)
  return {id,lead_id:data.lead_id}
}
export async function encolarRevision(db:SupabaseClient,id:string,leadId:string,datos:{pestana:string;fila:number;datos?:Record<string,string>}) {
  let l=await cargarRuta(db,leadId)
  const r=rutaFormulario(l.ruta!,new Date().toISOString())
  // La solicitud identifica el programa correcto (Karla: CL inglés, no licenciatura inferida por bot).
  l=await guardarRuta(db,l,r,{curso:datos.datos?.curso||l.curso,modalidad:datos.datos?.modalidad||l.modalidad},'formulario')
  const {error}=await db.from('ruta_inscripcion_trabajos').upsert({id,lead_id:leadId,pestana:datos.pestana,fila:datos.fila},{onConflict:'id',ignoreDuplicates:true})
  if(error) throw new Error('No se pudo encolar revisión')
}
export async function revisarDrive(pestana:string,fila:number):Promise<{tipos:string[]}> {
  const url=process.env.INSCRIPCION_DRIVE_URL;const secreto=process.env.INSCRIPCION_DRIVE_SECRETO
  if(!url||!secreto) throw new Error('Falta configurar Drive')
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({secreto,accion:'revisar',pestana,fila}),signal:AbortSignal.timeout(30000)})
  const data=await res.json()
  if(!res.ok||!data.ok||!Array.isArray(data.tipos)) throw new Error('Drive no verificable')
  return {tipos:data.tipos}
}
export async function aplicarRevision(db:SupabaseClient,leadId:string,programa:ProgramaInscripcion,tipos:string[]) {
  const lead=await cargarRuta(db,leadId);let r=lead.ruta!
  const faltantes=faltantesDocumentos(programa,tipos);r={...r,faltantes}
  if(!faltantes.length) r=marcar(r,15,'cumplido',new Date().toISOString(),'drive')
  await guardarRuta(db,lead,r,{},'drive')
  return faltantes
}
export const confirmacionDocumentos=(nombre:string,programa:string,recibidos:string[])=>`¡Felicidades! Confirmo la recepción de los documentos para tu inscripción a ${programa}. *${nombre}*\nDocumentos recibidos: ${recibidos.join(', ')}.\nCon gusto canalizo tu inscripción al área de inscripciones, quien se pondrá en contacto contigo a la brevedad para revisar el pago y darte la bienvenida.`
