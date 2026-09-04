// Envío del template "windsor_nuevo_ciclo" (inicio de nuevo ciclo escolar +
// promociones vigentes) a TODOS los leads con WhatsApp, sin importar el
// programa — el texto es genérico a propósito, aplica a cualquier oferta
// educativa. Reactiva conversación y ve quién sigue interesado en inscribirse.
//
// Texto: "Hola {{1}} 👋 Se acerca el nuevo ciclo escolar en Instituto Windsor y
// tenemos promociones vigentes para ti. Por favor, selecciona una opción." —
// botones: "Me quiero inscribir" / "Tengo dudas" / "Quizás más adelante" /
// "Ya no me interesa". Las respuestas se auto-clasifican en el Kanban vía
// interceptores en app/api/whatsapp/webhook/route.ts (busca "windsor_nuevo_ciclo"
// y "seguimiento_general" ahí):
//   "Me quiero inscribir" → inscripcion_pendiente
//   "Tengo dudas"         → tercer_contacto
//   "Quizás más adelante" → archivado
//   "Ya no me interesa"   → perdido
//
// Excluye:
//   - stage "inscrito" (ya se inscribió, no aplica reactivar)
//   - stage "perdido" (ya canceló o no le interesa)
//   - stage "cerrado" — nombre legacy de "inscrito" (ver LEGACY_STAGE_MAP en
//     app/crm.jsx), el Kanban ya lo muestra como "Inscrito"
//   - curso de Relaciones públicas y mercadotecnia (offline/online), porque esos
//     leads ya recibieron el template "lic_mkt" el 2026-09-03 — no saturar tan pronto
//
// Tope de la cuenta en Meta: 2,000 conversaciones nuevas/día (WhatsApp Manager,
// confirmado 2026-09-04). Plan de ritmo (2026-09-04, versión final —
// conservador, exponencial, para medir respuesta/bloqueos antes de escalar):
//   Día 1: 50   Día 2: 100   Día 3: 200   Día 4: 400   Día 5: 800   Día 6: resto (~569)
// Cada corrida mezcla los pendientes al azar (ver Fisher-Yates abajo) para que
// cada lote sea una mezcla representativa de programas, no solo los ids más
// antiguos de un mismo lote de captación.
//
// Uso:
//   node --env-file=.env.local scripts/campana-ciclo-escolar.mjs                   → dry-run (solo lista, no envía nada)
//   node --env-file=.env.local scripts/campana-ciclo-escolar.mjs --send --limit=50 → envía el lote del día
//   node --env-file=.env.local scripts/campana-ciclo-escolar.mjs --send            → envía a TODOS los pendientes restantes
//
// Reusa el endpoint /api/whatsapp/send ya desplegado (crea/actualiza conversación e
// historial automáticamente). Registra cada envío exitoso en
// campana-ciclo-escolar-enviados.json para no reenviar en corridas futuras — así se
// puede correr el script varias veces al día/semana con --limit hasta cubrir a todos.

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const SEND = process.argv.includes('--send')
const TEMPLATE_NAME = 'windsor_nuevo_ciclo'
const API_BASE = process.env.CRM_API_BASE || 'https://crm.windsor.edu.mx'
const SENT_LOG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'campana-ciclo-escolar-enviados.json')

const RRPP_REGEX = /relaciones p[úu]blicas|mercadotecnia/i
const STAGES_EXCLUIDOS = new Set(['inscrito', 'perdido', 'cerrado'])

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
  // Paginado: el cliente de Supabase trae máximo 1000 filas por query aunque
  // no se pida un límite explícito — sin este loop se pierden leads en silencio
  // en tablas grandes (aquí el objetivo real es de 1154, no 1000).
  const leads = []
  const PAGE_SIZE = 1000
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, nombre, whatsapp, curso, stage')
      .not('whatsapp', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    leads.push(...data)
    if (data.length < PAGE_SIZE) break
  }

  const candidatos = leads.filter((l) => !STAGES_EXCLUIDOS.has(l.stage) && !RRPP_REGEX.test(l.curso || ''))

  const sentLog = loadSentLog()
  const sentSet = new Set(sentLog.map((e) => normalizePhoneNumber(e.whatsapp)))
  const pendientesOrdenados = candidatos.filter((l) => !sentSet.has(normalizePhoneNumber(l.whatsapp)))

  // Mezcla aleatoria (Fisher-Yates) antes de tomar el bloque — si no, --limit
  // siempre toma los ids más antiguos primero, que pueden estar concentrados
  // en un solo programa/época de captación en vez de ser representativos.
  const pendientes = [...pendientesOrdenados]
  for (let i = pendientes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pendientes[i], pendientes[j]] = [pendientes[j], pendientes[i]]
  }

  console.log(`\nTotal con whatsapp: ${leads.length} | Excluidos (stage inscrito/perdido/cerrado + RR.PP.): ${leads.length - candidatos.length} | Ya enviados antes: ${sentLog.length} | Pendientes: ${pendientes.length}\n`)

  const bloque = LIMIT ? pendientes.slice(0, LIMIT) : pendientes

  if (!SEND) {
    console.log('DRY-RUN — no se envió nada.\n')
    const porCurso = {}
    for (const l of pendientes) porCurso[l.curso] = (porCurso[l.curso] || 0) + 1
    console.log('Pendientes por curso:', JSON.stringify(porCurso, null, 2))
    console.log(`\nPara enviar de verdad (recomendado por tandas): node --env-file=.env.local scripts/campana-ciclo-escolar.mjs --send --limit=40`)
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
      // Mueve al lead a la columna "Promoción enviada" del Kanban — así la respuesta
      // del botón (interceptada en el webhook) parte de un stage conocido, y si
      // no responde nada queda visible que ya se le mandó esta promoción.
      await supabase.from('leads').update({ stage: 'promocion_enviada' }).eq('id', lead.id)
      appendSentLog({ lead_id: lead.id, nombre: lead.nombre, whatsapp: lead.whatsapp, curso: lead.curso, sent_at: new Date().toISOString() })
      console.log(`OK   ${lead.nombre || '(sin nombre)'} (${lead.whatsapp}) — ${lead.curso}`)
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
