import type { SupabaseClient } from '@supabase/supabase-js'
import { aplicarRevision,confirmacionDocumentos,revisarDrive } from './ruta'
import { documentosPrograma, type ProgramaInscripcion } from './config'
import { cargarRuta,guardarRuta } from '../whatsapp/ruta-servicio'
import { marcar } from '../whatsapp/ruta'
import { ADMIN_WA_ALERTA } from '../whatsapp/atencion'
import { sendMetaWhatsAppMessage,sendMetaWhatsAppTemplate } from '../whatsapp/provider'

// Se ejecuta desde el cron existente. Una entrega ambigua no se reintenta automáticamente.
export async function procesarInscripciones(db:SupabaseClient,dryRun:boolean) {
  const {data:jobs,error}=await db.from('ruta_inscripcion_trabajos').select('*').or('estado.neq.completo,aviso_estado.neq.enviado,confirmacion_estado.neq.enviado').order('actualizado_at').limit(25)
  if(error) throw new Error(error.message)
  const resultados:Record<string,unknown>[]=[]
  for(const job of jobs||[]) {
    if(dryRun) {resultados.push({id:job.id,estado:job.estado,aviso:job.aviso_estado});continue}
    try {
      const {data:sol}=await db.from('inscripciones').select('programa').eq('id',job.id).single()
      if(!sol) throw new Error('Solicitud no encontrada')
      const programa=sol.programa as ProgramaInscripcion
      const revision=await revisarDrive(job.pestana,job.fila)
      const faltantes=await aplicarRevision(db,job.lead_id,programa,revision.tipos)
      if(faltantes.length) {await db.from('ruta_inscripcion_trabajos').update({estado:'incompleto',actualizado_at:new Date().toISOString()}).eq('id',job.id);continue}
      await db.from('ruta_inscripcion_trabajos').update({estado:'completo',actualizado_at:new Date().toISOString()}).eq('id',job.id)
      let lead=await cargarRuta(db,job.lead_id)
      if(lead.ruta?.salida==='perdido') continue
      // Confirmación al alumno solo dentro de ventana y si no lo atiende una persona.
      if(job.confirmacion_estado==='pendiente') {
        const {data:conv}=await db.from('whatsapp_conversaciones').select('id,modo_humano').eq('lead_id',job.lead_id).order('ultimo_mensaje_at',{ascending:false}).limit(1).maybeSingle()
        if(conv&&!conv.modo_humano) {
          const {data:msg}=await db.from('whatsapp_mensajes').select('created_at').eq('conversacion_id',conv.id).eq('rol','usuario').order('created_at',{ascending:false}).limit(1).maybeSingle()
          if(msg && Date.now()-Date.parse(msg.created_at)<23.5*3600000) {
            const {data:claim,error:ce}=await db.from('ruta_inscripcion_trabajos').update({confirmacion_estado:'enviando'}).eq('id',job.id).eq('confirmacion_estado','pendiente').select('id')
            if(ce) throw ce
            if(claim?.length) {
              const texto=confirmacionDocumentos(lead.nombre||'',lead.curso||programa,documentosPrograma(programa).filter(d=>revision.tipos.includes(d.id)).map(d=>d.label))
              await sendMetaWhatsAppMessage({to:lead.whatsapp!,body:texto})
              await db.from('whatsapp_mensajes').insert({conversacion_id:conv.id,rol:'bot',contenido:texto})
              await db.from('ruta_inscripcion_trabajos').update({confirmacion_estado:'enviado'}).eq('id',job.id)
            }
          }
        }
      }
      if(job.aviso_estado==='enviado') {
        if(lead.ruta!.pasos[16]?.estado!=='cumplido') await guardarRuta(db,lead,marcar(lead.ruta!,16,'cumplido',job.actualizado_at,'utility'),{},'utility')
        continue
      }
      // No existe/está aprobada todavía. Sin configuración explícita no se intenta un envío.
      const template=process.env.INSCRIPCION_UTILITY_TEMPLATE
      if(!template) {resultados.push({id:job.id,aviso:'pendiente de aprobación/configuración UTILITY'});continue}
      const {data:claim,error:ce}=await db.from('ruta_inscripcion_trabajos').update({aviso_estado:'enviando'}).eq('id',job.id).eq('aviso_estado','pendiente').select('id')
      if(ce) throw ce
      if(!claim?.length) continue
      const base=process.env.NEXT_PUBLIC_APP_URL||'https://crm.windsor.edu.mx'
      const enviado=await sendMetaWhatsAppTemplate({to:ADMIN_WA_ALERTA,templateName:template,parameters:[lead.nombre||lead.whatsapp!,lead.curso||programa,lead.modalidad||'Por confirmar',`${base}/inscripciones/${job.id}`]})
      if(!enviado.id) throw new Error('Entrega sin ID; revisar manualmente antes de reintentar')
      await db.from('ruta_inscripcion_trabajos').update({aviso_estado:'enviado',wamid:enviado.id}).eq('id',job.id)
      lead=await cargarRuta(db,job.lead_id)
      await guardarRuta(db,lead,marcar(lead.ruta!,16,'cumplido',new Date().toISOString(),'utility'),{},'utility')
    } catch(e) {
      const error=e instanceof Error?e.message:String(e)
      await db.from('ruta_inscripcion_trabajos').update({ultimo_error:error,actualizado_at:new Date().toISOString()}).eq('id',job.id)
      resultados.push({id:job.id,error})
    }
  }
  return resultados
}
