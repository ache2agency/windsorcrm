import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {procesarCanalizaciones} from '../lib/whatsapp/canalizacion-motor'
import {hasLeadName} from '../lib/whatsapp/nombres'
import {decidirSeguimientoAutomatico} from '../lib/whatsapp/seguimiento-motor'
import {avisoVisitaInhabil,horarioAtencion,INICIO_INGLES_NINOS} from '../lib/whatsapp/servicio-calendario'
import {INFO_MSGS} from '../lib/whatsapp/infoMsgs'
import type {SupabaseClient} from '@supabase/supabase-js'
const ahora=new Date('2026-11-04T18:00:00Z'),fecha=(h:number)=>new Date(ahora.getTime()-h*3600_000).toISOString()
function fixture({ventanaLead=true,ventanaAsesor=true,ventanaHarold=true,atendido=false}={}) {
 const tablas:any={leads:[{id:'lead',nombre:'Demo',whatsapp:'+525500000001',asignado_a:'asesor',paso:6,ruta_version:0,ruta:{pasos:{6:{estado:'cumplido',fuente:'envio',fecha:fecha(48)}},dudas:[],persona:{desde:fecha(48),hasta:fecha(24),a:'coordinación',motivo:'B1 universidad',estado:'pendiente'}}}],profiles:[{id:'asesor',whatsapp:'+525500000002'}],whatsapp_conversaciones:[{id:'leadconv',lead_id:'lead',whatsapp:'+525500000001',ultimo_mensaje_at:fecha(1)},{id:'asesorconv',whatsapp:'+525500000002',ultimo_mensaje_at:fecha(1)},{id:'haroldconv',whatsapp:'527471028306',ultimo_mensaje_at:fecha(1)}],whatsapp_mensajes:[{id:'leadmsg',conversacion_id:'leadconv',rol:'usuario',created_at:fecha(ventanaLead?1:25)},{id:'asesormsg',conversacion_id:'asesorconv',rol:'usuario',created_at:fecha(ventanaAsesor?1:26)},{id:'haroldmsg',conversacion_id:'haroldconv',rol:'usuario',created_at:fecha(ventanaHarold?1:26)},...(atendido?[{id:'human',conversacion_id:'leadconv',rol:'agente',created_at:fecha(2)}]:[])],lead_activities:[]}
 const eventos:any[]=[],envios:any[]=[]
 const db:any={from(tabla:string){let filtros:any[]=[],limite=Infinity,offset=0,orden:any[]=[],valores:any,op='select';const get=(r:any,k:string)=>k.split('->').reduce((v,p)=>v?.[p],r)
  const q:any={select(){return q},eq(k:string,v:any){filtros.push((r:any)=>get(r,k)===v);return q},not(k:string,_op:string,v:any){filtros.push((r:any)=>get(r,k)!=null);return q},in(k:string,v:any[]){filtros.push((r:any)=>v.includes(get(r,k)));return q},gte(k:string,v:any){filtros.push((r:any)=>get(r,k)>=v);return q},limit(n:number){limite=n;return q},range(a:number,b:number){offset=a;limite=b-a+1;return q},order(k:string,o:any={}){orden.push([k,o.ascending]);return q},update(v:any){op='update';valores=v;return q},insert(v:any){op='insert';valores=v;return q},maybeSingle:async()=>{const x=await run();return {...x,data:x.data[0]||null}},then(a:any,b:any){return run().then(a,b)}}
  async function run(){let rows=tablas[tabla].filter((r:any)=>filtros.every(f=>f(r)));if(op==='insert'){tablas[tabla].push(...valores);rows=valores}if(op==='update')rows.forEach((r:any)=>Object.assign(r,valores));rows.sort((a:any,b:any)=>{for(const[k,asc]of orden){const c=String(a[k]).localeCompare(String(b[k]));if(c)return asc?c:-c}return 0});return {data:structuredClone(rows.slice(offset,offset+limite)),error:null}}
  return q
 },async rpc(name:string,p:any){assert.equal(name,'guardar_ruta_lead');const l=tablas.leads[0];if(l.ruta_version!==p.p_version)return {data:null,error:null};Object.assign(l,{ruta:p.p_ruta,ruta_version:l.ruta_version+1});eventos.push(structuredClone(l));return {data:structuredClone(l),error:null}}}
 return {db:db as SupabaseClient,tablas,eventos,envios,enviar:async(m:any)=>{envios.push(m);return {id:'wamid.mock',raw:{}}}}
}
test('10-bis: vencimiento conserva paso, audita y avisa a Harold y asesor una sola vez dentro de ventana',async()=>{
 const f=fixture();await Promise.all([procesarCanalizaciones(f.db,false,ahora,f.enviar),procesarCanalizaciones(f.db,false,ahora,f.enviar)])
 assert.equal(f.tablas.leads[0].paso,6);assert.equal(f.tablas.leads[0].ruta.persona.estado,'vencida')
 assert.equal(f.tablas.whatsapp_conversaciones[0].fase,'con_asesor');assert.equal(f.eventos.length,1)
 assert.deepEqual(f.envios.map(m=>m.to).sort(),['525500000002','527471028306']);assert.equal(f.tablas.lead_activities.length,1)
 await procesarCanalizaciones(f.db,false,ahora,f.enviar);assert.equal(f.envios.length,2)
})
test('10-bis: fuera de ventana solo CRM; sin inventar plantillas ni usar el número del prospecto para alertar',async()=>{
 for(const opciones of [{ventanaAsesor:false,ventanaHarold:false}]) {
  const f=fixture(opciones);await procesarCanalizaciones(f.db,false,ahora,f.enviar)
  assert.equal(f.envios.length,0);assert.equal(f.tablas.lead_activities.length,1);assert.equal(f.eventos.length,1)
 }
 const f=fixture({ventanaAsesor:false});await procesarCanalizaciones(f.db,false,ahora,f.enviar)
 assert.deepEqual(f.envios.map(m=>m.to),['527471028306'])
})
test('10-bis: dry-run y asesor ya respondió no escriben ni envían',async()=>{
 for(const atendido of [false,true]) {
  const f=fixture({atendido});const antes=structuredClone(f.tablas)
  await procesarCanalizaciones(f.db,!atendido,ahora,f.enviar)
  assert.equal(f.envios.length,0);assert.deepEqual(f.tablas,antes)
 }
})
test('10-bis: sin nombre válido seguimiento saluda sin Windsor, Sabatinos o De',()=>{
 for(const nombre of [null,'Windsor','Sabatinos','De']) {
  assert.equal(hasLeadName(nombre,null),false)
  const d=decidirSeguimientoAutomatico({fase:'saludo',lead:{nombre,curso:'Diplomado en Farmacología'},horasDesdeLead:20,horasDesdeBot:20,diasDesdeLead:20/24,dentroVentana24h:true,yaTienePrograma:true})
  assert.ok(d?.mensaje);assert.match(d.mensaje,/¡Hola!/) ;assert.doesNotMatch(d.mensaje,/Hola (?:Windsor|Sabatinos|De)/)
 }
 assert.equal(hasLeadName('María de la Cruz',null),true)
})
test('10-bis: puente del 2-nov, siguiente 16-nov y lista configurable en hora de México',()=>{
 for(const fecha of ['2026-11-02T18:00:00Z','2026-11-16T18:00:00Z']) assert.match(horarioAtencion(new Date(fecha),{}),/no hay atención/)
 assert.match(avisoVisitaInhabil('Voy hoy temprano',new Date('2026-11-02T18:00:00Z'),{})!,/no hay atención/)
 assert.match(avisoVisitaInhabil('Voy mañana',new Date('2026-11-01T18:00:00Z'),{})!,/no hay atención/)
 assert.doesNotMatch(horarioAtencion(new Date('2026-11-03T18:00:00Z'),{}),/hoy estamos atendiendo|no hay atención/i)
 assert.match(horarioAtencion(new Date('2026-11-03T18:00:00Z'),{WINDSOR_DIAS_INHABILES:'2026-11-03'}),/no hay atención/)
 assert.doesNotMatch(horarioAtencion(new Date('2026-11-02T18:00:00Z'),{WINDSOR_DIAS_INHABILES:''}),/no hay atención/)
})
test('10-bis: inicio de niños fuente aprobada, sin septiembre 2027 ni fecha exacta inventada',()=>{
 assert.ok(INFO_MSGS['Inglés para niños'].includes(INICIO_INGLES_NINOS));assert.match(INICIO_INGLES_NINOS,/abierta todo el año/);assert.match(INICIO_INGLES_NINOS,/principios de año/)
 assert.doesNotMatch(INFO_MSGS['Inglés para niños'],/septiembre.*2027/)
})

