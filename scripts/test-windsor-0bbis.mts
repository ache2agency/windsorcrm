import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHmac } from 'node:crypto'
import { POST } from '../app/api/whatsapp/webhook/route'
import { clasificarContacto } from '../lib/whatsapp/contactos'
import { hasLeadName } from '../lib/whatsapp/nombres'
import { decidirSeguimientoAutomatico } from '../lib/whatsapp/seguimiento-motor'
import { corregirComillaSeguimiento } from '../lib/whatsapp/template-correcciones'
import { TEMPLATES_APROBADOS } from '../lib/whatsapp/templates-aprobados'
import { detectarPrograma, matchOfertaEducativa } from '../lib/whatsapp/programas'

const prospectos = ['Mi hijo está en tercero de primaria, ¿qué curso le recomiendan?', 'Mi hija estudia en la secundaria y quiere inglés', 'Quiero saber si hay clases hoy de muestra', 'La calificación mínima para el diploma cuál es?', 'Mi hija está en su grupo de primaria y quiere inglés']
const alumnos = ['El día de hoy si habrá clases?', 'Envío la calificación de Luna', 'Pueden darme una constancia de que estoy haciendo el curso?', 'Y para la regularización del mes que no asistí…']
for (const texto of prospectos) test(`prospecto y corrección de automático: ${texto}`, () => {
  assert.equal(clasificarContacto(texto), 'prospecto')
  assert.equal(clasificarContacto(texto, 'alumno'), 'prospecto')
  assert.equal(clasificarContacto(texto, 'alumno', true), 'alumno')
  assert.equal(clasificarContacto(texto, 'alumno', false, true), 'alumno')
  assert.equal(clasificarContacto(texto, 'prospecto', true, true), 'prospecto')
})
for (const texto of [...alumnos, 'Mi hijo está en su grupo de inglés', 'Mi hija estudia en Windsor', 'Mi maestro de inglés no llegó', 'Ya pagué la mensualidad', 'Mis calificaciones', 'La calificación de Luna']) test(`alumno con evidencia: ${texto}`, () => assert.equal(clasificarContacto(texto), 'alumno'))

test('nombre Windsor inválido y saludos del motor sin marca como nombre', () => {
  for (const nombre of ['Windsor', 'Instituto Windsor', 'WINDSOR', 'Instituto de Windsor', 'InstitutoWindsor', 'Windsor Chilpancingo', '']) {
    assert.equal(hasLeadName(nombre, ''), false)
    const texto = decidirSeguimientoAutomatico({ fase: 'saludo', lead: { nombre }, horasDesdeLead: 4, horasDesdeBot: 4, diasDesdeLead: 4 / 24, dentroVentana24h: true, ultimoBotFuePreguntaDato: true })!
    assert.match(texto.mensaje!, /^¡Hola! 😊/)
    assert.match(texto.mensaje!, /faltaría/)
    for (const curso of ['Inglés para niños', 'Diplomado en Epidemiología']) {
      const template = decidirSeguimientoAutomatico({ fase: 'accion', lead: { nombre, curso }, horasDesdeLead: 72, horasDesdeBot: 72, diasDesdeLead: 3, dentroVentana24h: false })!
      assert.equal(template.accion, 'template')
      assert.equal(template.templateParams![0], '👋', 'saludo sin nombre; el parámetro no puede estar vacío')
    }
  }
  assert.equal(hasLeadName('Ana Luna', ''), true)
  const correo = decidirSeguimientoAutomatico({ fase: 'correo', lead: {}, horasDesdeLead: 4, horasDesdeBot: 4, diasDesdeLead: 4 / 24, dentroVentana24h: true, ultimoBotFuePreguntaDato: true })!
  assert.match(correo.mensaje!, /por aquí/)
})

test('programa del anuncio niños reconocido en los dos clasificadores compartidos', () => {
  const texto = '🧒👧 ¡Hola! Quiero más información sobre el curso de idiomas para niños.'
  assert.equal(detectarPrograma(texto), 'Inglés para niños')
  assert.equal(matchOfertaEducativa(texto).match, 'Inglés para niños')
})

