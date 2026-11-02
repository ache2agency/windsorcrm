import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createClient} from '@supabase/supabase-js'
import {procesarInscripciones} from '../lib/inscripcion/trabajos'
import {ADMIN_WA_ALERTA} from '../lib/whatsapp/atencion'
for(const escenario of ['incompleto','sin_template','entregado','fallo_ambiguo','recuperar','confirmacion','dry']) test(`cola inscripción: ${escenario}`,async t=>{
 const env={...process.env};Object.assign(process.env,{INSCRIPCION_DRIVE_URL:'https://drive-test.invalid/exec',INSCRIPCION_DRIVE_SECRETO:'fake',META_WHATSAPP_TOKEN:'fake',META_PHONE_NUMBER_ID:'fake'})
 if(['entregado','fallo_ambiguo','confirmacion'].includes(escenario)) process.env.INSCRIPCION_UTILITY_TEMPLATE='utility_prueba'
 else delete process.env.INSCRIPCION_UTILITY_TEMPLATE
 t.after(()=>{process.env=env})
 const ahora=new Date('2026-11-01T18:00:00Z');t.mock.timers.enable({apis:['Date'],now:ahora})
 const job:any={id:'sol-1',lead_id:'lead-1',pestana:'Respuestas de formulario CL',fila:74,estado:'pendiente',aviso_estado:escenario==='recuperar'?'enviado':'pendiente',confirmacion_estado:escenario==='confirmacion'?'pendiente':'enviado',actualizado_at:ahora.toISOString()}
 const lead:any={id:'lead-1',nombre:'Karla Ejemplo',whatsapp:'+525500000001',curso:'Inglés para adultos',modalidad:'En línea',ruta_version:0,paso:14,ruta:{pasos:{14:{estado:'cumplido',fecha:ahora.toISOString(),fuente:'formulario'}},dudas:[]}}
 const envios:any[]=[];let writes=0
 t.mock.method(globalThis,'fetch',async(input:any,init?:RequestInit)=>{
  const req=new Request(input,init),url=new URL(req.url),tabla=url.pathname.split('/').at(-1)
  if(escenario==='dry') assert.equal(req.method,'GET')
  if(url.hostname==='drive-test.invalid') return Response.json({ok:true,tipos:escenario==='incompleto'?['acta']:['acta','comprobante']})
  if(url.hostname==='graph.facebook.com') {envios.push(await req.json());if(escenario==='fallo_ambiguo') throw new Error('Entrega desconocida');return Response.json({messages:[{id:'wamid.simulado'}]})}
  assert.equal(url.hostname,'cola-test.supabase.co','ninguna red real')
  if(req.method==='POST'&&tabla==='guardar_ruta_lead'){writes++;const b=await req.json();lead.ruta=b.p_ruta;lead.paso=b.p_paso;lead.ruta_version++;return Response.json(lead)}
  if(tabla==='ruta_inscripcion_trabajos') {
   if(req.method==='GET') return Response.json([job])
   writes++;const b=await req.json();const key=b.aviso_estado?'aviso_estado':b.confirmacion_estado?'confirmacion_estado':null
   if(key&&url.searchParams.has(key)&&url.searchParams.get(key)!==`eq.${job[key]}`) return Response.json([])
   Object.assign(job,b);return url.searchParams.has('select')?Response.json([{id:job.id}]):new Response(null,{status:204})
  }
  if(tabla==='inscripciones') return Response.json({programa:'cursos-libres'})
  if(tabla==='leads') return Response.json(lead)
  if(tabla==='whatsapp_conversaciones') return Response.json({id:'conv-1',modo_humano:false})
  if(tabla==='whatsapp_mensajes') return req.method==='GET'?Response.json({created_at:ahora.toISOString()}):new Response(null,{status:201})
  assert.fail(`consulta inesperada: ${req.method} ${url}`)
 })
 const db=createClient('https://cola-test.supabase.co','fake',{auth:{persistSession:false}})
 await procesarInscripciones(db,escenario==='dry')
 if(escenario==='dry'){assert.equal(writes,0);assert.equal(envios.length,0);return}
 if(escenario==='incompleto'){assert.equal(lead.paso,14);assert.equal(envios.length,0);return}
 if(escenario==='sin_template'){assert.equal(lead.paso,15);assert.equal(envios.length,0);return}
 if(escenario==='fallo_ambiguo'){assert.equal(lead.paso,15);assert.equal(job.aviso_estado,'enviando');await procesarInscripciones(db,false);assert.equal(envios.length,1);return}
 assert.equal(lead.paso,16);assert.equal(lead.ruta.pasos[17],undefined)
 if(escenario==='recuperar'){assert.equal(envios.length,0);return}
 const avisos=envios.filter(e=>e.type==='template');assert.equal(avisos.length,1);assert.equal(avisos[0].to,ADMIN_WA_ALERTA)
 await procesarInscripciones(db,false);assert.equal(envios.filter(e=>e.type==='template').length,1)
 if(escenario==='confirmacion'){const alumno=envios.find(e=>e.type==='text');assert.match(alumno.text.body,/¡Felicidades![\s\S]*Documentos recibidos:[\s\S]*canalizo tu inscripción/)}
})