test('10-bis: etiquetas y resto de Conversaciones intactos; solo añade editor de ruta',async()=>{
 const source=await readFile(new URL('../components/crm/ConversationsPanel.jsx',import.meta.url),'utf8')
 const original=source.replace("import RutaManual from './RutaManual';\n",'').replace('                  <RutaManual key={selectedConv.id} leadId={selectedConv.lead_id} />\n','')
 assert.equal(createHash('sha256').update(original).digest('hex'),'e89e682061f9a1f3b533bf48aaa6051169e1b057fefc1827dfff3bbf950b62ce')
})

test('10-bis: API manual exige sesión, usa su JWT y devuelve 409 ante versión obsoleta',async()=>{
 const ts=(await import('typescript')).default
 const {runInNewContext}=await import('node:vm')
 const source=await readFile(new URL('../app/api/leads/[id]/ruta/route.ts',import.meta.url),'utf8')
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 let usuario:any=null;const llamadas:any[]=[]
 const db={auth:{getUser:async()=>({data:{user:usuario}})},rpc:async(...args:any[])=>{llamadas.push(args);return {data:null,error:null}}}
 const exp:any={};runInNewContext(code,{exports:exp,Response,require:(name:string)=>{assert.equal(name,'@/utils/supabase/server');return {createClient:async()=>db}}})
 const context={params:Promise.resolve({id:'lead'})}
 const request=()=>new Request('http://localhost/api/leads/lead/ruta',{method:'POST',body:JSON.stringify({accion:'retomar',version:3,motivo:'Motivo probado',actor_id:'falso'})})
 assert.equal((await exp.POST(request(),context)).status,401);assert.equal(llamadas.length,0)
 usuario={id:'usuario-real'};assert.equal((await exp.POST(request(),context)).status,409)
 assert.equal(llamadas[0][0],'editar_ruta_manual');assert.equal(llamadas[0][1].p_version,3);assert.equal(llamadas[0][1].actor_id,undefined)
})

