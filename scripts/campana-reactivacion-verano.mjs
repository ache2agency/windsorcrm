// Envío masivo del template "reactivacion_verano" a leads interesados en verano
// que ya escribieron por WhatsApp, excluyendo inscrito/perdido.
//
// Uso:
//   node --env-file=.env.local scripts/campana-reactivacion-verano.mjs                              → dry-run (solo lista, no envía nada)
//   node --env-file=.env.local scripts/campana-reactivacion-verano.mjs --send                       → envía a todos
//   node --env-file=.env.local scripts/campana-reactivacion-verano.mjs --send --limit=50 --offset=0 → envía solo el bloque [offset, offset+limit)
//
// Envío por bloques con registro propio de enviados: cada envío exitoso se guarda en
// campana-reactivacion-verano-enviados.json (por número de WhatsApp normalizado), así que
// --send --limit=50 siempre manda a los siguientes 50 que AÚN NO han recibido el mensaje,
// sin importar cambios de stage entre corridas. Nunca hace falta mover --offset a mano.

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const SEND = process.argv.includes('--send')
const TEMPLATE_NAME = 'reactivacion_verano'
const SENT_LOG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'campana-reactivacion-verano-enviados.json')

function argNumber(flag) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg ? Number(arg.split('=')[1]) : null
}
const LIMIT = argNumber('limit')
const OFFSET = argNumber('offset') || 0

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function loadSentLog() {
  if (!fs.existsSync(SENT_LOG_PATH)) return []
  return JSON.parse(fs.readFileSync(SENT_LOG_PATH, 'utf8'))
}

function appendSentLog(entry) {
  const log = loadSentLog()
  log.push(entry)
  fs.writeFileSync(SENT_LOG_PATH, JSON.stringify(log, null, 2))
}

function esNombreBasura(nombre) {
  if (!nombre?.trim()) return true
  const n = nombre.trim().toLowerCase()
  // Frases capturadas por error (saludos, preguntas, palabras sueltas) en vez de un nombre real
  const basura = /^(sin nombre|buen[oa]s?\s*(d[ií]as?|tardes?|noches?)?|hola|fotos?|inf|costo|precio|informaci[oó]n|quien tengo el gusto|qui[eé]n tengo el gusto|con quien tengo el gusto)\b/i
  return basura.test(n)
}

function normalizePhoneNumber(value) {
  let normalized = (value || '').replace(/^whatsapp:/i, '').trim()
  if (normalized && !normalized.startsWith('+')) normalized = `+${normalized}`
  if (/^\+521\d{10}$/.test(normalized)) normalized = '+52' + normalized.slice(4)
  return normalized
}

async function sendTemplate(to, nombre) {
  const accessToken = process.env.META_WHATSAPP_TOKEN || process.env.META_WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID
  const toFormatted = normalizePhoneNumber(to).replace(/^\+/, '')

  const res = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toFormatted,
      type: 'template',
      template: {
        name: TEMPLATE_NAME,
        language: { code: 'es_MX' },
        components: [{ type: 'body', parameters: [{ type: 'text', parameter_name: 'nombre', text: nombre }] }],
      },
    }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`)
  return data?.messages?.[0]?.id || null
}

async function main() {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, nombre, whatsapp, curso, stage')
    .ilike('curso', '%verano%')
    .not('stage', 'in', '(inscrito,perdido,archivado)')
    .not('whatsapp', 'is', null)
    .order('id', { ascending: true })

  if (error) throw error

  // Filtrar solo leads con conversación por WhatsApp vía Meta (no Messenger)
  const resultado = []
  for (const lead of leads) {
    const { data: conv } = await supabase
      .from('whatsapp_conversaciones')
      .select('id, provider')
      .eq('lead_id', lead.id)
      .eq('provider', 'meta')
      .order('ultimo_mensaje_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (conv) resultado.push({ ...lead, conversacion_id: conv.id })
  }

  const sentLog = loadSentLog()
  const sentSet = new Set(sentLog.map((e) => normalizePhoneNumber(e.whatsapp)))
  const pendientes = resultado.filter((l) => !sentSet.has(normalizePhoneNumber(l.whatsapp)))

  console.log(`\nTotal leads de verano (excluye inscrito/perdido, con conversación WhatsApp Meta): ${resultado.length}`)
  console.log(`Ya enviados en corridas anteriores: ${sentLog.length} | Pendientes por enviar: ${pendientes.length}\n`)
  const porStage = {}
  for (const l of resultado) porStage[l.stage || 'sin_stage'] = (porStage[l.stage || 'sin_stage'] || 0) + 1
  console.table(porStage)

  const bloque = LIMIT ? pendientes.slice(OFFSET, OFFSET + LIMIT) : pendientes

  if (!SEND) {
    console.log('DRY-RUN — no se envió nada. Lista de pendientes:\n')
    for (const l of pendientes) console.log(`- ${l.nombre || '(sin nombre)'} | ${l.whatsapp} | stage=${l.stage} | curso=${l.curso}`)
    console.log('\nPara enviar de verdad: node --env-file=.env.local scripts/campana-reactivacion-verano.mjs --send')
    return
  }

  if (LIMIT) {
    console.log(`Bloque: siguientes ${bloque.length} pendientes (de ${pendientes.length} sin enviar)\n`)
  }
  console.log(`Enviando template "${TEMPLATE_NAME}" a ${bloque.length} leads...\n`)
  let ok = 0, fail = 0
  for (const lead of bloque) {
    const nombre = esNombreBasura(lead.nombre) ? 'amig@' : lead.nombre.trim()
    try {
      await sendTemplate(lead.whatsapp, nombre)
      const contenido = `Hola ${nombre} 👋 ¡Ya casi arranca My Best Summer 2026! Inicia el 13 de julio ☀️ y quedan pocos lugares disponibles. Si tienes dudas o quieres asegurar tu lugar, con gusto te ayudamos.`
      const now = new Date().toISOString()
      await supabase.from('whatsapp_mensajes').insert([{
        conversacion_id: lead.conversacion_id, rol: 'agente', contenido, created_at: now,
      }])
      await supabase.from('whatsapp_conversaciones').update({ ultimo_mensaje_at: now, estado: 'abierta' }).eq('id', lead.conversacion_id)
      appendSentLog({ lead_id: lead.id, nombre: lead.nombre, whatsapp: lead.whatsapp, sent_at: now })
      console.log(`OK   ${lead.nombre} (${lead.whatsapp})`)
      ok++
    } catch (e) {
      console.log(`FAIL ${lead.nombre} (${lead.whatsapp}) — ${e.message}`)
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
