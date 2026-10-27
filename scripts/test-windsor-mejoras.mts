import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { clasificarContacto } from '../lib/whatsapp/contactos'
import { avisarAdmin } from '../lib/whatsapp/avisos-admin'
import { firmaMetaValida, templateBloqueado } from '../lib/whatsapp/entregas'
import { POST } from '../app/api/whatsapp/webhook/route'
import { GET } from '../app/api/whatsapp/seguimiento-motor/route'
import { respuestaRevisionVencida } from '../lib/whatsapp/revision-timeout'
import { diasInactividadHumana } from '../lib/whatsapp/modo-humano'
import { hasLeadName } from '../lib/whatsapp/nombres'

const db = () => createClient('https://mejoras-test.supabase.co', 'fake', { auth: { persistSession: false } })
const ahora = new Date('2026-10-26T16:00:00Z')
const hace = (h: number) => new Date(ahora.getTime() - h * 3600_000).toISOString()
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://mejoras-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake', META_APP_SECRET: 'fake-secret', META_WHATSAPP_TOKEN: 'fake', META_PHONE_NUMBER_ID: 'fake', META_WHATSAPP_BUSINESS_ACCOUNT_ID: 'fake', CRON_SECRET: 'fake' }

test('clasificación conserva decisiones manuales y distingue consultas de venta', () => {
  for (const text of ['El día de hoy si habrá clases?', '¿hay clase hoy?', 'Envío la calificación de Luna', 'Pueden darme una constancia de que estoy haciendo el curso?', 'Y para la regularización del mes que no asistí…', 'Ya pagué la mensualidad', 'Mi hija estudia en el grupo de inglés', 'Quiero pagar mi mensualidad', 'mi maestro de Windsor no ha llegado']) assert.equal(clasificarContacto(text), 'alumno', text)
  for (const text of ['¿Cuánto cuesta la mensualidad?', '¿Cuánto voy a pagar de mensualidad?', '¿Dan constancia al terminar?', 'Quiero inscribirme', 'Mi hija quiere aprender inglés']) assert.equal(clasificarContacto(text), 'prospecto', text)
  assert.equal(clasificarContacto('Quiero información', 'alumno'), 'prospecto')
  assert.equal(clasificarContacto('¿hay clase hoy?', 'prospecto', true), 'prospecto')
  assert.equal(clasificarContacto('Quiero información', 'alumno', true), 'alumno')
  assert.doesNotMatch(respuestaRevisionVencida('Diplomado en Epidemiología', 'alumno'), /inscripci|precio|diplomado|formulario|horas/i)
})

test('Saludos y sus variantes no se capturan como nombre; nombres reales siguen válidos', () => {
  for (const text of ['Slaudos', 'Saludos', 'Buenas tardes', 'Saludos cordiales', 'Saluditos', 'Salduos', 'Hloa']) assert.equal(hasLeadName(text, ''), false)
  for (const text of ['Ana Luna', 'Angel de la cruz roque', 'Salvador García']) assert.equal(hasLeadName(text, ''), true)
})

