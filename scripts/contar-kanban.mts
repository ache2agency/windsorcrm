// SOLO LECTURA: GET paginado de campos mínimos; imprime únicamente agregados.
import { ETAPAS_KANBAN, etapaMigrada } from '../lib/crm/kanban'
const base = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) throw new Error('Faltan variables Supabase de lectura')
const headers = { apikey: key, Authorization: `Bearer ${key}` }
async function leer(tabla: string, campos: string) {
  const rows: any[] = []
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`/rest/v1/${tabla}`, base)
    url.searchParams.set('select', campos); url.searchParams.set('order', 'id.asc')
    url.searchParams.set('offset', String(offset)); url.searchParams.set('limit', '1000')
    const res = await fetch(url, { method: 'GET', headers })
    if (!res.ok) { const e = await res.json(); throw Object.assign(new Error(`Lectura ${tabla}: ${e.code}`), { code: e.code }) }
    const page = await res.json(); rows.push(...page); if (page.length < 1000) return rows
  }
}
let alumnosDisponibles = true, leads
try { leads = await leer('leads','id,stage,curso,tipo_contacto') }
catch (e) { if (!['42703','PGRST204'].includes((e as { code: string }).code)) throw e; alumnosDisponibles = false; leads = await leer('leads','id,stage,curso') }
const convs = await leer('whatsapp_conversaciones','id,lead_id,fase,ultimo_mensaje_at,created_at')
convs.sort((a,b) => String(b.ultimo_mensaje_at || '').localeCompare(String(a.ultimo_mensaje_at || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')) || b.id.localeCompare(a.id))
const fases = new Map<string,string>(); for (const c of convs) if (!fases.has(c.lead_id)) fases.set(c.lead_id,c.fase)
const porEtapa = Object.fromEntries(ETAPAS_KANBAN.map(e => [e.id,0])), anteriores: Record<string,number> = {}, cruces: Record<string,Record<string,number>> = {}
let alumnos = 0
for (const l of leads) {
  if (l.tipo_contacto === 'alumno') { alumnos++; continue }
  const old = l.stage || '(sin etapa)', next = etapaMigrada(l, fases.get(l.id))
  anteriores[old] = (anteriores[old] || 0) + 1; porEtapa[next]++
  ;(cruces[old] ||= {})[next] = (cruces[old]?.[next] || 0) + 1
}
console.log(JSON.stringify({ consultado_at: new Date().toISOString(), metodo: 'GET solamente; no SQL ni escrituras', total: leads.length, alumnosDisponibles, alumnosExcluidos: alumnos,
  etapas: ETAPAS_KANBAN.map(e => ({ etapa:e.label, id:e.id, leads:porEtapa[e.id] })), anteriores, cruces }, null, 2))
