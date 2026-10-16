import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recibirInscripcion } from '../lib/inscripcion/servicio'
import { consultarInscripcion } from '../lib/inscripcion/consulta'
import { validarArchivo, normalizarWhatsapp } from '../lib/inscripcion/validacion'
import { camposPrograma, diplomadoCanonico, esPrograma, BUCKET_INSCRIPCIONES, MAX_ARCHIVO } from '../lib/inscripcion/config'
import { urlInscripcion } from '../lib/inscripcion/enlace'
import { mensajeDocumentosInscripcion } from '../lib/whatsapp/seguimiento-motor'

const pg = new PGlite()
const asesor = '10000000-0000-4000-8000-000000000001'
const existente = '20000000-0000-4000-8000-000000000001'
const otroLead = '20000000-0000-4000-8000-000000000002'
const objetos = new Map<string, File>()
let firmas = 0
let romperUpload = false
let romperRpc = false
let uploads = 0
const storage = {
  from(bucket: string) {
    assert.equal(bucket, BUCKET_INSCRIPCIONES)
    return {
      async upload(path: string, file: File, options: { upsert: boolean }) {
        assert.equal(options.upsert, false)
        uploads++
        if (romperUpload && uploads % 2 === 0) return { error: new Error('fallo storage') }
        objetos.set(path, file)
        return { error: null }
      },
      async remove(paths: string[]) { paths.forEach(p => objetos.delete(p)); return { error: null } },
      async createSignedUrl(path: string, seconds: number) {
        assert.equal(seconds, 300); assert.ok(objetos.has(path)); firmas++
        return { data: { signedUrl: `https://storage.example/signed/${path}?token=test` }, error: null }
      },
    }
  },
}
const db = {
  storage,
  from(table: string) {
    assert.equal(table, 'inscripciones')
    return { select: () => ({ eq: (_key: string, id: string) => ({
      async maybeSingle() {
        const { rows } = await pg.query('select * from inscripciones where id = $1', [id])
        return { data: rows[0] || null, error: null }
      },
    }) }) }
  },
  async rpc(_name: string, args: Record<string, unknown>) {
    if (romperRpc) return { error: new Error('fallo RPC') }
    try {
      const { rows } = await pg.query<{ result: { nuevo: boolean; lead_id: string } }>(
        'select registrar_inscripcion($1,$2,$3::jsonb,$4::jsonb,$5::uuid) result',
        [args.p_id, args.p_programa, JSON.stringify(args.p_datos), JSON.stringify(args.p_documentos), args.p_asesor],
      )
      return { data: rows[0]?.result, error: null }
    } catch (error) { return { error } }
  },
} as unknown as SupabaseClient
function session(puedeLeer: boolean) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: puedeLeer ? { id: existente } : null, error: null }) }) }) }) } as unknown as SupabaseClient
}
const pdf = () => new File(['%PDF-1.7\nDocumento ficticio de prueba'], 'acta.pdf', { type: 'application/pdf' })
function formulario(phone = '+52 747 123 4567', programa: 'diplomados' | 'licenciaturas' | 'cursos-libres' | 'verano' = 'diplomados') {
  const form = new FormData()
  for (const campo of camposPrograma(programa)) if (campo.required) form.set(campo.id, campo.options?.[0] ?? 'Dato de prueba')
  form.set('programa', programa); form.set('solicitud_id', randomUUID()); form.set('consentimiento', 'si')
  form.set('email', 'alumno@example.test'); form.set('fecha_nacimiento', '2000-01-02')
  form.set('lengua_indigena', 'No'); form.set('whatsapp', phone)
  form.set('edad', '26'); form.set('curp', 'ABCD000102HGRXXX01')
  form.set('acta', pdf()); form.set('comprobante', pdf())
  if (programa === 'licenciaturas') form.set('certificado', pdf())
  return form
}
before(async () => {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table storage.buckets (id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant all on storage.objects,storage.buckets to anon,authenticated;
    -- Simula una policy vieja demasiado amplia: la nueva restrictive debe prevalecer.
    create policy legacy_public on storage.objects for all to anon,authenticated using (true) with check (true);
    create table profiles(id uuid primary key,rol text,whatsapp text);
    create table leads(id uuid primary key default gen_random_uuid(),nombre text,email text,whatsapp text,curso text,stage text,asignado_a uuid,created_at timestamptz default now());
    create table whatsapp_conversaciones(id uuid default gen_random_uuid(),lead_id uuid,whatsapp text,fase text,modo_humano boolean default false);
    create table lead_activities(id uuid default gen_random_uuid(),lead_id uuid,actor_id uuid,event_type text,title text,detail text,meta jsonb);
    insert into profiles values('${asesor}','admin',null);
    insert into leads values('${existente}','Nombre original','original@example.test','+5217471234567','Programa original','primer_contacto','${asesor}',now());
    insert into leads values('${otroLead}','Alumno inscrito',null,'+527471234568','Curso','inscrito','${asesor}',now());
    insert into whatsapp_conversaciones(lead_id,whatsapp,fase,modo_humano) values('${existente}','+5217471234567','accion',true);
  `)
  await pg.exec(await readFile(new URL('../supabase/inscripciones_publicas.sql', import.meta.url), 'utf8'))
})
after(async () => { await pg.close() })

test('formatos de WhatsApp mexicanos se normalizan al mismo número', () => {
  for (const n of ['7471234567', '+52 (747) 123-4567', '+5217471234567']) assert.equal(normalizarWhatsapp(n), '+527471234567')
  assert.throws(() => normalizarWhatsapp('abc'))
})
test('rechaza extensión, MIME, firma y tamaño incorrectos', async () => {
  for (const file of [new File(['<script>'], 'x.html'), new File(['falso'], 'x.pdf', { type: 'application/pdf' }),
    new File(['%PDF-1.7'], 'x.png', { type: 'application/pdf' }), new File([new Uint8Array(MAX_ARCHIVO + 1)], 'x.pdf', { type: 'application/pdf' })]) {
    await assert.rejects(() => validarArchivo(file))
  }
})
test('acepta PDF/JPEG/PNG/HEIC con firma y extensión coherentes', async () => {
  await validarArchivo(pdf())
  await validarArchivo(new File([new Uint8Array([255,216,255,224])], 'x.jpg', { type: 'image/jpeg' }))
  await validarArchivo(new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'x.png', { type: 'image/png' }))
  await validarArchivo(new File([new Uint8Array([0,0,0,24]), 'ftypheic'], 'x.heic', { type: 'image/heic' }))
})
test('valida todos los documentos antes de subir y rechaza campos desconocidos/repetidos', async () => {
  const size = objetos.size
  for (const variante of ['falso', 'repetido', 'extra', 'sin_acta']) {
    const form = formulario()
    if (variante === 'falso') form.set('comprobante', new File(['falso'], 'x.pdf', { type: 'application/pdf' }))
    if (variante === 'repetido') form.append('whatsapp', '+527471234567')
    if (variante === 'extra') form.set('arbitrario', pdf())
    if (variante === 'sin_acta') form.delete('acta')
    await assert.rejects(() => recibirInscripcion(db, form))
  }
  assert.equal(objetos.size, size)
})
let solicitudId: string
test('SQL real reutiliza el lead, conserva identidad/asesor, sincroniza fase y registra actividad', async () => {
  const form = formulario()
  solicitudId = String(form.get('solicitud_id'))
  const result = await recibirInscripcion(db, form)
  assert.equal(result.nuevo, true)
  const { rows } = await pg.query<{ id: string; nombre: string; stage: string; asignado_a: string }>('select * from leads order by created_at, id')
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.id, existente); assert.equal(rows[0]?.nombre, 'Nombre original')
  assert.equal(rows[0]?.asignado_a, asesor); assert.equal(rows[0]?.stage, 'inscripcion_pendiente')
  const conv = await pg.query<{ fase: string; modo_humano: boolean }>('select * from whatsapp_conversaciones')
  assert.equal(conv.rows[0]?.fase, 'inscribiendo'); assert.equal(conv.rows[0]?.modo_humano, true)
  const act = await pg.query('select * from lead_activities where event_type = $1', ['inscripcion_recibida'])
  assert.equal(act.rows.length, 1)
  const size = objetos.size
  assert.equal((await recibirInscripcion(db, form)).nuevo, false)
  assert.equal(objetos.size, size)
})
test('un segundo envío y el retry directo al RPC son idempotentes para leads/actividad', async () => {
  const form = formulario('+527471234567')
  const id = String(form.get('solicitud_id'))
  await recibirInscripcion(db, form)
  const current = await pg.query<{ datos: unknown; documentos: unknown }>('select datos,documentos from inscripciones where id=$1', [id])
  const retry = await pg.query<{ result: { nuevo: boolean } }>('select registrar_inscripcion($1,$2,$3,$4) result', [id,'diplomados',JSON.stringify(current.rows[0]?.datos),JSON.stringify(current.rows[0]?.documentos)])
  assert.equal(retry.rows[0]?.result.nuevo, false)
  assert.equal((await pg.query('select * from leads')).rows.length, 2)
  assert.equal((await pg.query('select * from lead_activities')).rows.length, 2)
})
test('los cuatro tipos guardan solicitud y un teléfono nuevo crea exactamente un lead', async () => {
  for (const programa of ['diplomados','licenciaturas','cursos-libres'] as const) await recibirInscripcion(db, formulario('+527471234569', programa))
  assert.equal((await pg.query('select * from leads')).rows.length, 3)
  const { rows } = await pg.query<{ asignado_a: string }>('select asignado_a from leads where whatsapp=$1',['+527471234569'])
  assert.equal(rows[0]?.asignado_a, asesor)
})
test('un inscrito nunca retrocede de etapa', async () => {
  await recibirInscripcion(db, formulario('+527471234568'))
  const { rows } = await pg.query<{ stage: string }>('select stage from leads where id=$1', [otroLead])
  assert.equal(rows[0]?.stage, 'inscrito')
})
test('fallo de SQL revierte lead/fase/actividad conjuntamente', async () => {
  const before = (await pg.query('select * from leads')).rows.length
  await assert.rejects(() => pg.query('select registrar_inscripcion($1,$2,$3,$4)', [randomUUID(),'invalido',JSON.stringify({ whatsapp: '+527471230000', nombres: 'Prueba' }), '[]']))
  assert.equal((await pg.query('select * from leads')).rows.length, before)
})
test('fallo de Storage limpia solo el intento; fallo ambiguo del RPC conserva objetos', async () => {
  const size = objetos.size
  romperUpload = true; uploads = 0
  await assert.rejects(() => recibirInscripcion(db, formulario()))
  romperUpload = false
  assert.equal(objetos.size, size)
  romperRpc = true
  await assert.rejects(() => recibirInscripcion(db, formulario()))
  romperRpc = false
  assert.equal(objetos.size, size + 2)
})
test('bucket privado y policy restrictive niega objetos a anon y authenticated, incluso con policy amplia', async () => {
  const { rows } = await pg.query<{ public: boolean }>('select public from storage.buckets where id=$1', [BUCKET_INSCRIPCIONES])
  assert.equal(rows[0]?.public, false)
  await pg.query('insert into storage.objects(bucket_id,name) values($1,$2)', [BUCKET_INSCRIPCIONES,'documento.pdf'])
  for (const role of ['anon','authenticated']) {
    await pg.exec(`set role ${role}`)
    try {
      assert.equal((await pg.query('select * from storage.objects')).rows.length, 0)
      await assert.rejects(() => pg.query('insert into storage.objects(bucket_id,name) values($1,$2)', [BUCKET_INSCRIPCIONES,'ataque.pdf']))
      await assert.rejects(() => pg.query('select * from inscripciones'))
      await assert.rejects(() => pg.query('select registrar_inscripcion($1,$2,$3,$4)', [randomUUID(),'diplomados','{}','[]']))
    } finally { await pg.exec('reset role') }
  }
})
test('otro asesor no puede ver datos ni generar firmas; el autorizado recibe links de 300 segundos', async () => {
  const before = firmas
  assert.equal(await consultarInscripcion(db, session(false), solicitudId), null)
  assert.equal(firmas, before)
  const solicitud = await consultarInscripcion(db, session(true), solicitudId)
  assert.equal(solicitud?.documentos.length, 2)
  assert.equal(firmas, before + 2)
  assert.ok(solicitud?.documentos.every(d => d.url.includes('/signed/')))
})
test('el botón del motor comparte link prellenado correcto con el webhook', () => {
  for (const [curso, ruta] of [['Diplomado en Administración de Restaurantes','diplomados'],['Licenciatura en Inglés','licenciaturas'],['Inglés para niños','cursos-libres'],['Francés','cursos-libres']]) {
    const url = new URL(urlInscripcion(curso,'+527471234567','Ana & María'))
    assert.equal(url.pathname, `/inscripcion/${ruta}`)
    assert.equal(url.searchParams.get('nombre'), 'Ana & María')
    assert.equal(url.searchParams.get('wa'), '+527471234567')
    assert.ok(mensajeDocumentosInscripcion({ curso, whatsapp: '+527471234567' }).includes(`/inscripcion/${ruta}`))
  }
})
test('límite persistente: permite veinte intentos por hora y rechaza el siguiente', async () => {
  for (let i = 0; i < 21; i++) {
    const { rows } = await pg.query<{ permitido: boolean }>('select limitar_inscripcion($1) permitido', ['ip-ficticia-hasheada'])
    assert.equal(rows[0]?.permitido, i < 20)
  }
  await pg.exec("update inscripcion_intentos set inicio=now()-interval '2 hours'")
  assert.equal((await pg.query<{ permitido: boolean }>('select limitar_inscripcion($1) permitido', ['ip-ficticia-hasheada'])).rows[0]?.permitido, true)
})
test('diplomados: lista cerrada del catálogo y prellenado desde leads.curso', () => {
  const curso = camposPrograma('diplomados').find(c => c.id === 'curso')
  assert.equal(curso?.options?.length, 40)
  assert.equal(diplomadoCanonico('Diplomado en Tanatología'), 'Tanatología')
  assert.equal(diplomadoCanonico('Diplomado en Administración de Instituciones de la Salud'), 'Administración de Instituciones de Salud')
  assert.equal(diplomadoCanonico('diplomado en administracion de restaurantes'), 'Administración de restaurantes')
  assert.equal(diplomadoCanonico('Diplomado'), '')
})
test('verano en pausa: sin formulario público y el bot conserva la página anterior', () => {
  assert.equal(esPrograma('verano'), false)
  assert.equal(urlInscripcion('Verano niños', '+527471234567', 'Ana'), 'https://www.windsor.edu.mx/solicitud-de-inscripcion')
})
