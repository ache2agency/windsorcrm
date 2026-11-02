import { timingSafeEqual } from 'node:crypto'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { recibirGoogleForm } from '@/lib/inscripcion/ruta'
import { esPrograma } from '@/lib/inscripcion/config'
export const runtime='nodejs'
export async function POST(request:Request) {
  const secret=process.env.INSCRIPCION_EVENTO_SECRETO||''
  const auth=request.headers.get('authorization')||''
  const esperado=`Bearer ${secret}`
  if(!secret||auth.length!==esperado.length||!timingSafeEqual(Buffer.from(auth),Buffer.from(esperado))) return Response.json({error:'No autorizado'},{status:401})
  if(Number(request.headers.get('content-length')||0)>32768) return Response.json({error:'Solicitud grande'},{status:413})
  try {
    const b=await request.json()
    const pestañas:Record<string,string>={licenciaturas:'Respuestas de formulario LIC','cursos-libres':'Respuestas de formulario CL',diplomados:'Respuestas de formulario DIPLOMADOS'}
    if(!esPrograma(b.programa)||pestañas[b.programa]!==b.pestana||!Number.isSafeInteger(b.fila)||b.fila<2||!b.datos?.whatsapp||(b.carpeta&&!/^https:\/\/drive\.google\.com\//.test(b.carpeta))) return Response.json({error:'Evento inválido'},{status:400})
    const data=await recibirGoogleForm(createServiceRoleClient(),b)
    return Response.json({ok:true,id:data.id},{headers:{'Cache-Control':'no-store'}})
  } catch(e) {console.error('[google-form] Evento no registrado',e);return Response.json({error:'No se registró el evento; reintentar'},{status:503})}
}
