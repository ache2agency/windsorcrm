import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { GET } from '../app/api/whatsapp/seguimiento-motor/route'
import { accionRevision, ejecutarRevisionesPendientes, siguienteCorridaRevision, type RevisionPendiente } from '../lib/whatsapp/revision-timeout'
import { ADMIN_WA_ALERTA } from '../lib/whatsapp/atencion'
const mx = (s: string) => new Date(`${s}:00-06:00`)
const revision = (desde: Date, recordado = false): RevisionPendiente => ({
  id: 'revision-horario', whatsapp: '+525500000001', lead_id: 'lead-1', provider: 'meta',
  revision_codigo: 'x', revision_timeout_desde_at: desde.toISOString(),
  revision_recordatorio_at: recordado ? desde.toISOString() : null,
  revision_timeout_claim_at: null, revision_draft: null, modo_humano: true, tomado_por: null,
})

test('08h: recordatorio a 12h, adelanta cierre al último turno de 20h; nada de madrugada', () => {
  const desde = mx('2026-10-24T08:00')
  assert.equal(accionRevision(revision(desde), mx('2026-10-24T11:00'), undefined, desde.toISOString()), null)
  assert.equal(accionRevision(revision(desde), mx('2026-10-24T12:00'), undefined, desde.toISOString()), 'recordatorio')
  assert.equal(accionRevision(revision(desde, true), mx('2026-10-24T19:00'), undefined, desde.toISOString()), null)
  assert.equal(accionRevision(revision(desde, true), mx('2026-10-24T20:00'), undefined, desde.toISOString()), 'reactivar')
  assert.equal(accionRevision(revision(desde), mx('2026-10-25T04:00'), undefined, desde.toISOString()), null)
  assert.equal(siguienteCorridaRevision(mx('2026-10-24T20:35')).toISOString(), mx('2026-10-25T08:35').toISOString())
})

test('19h: recordatorio nocturno espera 08h y reactivación ocurre a 15h', () => {
  const desde = mx('2026-10-24T19:00')
  assert.equal(accionRevision(revision(desde), mx('2026-10-24T20:00'), undefined, desde.toISOString()), null)
  assert.equal(accionRevision(revision(desde), mx('2026-10-24T23:00'), undefined, desde.toISOString()), null)
  assert.equal(accionRevision(revision(desde), mx('2026-10-25T08:00'), undefined, desde.toISOString()), 'recordatorio')
  assert.equal(accionRevision(revision(desde, true), mx('2026-10-25T14:00'), undefined, desde.toISOString()), null)
  assert.equal(accionRevision(revision(desde, true), mx('2026-10-25T15:00'), undefined, desde.toISOString()), 'reactivar')
})

test('23h: recordatorio espera 08h y reactivación ocurre a 19h', () => {
  const desde = mx('2026-10-24T23:00')
  assert.equal(accionRevision(revision(desde), mx('2026-10-25T03:00'), undefined, desde.toISOString()), null)
  assert.equal(accionRevision(revision(desde), mx('2026-10-25T08:00'), undefined, desde.toISOString()), 'recordatorio')
  assert.equal(accionRevision(revision(desde, true), mx('2026-10-25T18:00'), undefined, desde.toISOString()), null)
  assert.equal(accionRevision(revision(desde, true), mx('2026-10-25T19:00'), undefined, desde.toISOString()), 'reactivar')
})

test('ventana usa el último usuario y permite esperar a apertura si sigue vigente', () => {
  const desde = mx('2026-10-24T08:00'), ultimo = mx('2026-10-24T19:00')
  assert.equal(accionRevision(revision(desde, true), mx('2026-10-24T20:00'), undefined, ultimo.toISOString()), null)
  assert.equal(accionRevision(revision(desde, true), mx('2026-10-25T08:00'), undefined, ultimo.toISOString()), 'reactivar')
  const desde11 = mx('2026-10-24T11:00')
  assert.equal(accionRevision(revision(desde11, true), mx('2026-10-24T20:00'), undefined, desde11.toISOString()), null)
  assert.equal(accionRevision(revision(desde11, true), mx('2026-10-25T08:00'), undefined, desde11.toISOString()), 'reactivar')
})

