import type {SupabaseClient} from '@supabase/supabase-js'
import type {PersonaProgramada} from './canalizacion'
import type {LeadRuta} from './ruta'
import {guardarRuta} from './ruta-servicio'
import {ADMIN_WA_ALERTA} from './atencion'
import {sendMetaWhatsAppMessage} from './provider'
const digitos=(s:string)=>s.replace(/\D/g,'').replace(/^521(?=\d{10}$)/,'52')
async function ventana(db:SupabaseClient,telefono:string,ahora:Date) {
  const n=digitos(telefono),variantes=[n,'+'+n,...(n.startsWith('52')?['521'+n.slice(2),'+521'+n.slice(2)]:[])]
  const {data:c,error}=await db.from('whatsapp_conversaciones').select('id').in('whatsapp',variantes).order('ultimo_mensaje_at',{ascending:false}).limit(1).maybeSingle()
  if(error) throw error
  if(!c) return false
  const {data:m,error:e}=await db.from('whatsapp_mensajes').select('created_at').eq('conversacion_id',c.id).eq('rol','usuario').order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(e) throw e
  return !!m && ahora.getTime()-Date.parse(m.created_at)>=0 && ahora.getTime()-Date.parse(m.created_at)<23.5*3600_000
}
export async function procesarCanalizaciones(db:SupabaseClient,dry=false,ahora=new Date(),enviar=sendMetaWhatsAppMessage) {
  const rows:LeadRuta[]=[]
  for(let offset=0;;offset+=500) {
    const {data,error}=await db.from('leads').select('id,nombre,whatsapp,ruta,ruta_version,asignado_a,paso,curso').not('ruta->persona','is',null).order('id').range(offset,offset+499)
    if(error) throw error
    rows.push(...(data||[]));if(!data||data.length<500) break
  }
  const resultados=[]
  for(const original of rows) {
    try {
      let lead=original;const raw=lead.ruta?.persona
      if(!raw) continue
      const p:PersonaProgramada=typeof raw==='string'?{origen:'automatica',desde:raw,a:'el asesor asignado',motivo:'Pase a asesor',estado:'pendiente'}:{...raw}
      if(!Number.isFinite(Date.parse(p.desde))) continue
      const {data:convs,error:ce}=await db.from('whatsapp_conversaciones').select('id').eq('lead_id',lead.id)
      if(ce) throw ce
      const ids=(convs||[]).map(c=>c.id)
      if(ids.length) {
        const {data:atendido,error:ae}=await db.from('whatsapp_mensajes').select('id').in('conversacion_id',ids).eq('rol','agente').gte('created_at',p.desde).limit(1)
        if(ae) throw ae
        if(atendido?.length) continue
      }
      const vence=!!p.hasta&&Date.parse(p.hasta)<=ahora.getTime()&&p.estado!=='vencida'
      const aviso=ahora.getTime()-Date.parse(p.desde)>=24*3600_000&&!p.aviso24At
      if(!vence&&!aviso) continue
      if(dry) {resultados.push({lead_id:lead.id,vence,aviso,accion:'dry_canalizacion'});continue}
      // Optimistic lock reserva el evento antes de enviar: dos crons no duplican el aviso.
      if(vence) p.estado='vencida'
      if(aviso) p.aviso24At=ahora.toISOString()
      lead=await guardarRuta(db,lead,{...lead.ruta!,persona:p},{},'motor_canalizacion')
      if(vence) {
        const {error}=await db.from('whatsapp_conversaciones').update({fase:'con_asesor',estado:'abierta'}).eq('lead_id',lead.id)
        if(error) throw error
      }
      const entregas:Record<string,string>={}
      if(aviso) {
        const {data:asesor,error}=lead.asignado_a?await db.from('profiles').select('whatsapp').eq('id',lead.asignado_a).maybeSingle():{data:null,error:null}
        if(error) throw error
        const destinos=[...new Set([ADMIN_WA_ALERTA,asesor?.whatsapp].filter(Boolean).map(n=>digitos(n!)))]
        for(const to of destinos) {
          if(!await ventana(db,to,ahora)) {entregas[to]='solo_CRM_sin_ventana';continue}
          try {await enviar({to,body:`⏰ Pase a asesor sin atender 24 h\n${lead.nombre||lead.whatsapp} · ${lead.whatsapp}\n${p.a}: ${p.motivo}`});entregas[to]='enviado'}
          catch {entregas[to]='error_envio_revisar_CRM'}
        }
        if(!asesor?.whatsapp) entregas.asesor='sin_telefono_CRM'
      }
      const {error}=await db.from('lead_activities').insert([{lead_id:lead.id,event_type:'canalizacion_pendiente',title:vence?'Canalización vencida: contactar':'Pase sin atender 24 h',detail:`${p.a} · ${p.hasta||'sin fecha acordada'}`,meta:{entregas,source:'canalizacion_motor'}}])
      if(error) throw error
      resultados.push({lead_id:lead.id,vence,aviso,accion:'canalizacion_CRM'})
    } catch(error) {resultados.push({lead_id:original.id,accion:'error_canalizacion',detalle:String(error)})}
  }
  return resultados
}
