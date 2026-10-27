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
    assert.ok(['GET', 'HEAD'].includes(method), 'dry-run no puede escribir ni enviar')
    assert.equal(url.hostname, 'motor-test.supabase.co', 'ningún envío a Meta')
    const q = url.searchParams
    if (q.has('revision_timeout_desde_at')) return Response.json([])
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
    if (method === 'HEAD') return new Response(null, { headers: { 'Content-Range': '0-0/0' } })
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
  assert.equal(resultado('conv-0706').detalle, 'dry aviso a 5274***06')
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

test('inicio del día de México independiente de la zona horaria del servidor', async () => {
  const { inicioDiaMexicoIso } = await import('../lib/whatsapp/seguimiento-motor')
  const tzAnterior = process.env.TZ
  try {
    for (const tz of ['UTC', 'America/Mexico_City', 'America/New_York']) {
      process.env.TZ = tz
      assert.equal(inicioDiaMexicoIso(new Date('2026-10-20T05:59:59Z')), '2026-10-19T06:00:00.000Z')
      assert.equal(inicioDiaMexicoIso(new Date('2026-10-20T06:00:00Z')), '2026-10-20T06:00:00.000Z')
    }
  } finally {
    if (tzAnterior === undefined) delete process.env.TZ
    else process.env.TZ = tzAnterior
  }
})

