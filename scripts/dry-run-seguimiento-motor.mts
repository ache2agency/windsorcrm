// Ejecutar con node --env-file=<archivo local> --import tsx scripts/dry-run-seguimiento-motor.mts
// Llama al GET local, nunca al endpoint productivo. Solo permite lecturas Supabase.
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { GET } from '../app/api/whatsapp/seguimiento-motor/route'
import { FASES_MOTOR_SEGUIMIENTO } from '../lib/whatsapp/seguimiento-motor'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!
const originalFetch = globalThis.fetch
let lecturas = 0
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  assert.ok(['GET', 'HEAD'].includes(request.method), 'El dry-run no permite escrituras ni envíos')
  assert.equal(new URL(request.url).origin, new URL(supabaseUrl).origin)
  lecturas++
  return originalFetch(input, init)
}
const supabase = createClient(supabaseUrl, supabaseKey)
const { data: antes, error } = await supabase.from('whatsapp_conversaciones')
  .select('id').in('estado', ['abierta', 'cerrada']).in('fase', FASES_MOTOR_SEGUIMIENTO).limit(700)
if (error) throw new Error(error.message)
const secret = process.env.CRON_SECRET?.replace(/\\n$/, '').trim() || 'dry-local-only'
process.env.CRON_SECRET = secret
const inicio = performance.now()
const response = await GET(new Request('http://localhost/api/whatsapp/seguimiento-motor?dry=1', {
  headers: { authorization: `Bearer ${secret}` },
}))
const body = await response.json()
assert.equal(response.status, 200)
assert.equal(body.dryRun, true)
const conteo: Record<string, number> = {}
for (const r of body.resultados) conteo[r.accion] = (conteo[r.accion] || 0) + 1
console.log(JSON.stringify({
  antes: antes?.length, ahora: body.revisadas, acciones: body.acciones,
  porAccion: conteo,
  templates: body.templates,
  canalInternoOmitido: body.resultados.filter((r: { detalle: string }) => r.detalle === 'canal interno de asesores').length,
  recordatoriosBloqueados24h: body.resultados.filter((r: { detalle: string }) => r.detalle === 'recordatorio del mismo dato hace menos de 24h').length,
  lecturas, segundos: Math.round((performance.now() - inicio) / 1000),
  soloLectura: true,
}, null, 2))
