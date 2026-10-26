import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { POST } from '../app/api/whatsapp/webhook/route'
import * as inscripcion from '../lib/whatsapp/inscripcion'
import { ADMIN_WA_ALERTA, MENSAJE_ESPERA, quitarPromesasAsesor } from '../lib/whatsapp/atencion'
import { accionRevision, ejecutarRevisionesPendientes, plazosRevision, respuestaRevisionVencida, type RevisionPendiente } from '../lib/whatsapp/revision-timeout'
import { sustituirParametrosTemplate, textoTemplateEnviado } from '../lib/whatsapp/template-registro'

const ahora = new Date('2026-10-24T16:00:00Z')
const hace = (h: number) => new Date(ahora.getTime() - h * 3600_000).toISOString()
const revision = (h: number, extra: Partial<RevisionPendiente> = {}): RevisionPendiente => ({
  id: 'rev-1', whatsapp: '+525500000001', lead_id: 'lead-1', provider: 'meta',
  revision_codigo: 'x', revision_timeout_desde_at: hace(h), revision_recordatorio_at: null,
  revision_timeout_claim_at: null, revision_draft: null, tomado_por: null, modo_humano: true, ...extra,
})
const sinPromesas = (txt: string) => assert.doesNotMatch(txt, /asesor te|te marco|llamada|asesor revisar/i)

test('inscripción: Epidemiología guardada gana a clasificación desconocida/GPT', () => {
  assert.equal(inscripcion.resolverTipoInscripcion('Diplomado en Epidemiología', 'desconocido', 'B'), 'diplomado')
  assert.match(inscripcion.mensajeInscripcionPara(inscripcion.resolverTipoInscripcion('Diplomado en Epidemiología') as 'diplomado'), /INSCRIPCIÓN DIPLOMADOS/)
  assert.equal(inscripcion.resolverTipoInscripcion(null, 'Diplomado en Epidemiología'), 'diplomado')
  assert.equal(inscripcion.resolverTipoInscripcion('Curso no registrado'), 'desconocido')
  assert.match(inscripcion.INSCRIPCION_DESCONOCIDA_MSG, /Licenciatura[\s\S]*Bachillerato[\s\S]*Diplomado[\s\S]*idiomas/)
  assert.doesNotMatch(inscripcion.INSCRIPCION_DESCONOCIDA_MSG, /asesor|en breve te contact/i)
})

test('todos los procesos de inscripción y espera excluyen promesas de asesores', () => {
  for (const [nombre, texto] of Object.entries(inscripcion)) if (nombre.startsWith('INSCRIPCION_') && typeof texto === 'string') sinPromesas(texto)
  for (const texto of ['Un asesor te contacta mañana', 'Te marco en una hora', 'Te hago una llamada', 'Un asesor revisará tu inscripción', 'Déjame consultarlo con un asesor']) {
    assert.equal(quitarPromesasAsesor(texto), MENSAJE_ESPERA)
    sinPromesas(quitarPromesasAsesor(texto))
  }
  assert.equal(quitarPromesasAsesor(inscripcion.INSCRIPCION_DIPLOMADO_MSG), inscripcion.INSCRIPCION_DIPLOMADO_MSG)
  sinPromesas(respuestaRevisionVencida('Diplomado en Epidemiología'))
  assert.match(respuestaRevisionVencida('Diplomado en Epidemiología'), /120 horas[\s\S]*¿Te puedo ayudar con algo más\?/)
})

test('revisión: límites 4/20h, legacy intacto, borrador y control humano respetados', () => {
  assert.equal(accionRevision(revision(3.99), ahora), null)
  assert.equal(accionRevision(revision(4), ahora), 'recordatorio')
  assert.equal(accionRevision(revision(19.99), ahora), 'recordatorio')
  assert.equal(accionRevision(revision(20), ahora), 'reactivar')
  assert.equal(accionRevision(revision(20, { revision_recordatorio_at: hace(16) }), ahora), 'reactivar')
  assert.equal(accionRevision(revision(6, { revision_recordatorio_at: hace(2) }), ahora), null)
  assert.equal(accionRevision(revision(500, { revision_timeout_desde_at: null }), ahora), null)
  assert.equal(accionRevision(revision(21, { revision_draft: 'Harold ya respondió' }), ahora), null)
  assert.equal(accionRevision(revision(21, { tomado_por: 'operador' }), ahora), null)
  assert.equal(accionRevision(revision(21, { modo_humano: false }), ahora), null)
  assert.deepEqual(plazosRevision({ REVISION_RECORDATORIO_HORAS: '2', REVISION_REACTIVAR_HORAS: '18' }), { recordatorio: 2, reactivar: 18 })
  for (const n of ['NaN', '24', '0', '-1']) assert.deepEqual(plazosRevision({ REVISION_REACTIVAR_HORAS: n }), { recordatorio: 4, reactivar: 20 })
})

