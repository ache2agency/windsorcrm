import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import vm from 'node:vm'
import type {SupabaseClient} from '@supabase/supabase-js'
import {marcar,rutaVacia,capturarEntrada,siguientePaso,pasoActual,equivalenciaFase,temasDuda,type LeadRuta} from '../lib/whatsapp/ruta'
import {datosEntrada,responderRuta,confirmarEntregaRuta} from '../lib/whatsapp/ruta-bot'
import {cargarRuta,guardarRuta} from '../lib/whatsapp/ruta-servicio'
import {recibirGoogleForm,aplicarRevision,faltantesDocumentos,folioGoogle} from '../lib/inscripcion/ruta'
import {decidirSeguimientoAutomatico} from '../lib/whatsapp/seguimiento-motor'
import {calcularEmbudo} from '../lib/crm/embudo'
const pg=new PGlite();const fecha='2026-11-01T18:00:00Z';const karla=randomUUID(),canal=randomUUID(),asesor=randomUUID()
// Adaptador SDK mínimo: los RPC, restricciones, triggers, backfill y locks corren en PostgreSQL real.
function from(table:string) {
  const filtros:Array<[string,unknown]>=[];let upsert:Record<string,unknown>|null=null;let seleccion='*'
  const q:any={select(s='*'){seleccion=s;return q},eq(k:string,v:unknown){filtros.push([k,v]);return q},single(){return run()},maybeSingle(){return run()},
    upsert(row:Record<string,unknown>){upsert=row;return q},then(resolve:any,reject:any){return run().then(resolve,reject)}}
  async function run(){try{
    if(upsert){const keys=Object.keys(upsert);await pg.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) on conflict do nothing`,Object.values(upsert));return {error:null,data:null}}
    const {rows}=await pg.query(`select ${seleccion} from ${table}${filtros.length?' where '+filtros.map(([k],i)=>`${k}=$${i+1}`).join(' and '):''}`,filtros.map(([,v])=>v));return {data:rows[0]||null,error:null}
  }catch(error){return {data:null,error}}}
  return q
}
const db={from,async rpc(name:string,a:Record<string,unknown>){try{
  const keys=Object.keys(a);const {rows}=await pg.query<{r:any}>(`select ${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) r`,Object.values(a).map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v));return {data:rows[0]?.r,error:null}
}catch(error){return {data:null,error}}}} as unknown as SupabaseClient
const deps={detectarPrograma:(s:string)=>/licenciatura/i.test(s)?'Licenciatura en Inglés':/ingles para adultos/i.test(s)?'Inglés para adultos':null,info:async()=> 'Información oficial de prueba: costos y horarios',duda:async()=> 'Respuesta a la duda'}
before(async()=>{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text);
 create table profiles(id uuid primary key,rol text,whatsapp text);
 create table leads(id uuid primary key default gen_random_uuid(),nombre text,email text,whatsapp text,curso text,stage text,asignado_a uuid,created_at timestamptz default now());
 create table whatsapp_conversaciones(id uuid primary key default gen_random_uuid(),lead_id uuid,whatsapp text,fase text,estado text,modo_humano boolean default false,ultimo_mensaje_at timestamptz);
 create table whatsapp_mensajes(id uuid primary key,conversacion_id uuid,rol text,contenido text,created_at timestamptz);
 create table citas(id uuid primary key default gen_random_uuid(),lead_id uuid,status text,tipo text);
 create table lead_activities(id uuid default gen_random_uuid(),lead_id uuid,actor_id uuid,event_type text,title text,detail text,meta jsonb);
 insert into profiles values('${asesor}','admin','+527474722466');
 insert into leads(id,nombre,email,whatsapp,curso,stage,asignado_a,created_at) values
 ('${karla}','Karla Galilea','karla@example.test','+5217331068375','Licenciatura en Inglés','primer_contacto','${asesor}','2026-10-01'),
 ('${canal}','Harold','harold@example.test','+527474722466','Canal interno','primer_contacto','${asesor}','2026-10-01');
 insert into whatsapp_conversaciones(lead_id,whatsapp,fase,estado,ultimo_mensaje_at) values('${karla}','+527331068375','accion','abierta','2026-11-01');`)
 await pg.exec(await readFile(new URL('../supabase/inscripciones_publicas.sql',import.meta.url),'utf8'))
 await pg.exec(await readFile(new URL('../supabase/windsor_ruta_17_pasos.sql',import.meta.url),'utf8'))
})
after(()=>pg.close())
test('sin brincos: intención de inscripción espera nombre, correo, oferta, modalidad e info real',()=>{
 const l:LeadRuta={ruta:rutaVacia()};let r=capturarEntrada(l,'quiero inscribirme',{},fecha).ruta
 assert.equal(siguientePaso(r),2);assert.equal(r.quiereInscribirse,true);assert.equal(r.pasos[13],undefined)
 r=capturarEntrada({ruta:r},'Ana',{nombre:'Ana',curso:'Inglés para adultos',modalidad:'En línea'},fecha).ruta
 assert.equal(siguientePaso(r),3);assert.equal(r.pasos[4],undefined)
 r=capturarEntrada({ruta:r,nombre:'Ana',curso:'Inglés para adultos',modalidad:'En línea'},'ana@example.test',{email:'ana@example.test'},fecha).ruta
 assert.equal(siguientePaso(r),6);assert.equal(r.pasos[13],undefined)
 r=marcar(r,6,'cumplido',fecha,'envio');r=capturarEntrada({ruta:r},'',{},fecha).ruta
 assert.equal(siguientePaso(r),13)
 for(const n of [7,8,9,10,11,12]) assert.ok(r.pasos[n].motivo)
 assert.throws(()=>marcar(r,17,'cumplido',fecha,'bot'),/persona/)
 assert.throws(()=>marcar(rutaVacia(),8,'saltado',fecha,'bot'),/motivo/)
})
test('duda antes de información conserva paso y etiqueta; edad solo en cursos de inglés',()=>{
 let r=capturarEntrada({ruta:rutaVacia()},'¿Cuál es el precio y horario?',{},fecha).ruta
 assert.equal(pasoActual(r),1);assert.equal(siguientePaso(r),2);assert.deepEqual(r.dudas,['horario','precio'])
 const datos=datosEntrada({ruta:r,curso:'Curso de inglés'},'tiene 8 años',deps.detectarPrograma)
 assert.equal(datos.edad,8);assert.equal(datos.curso,'Inglés para niños')
 assert.equal(datosEntrada({ruta:r,curso:'Curso de inglés'},'24 años',deps.detectarPrograma).curso,'Inglés para adultos')
 assert.equal(datosEntrada({ruta:r,curso:'Licenciatura en Inglés'},'24 años',deps.detectarPrograma).edad,undefined)
})
test('bot integrado guarda captura, responde dudas sin avanzar y solo confirma info después de enviar',async()=>{
 const id=randomUUID();await pg.query('insert into leads(id,nombre,whatsapp) values($1,$2,$3)',[id,'','+527471234000'])
 let out=await responderRuta(db,id,'quiero inscribirme',deps);assert.match(out!.mensaje,/nombre/)
 await responderRuta(db,id,'Soy Ana',deps)
 out=await responderRuta(db,id,'ana@example.test',deps);assert.match(out!.mensaje,/programa/)
 out=await responderRuta(db,id,'curso de inglés',deps);assert.match(out!.mensaje,/edad/)
 out=await responderRuta(db,id,'8 años',deps);assert.match(out!.mensaje,/modalidad/)
 out=await responderRuta(db,id,'en línea',deps);assert.match(out!.mensaje,/Información oficial/)
 let l=await cargarRuta(db,id);assert.equal(Boolean(l.ruta!.pasos[6]),false)
 await confirmarEntregaRuta(db,id,out!);l=await cargarRuta(db,id);assert.equal(l.ruta!.pasos[6].estado,'cumplido')
 out=await responderRuta(db,id,'quiero inscribirme',deps);assert.match(out!.mensaje,/\/inscripcion\/cursos-libres/)
 await confirmarEntregaRuta(db,id,out!);assert.equal((await cargarRuta(db,id)).paso,13)
})
test('Google Form CL Karla: mismo teléfono normalizado, curso correcto, paso14 y no ventas; retry idempotente',async()=>{
 const payload={programa:'cursos-libres' as const,pestana:'Respuestas de formulario CL',fila:74,datos:{whatsapp:'+527331068375',nombres:'Karla',curso:'Inglés para adultos',modalidad:'En línea'},carpeta:'https://drive.google.com/drive/folders/prueba'}
 const x=await recibirGoogleForm(db,payload);assert.equal(x.lead_id,karla)
 await recibirGoogleForm(db,payload)
 const l=await cargarRuta(db,karla);assert.equal(l.paso,14);assert.equal(l.curso,'Inglés para adultos');assert.equal(l.modalidad,'En línea')
 assert.equal((await pg.query('select * from inscripciones')).rows.length,1)
 assert.equal((await pg.query('select * from ruta_inscripcion_trabajos')).rows.length,1)
 const ctx={fase:'accion',lead:l,horasDesdeLead:72,horasDesdeBot:72,diasDesdeLead:3,dentroVentana24h:false}
 assert.equal(decidirSeguimientoAutomatico(ctx),null)
 const interno=(await pg.query<{nombre:string;email:string;whatsapp:string}>('select nombre,email,whatsapp from leads where id=$1',[canal])).rows[0]
 assert.deepEqual(interno,{nombre:'Harold',email:'harold@example.test',whatsapp:'+527474722466'})
})
test('Drive incompleto no acredita15; completo acredita15; no acredita16 ni17 por intención de pago',async()=>{
 assert.deepEqual(await aplicarRevision(db,karla,'cursos-libres',['acta']),['Comprobante de pago'])
 assert.equal((await cargarRuta(db,karla)).ruta!.pasos[15],undefined)
 await aplicarRevision(db,karla,'cursos-libres',['acta','comprobante'])
 const l=await cargarRuta(db,karla);assert.equal(l.paso,15);assert.equal(l.ruta!.pasos[16],undefined)
 assert.deepEqual(faltantesDocumentos('licenciaturas',['acta','comprobante']),['Certificado de bachillerato'])
 assert.equal(capturarEntrada(l,'ya pagué',{},fecha).ruta.pasos[17],undefined)
})
test('UTILITY entregada acredita16 una vez; Inscrito solo persona; control de versión evita pisar concurrencia',async()=>{
 let l=await cargarRuta(db,karla);await guardarRuta(db,l,marcar(l.ruta!,16,'cumplido',fecha,'utility'),{},'utility')
 await assert.rejects(()=>guardarRuta(db,l,l.ruta!),/Conflicto/)
 await assert.rejects(()=>pg.query("update leads set stage='inscrito' where id=$1",[karla]),/persona/)
 await pg.query("select set_config('test.uid',$1,false)",[asesor])
 await pg.query("update leads set stage='inscrito' where id=$1",[karla])
 l=await cargarRuta(db,karla);assert.equal(l.paso,17);assert.equal(l.ruta!.pasos[17].fuente,'persona')
 await assert.rejects(()=>pg.query("update leads set paso=1 where id=$1",[karla]),/lectura/)
 await pg.query("select set_config('test.uid','',false)")
})
test('archivado retorna al mismo progreso; una despedida no cierra la ruta',()=>{
 let r=marcar(rutaVacia(),1,'cumplido',fecha,'bot');r=marcar(r,2,'cumplido',fecha,'bot');r={...r,salida:'archivado'}
 const out=capturarEntrada({ruta:r,nombre:'Ana'},'gracias, hasta luego',{},fecha).ruta
 assert.equal(out.salida,null);assert.equal(pasoActual(out),2);assert.equal(siguientePaso(out),3)
})
test('examen/clase no se acredita por fase; cita y asistencia confirmada crean evidencia',async()=>{
 assert.equal(equivalenciaFase.examen,9)
 const id=randomUUID();await pg.query('insert into leads(id,whatsapp) values($1,$2)',[id,'+527471230001'])
 await pg.query("insert into citas(lead_id,status,tipo) values($1,'confirmada','examen_ubicacion')",[id]);assert.equal((await cargarRuta(db,id)).paso,10)
 await pg.query("update citas set status='completada' where lead_id=$1",[id]);assert.equal((await cargarRuta(db,id)).paso,12)
})
test('cadencia informado 20h/día3/día7/archivar se conserva leyendo ruta y no fase vieja',()=>{
 let r=rutaVacia();for(let n=1;n<=9;n++) r=marcar(r,n,'cumplido',fecha,'bot')
 const base={fase:'saludo',lead:{curso:'Inglés para adultos',ruta:r},horasDesdeLead:20,horasDesdeBot:20,diasDesdeLead:20/24,dentroVentana24h:true}
 assert.equal(decidirSeguimientoAutomatico(base)?.reglaId,'informado_20h_texto')
 for(const [dias,accion] of [[3,'template'],[7,'template'],[10,'archivar']] as const) assert.equal(decidirSeguimientoAutomatico({...base,diasDesdeLead:dias,horasDesdeLead:dias*24,dentroVentana24h:false})?.accion,accion)
})
test('embudo: saltados no cuentan, cohortes 30/60 no confunden inscripción tardía o fecha desconocida',()=>{
 const crear=(id:string,dia:number|null):LeadRuta=>({id,created_at:'2026-08-03T12:00:00Z',paso:17,ruta:{pasos:{1:{estado:'cumplido',fecha:'2026-08-03',fuente:'bot'},17:{estado:'cumplido',fecha:dia?new Date(Date.parse('2026-08-03')+dia*86400000).toISOString():null as any,fuente:'persona'},3:{estado:'saltado',fecha,fuente:'bot',motivo:'No proporcionado'}},dudas:[]}})
 const emb=calcularEmbudo([crear('a',10),crear('b',40),crear('c',null)],new Date('2026-11-01'))
 assert.equal(emb.pasos[2].total,0);assert.equal(emb.cohortes[0].ventanas[0].inscritos,1);assert.equal(emb.cohortes[0].ventanas[1].inscritos,2);assert.equal(emb.cohortes[0].ventanas[0].sinFecha,1)
})
test('Registro/2466 intercepta antes de crear lead, desenlaza canal y no usa captura de prospectos',async()=>{
 const source=await readFile(new URL('../app/api/whatsapp/webhook/route.ts',import.meta.url),'utf8')
 const post=source.slice(source.indexOf('export async function POST'))
 assert.ok(post.indexOf('await handleRegistroCommand')<post.indexOf('let leadSnapshot'))
 assert.match(post,/if \(waNumber && !esCanalInternoSeguimiento\(waNumber\)\)/)
 assert.match(source,/update\(\{ lead_id: null, fase: nuevaFase/)
 // Ejecutar el detector real y finalizarRegistro con SDK simulado para el texto del incidente.
 const start=source.indexOf('async function finalizarRegistro('),end=source.indexOf('/** Comando "memoria"',start)
 const {transformSync}=await import('esbuild')
 const fn=transformSync(source.slice(start,end),{loader:'ts',format:'cjs'}).code
 const writes:any[]=[];let respuesta='';const chain:any={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},maybeSingle:async()=>({data:{id:'conv-2466'}}),update(x:any){writes.push(x);return chain},insert(x:any){writes.push(x);return Promise.resolve({error:null})},then(resolve:any){return Promise.resolve({error:null}).then(resolve)}}
 const ctx=vm.createContext({buildProviderResponse:async(_p:string,t:string)=>{respuesta=t;return t}})
 vm.runInContext(fn+';this.finalizarRegistro=finalizarRegistro',ctx)
 await ctx.finalizarRegistro({from:(t:string)=>{assert.notEqual(t,'leads');return chain}},'+527474722466','meta','Registro +52 733 106 8375, Karla Galilea, karla@example.test, inglés para adultos','Confirma estos datos','registro_confirmar')
 assert.equal(writes[0].lead_id,null);assert.equal(respuesta,'Confirma estos datos')
})
test('migración reejecutable conserva respaldo, ruta actual y eventos; equivalencias SQL y TS coinciden',async()=>{
 for(const [f,n] of Object.entries(equivalenciaFase)){const out=await pg.query<{n:number|null}>('select ruta17_equivalencia($1) n',[f]);assert.equal(out.rows[0].n,n,f)}
 await pg.exec(await readFile(new URL('../supabase/windsor_ruta_17_pasos.sql',import.meta.url),'utf8'))
 assert.equal((await cargarRuta(db,karla)).paso,17)
 const {rows}=await pg.query<{n:number}>('select count(*)::int n from ruta17_respaldo_leads');assert.equal(rows[0].n,2)
})

test('Apps Script: el evento persiste al fallar CRM y el retry conserva la fila; Drive falla sin perder14',async()=>{
 const source=await readFile(new URL('../apps-script/InscripcionCRM.gs',import.meta.url),'utf8')
 const valores:Record<string,string>={};let intentos=0
 const props={getProperty:(k:string)=>valores[k],setProperty:(k:string,v:string)=>{valores[k]=v},deleteProperty:(k:string)=>{delete valores[k]},getProperties:()=>valores}
 const sheet={getSheetId:()=>7,getName:()=> 'Respuestas de formulario CL'}
 const context=vm.createContext({PropertiesService:{getScriptProperties:()=>props},SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet})},Logger:{log:()=>{}},onFormSubmit:()=>{throw new Error('Drive sin respuesta')},FORM_CONFIGS:{'Respuestas de formulario DIPLOMADOS':{}}})
 vm.runInContext(source,context)
 context.crmNotificarFila_=()=>{intentos++;if(intentos===1) throw new Error('CRM caído')}
 assert.throws(()=>context.crmAlRecibirGoogleForm({range:{getSheet:()=>sheet,getRow:()=>74}}),/CRM caído/)
 assert.ok(valores.CRM_PENDIENTE_7_74)
 context.crmReintentarEventos();assert.equal(intentos,2);assert.equal(valores.CRM_PENDIENTE_7_74,undefined)
})
test('RLS: lectura compartida solo equipo; RPC, respaldos y mutaciones de ruta no son públicos',async()=>{
 await pg.exec('grant usage on schema auth to authenticated;grant select on profiles,leads to authenticated;alter table leads enable row level security;')
 await pg.query("select set_config('test.uid',$1,false)",[asesor])
 await pg.exec('set role authenticated')
 try {
  assert.ok((await pg.query('select * from leads')).rows.length>=2)
  await assert.rejects(()=>pg.query('select * from ruta17_respaldo_leads'),/permission denied/)
  await assert.rejects(()=>pg.query("select guardar_ruta_lead($1,0,'{}','{}','bot',1,'Contacto')",[karla]),/permission denied/)
  const permissions=await pg.query<{ok:boolean}>("select has_function_privilege('authenticated','ruta17_aplicar_formulario(inscripciones)','execute') ok")
  assert.equal(permissions.rows[0].ok,false)
 } finally {await pg.exec('reset role');await pg.query("select set_config('test.uid','',false)")}
})
test('11-bis: menciones ambiguas nunca detienen y peticiones explícitas sí',()=>{
 for(const texto of ['diplomado en Recursos Humanos','¿el asesor me puede mandar el temario?','¿hay vacantes en el grupo sabatino?','no quiero perder la promo, ¿cuándo inicia?','por ahora no tengo dudas','no me interesa eso, ¿cuál es el precio?']) {
  const r=capturarEntrada({ruta:rutaVacia()},texto,{},fecha).ruta
  assert.ok(!r.persona,texto);assert.ok(!r.salida,texto)
 }
 for(const texto of ['no me interesa','no me interesa, gracias','ya no quiero','ya no, gracias','más adelante te escribo']) assert.equal(capturarEntrada({ruta:rutaVacia()},texto,{},fecha).ruta.salida,'archivado',texto)
 for(const texto of ['quiero hablar con un asesor','me puede llamar alguien','no quiero hablar con un bot']) assert.equal(capturarEntrada({ruta:rutaVacia()},texto,{},fecha).ruta.persona,fecha,texto)
 for(const texto of ['busco trabajo','solicito empleo','vacante de maestro','¿están contratando?']) assert.equal(capturarEntrada({ruta:rutaVacia()},texto,{},fecha).ruta.salida,'vacante',texto)
})
test('11-bis: nombres del catálogo y respuestas breves no son nombres personales',()=>{
 const l={ruta:marcar(rutaVacia(),1,'cumplido',fecha,'bot')}
 for(const texto of ['Psicología','Enfermería','Derecho','Inglés','Info','Precio','Ok','Sí','Farmacología','Francés','No tengo dudas']) assert.equal(datosEntrada(l,texto,deps.detectarPrograma).nombre,undefined,texto)
 assert.equal(datosEntrada(l,'Ana María',deps.detectarPrograma).nombre,'Ana María')
})
async function nuevoLeadRuta(curso='Inglés para adultos',conInfo=false) {
 const id=randomUUID();await pg.query('insert into leads(id,nombre,email,whatsapp,curso) values($1,$2,$3,$4,$5)',[id,'Ana','ana@example.test','+527471234001',curso])
 let l=await cargarRuta(db,id);let r=capturarEntrada(l,'',{modalidad:'En línea'},fecha).ruta
 if(conInfo) r=marcar(r,6,'cumplido',fecha,'envio')
 await guardarRuta(db,l,r,{modalidad:'En línea'});return id
}
test('11-bis: timeout RAG entrega pendiente y marca revisión, sin acreditar duda resuelta',async()=>{
 const id=await nuevoLeadRuta('Inglés para adultos',true)
 const out=await responderRuta(db,id,'¿Cuánto cuesta?',{...deps,duda:async()=>{throw new DOMException('Timeout 8 s','TimeoutError')}})
 assert.equal(out!.revision,true);assert.match(out!.mensaje,/duda|inscripción/);assert.equal(out!.convenio,false)
 const source=await readFile(new URL('../app/api/whatsapp/webhook/route.ts',import.meta.url),'utf8')
 const bloque=source.slice(source.indexOf('// Ruta 17:'),source.indexOf('// Si la conversación está en modo humano'))
 assert.match(bloque,/if\(resultado.revision\)/);assert.match(bloque,/solicitarRevisionCodigo/);assert.match(bloque,/lead_activities/);assert.doesNotMatch(bloque,/rutaPendiente: true/)
})
test('11-bis: dos mensajes simultáneos recargan versión y ambos obtienen respuesta',async()=>{
 const id=await nuevoLeadRuta('Inglés para adultos',true)
 const outs=await Promise.all(['¿Cuál es el precio?','¿Cuál es el horario?'].map(t=>responderRuta(db,id,t,deps)))
 assert.equal(outs.length,2);for(const out of outs) assert.match(out!.mensaje,/Respuesta a la duda/)
 assert.deepEqual((await cargarRuta(db,id)).ruta!.dudas.sort(),['horario','precio'])
})
test('11-bis: conflictos dos veces reintentan; RPC caído sale a revisión del webhook',async()=>{
 const {reintentarConflicto}=await import('../lib/whatsapp/ruta-bot')
 let n=0;assert.equal(await reintentarConflicto(async()=>{if(n++<2) throw new Error('Conflicto de ruta');return 'respuesta'}),'respuesta');assert.equal(n,3)
 n=0;await assert.rejects(()=>reintentarConflicto(async()=>{n++;throw new Error('Conflicto de ruta')}),/Conflicto/);assert.equal(n,3)
})
test('11-bis: diplomado una modalidad automática, botón inscripción entrega PDF bancario y enlace prellenado',async()=>{
 const id=await nuevoLeadRuta('Diplomado en Enfermería')
 const out=await responderRuta(db,id,'Me quiero inscribir',deps)
 assert.match(out!.mensaje,/Información oficial/);assert.match(out!.mensaje,/1Hj9rRk1zHMWGnG_CjF287W-hxY2AoTe9/);assert.match(out!.mensaje,/inscripcion\/diplomados\?/);assert.match(out!.mensaje,/wa=%2B527471234001/);assert.match(out!.mensaje,/nombre=Ana/)
 assert.equal((await cargarRuta(db,id)).ruta!.pasos[5].estado,'cumplido')
 assert.doesNotMatch(out!.mensaje,/modalidad prefieres/)
 await confirmarEntregaRuta(db,id,out!);assert.equal((await cargarRuta(db,id)).ruta!.pasos[13].estado,'cumplido')
})
test('11-bis: archivo conserva rechazo al confirmar; mensaje nuevo reactiva y persona vencida retoma',async()=>{
 const id=await nuevoLeadRuta('Inglés para adultos',true)
 let out=await responderRuta(db,id,'no me interesa',deps);await confirmarEntregaRuta(db,id,out!)
 assert.equal((await cargarRuta(db,id)).ruta!.salida,'archivado')
 out=await responderRuta(db,id,'¿Cuál es el horario?',deps);assert.match(out!.mensaje,/Respuesta a la duda/);assert.equal((await cargarRuta(db,id)).ruta!.salida,null)
 let l=await cargarRuta(db,id);await guardarRuta(db,l,{...l.ruta!,persona:'histórica; fecha desconocida'})
 out=await responderRuta(db,id,'Hola',deps);assert.ok(!out!.revision);assert.match(out!.mensaje,/duda|inscripción/)
 l=await cargarRuta(db,id);await guardarRuta(db,l,{...l.ruta!,persona:new Date(Date.now()-21*3600_000).toISOString()})
 out=await responderRuta(db,id,'Hola',deps);assert.ok(!out!.revision)
 out=await responderRuta(db,id,'quiero hablar con un asesor',deps);assert.equal(out!.revision,true)
})
test('11-bis: motor retoma persona vencida sin cambiar cadencia',()=>{
 let r=rutaVacia();for(let n=1;n<=9;n++) r=marcar(r,n,'cumplido',fecha,'bot')
 r.persona='histórica; fecha desconocida'
 const base={fase:'pendiente',lead:{curso:'Inglés para adultos',ruta:r},horasDesdeLead:20,horasDesdeBot:20,diasDesdeLead:20/24,dentroVentana24h:true,ahora:new Date(fecha)}
 assert.equal(decidirSeguimientoAutomatico(base)?.accion,'texto')
 r.persona=new Date(Date.parse(fecha)-21*3600_000).toISOString();assert.equal(decidirSeguimientoAutomatico(base)?.accion,'texto')
})
test('11-bis: multimedia y ubicación acusan y conservan pendiente sin inventar datos',async()=>{
 const id=await nuevoLeadRuta('Inglés para adultos',true)
 for(const texto of ['__MEDIA__','__LOCATION__']) {
  const out=await responderRuta(db,id,texto,deps);assert.match(out!.mensaje,/Gracias/);assert.match(out!.mensaje,/duda|inscripción/)
 }
})
test('11-bis: botones de dudas, espera, información y A/B licenciatura conservan respuesta',async()=>{
 const id=await nuevoLeadRuta('Licenciatura en Inglés',true)
 let out=await responderRuta(db,id,'Sí, tengo dudas',deps);assert.match(out!.mensaje,/Con gusto resuelvo tus dudas/)
 out=await responderRuta(db,id,'Necesito más tiempo',deps);assert.match(out!.mensaje,/Te damos espacio/)
 out=await responderRuta(db,id,'Sí, envíame la info',deps);assert.match(out!.mensaje,/Información oficial/)
 out=await responderRuta(db,id,'Quiero apartar mi lugar',deps);await confirmarEntregaRuta(db,id,out!)
 out=await responderRuta(db,id,'A',deps);assert.match(out!.mensaje,/Información bancaria/)
 out=await responderRuta(db,id,'B',{...deps,inscripcionPresencial:()=> 'Documentos para inscripción presencial'});assert.match(out!.mensaje,/inscripción presencial/)
})
test('reversa local conserva documentos, nuevos leads e historial y retira automatización nueva',async()=>{
 const antes=(await pg.query('select count(*)::int n from inscripciones')).rows[0]
 const eventos=(await pg.query('select count(*)::int n from lead_ruta_eventos')).rows[0]
 await pg.exec(await readFile(new URL('../supabase/windsor_ruta_17_pasos_reversa.sql',import.meta.url),'utf8'))
 assert.deepEqual((await pg.query('select count(*)::int n from inscripciones')).rows[0],antes)
 assert.deepEqual((await pg.query('select count(*)::int n from lead_ruta_eventos')).rows[0],eventos)
 assert.equal((await cargarRuta(db,karla)).paso,17)
})
