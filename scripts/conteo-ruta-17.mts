// Solo GET en Supabase; aplica el SQL exclusivamente a PostgreSQL embebido en memoria.
// No guarda PII ni credenciales en disco. Salida: conteos agregados.
import {readFile,writeFile} from 'node:fs/promises'
import {decidirSeguimientoAutomatico,esCanalInternoSeguimiento,inicioDiaMexicoIso,recordatorioDatoReciente} from '../lib/whatsapp/seguimiento-motor'
import {hasLeadName} from '../lib/whatsapp/nombres'
import {PGlite} from '@electric-sql/pglite'
const env=await readFile(process.argv[2]||'../../windsor/windsorcrm/.env.local','utf8')
const get=(k:string)=>env.match(new RegExp(`^${k}=(.*)$`,'m'))?.[1]?.trim().replace(/^['"]|['"]$/g,'').replace(/\\n$/,'').trim()
const url=get('NEXT_PUBLIC_SUPABASE_URL'),key=get('SUPABASE_SERVICE_ROLE_KEY')||get('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY')
if(!url||!key) throw new Error('Falta configuración de lectura')
async function leer(tabla:string,select:string){const out:any[]=[];for(let offset=0;;offset+=500){
 const u=new URL(`/rest/v1/${tabla}`,url);u.searchParams.set('select',select);u.searchParams.set('order','id.asc');u.searchParams.set('offset',String(offset));u.searchParams.set('limit','500')
 const res=await fetch(u,{headers:{apikey:key!,Authorization:`Bearer ${key}`}})
 if(!res.ok) throw new Error(`Lectura ${tabla}: HTTP ${res.status}`)
 const rows=await res.json();out.push(...rows);if(rows.length<500) break
}return out}
const [leads,convs,solicitudes,citas,mensajes]=await Promise.all([leer('leads','id,nombre,email,whatsapp,curso,stage,asignado_a,created_at'),leer('whatsapp_conversaciones','id,lead_id,whatsapp,fase,estado,modo_humano,ultimo_mensaje_at,provider,revision_codigo'),leer('inscripciones','id,lead_id,programa,datos,documentos,created_at'),leer('citas','id,lead_id,tipo,status'),leer('whatsapp_mensajes','id,conversacion_id,rol,contenido,created_at,raw_payload')])
const pg=new PGlite()
try {
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text);
 create table profiles(id uuid primary key,rol text,whatsapp text);
 create table leads(id uuid primary key,nombre text,email text,whatsapp text,curso text,stage text,asignado_a uuid,created_at timestamptz);
 create table whatsapp_conversaciones(id uuid primary key,lead_id uuid,whatsapp text,fase text,estado text,modo_humano boolean,ultimo_mensaje_at timestamptz);
 create table whatsapp_mensajes(id uuid primary key,conversacion_id uuid,rol text,contenido text,created_at timestamptz);
 create table citas(id uuid primary key,lead_id uuid,tipo text,status text);
 create table lead_activities(id uuid,lead_id uuid,actor_id uuid,event_type text,title text,detail text,meta jsonb);`)
 await pg.exec(await readFile('supabase/inscripciones_publicas.sql','utf8'))
 async function cargar(tabla:string,rows:any[]) {for(const r of rows) {const keys=Object.keys(r);await pg.query(`insert into ${tabla}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(r).map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v))}}
 await cargar('leads',leads);await cargar('whatsapp_conversaciones',convs.map(({provider,revision_codigo,...row})=>row));await cargar('inscripciones',solicitudes);await cargar('citas',citas)
 await pg.exec(await readFile('supabase/windsor_ruta_17_pasos.sql','utf8'))
 const conteos=await pg.query(`select paso,bloque,count(*)::int total from leads where coalesce(ruta->>'salida','')<>'vacante' and telefono_inscripcion(whatsapp) is distinct from '527474722466' group by paso,bloque order by paso`)
 const salidas=await pg.query(`select coalesce(ruta->>'salida','activo') salida,count(*)::int total from leads group by 1 order by 1`)
 const canon=(s:string)=>s.replace(/\D/g,'').replace(/^521(?=\d{10}$)/,'52')
 const casoKarla=leads.filter(l=>canon(l.whatsapp||'')==='527331068375').map(l=>({id:l.id,conversaciones:convs.filter(c=>c.lead_id===l.id).map(c=>({id:c.id,canalInterno:canon(c.whatsapp||'')==='527474722466',fase:c.fase}))}))
 const migrados=(await pg.query<any>('select * from leads')).rows
 const nuevasConvs=(await pg.query<any>('select * from whatsapp_conversaciones')).rows
 const porLead=new Map(migrados.map(l=>[l.id,l]))
 const ahora=new Date(),inicio=inicioDiaMexicoIso(ahora),fin=new Date(Date.parse(inicio)+86400000).toISOString()
 const raw=(m:any)=>m.raw_payload?.seguimiento_motor
 const enviadosHoy=mensajes.filter(m=>m.rol==='bot'&&m.created_at>=inicio&&m.created_at<fin&&raw(m)?.accion==='template').length
 const candidatas:any[]=[];const omisiones:Record<string,number>={}
 const omitir=(motivo:string)=>{omisiones[motivo]=(omisiones[motivo]||0)+1}
 for(const c of [...convs].sort((a,b)=>String(b.ultimo_mensaje_at||'').localeCompare(String(a.ultimo_mensaje_at||''))||a.id.localeCompare(b.id))) {
  const l=porLead.get(c.lead_id)||migrados.find(l=>canon(l.whatsapp||'')===canon(c.whatsapp||''));if(!l) continue
  const nuevo=l.paso<=5;const omit=(m:string)=>{if(nuevo)omitir(m)}
  if(!['abierta','cerrada'].includes(c.estado)) {omit('estado fuera del motor');continue}
  if(esCanalInternoSeguimiento(c.whatsapp)||esCanalInternoSeguimiento(l.whatsapp)) continue
  if(c.provider==='messenger'||c.modo_humano||c.revision_codigo) {omit('messenger/humano/revisión');continue}
  const todos=mensajes.filter(m=>m.conversacion_id===c.id).sort((a,b)=>b.created_at.localeCompare(a.created_at))
  const ms=todos.slice(0,60),ultimo=ms[0],u=ms.find(m=>m.rol==='usuario')
  const fase=nuevasConvs.find(n=>n.id===c.id)?.fase||'saludo',asesor=['asesor','pendiente','con_asesor'].includes(fase)
  if(!ultimo||!u) {omit('sin mensajes/usuario');continue}
  if((!asesor&&ultimo.rol!=='bot')||(asesor&&ultimo.rol!=='usuario')) {omit('no espera al bot');continue}
  if(ms.some(m=>m.rol==='bot'&&m.created_at>=inicio&&raw(m))) {omit('seguimiento hoy');continue}
  const h=(ahora.getTime()-Date.parse(u.created_at))/3600000,hb=ultimo.rol==='bot'?(ahora.getTime()-Date.parse(ultimo.created_at))/3600000:h
  const textoBot=ultimo.contenido||'',parrafo=textoBot.trim().split(/\n\s*\n/).pop()||''
  const pregunta:Record<string,RegExp>={saludo:/c[oó]mo te llamas|tu nombre|con qui[eé]n tengo el gusto/i,correo:/correo/i,programa:/qu[eé] programa|cu[aá]l.{0,40}te interesa/i}
  const d=decidirSeguimientoAutomatico({fase,lead:{...l,nombre:hasLeadName(l.nombre,l.whatsapp)?l.nombre:null},horasDesdeLead:h,horasDesdeBot:hb,diasDesdeLead:h/24,dentroVentana24h:h<23.5,ultimoBotFuePreguntaDato:ultimo.rol==='bot'&&!!pregunta[fase]?.test(parrafo),yaRecibioInfo:ms.some(m=>m.rol==='bot'&&(/\$\s?\d/.test(m.contenido||'')||(/inscripci[oó]n|mensualidad|colegiatura/i.test(m.contenido||'')&&(m.contenido||'').length>300)||/no (ofrecemos|contamos con|tenemos|manejamos)/i.test(m.contenido||''))),yaTienePrograma:!!l.curso&&!/^(whatsapp|messenger) - instituto windsor$/i.test(l.curso),yaTieneNombre:hasLeadName(l.nombre,l.whatsapp),ultimoTextoUsuario:u.contenido,ahora})
  if(!d) {omit('sin regla');continue}
  if(d.reglaId==='nuevo_3h_dato'&&recordatorioDatoReciente(todos.filter(m=>m.rol==='bot'&&raw(m)?.reglaId==='nuevo_3h_dato'&&Date.parse(m.created_at)>=ahora.getTime()-86400000),fase,ahora)) {omit('dato recordado <24h');continue}
  if(ms.some(m=>m.rol==='bot'&&m.created_at>u.created_at&&raw(m)?.reglaId===d.reglaId)) {omit('regla ya disparada');continue}
  if(h>30*24&&ms.some(m=>m.rol==='bot'&&m.created_at>u.created_at&&raw(m))) {omit('backlog ya seguido');continue}
  candidatas.push({nuevo,lead:l.id,accion:d.accion})
 }
 const cupo=Math.max(0,40-enviadosHoy);let usados=0
 const elegidas=candidatas.filter(c=>c.accion!=='template'||usados++<cupo)
 const ids=(rows:any[])=>new Set(rows.map(r=>r.lead)).size
 const dryRun={fecha:ahora.toISOString(),limiteDia:40,enviadosHoy,cupoDisponible:cupo,nuevosPasos1a5:migrados.filter(l=>l.paso<=5&&!esCanalInternoSeguimiento(l.whatsapp)&&l.ruta.salida!=='vacante').length,
   recibirian:ids(elegidas.filter(c=>c.nuevo&&['texto','template'].includes(c.accion))),texto:ids(elegidas.filter(c=>c.nuevo&&c.accion==='texto')),plantilla:ids(elegidas.filter(c=>c.nuevo&&c.accion==='template')),
   plantillasCandidatasNuevo:ids(candidatas.filter(c=>c.nuevo&&c.accion==='template')),otrasAccionesNuevo:elegidas.filter(c=>c.nuevo&&!['texto','template'].includes(c.accion)).length,omisionesNuevo:omisiones,
   nota:'Mismos filtros/cadencias del motor; cupo 40 compartido con todos los pasos; cierres no son envíos. Simulación en horario de corrida, sin llamar endpoints de motor ni enviar.'}
 const bis={cerradosReabiertos:convs.filter(c=>c.fase==='cerrado'&&nuevasConvs.some(n=>n.id===c.id&&n.fase==='accion'&&n.estado==='abierta')).length,
   personaHistoricaSinModoHumano:migrados.filter(l=>l.ruta.persona&&!convs.some(c=>c.lead_id===l.id&&c.modo_humano)).length,
   personaHistoricaSinModoHumanoAntes:leads.filter(l=>{const c=convs.filter(c=>c.lead_id===l.id).sort((a,b)=>String(b.ultimo_mensaje_at||'').localeCompare(String(a.ultimo_mensaje_at||''))||a.id.localeCompare(b.id))[0];return c&&['asesor','pendiente','con_asesor'].includes(c.fase)&&!convs.some(c=>c.lead_id===l.id&&c.modo_humano)}).length,
   inscripcionesQuePasanA14:migrados.filter(l=>l.ruta.pasos['14']?.estado==='cumplido'&&l.ruta.pasos['14']?.fuente==='formulario').length,dryRun}
 const resumen={bis,casoKarla,fecha:new Date().toISOString(),modo:'GET remoto + migración en PostgreSQL temporal; sin SQL remoto',leads:leads.length,conversaciones:convs.length,solicitudes:solicitudes.length,citas:citas.length,conteos:conteos.rows,salidas:salidas.rows}
 await writeFile('/private/tmp/windsor-ruta-17-conteos.json',JSON.stringify(resumen,null,2));console.log(JSON.stringify(resumen,null,2))
} finally {await pg.close()}