test('templates: texto aprobado con parámetros literales y faltantes seguros', async () => {
  assert.equal(sustituirParametrosTemplate('Hola {{1}}, {{ 2 }}', ['Ana $&', 'Epidemiología']), 'Hola Ana $&, Epidemiología')
  assert.equal(sustituirParametrosTemplate('Hola {{1}}', []), null)
  assert.equal(await textoTemplateEnviado('x', ['Ana'], async () => 'Hola {{1}}'), 'Hola Ana')
  assert.equal(await textoTemplateEnviado('x', [], async () => null), null)
})

for (const escenario of ['recordatorio', 'reactivar', 'sin_ventana', 'sin_claim', 'dry', 'falla_envio', 'harold_respondio']) {
  test(`worker de revisión con Supabase simulado: ${escenario}`, async t => {
    const row = revision(escenario === 'recordatorio' ? 4 : 20)
    const rpc: Array<{ nombre: string; body: Record<string, unknown> }> = [], enviados: Array<{ to: string; body: string }> = []
    const db = createClient('https://revision-test.supabase.co', 'fake-service', { auth: { persistSession: false } })
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init), url = new URL(req.url)
      assert.equal(url.hostname, 'revision-test.supabase.co')
      const q = url.searchParams
      if (url.pathname.includes('/rpc/')) {
        const nombre = url.pathname.split('/').at(-1)!, body = await req.json()
        rpc.push({ nombre, body })
        if (nombre === 'reclamar_revision_timeout') return Response.json(escenario === 'sin_claim' ? [] : [{ ...row, revision_timeout_claim_at: ahora.toISOString() }])
        if (nombre === 'terminar_revision_timeout') return Response.json(body.p_exito)
        assert.fail('RPC no autorizado')
      }
      assert.equal(req.method, 'GET', 'mutaciones solo mediante RPC atómica')
      if (url.pathname.endsWith('/whatsapp_conversaciones')) {
        if (q.has('revision_timeout_desde_at')) return Response.json([row, revision(500, { id: 'legacy', revision_timeout_desde_at: null })])
        return Response.json({ ...row, ...(escenario === 'harold_respondio' ? { revision_draft: 'Respuesta', revision_timeout_desde_at: null } : {}) })
      }
      if (url.pathname.endsWith('/whatsapp_mensajes')) return Response.json({ created_at: hace(escenario === 'sin_ventana' ? 25 : 21) })
      if (url.pathname.endsWith('/leads')) return Response.json({ curso: 'Diplomado en Epidemiología' })
      assert.fail(`consulta inesperada ${url.pathname}`)
    })
    const results = await ejecutarRevisionesPendientes(db, escenario === 'dry', ahora, async m => {
      enviados.push(m)
      if (escenario === 'falla_envio') throw new Error('fallo simulado')
      return { id: 'wamid.reply', raw: {} }
    })
    assert.ok(rpc.every(r => r.body.p_id === row.id), 'legacy nunca se reclama')
    if (escenario === 'dry') { assert.equal(rpc.length, 0); assert.equal(enviados.length, 0); assert.equal(results[0]?.accion, 'dry_revision_reactivar'); return }
    if (escenario === 'sin_claim' || escenario === 'harold_respondio') { assert.equal(enviados.length, 0); return }
    const fin = rpc.find(r => r.nombre === 'terminar_revision_timeout')!.body
    if (escenario === 'falla_envio') { assert.equal(fin.p_exito, false); assert.equal(results[0]?.accion, 'error_revision'); return }
    assert.equal(fin.p_exito, true)
    if (escenario === 'sin_ventana') { assert.equal(enviados.length, 0); assert.equal(fin.p_accion, 'reactivar_sin_ventana'); return }
    assert.equal(enviados.length, 1)
    if (escenario === 'recordatorio') { assert.equal(enviados[0]!.to, ADMIN_WA_ALERTA); assert.match(enviados[0]!.body, /\[X\]/); assert.equal(fin.p_accion, 'recordatorio') }
    else { assert.equal(enviados[0]!.to, row.whatsapp); assert.equal(fin.p_accion, 'reactivar'); assert.equal((fin.p_raw as { wamid: string }).wamid, 'wamid.reply'); sinPromesas(enviados[0]!.body) }
  })
}

