// Envío del template "lic_mkt" (Licenciatura en Relaciones Públicas y Mercadotecnia)
// a leads interesados en ese programa, para saber quién sigue interesado ante la
// posible apertura de un nuevo grupo. Excluye explícitamente a Luis (+527444243810,
// canceló su inscripción — stage "perdido"). Incluye a los demás sin importar stage,
// incluidos los 2 "archivado" y 1 "cerrado" que Harold revisó y decidió conservar.
//
// Uso:
//   node --env-file=.env.local scripts/campana-lic-mkt.mjs                 → dry-run (solo lista, no envía nada)
//   node --env-file=.env.local scripts/campana-lic-mkt.mjs --send          → envía a todos los pendientes
//   node --env-file=.env.local scripts/campana-lic-mkt.mjs --send --limit=10 → envía solo un bloque de N pendientes
//
// Reusa el endpoint /api/whatsapp/send ya desplegado (crea/actualiza conversación e
// historial automáticamente), en vez de duplicar esa lógica aquí. Registra cada envío
// exitoso en campana-lic-mkt-enviados.json para no reenviar en corridas futuras.

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const SEND = process.argv.includes('--send')
const TEMPLATE_NAME = 'lic_mkt'
const API_BASE = process.env.CRM_API_BASE || 'https://crm.windsor.edu.mx'
const EXCLUIR_WHATSAPP = ['+527444243810'] // Luis — canceló su inscripción
const SENT_LOG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'campana-lic-mkt-enviados.json')

function argNumber(flag) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg ? Number(arg.split('=')[1]) : null
}
const LIMIT = argNumber('limit')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function loadSentLog() {
  if (!fs.existsSync(SENT_LOG_PATH)) return []
  return JSON.parse(fs.readFileSync(SENT_LOG_PATH, 'utf8'))
}
function appendSentLog(entry) {
  const log = loadSentLog()
  log.push(entry)
  fs.writeFileSync(SENT_LOG_PATH, JSON.stringify(log, null, 2))
}

function normalizePhoneNumber(value) {
  let normalized = (value || '').replace(/^whatsapp:/i, '').trim()
  if (normalized && !normalized.startsWith('+')) normalized = `+${normalized}`
  if (/^\+521\d{10}$/.test(normalized)) normalized = '+52' + normalized.slice(4)
  return normalized
}

function esNombreBasura(nombre) {
  if (!nombre?.trim()) return true
  const n = nombre.trim().toLowerCase()
  const basura = /^(sin nombre|buen[oa]s?\s*(d[ií]as?|tardes?|noches?)?|hola|fotos?|inf|costo|precio|informaci[oó]n|me interesa|si|s[ií]|no|ok|vale)\b/i
  return basura.test(n)
}

async function main() {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, nombre, whatsapp, curso, stage')
    .ilike('curso', '%relaciones%')
    .not('whatsapp', 'is', null)
    .order('id', { ascending: true })

  if (error) throw error

  const objetivo = leads.filter((l) => /relaciones p[úu]blicas|mercadotecnia/i.test(l.curso || ''))
  const excluidosSet = new Set(EXCLUIR_WHATSAPP.map(normalizePhoneNumber))
  const candidatos = objetivo.filter((l) => !excluidosSet.has(normalizePhoneNumber(l.whatsapp)))

  const sentLog = loadSentLog()
  const sentSet = new Set(sentLog.map((e) => normalizePhoneNumber(e.whatsapp)))
  const pendientes = candidatos.filter((l) => !sentSet.has(normalizePhoneNumber(l.whatsapp)))

  console.log(`\nTotal en RR.PP. y Mercadotecnia: ${objetivo.length} | Excluidos: ${objetivo.length - candidatos.length} | Ya enviados antes: ${sentLog.length} | Pendientes: ${pendientes.length}\n`)

  const bloque = LIMIT ? pendientes.slice(0, LIMIT) : pendientes

  if (!SEND) {
    console.log('DRY-RUN — no se envió nada. Lista de pendientes:\n')
    for (const l of pendientes) console.log(`- ${l.nombre || '(sin nombre)'} | ${l.whatsapp} | stage=${l.stage} | curso=${l.curso}`)
    console.log(`\nPara enviar de verdad: node --env-file=.env.local scripts/campana-lic-mkt.mjs --send`)
    return
  }

  console.log(`Enviando template "${TEMPLATE_NAME}" a ${bloque.length} leads...\n`)
  let ok = 0, fail = 0
  for (const lead of bloque) {
    const nombre = esNombreBasura(lead.nombre) ? 'amig@' : lead.nombre.trim().split(/\s+/)[0]
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: lead.whatsapp,
          leadId: lead.id,
          templateName: TEMPLATE_NAME,
          templateParams: [nombre],
          fase: 'seguimiento',
          modoHumano: false, // /api/whatsapp/send default modoHumano=true si se omite — un envío masivo no debe sacar la conversación del bot
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      appendSentLog({ lead_id: lead.id, nombre: lead.nombre, whatsapp: lead.whatsapp, sent_at: new Date().toISOString() })
      console.log(`OK   ${lead.nombre || '(sin nombre)'} (${lead.whatsapp})`)
      ok++
    } catch (e) {
      console.log(`FAIL ${lead.nombre || '(sin nombre)'} (${lead.whatsapp}) — ${e.message}`)
      fail++
    }
    await new Promise((r) => setTimeout(r, 1200)) // evitar rate limit de Meta
  }
  console.log(`\nListo. Enviados: ${ok} | Fallidos: ${fail}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