for (const escenario of ['sin_secreto', 'firmado', 'anuncio_ninos']) test(`webhook real 0B-bis: ${escenario}`, async t => {
  const env = { ...process.env }
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: 'https://bis-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake', META_WHATSAPP_TOKEN: 'fake', META_PHONE_NUMBER_ID: 'fake', WHATSAPP_PROVIDER: 'meta', OPENAI_API_KEY: '' })
  delete process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID
  if (escenario === 'firmado') process.env.META_APP_SECRET = 'fake-secret'
  else delete process.env.META_APP_SECRET
  t.after(() => { process.env = env })
  const lead = { id: 'lead', nombre: escenario === 'anuncio_ninos' ? '' : 'Ana Prueba', curso: escenario === 'anuncio_ninos' ? 'WhatsApp - Instituto Windsor' : 'Diplomado en Epidemiología', email: '', stage: 'contactado', whatsapp: '+525500000001' }
  let fase = escenario === 'anuncio_ninos' ? 'saludo' : 'accion', tipo = 'prospecto', seq = 0, latest = ''
  const sent: any[] = [], rpc: any[] = [], saved: any[] = [], warnings: string[] = []
  t.mock.method(console, 'warn', (m: string) => { warnings.push(m) })
  const timer = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', ((fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]) => timer(fn, ms === 8000 ? 0 : ms, ...args)) as typeof setTimeout)
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const req = new Request(input, init), url = new URL(req.url), q = url.searchParams
    if (url.hostname === 'graph.facebook.com') { sent.push(await req.json()); return Response.json({ messages: [{ id: 'wamid.fake' }] }) }
    assert.equal(url.hostname, 'bis-test.supabase.co', 'ningún servicio real ni IA')
    const tabla = url.pathname.split('/').at(-1)
    if (req.method === 'PATCH') {
      const p = await req.json()
      if (tabla === 'leads') Object.assign(lead, p)
      if (tabla === 'whatsapp_conversaciones') { if (p.fase) fase = p.fase; if (p.tipo_contacto) tipo = p.tipo_contacto }
      return new Response(null, { status: 204 })
    }
    if (req.method === 'POST') {
      const p = await req.json()
      if (tabla === 'registrar_entrega_whatsapp') { rpc.push(p); return Response.json(1) }
      if (tabla === 'whatsapp_mensajes') {
        saved.push(...p)
        if (p[0].rol === 'usuario') latest = 'incoming-' + seq
        return q.has('select') ? Response.json({ id: latest }) : new Response(null, { status: 201 })
      }
      if (tabla === 'lead_activities') return new Response(null, { status: 201 })
      assert.fail(`POST inesperado ${tabla}`)
    }
    if (tabla === 'leads') return Response.json(lead)
    if (tabla === 'whatsapp_conversaciones') return Response.json(q.get('fase') === 'eq.registro_confirmar' ? null : { id: 'conv', fase, modo_humano: false, tipo_contacto: tipo })
    if (tabla === 'whatsapp_mensajes') {
      if (q.has('raw_payload')) return Response.json(null)
      if (q.get('select') === 'id') return Response.json({ id: latest })
      return Response.json(saved.slice(-6).reverse())
    }
    if (tabla === 'profiles') assert.fail('no consultar asesores')
    return Response.json(null)
  })
  const mensaje = async (text: string, mixed = false) => {
    seq++
    const changes: any[] = mixed ? [{ value: { statuses: [{ id: 'wamid.failed', status: 'failed', timestamp: '1793030400', errors: [{ code: 131049, message: 'Límite' }] }] } }] : []
    changes.push({ value: { messages: [{ id: 'wamid.' + seq, from: '525500000001', type: 'text', text: { body: text } }] } })
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes }] })
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (process.env.META_APP_SECRET) headers['x-hub-signature-256'] = 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex')
    const response = await POST(new Request('http://localhost/api/whatsapp/webhook', { method: 'POST', body: raw, headers }))
    assert.equal(response.status, 200)
    return sent.filter(m => m.to.replace(/\D/g, '') === '525500000001').at(-1)?.text.body as string
  }
  if (escenario !== 'anuncio_ninos') {
    assert.match(await mensaje('Me quiero inscribir', true), /INSCRIPCIÓN DIPLOMADOS/)
    assert.equal(rpc.length, escenario === 'firmado' ? 1 : 0)
    assert.equal(warnings.length, escenario === 'firmado' ? 0 : 1)
    assert.ok(saved.some(m => m.rol === 'usuario'), 'el mensaje mixto se registra y procesa')
    return
  }
  assert.match(await mensaje('🧒👧 ¡Hola! Quiero más información sobre el curso de idiomas para niños.'), /tengo el gusto|nombre/i)
  assert.equal(lead.curso, 'Inglés para niños', 'guardado ya en el primer mensaje')
  assert.doesNotMatch(await mensaje('Ana Prueba'), /CATÁLOGO|Bachillerato|Licenciaturas|Maestrías/)
  for (const text of ['¿Cuál es el precio?', 'De 10 años']) {
    const reply = await mensaje(text)
    assert.match(reply, /Inglés para Niños|Inglés para niños/)
    assert.match(reply, /780/)
    assert.doesNotMatch(reply, /Bachillerato|Licenciaturas|Maestrías/)
    assert.equal(lead.curso, 'Inglés para niños')
    assert.equal(tipo, 'prospecto')
  }
  assert.match(await mensaje('¿Cuál es el precio de Psicología?'), /Psicología/)
  assert.equal(lead.curso, 'Psicología', 'una solicitud explícita de otro programa sí cambia el contexto')
})


test('seguimiento general local sin comilla; corrección exacta del BODY de Meta disponible para Harold', () => {
  const body = TEMPLATES_APROBADOS.find(t => t.name === 'seguimiento_general')!.body
  assert.match(body, /te ayudamos\. 😊$/)
  assert.equal(corregirComillaSeguimiento(body + '"'), body)
  assert.equal(corregirComillaSeguimiento(body + '”'), body)
  assert.equal(corregirComillaSeguimiento(body), body)
  assert.equal(corregirComillaSeguimiento('El alumno dijo "gracias"'), 'El alumno dijo "gracias"')
})
