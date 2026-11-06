import {createClient} from '@/utils/supabase/server'
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}) {
  const db=await createClient();const {data:{user}}=await db.auth.getUser()
  if(!user) return Response.json({error:'Inicia sesión'},{status:401})
  const {id}=await params
  const {data:lead,error}=await db.from('leads').select('id,ruta,paso,ruta_version,asignado_a').eq('id',id).maybeSingle()
  if(error||!lead) return Response.json({error:'No disponible'},{status:404})
  const {data:profile}=await db.from('profiles').select('rol').eq('id',user.id).maybeSingle()
  const {data:eventos,error:eventsError}=await db.from('lead_ruta_eventos').select('version,fuente,actor_id,created_at').eq('lead_id',id).order('version',{ascending:false}).limit(12)
  if(eventsError) return Response.json({error:'No se pudo cargar la auditoría'},{status:503})
  const actores=[...new Set((eventos||[]).map(e=>e.actor_id).filter(Boolean))]
  const {data:perfiles}=actores.length?await db.from('profiles').select('id,nombre,email').in('id',actores):{data:[]}
  const historial=(eventos||[]).map(e=>{const p=perfiles?.find(p=>p.id===e.actor_id);return {...e,autor:p?.nombre||p?.email||e.actor_id||'Automático'}})
  return Response.json({lead,eventos:historial,puedeEditar:profile?.rol==='admin'||lead.asignado_a===user.id},{headers:{'Cache-Control':'private, no-store'}})
}
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}) {
  const db=await createClient();const {data:{user}}=await db.auth.getUser()
  if(!user) return Response.json({error:'Inicia sesión'},{status:401})
  const {id}=await params
  let p;try{p=await req.json()}catch{return Response.json({error:'Datos inválidos'},{status:400})}
  if(!['paso','canalizar','retomar'].includes(p.accion)||!Number.isInteger(p.version)||typeof p.motivo!=='string'||p.motivo.trim().length<5) return Response.json({error:'Acción, versión y motivo son obligatorios'},{status:400})
  // El JWT llega a la RPC: permisos y actor de lead_ruta_eventos se verifican en BD.
  const {data,error}=await db.rpc('editar_ruta_manual',{p_id:id,p_version:p.version,p_accion:p.accion,p_motivo:p.motivo,p_paso:p.paso??null,p_a:p.a??null,p_hasta:p.hasta??null})
  if(error) return Response.json({error:error.message},{status:400})
  if(!data) return Response.json({error:'La ruta cambió. Recarga antes de guardar.'},{status:409})
  return Response.json({lead:data},{headers:{'Cache-Control':'private, no-store'}})
}
