import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GET } from '../app/api/whatsapp/seguimiento-motor/route'
import { decidirSeguimientoAutomatico, esCanalInternoSeguimiento, recordatorioDatoReciente } from '../lib/whatsapp/seguimiento-motor'

const ahora = new Date('2026-10-20T16:00:00Z')
const hace = (h: number) => new Date(ahora.getTime() - h * 3600_000).toISOString()
const recordatorio = (dato: string, horas: number, legacy = false) => ({
  rol: 'bot', contenido: `¡Hola! Para ayudarte mejor, me faltaria confirmar tu ${dato}.`,
  created_at: hace(horas),
  raw_payload: { seguimiento_motor: { reglaId: 'nuevo_3h_dato', ...(legacy ? {} : { datoPendiente: dato }) } },
})

test('canal interno excluido en formatos E.164, Meta y mexicano heredado', () => {
  for (const numero of ['+527474722466', '527474722466', '+5217474722466', 'whatsapp:+52 747 472 2466']) {
    assert.equal(esCanalInternoSeguimiento(numero), true)
    assert.equal(decidirSeguimientoAutomatico({
      fase: 'saludo', lead: { whatsapp: numero }, horasDesdeLead: 80,
      horasDesdeBot: 80, diasDesdeLead: 80 / 24, dentroVentana24h: false,
    }), null)
  }
  assert.equal(esCanalInternoSeguimiento('+527474728775'), false)
})

test('24 horas por dato, incluso con mensajes antiguos sin datoPendiente', () => {
  for (const [dato, fase] of [['nombre', 'saludo'], ['correo', 'correo']]) {
    for (const legacy of [true, false]) {
      assert.equal(recordatorioDatoReciente([recordatorio(dato, 3.5, legacy)], fase, ahora), true)
      assert.equal(recordatorioDatoReciente([recordatorio(dato, 23.99, legacy)], fase, ahora), true)
      assert.equal(recordatorioDatoReciente([recordatorio(dato, 24, legacy)], fase, ahora), false)
      assert.equal(recordatorioDatoReciente([recordatorio(dato, 25, legacy)], fase, ahora), false)
    }
  }
  assert.equal(recordatorioDatoReciente([recordatorio('nombre', 4)], 'correo', ahora), false)
})