for (const caso of [
  { nombre: 'ventana abierta', h: 2, status: 'APPROVED', category: 'UTILITY', language: 'es_MX', tipo: 'text' },
  { nombre: 'ventana cerrada y aprobado', h: 25, status: 'APPROVED', category: 'UTILITY', language: 'es_MX', tipo: 'template' },
  { nombre: 'sin mensaje previo de Harold', h: null, status: 'APPROVED', category: 'UTILITY', language: 'es_MX', tipo: 'template' },
  ...['PENDING','REJECTED','PAUSED'].map(status => ({ nombre: status, h: 25, status, category: 'UTILITY', language: 'es_MX', tipo: 'text' })),
  { nombre: 'categoría incorrecta', h: 25, status: 'APPROVED', category: 'MARKETING', language: 'es_MX', tipo: 'text' },
  { nombre: 'idioma incorrecto', h: 25, status: 'APPROVED', category: 'UTILITY', language: 'es', tipo: 'text' },
]) test(`aviso a Harold: ${caso.nombre}`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: ahora })
  const old = { ...process.env }; Object.assign(process.env, env); t.after(() => { process.env = old })
  const enviados: any[] = []; let consultasMeta = 0
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const req = new Request(input, init), url = new URL(req.url)
    if (url.hostname === 'graph.facebook.com') {
      if (req.method === 'GET') { consultasMeta++; return Response.json({ data: [{ name: 'windsor_aviso_interno', ...caso }] }) }
      enviados.push(await req.json()); return Response.json({ messages: [{ id: 'wamid.aviso' }] })
    }
    assert.equal(url.hostname, 'mejoras-test.supabase.co')
    assert.equal(req.method, 'GET')
    if (url.pathname.endsWith('/whatsapp_conversaciones')) return Response.json([{ id: 'admin' }])
    assert.equal(url.searchParams.get('rol'), 'eq.usuario', 'solo el mensaje entrante abre ventana')
    return Response.json(caso.h === null ? null : { created_at: hace(caso.h) })
  })
  const body = '🎓 ALUMNO ❓ [A1] Ana (+525500000001): constancia. Responde A1: explicación'
  assert.equal((await avisarAdmin(db(), body)).id, 'wamid.aviso')
  assert.equal(enviados.length, 1); assert.equal(enviados[0].to, '527471028306')
  assert.equal(enviados[0].type, caso.tipo)
  if (caso.tipo === 'template') {
    assert.equal(enviados[0].template.name, 'windsor_aviso_interno')
    assert.equal(enviados[0].template.language.code, 'es_MX')
    assert.match(enviados[0].template.components[0].parameters[0].text, /ALUMNO.*A1.*constancia.*Responde A1/)
    assert.equal(enviados[0].template.components[0].parameters[2].text, '+525500000001')
  } else assert.equal(enviados[0].text.body, body)
  assert.equal(consultasMeta, caso.h === 2 ? 0 : 1)
})

for (const caso of ['válido', 'firma inválida', 'sin secreto', 'falla DB']) test(`statuses firmados: ${caso}`, async t => {
  const old = { ...process.env }; Object.assign(process.env, env); if (caso === 'sin secreto') delete process.env.META_APP_SECRET
  t.after(() => { process.env = old })
  const rpc: any[] = []
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const req = new Request(input, init), url = new URL(req.url)
    assert.equal(url.hostname, 'mejoras-test.supabase.co', 'sin envíos por callbacks de estados')
    assert.equal(url.pathname, '/rest/v1/rpc/registrar_entrega_whatsapp')
    rpc.push(await req.json())
    return caso === 'falla DB' ? Response.json({ message: 'fallo simulado' }, { status: 500 }) : Response.json(1)
  })
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.a', status: 'failed', timestamp: '1793030400', errors: [{ code: 131049, title: 'Marketing limit', error_data: { details: 'Meta limitó la entrega de Marketing.' } }] }] } }] }, { changes: [{ value: { statuses: [{ id: 'wamid.b', status: 'delivered', timestamp: '1793030401' }] } }] }] })
  const firma = 'sha256=' + createHmac('sha256', env.META_APP_SECRET).update(raw).digest('hex')
  assert.equal(firmaMetaValida(raw, firma, env.META_APP_SECRET), true)
  assert.equal(firmaMetaValida(raw + ' ', firma, env.META_APP_SECRET), false)
  const response = await POST(new Request('http://localhost/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': caso === 'firma inválida' ? 'sha256=' + '0'.repeat(64) : firma }, body: raw }))
  assert.equal(response.status, caso === 'válido' || caso === 'sin secreto' ? 200 : caso === 'firma inválida' ? 401 : 503)
  assert.equal(rpc.length, caso === 'válido' ? 2 : caso === 'falla DB' ? 1 : 0)
  if (rpc.length) assert.deepEqual(rpc[0], { p_wamid: 'wamid.a', p_estado: 'failed', p_fecha: '2026-10-26T16:00:00.000Z', p_codigo: 131049, p_motivo: 'Meta limitó la entrega de Marketing.' })
})

