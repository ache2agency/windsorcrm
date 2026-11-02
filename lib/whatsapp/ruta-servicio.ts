import type { SupabaseClient } from '@supabase/supabase-js'
import { type LeadRuta, type Ruta, pasoActual, bloqueDe } from './ruta'
export async function cargarRuta(db:SupabaseClient,id:string):Promise<LeadRuta> {
  const {data,error}=await db.from('leads').select('id,nombre,email,whatsapp,curso,stage,modalidad,edad,paso,ruta,ruta_version').eq('id',id).single()
  if(error||!data?.ruta) throw new Error('Ruta no disponible; aplicar SQL antes del código')
  return data as LeadRuta
}
export async function guardarRuta(db:SupabaseClient,lead:LeadRuta,ruta:Ruta,datos:Partial<LeadRuta>={},fuente='bot') {
  const {data,error}=await db.rpc('guardar_ruta_lead',{
    p_id:lead.id,p_version:lead.ruta_version,p_ruta:ruta,p_datos:datos,p_fuente:fuente,
    p_paso:pasoActual(ruta),p_bloque:bloqueDe(pasoActual(ruta)).nombre,
  })
  if(error) throw new Error(`Ruta no guardada: ${error.message}`)
  if(!data) throw new Error('Conflicto de ruta: reintentar con versión actual')
  return data as LeadRuta
}