test('10-ter: lead sin ventana hace 25 h no impide avisar al asesor en ventana',async()=>{
 const f=fixture({ventanaLead:false,ventanaHarold:false})
 await procesarCanalizaciones(f.db,false,ahora,f.enviar)
 assert.deepEqual(f.envios.map(m=>m.to),['525500000002'])
 assert.equal(f.tablas.lead_activities[0].meta.entregas['527471028306'],'solo_CRM_sin_ventana')
})
test('10-ter: conversión automática conserva origen y fecha para el timeout; no crea fecha acordada',async()=>{
 const f=fixture();f.tablas.leads[0].ruta.persona=fecha(25)
 await procesarCanalizaciones(f.db,false,ahora,f.enviar)
 const p=f.tablas.leads[0].ruta.persona
 assert.equal(p.origen,'automatica');assert.equal(p.desde,fecha(25));assert.equal(p.hasta,undefined)
 const {personaVencida}=await import('../lib/whatsapp/ruta')
 assert.equal(personaVencida(p,ahora.toISOString()),true)
 assert.equal(personaVencida({...p,origen:undefined},ahora.toISOString()),false)
})
test('10-ter: hoy en la mañana y mañana se distinguen en días inhábiles',()=>{
 assert.match(avisoVisitaInhabil('voy hoy en la mañana',new Date('2026-11-02T18:00:00Z'),{})!,/visita \(2026-11-02\)/)
 assert.match(avisoVisitaInhabil('voy hoy por la mañana',new Date('2026-11-02T18:00:00Z'),{})!,/visita \(2026-11-02\)/)
 assert.match(avisoVisitaInhabil('voy mañana',new Date('2026-11-15T18:00:00Z'),{})!,/visita \(2026-11-16\)/)
})