test('bloqueos usan número normalizado y ante error de consulta no habilitan envío', async t => {
  let falla = false
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url)
    assert.equal(url.hostname, 'mejoras-test.supabase.co')
    assert.equal(url.searchParams.get('whatsapp'), 'eq.+525500000001')
    assert.equal(url.searchParams.get('template_name'), 'eq.template_test')
    return falla ? Response.json({ message: 'sin BD' }, { status: 500 }) : Response.json({ template_name: 'template_test' })
  })
  assert.equal(await templateBloqueado(db(), '+5215500000001', 'template_test'), true)
  falla = true; await assert.rejects(templateBloqueado(db(), '525500000001', 'template_test'))
})

for (const escenario of ['alumnos', 'template fallido']) test(`motor real omite ${escenario}`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: ahora })
  const old = { ...process.env }; Object.assign(process.env, env); t.after(() => { process.env = old })
  let consultasHistorial = 0, consultasBloqueo = 0
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const req = new Request(input, init), url = new URL(req.url), q = url.searchParams
    assert.equal(url.hostname, 'mejoras-test.supabase.co', 'ningún envío a Meta')
    assert.ok(['GET','HEAD'].includes(req.method), 'sin escrituras')
    if (req.method === 'HEAD') return new Response(null, { headers: { 'Content-Range': '*/0' } })
    if (url.pathname.endsWith('/whatsapp_conversaciones')) return Response.json(q.has('revision_timeout_desde_at') ? [] : [{ id: 'conv', whatsapp: '+525500000001', fase: 'saludo', lead_id: 'lead', provider: 'meta', tipo_contacto: escenario === 'alumnos' ? 'alumno' : 'prospecto' }])
    if (url.pathname.endsWith('/whatsapp_mensajes')) { consultasHistorial++; return Response.json([{ rol: 'bot', contenido: '¿Con quién tengo el gusto?', created_at: hace(50) }, { rol: 'usuario', contenido: 'Información', created_at: hace(51) }]) }
    if (url.pathname.endsWith('/leads')) return Response.json({ id: 'lead', whatsapp: '+525500000001', stage: 'contactado' })
    if (url.pathname.endsWith('/whatsapp_template_bloqueos')) { consultasBloqueo++; return Response.json({ template_name: 'windsor_elige_programa' }) }
    assert.fail(`consulta inesperada ${url.pathname}`)
  })
  const res = await GET(new Request('http://localhost/api/whatsapp/seguimiento-motor', { headers: { authorization: 'Bearer fake' } }))
  assert.equal(res.status, 200)
  const activo = await res.json(); assert.equal(activo.acciones, 0); assert.equal(activo.templates.seleccionados, 0)
  const body = await (await GET(new Request('http://localhost/api/whatsapp/seguimiento-motor?dry=1', { headers: { authorization: 'Bearer fake' } }))).json()
  assert.equal(body.resultados[0].accion, 'omitido')
  assert.match(body.resultados[0].detalle, escenario === 'alumnos' ? /alumno/ : /template bloqueado/)
  assert.equal(consultasHistorial, escenario === 'alumnos' ? 0 : 2)
  assert.equal(consultasBloqueo, escenario === 'alumnos' ? 0 : 2)
})


test('plazo de control humano configurable con default de 7 días', () => {
  assert.equal(diasInactividadHumana({}), 7)
  assert.equal(diasInactividadHumana({ MODO_HUMANO_INACTIVO_DIAS: '14' }), 14)
  for (const value of ['0','-1','NaN','Infinity','4000']) assert.equal(diasInactividadHumana({ MODO_HUMANO_INACTIVO_DIAS: value }), 7)
})