test('dry-run del endpoint: todas las páginas, canal interno y cooldown tras nueva respuesta', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: ahora })
  const envAnterior = { ...process.env }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://motor-test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
  process.env.CRON_SECRET = 'test-secret'
  delete process.env.SEGUIMIENTO_MOTOR_CIERRES
  t.after(() => { process.env = envAnterior })

  const convs = Array.from({ length: 3134 }, (_, i) => ({
    id: `conv-${String(i).padStart(4, '0')}`, whatsapp: '+525500000000', lead_id: `lead-${i}`,
    fase: 'saludo', provider: 'meta', estado: 'abierta', modo_humano: true,
    revision_codigo: null, ultimo_mensaje_at: hace(100),
  }))
  // El reciente está fuera de los primeros 700 en el orden original de la BD.
  convs[3133] = { ...convs[3133], modo_humano: false, ultimo_mensaje_at: hace(4) }
  convs[701] = { ...convs[701], modo_humano: false, whatsapp: '+527474722466' }
  convs[702] = { ...convs[702], modo_humano: false }
  convs[703] = { ...convs[703], modo_humano: false, fase: 'correo' }
  convs[704] = { ...convs[704], modo_humano: false }
  convs[706] = { ...convs[706], modo_humano: false, fase: 'pendiente' }
  convs[705] = { ...convs[705], modo_humano: false, fase: 'accion' }
  const pages: number[] = []
  const consultasMensajes: string[] = []
  const msgs = (id: string) => [
    ...(id === 'conv-0706' ? [] : [{ rol: 'bot', contenido: id === 'conv-0705' ? 'Información enviada' : id === 'conv-0703' ? '¿Cuál es tu correo?' : '¿Con quién tengo el gusto?', created_at: hace(4) }]),
    { rol: 'usuario', contenido: 'Información', created_at: hace(id === 'conv-0705' ? 12 * 24 : 5) },
  ]
  let falloPagina = false
  let falloRecordatorios = false
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const method = init?.method || (input instanceof Request ? input.method : 'GET')
    assert.equal(method, 'GET', 'dry-run no puede escribir ni enviar')
    assert.equal(url.hostname, 'motor-test.supabase.co', 'ningún envío a Meta')
    const q = url.searchParams
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.pathname.endsWith('/whatsapp_conversaciones')) {
      assert.equal(q.get('order'), 'ultimo_mensaje_at.desc.nullslast,id.asc')
      const offset = Number(q.get('offset'))
      const limit = Number(q.get('limit'))
      assert.equal(limit, 500)
      pages.push(offset)
      if (falloPagina && offset === 500) return json({ message: 'falló página', code: 'XX000' }, 500)
      const sorted = [...convs].sort((a, b) => b.ultimo_mensaje_at.localeCompare(a.ultimo_mensaje_at) || a.id.localeCompare(b.id))
      return json(sorted.slice(offset, offset + limit))
    }
    if (url.pathname.endsWith('/whatsapp_mensajes')) {
      const id = q.get('conversacion_id')!.replace('eq.', '')
      consultasMensajes.push(id)
      if (q.has('raw_payload->seguimiento_motor->>reglaId')) {
        if (falloRecordatorios) return json({ message: 'falló historial', code: 'XX000' }, 500)
        assert.equal(q.get('created_at'), `gte.${hace(24)}`)
        if (id === 'conv-0702') return json([recordatorio('nombre', 20, true)])
        if (id === 'conv-0703') return json([recordatorio('correo', 20)])
        if (id === 'conv-0704') return json([recordatorio('nombre', 24)])
        return json([])
      }
      // La consulta de 60 mensajes no incluye el recordatorio anterior.
      return json(msgs(id))
    }
    if (url.pathname.endsWith('/leads')) {
      return json({ id: q.get('id')?.replace('eq.', ''), nombre: null, curso: null, whatsapp: '+525500000000', stage: 'contactado', asignado_a: q.get('id') === 'eq.lead-706' ? 'asesor-1' : null })
    }
    if (url.pathname.endsWith('/profiles')) return json({ whatsapp: '+527474722466', nombre: 'Canal interno' })
    assert.fail(`consulta inesperada: ${url.pathname}`)
  })
  const req = () => new Request('http://localhost/api/whatsapp/seguimiento-motor?dry=1', { headers: { authorization: 'Bearer test-secret' } })
  const response = await GET(req())
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.dryRun, true)
  assert.equal(body.revisadas, 3134)
  assert.deepEqual(pages, [0, 500, 1000, 1500, 2000, 2500, 3000])
  const resultado = (id: string) => body.resultados.find((r: { conversacion_id: string }) => r.conversacion_id === id)
  assert.equal(resultado('conv-3133').accion, 'dry_texto')
  assert.equal(resultado('conv-0701').detalle, 'canal interno de asesores')
  assert.equal(consultasMensajes.includes('conv-0701'), false)
  for (const id of ['conv-0702', 'conv-0703']) {
    assert.equal(resultado(id).accion, 'omitido')
    assert.match(resultado(id).detalle, /menos de 24h/)
  }
  assert.equal(resultado('conv-0704').accion, 'dry_texto')
  assert.equal(resultado('conv-0705').accion, 'cierre_apagado_archivar')
  assert.equal(resultado('conv-0706').detalle, 'canal interno de asesores excluido')
  console.log(`Dry-run fixture: antes 700; ahora ${body.revisadas}; acciones ${body.acciones}; cero envíos/escrituras`)

  falloPagina = true
  const failed = await GET(req())
  assert.equal(failed.status, 500)
  assert.equal((await failed.json()).error, 'falló página')
  falloPagina = false
  falloRecordatorios = true
  const closed = await (await GET(req())).json()
  assert.equal(closed.resultados.find((r: { conversacion_id: string }) => r.conversacion_id === 'conv-3133').detalle, 'error consultando recordatorios')
})