// Se recorre el webhook real con servicios simulados, sin datos ni envíos reales.
for (const escenario of ['epidemiologia', 'desconocido', 'elegir_diplomado', 'confirmacion', 'revision_nueva', 'revalidacion', 'ia_promesa', 'programa_precio', 'programa_licenciatura', 'programa_lista_doble_precio', 'programa_lista_doble_licenciatura']) {
  test(`webhook real: ${escenario}`, async t => {
    const usaIA = ['revision_nueva', 'ia_promesa', 'programa_precio'].includes(escenario)
    const esRevision = escenario === 'revision_nueva' || escenario === 'ia_promesa' || escenario.startsWith('programa_lista_doble')
    const env = { ...process.env }
    Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: 'https://webhook-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake', WHATSAPP_PROVIDER: 'meta', META_WHATSAPP_TOKEN: 'fake', META_PHONE_NUMBER_ID: 'fake', OPENAI_API_KEY: usaIA ? 'fake' : '' })
    t.after(() => { process.env = env })
    const patches: Array<Record<string, unknown>> = []
    if (usaIA) t.mock.method(console, 'log', () => {})
    const sent: Array<{ to: string; text: { body: string } }> = [], saved: Array<{ rol: string; contenido: string }> = []
    let fase = escenario.startsWith('programa_') ? 'inscripcion_programa' : escenario === 'revision_nueva' || escenario === 'ia_promesa' ? 'dudas' : escenario === 'elegir_diplomado' ? 'inscripcion_programa' : escenario === 'confirmacion' ? 'inscripcion_pendiente' : 'accion'
    const lead = { id: 'lead-1', nombre: 'Ana Prueba', whatsapp: '+525500000001', curso: escenario === 'desconocido' || escenario === 'elegir_diplomado' || escenario.startsWith('programa_') ? 'Curso no registrado' : 'Diplomado en Epidemiología', email: 'ana@example.test', stage: 'contactado' }
    const originalTimer = globalThis.setTimeout
    t.mock.method(globalThis, 'setTimeout', ((fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]) => originalTimer(fn, ms === 8000 ? 0 : ms, ...args)) as typeof setTimeout)
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init), url = new URL(req.url), q = url.searchParams
      if (url.hostname === 'api.openai.com' && usaIA) return Response.json({ choices: [{ message: { content: JSON.stringify({
        respuesta: escenario === 'ia_promesa' ? 'Un asesor te contacta para resolverlo.' : escenario === 'programa_precio' ? 'Para darte el costo exacto, ¿qué programa te interesa?' : MENSAJE_ESPERA,
        necesitaRevision: escenario === 'revision_nueva', siguienteFase: 'dudas',
      }) } }] })
      if (url.hostname === 'localhost' && usaIA) return Response.json({ context: '' })
      if (url.hostname === 'graph.facebook.com') { sent.push(await req.json()); return Response.json({ messages: [{ id: 'wamid.fake' }] }) }
      assert.equal(url.hostname, 'webhook-test.supabase.co', 'no consultar OpenAI, Meta ni Supabase real')
      const tabla = url.pathname.split('/').at(-1)
      if (req.method === 'HEAD') {
        assert.equal(tabla, 'whatsapp_mensajes')
        assert.equal(q.get('contenido'), `eq.${inscripcion.INSCRIPCION_DESCONOCIDA_MSG}`)
        return new Response(null, { headers: { 'Content-Range': `*/${escenario.startsWith('programa_lista_doble') ? 2 : 1}` } })
      }
      if (req.method === 'PATCH') {
        const patch = await req.json()
        patches.push(patch)
        if (tabla === 'whatsapp_conversaciones' && patch.fase) fase = patch.fase
        if (tabla === 'leads' && patch.curso) lead.curso = patch.curso
        return new Response(null, { status: 204 })
      }
      if (req.method === 'POST') {
        const data = await req.json()
        if (tabla === 'whatsapp_mensajes') {
          saved.push(...data)
          return q.has('select') ? Response.json({ id: 'incoming-1' }) : new Response(null, { status: 201 })
        }
        if (tabla === 'lead_activities') return new Response(null, { status: 201 })
        assert.fail(`POST inesperado ${tabla}`)
      }
      if (tabla === 'profiles') assert.fail('no debe consultar asesores asignados')
      if (tabla === 'leads') return Response.json(lead)
      if (tabla === 'whatsapp_conversaciones' && q.get('select') === 'revision_codigo') return Response.json([])
      if (tabla === 'whatsapp_conversaciones') return Response.json(q.get('fase') === 'eq.registro_confirmar' ? null : q.get('select') === 'id' ? [{ id: 'conv-1' }] : { id: 'conv-1', fase, modo_humano: false })
      if (tabla === 'whatsapp_mensajes') {
        if (q.has('raw_payload')) return Response.json(null)
        if (q.get('select') === 'id') return Response.json({ id: 'incoming-1' })
        return Response.json([])
      }
      if (tabla === 'whatsapp_flows') return Response.json(null)
      if (tabla === 'push_subscriptions') return Response.json([])
      return Response.json([])
    })
    const text = escenario === 'revalidacion' ? '¿Puedo revalidar materias de otra institución?' : escenario === 'ia_promesa' ? '¿El trámite especial está disponible?' : escenario.startsWith('programa_') ? escenario.endsWith('licenciatura') ? 'Licenciatura' : '¿cuánto cuesta?' : escenario === 'revision_nueva' ? '¿El trámite especial está disponible?' : escenario === 'elegir_diplomado' ? 'Diplomado en Epidemiología' : escenario === 'confirmacion' ? 'Ya pagué' : 'Me quiero inscribir'
    const req = new Request('http://localhost/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ id: `wamid.${escenario}`, from: '525500000001', type: 'text', text: { body: text } }], contacts: [{ profile: { name: 'Ana' } }] } }] }] }) })
    const response = await POST(req)
    assert.equal(response.status, 200)
    const toLead = sent.filter(m => m.to.replace(/\D/g, '') === '525500000001')
    assert.ok(toLead.length > 0, 'envía respuesta al lead')
    if (escenario === 'desconocido') { assert.match(toLead.at(-1)!.text.body, /Elige una opción/); assert.equal(fase, 'inscripcion_programa') }
    else if (escenario === 'confirmacion') { assert.ok(sent.some(m => m.to === ADMIN_WA_ALERTA)); assert.match(toLead.at(-1)!.text.body, /Déjame confirmarlo/) }
    else if (esRevision) {
      assert.equal(toLead.at(-1)!.text.body, MENSAJE_ESPERA)
      const pending = patches.find(p => p.modo_humano === true)!
      assert.ok(pending.revision_codigo)
      assert.equal(pending.revision_timeout_desde_at, pending.revision_codigo_asignado_at)
      assert.equal(pending.revision_recordatorio_at, null)
      assert.ok(sent.some(m => m.to === ADMIN_WA_ALERTA))
    }
    else if (escenario === 'revalidacion') {
      const mensaje = toLead.at(-1)!.text.body
      assert.match(mensaje, /kardex oficial[\s\S]*hola@windsor.edu.mx[\s\S]*nombre completo[\s\S]*WhatsApp[\s\S]*confírmanoslo por aquí y revisamos qué materias aplican/)
      assert.equal(saved.find(m => m.rol === 'bot')?.contenido, mensaje)
      assert.equal(patches.some(p => p.revision_codigo), false)
    } else if (escenario === 'programa_precio') {
      assert.equal(toLead.at(-1)!.text.body, 'Para darte el costo exacto, ¿qué programa te interesa?')
      assert.equal(patches.some(p => p.revision_codigo), false)
    } else if (escenario === 'programa_licenciatura') {
      assert.match(toLead.at(-1)!.text.body, /Tenemos (?:estas|las siguientes) licenciaturas:[\s\S]*Psicología/)
      assert.doesNotMatch(toLead.at(-1)!.text.body, /Elige una opción/)
      assert.equal(patches.some(p => p.revision_codigo), false)
    }
    else assert.match(toLead.at(-1)!.text.body, /INSCRIPCIÓN DIPLOMADOS/)
    for (const m of sent) { assert.ok(['525500000001', ADMIN_WA_ALERTA].includes(m.to.replace(/\D/g, ''))); if (m.to !== ADMIN_WA_ALERTA) sinPromesas(m.text.body) }
    for (const m of saved.filter(m => m.rol === 'bot')) sinPromesas(m.contenido)
  })
}