test('tope diario del endpoint con envíos y persistencia simulados', async (t) => {
  for (const escenario of [
    { nombre: 'cupo lleno: cero templates; texto y aviso salen', previos: 40, limite: undefined, esperados: 0 },
    { nombre: 'cupo parcial: solo los dos más recientes; siguiente corrida sin cupo', previos: 38, limite: undefined, esperados: 2 },
    { nombre: 'env configurable: dos diarios', previos: 0, limite: '2', esperados: 2 },
    { nombre: 'env cero: pausa templates sin afectar textos', previos: 0, limite: '0', esperados: 0 },
    { nombre: 'env inválida usa default 40', previos: 38, limite: '-1', esperados: 2 },
    { nombre: 'error al contar: no enviar sin conocer el cupo', previos: 0, limite: undefined, esperados: 0, errorConteo: true },
  ]) await t.test(escenario.nombre, async (st) => {
    st.mock.timers.enable({ apis: ['Date'], now: ahora })
    const envAnterior = { ...process.env }
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: 'https://motor-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
      CRON_SECRET: 'test', META_WHATSAPP_TOKEN: 'test', META_PHONE_NUMBER_ID: 'test', META_WHATSAPP_BUSINESS_ACCOUNT_ID: 'test-business',
    })
    if (escenario.limite === undefined) delete process.env.SEGUIMIENTO_MOTOR_MAX_TEMPLATES_DIA
    else process.env.SEGUIMIENTO_MOTOR_MAX_TEMPLATES_DIA = escenario.limite
    st.after(() => { process.env = envAnterior })
    type Log = { created_at: string; rol: string; raw_payload?: { seguimiento_motor?: { accion: string } } }
    const logs: Log[] = Array.from({ length: escenario.previos }, () => ({
      created_at: '2026-10-20T06:00:00.000Z', rol: 'bot', raw_payload: { seguimiento_motor: { accion: 'template' } },
    }))
    logs.push(
      { created_at: '2026-10-20T05:59:59.000Z', rol: 'bot', raw_payload: { seguimiento_motor: { accion: 'template' } } },
      { created_at: hace(1), rol: 'bot', raw_payload: { seguimiento_motor: { accion: 'texto' } } },
      { created_at: hace(1), rol: 'bot' }, // Template manual ajeno al motor.
      { created_at: '2026-10-21T06:00:00.000Z', rol: 'bot', raw_payload: { seguimiento_motor: { accion: 'template' } } },
    )
    const convs = [
      { id: 'aviso', horas: 3, fase: 'pendiente' },
      { id: 'texto', horas: 4, fase: 'saludo' },
      { id: 'reciente-a', horas: 50, fase: 'saludo' },
      { id: 'reciente-b', horas: 60, fase: 'saludo' },
      { id: 'reciente-c', horas: 70, fase: 'saludo' },
      { id: 'backlog', horas: 1000, fase: 'saludo' },
    ].map((c, i) => ({ ...c, whatsapp: `+52550000000${i}`, lead_id: c.id, provider: 'meta', estado: 'abierta', ultimo_mensaje_at: hace(c.horas) }))
    const enviados: Array<{ type: string; to: string; text?: { body: string } }> = []
    const inserts: Array<{ conversacion_id?: string; contenido?: string; raw_payload?: { wamid?: string; seguimiento_motor?: { accion: string; templateParams?: string[] } } }> = []
    const leadsEvaluados = new Set<string>()
    st.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const q = url.searchParams
      if (q.has('revision_timeout_desde_at')) return Response.json([])
      const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
      if (url.hostname === 'graph.facebook.com' && url.pathname.endsWith('/message_templates')) {
        return json({ data: [{ name: q.get('name'), status: 'APPROVED', language: 'es_MX', components: [{ type: 'BODY', text: q.get('name') === 'windsor_elige_programa' ? '¿Qué programa te interesa?' : 'Hola {{1}}, seguimos pendientes.' }] }] })
      }
      if (url.hostname === 'graph.facebook.com') {
        assert.equal(leadsEvaluados.size, convs.length, 'evaluar todas las decisiones antes de enviar')
        enviados.push(await request.json())
        return json({ messages: [{ id: 'wamid.mock' }] })
      }
      assert.equal(url.hostname, 'motor-test.supabase.co', 'ningún acceso real de red')
      if (request.method === 'HEAD') {
        assert.equal(q.get('rol'), 'eq.bot')
        assert.equal(q.get('raw_payload->seguimiento_motor->>accion'), 'eq.template')
        assert.equal(q.get('created_at'), 'gte.2026-10-20T06:00:00.000Z')
        assert.deepEqual(q.getAll('created_at'), ['gte.2026-10-20T06:00:00.000Z', 'lt.2026-10-21T06:00:00.000Z'])
        if (escenario.errorConteo) return new Response(null, { status: 500 })
        const count = logs.filter((m) => m.rol === 'bot' && m.raw_payload?.seguimiento_motor?.accion === 'template'
          && m.created_at >= '2026-10-20T06:00:00.000Z' && m.created_at < '2026-10-21T06:00:00.000Z').length
        return new Response(null, { headers: { 'Content-Range': `*/${count}` } })
      }
      if (request.method === 'POST') {
        const rows = await request.json()
        if (url.pathname.endsWith('/whatsapp_mensajes')) {
          inserts.push(...rows)
          logs.push(...rows.map((r: Log) => ({ ...r, created_at: ahora.toISOString() })))
        }
        return new Response(null, { status: 201 })
      }
      if (request.method === 'PATCH') return new Response(null, { status: 204 })
      assert.equal(request.method, 'GET')
      if (url.pathname.endsWith('/whatsapp_template_bloqueos')) return json(null)
      if (url.pathname.endsWith('/whatsapp_conversaciones')) return json(q.has('whatsapp') ? [] : q.has('id') ? { tipo_contacto: 'prospecto' } : convs)
      if (url.pathname.endsWith('/whatsapp_mensajes')) {
        if (q.has('raw_payload->seguimiento_motor->>reglaId')) return json([])
        const conv = convs.find((c) => `eq.${c.id}` === q.get('conversacion_id'))!
        return json([
          ...(conv.id === 'aviso' ? [] : [{ rol: 'bot', contenido: '¿Con quién tengo el gusto?', created_at: hace(conv.horas) }]),
          { rol: 'usuario', contenido: 'Información', created_at: hace(conv.horas + 1) },
        ])
      }
      if (url.pathname.endsWith('/leads')) {
        const id = q.get('id')!.replace('eq.', '')
        if (id === 'reciente-a') await new Promise((resolve) => setTimeout(resolve, 15))
        leadsEvaluados.add(id)
        const conv = convs.find((c) => c.id === id)!
        return json({ id, nombre: null, whatsapp: conv.whatsapp, curso: null, stage: 'contactado', asignado_a: id === 'aviso' ? 'asesor' : null })
      }
      if (url.pathname.endsWith('/profiles')) return json({ whatsapp: '+525599999999' })
      assert.fail(`consulta inesperada ${url.pathname}`)
    })
    const req = (dry = false) => new Request(`http://localhost/api/whatsapp/seguimiento-motor${dry ? '?dry=1' : ''}`, { headers: { authorization: 'Bearer test' } })
    const preview = await GET(req(true))
    const antes = await preview.json()
    if (escenario.errorConteo) {
      assert.equal(preview.status, 500)
      assert.equal((await GET(req())).status, 500)
      assert.equal(enviados.length, 0)
      return
    }
    assert.equal(antes.templates.enviadosHoy, escenario.previos)
    assert.equal(antes.templates.seleccionados, escenario.esperados)
    assert.equal(antes.templates.diferidos, 4 - escenario.esperados)
    assert.equal(antes.resultados.filter((r: { detalle: string }) => r.detalle === 'tope diario de templates').length, 4 - escenario.esperados)
    assert.equal(enviados.length, 0, 'preview no envía')
    assert.equal(inserts.length, 0, 'preview no marca omitidos como enviados')
    const body = await (await GET(req())).json()
    assert.equal(body.ok, true)
    assert.equal(enviados.filter((m) => m.type === 'template').length, escenario.esperados)
    assert.deepEqual(enviados.filter((m) => m.type === 'template').map((m) => m.to.replace(/^\+/, '')),
      convs.slice(2, 2 + escenario.esperados).map((c) => c.whatsapp.replace(/^\+/, '')))
    assert.equal(enviados.filter((m) => m.type === 'text').length, 2, 'texto y aviso no usan cupo')
    assert.equal(inserts.some((r) => r.conversacion_id === 'backlog'), false)
    for (const row of inserts.filter(r => r.raw_payload?.seguimiento_motor?.accion === 'template')) {
      assert.equal(row.raw_payload?.wamid, 'wamid.mock')
      assert.doesNotMatch(row.contenido || '', /\[Template:|\{\{/)
      assert.ok(row.contenido)
    }
    assert.ok(enviados.filter(m => m.type === 'text' && m.text?.body.includes('Seguimiento automático Windsor')).every(m => m.to.replace(/^\+/, '') === '527471028306'))
    if (escenario.previos === 38) {
      const siguiente = await (await GET(req(true))).json()
      assert.equal(siguiente.templates.enviadosHoy, 40)
      assert.equal(siguiente.templates.seleccionados, 0)
    }
  })
})