for (const hora of ['2026-10-24T21:00', '2026-10-25T03:00', '2026-10-25T07:59']) test(`sin consultas, reservas ni envíos de revisión a ${hora} México`, async t => {
  const db = createClient('https://revision-test.supabase.co', 'fake', { auth: { persistSession: false } })
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('noche: no debe consultar ni mutar') })
  const noEnviar = async () => { assert.fail('noche: no debe enviar') }
  assert.deepEqual(await ejecutarRevisionesPendientes(db, false, mx(hora), noEnviar), [])
  assert.deepEqual(await ejecutarRevisionesPendientes(db, true, mx(hora), noEnviar), [])
  const previous = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'test-secret'
  t.after(() => { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous })
  t.mock.timers.enable({ apis: ['Date'], now: mx(hora) })
  const result = await GET(new Request('http://localhost/api/whatsapp/seguimiento-motor', { headers: { authorization: 'Bearer test-secret' } }))
  const body = await result.json()
  assert.equal(result.status, 200)
  assert.match(body.omitido, /fuera de horario/)
  assert.deepEqual(body.revisiones, [])
})

for (const [desdeMX, corridaMX, esperado] of [
  ['2026-10-24T08:00', '2026-10-24T20:35', 'reactivar'],
  ['2026-10-24T19:00', '2026-10-25T08:35', 'recordatorio'],
  ['2026-10-24T19:00', '2026-10-25T15:35', 'reactivar'],
  ['2026-10-24T23:00', '2026-10-25T08:35', 'recordatorio'],
  ['2026-10-24T23:00', '2026-10-25T19:35', 'reactivar'],
  ['2026-10-24T08:00', '2026-10-25T08:35', 'reactivar_sin_ventana'],
]) test(`worker ${desdeMX} → ${corridaMX}: ${esperado}`, async t => {
  const desde = mx(desdeMX), ahora = mx(corridaMX), row = revision(desde)
  const enviados: Array<{ to: string; body: string }> = [], finales: Array<{ p_accion: string; p_exito: boolean }> = []
  const db = createClient('https://revision-test.supabase.co', 'fake', { auth: { persistSession: false } })
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init), url = new URL(req.url)
    assert.equal(url.hostname, 'revision-test.supabase.co')
    if (url.pathname.endsWith('/reclamar_revision_timeout')) return Response.json([{ ...row, revision_timeout_claim_at: ahora.toISOString() }])
    if (url.pathname.endsWith('/terminar_revision_timeout')) { finales.push(await req.json()); return Response.json(true) }
    if (url.pathname.endsWith('/whatsapp_mensajes')) return Response.json({ created_at: desde.toISOString() })
    if (url.pathname.endsWith('/leads')) return Response.json({ curso: 'Diplomado en Epidemiología' })
    if (url.pathname.endsWith('/whatsapp_conversaciones')) return Response.json(url.searchParams.has('revision_timeout_desde_at') ? [row] : row)
    assert.fail(`Consulta inesperada ${url}`)
  })
  const results = await ejecutarRevisionesPendientes(db, false, ahora, async m => { enviados.push(m); return { id: 'wamid.mock', raw: {} } })
  assert.deepEqual(finales, [{ p_id: row.id, p_codigo: row.revision_codigo, p_claim: ahora.toISOString(), p_accion: esperado,
    p_texto: enviados[0]?.body || '', p_raw: esperado === 'reactivar' ? {
      wamid: 'wamid.mock', seguimiento_motor: { accion: 'texto', reglaId: 'revision_timeout_reactivar' },
      revision_timeout: { codigo: row.revision_codigo, desde: row.revision_timeout_desde_at },
    } : {}, p_exito: true }])
  assert.equal(results[0]?.accion, `revision_${esperado}`)
  if (esperado === 'reactivar_sin_ventana') assert.equal(enviados.length, 0)
  else { assert.equal(enviados.length, 1); assert.equal(enviados[0]!.to, esperado === 'recordatorio' ? ADMIN_WA_ALERTA : row.whatsapp) }
})
