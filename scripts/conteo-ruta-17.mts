// Solo GET en Supabase; aplica el SQL exclusivamente a PostgreSQL embebido en memoria.
// No guarda PII ni credenciales en disco. Salida: conteos agregados.
import {readFile,writeFile} from 'node:fs/promises'
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
const [leads,convs,solicitudes,citas]=await Promise.all([leer('leads','id,nombre,email,whatsapp,curso,stage,asignado_a,created_at'),leer('whatsapp_conversaciones','id,lead_id,whatsapp,fase,estado,modo_humano,ultimo_mensaje_at'),leer('inscripciones','id,lead_id,programa,datos,documentos,created_at'),leer('citas','id,lead_id,tipo,status')])
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
 await cargar('leads',leads);await cargar('whatsapp_conversaciones',convs);await cargar('inscripciones',solicitudes);await cargar('citas',citas)
 await pg.exec(await readFile('supabase/windsor_ruta_17_pasos.sql','utf8'))
 const conteos=await pg.query(`select paso,bloque,count(*)::int total from leads where coalesce(ruta->>'salida','')<>'vacante' and telefono_inscripcion(whatsapp) is distinct from '527474722466' group by paso,bloque order by paso`)
 const salidas=await pg.query(`select coalesce(ruta->>'salida','activo') salida,count(*)::int total from leads group by 1 order by 1`)
 const canon=(s:string)=>s.replace(/\D/g,'').replace(/^521(?=\d{10}$)/,'52')
 const casoKarla=leads.filter(l=>canon(l.whatsapp||'')==='527331068375').map(l=>({id:l.id,conversaciones:convs.filter(c=>c.lead_id===l.id).map(c=>({id:c.id,canalInterno:canon(c.whatsapp||'')==='527474722466',fase:c.fase}))}))
 const resumen={casoKarla,fecha:new Date().toISOString(),modo:'GET remoto + migración en PostgreSQL temporal; sin SQL remoto',leads:leads.length,conversaciones:convs.length,solicitudes:solicitudes.length,citas:citas.length,conteos:conteos.rows,salidas:salidas.rows}
 await writeFile('/private/tmp/windsor-ruta-17-conteos.json',JSON.stringify(resumen,null,2));console.log(JSON.stringify(resumen,null,2))
} finally {await pg.close()}
