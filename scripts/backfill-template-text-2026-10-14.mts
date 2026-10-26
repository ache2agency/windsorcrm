// Dry-run por defecto. No envía WhatsApps. Leer docs/0A_4_ERRORES.md antes.
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { textoTemplateEnviado } from '../lib/whatsapp/template-registro'

async function main() {
  const apply = process.argv.includes('--apply')
  const arg = process.argv.find(a => a.startsWith('--parameters-file='))
  // Para mensajes antiguos sin parámetros registrados: proveer valores originales,
  // indexados por ID del mensaje. No inferirlos del nombre/curso actual del lead.
  const originales: Record<string, string[]> = arg ? JSON.parse(await readFile(arg.slice('--parameters-file='.length), 'utf8')) : {}
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltan credenciales Supabase')
  const db = createClient(url, key, { auth: { persistSession: false } })
  const filas = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('whatsapp_mensajes').select('id,contenido,raw_payload,created_at')
      .eq('rol', 'bot').like('contenido', '[Template: %]')
      .gte('created_at', '2026-10-14T00:00:00-06:00').order('id').range(offset, offset + 499)
    if (error) throw error
    filas.push(...(data || []))
    if (!data || data.length < 500) break
  }
  let preparados = 0, actualizados = 0, sinDatos = 0
  for (const fila of filas) {
    const nombre = /^\[Template: ([a-zA-Z0-9_]+)\]$/.exec(fila.contenido)?.[1]
    if (!nombre) { sinDatos++; continue }
    const parametros = originales[fila.id] ?? fila.raw_payload?.seguimiento_motor?.templateParams ?? []
    if (!Array.isArray(parametros) || !parametros.every((p: unknown) => typeof p === 'string')) throw new Error(`Parámetros inválidos: ${fila.id}`)
    const texto = await textoTemplateEnviado(nombre, parametros)
    if (!texto) { sinDatos++; continue }
    preparados++
    if (apply) {
      // CAS: no pisar una corrección manual hecha mientras se preparaba el lote.
      const { data, error } = await db.from('whatsapp_mensajes').update({ contenido: texto,
        raw_payload: { ...fila.raw_payload, template_body_resolved: true,
          template_text_backfill: { at: new Date().toISOString(), source: arg ? 'parameters_file_or_payload' : 'payload', body_source: 'meta_current' } },
      }).eq('id', fila.id).eq('contenido', fila.contenido).select('id')
      if (error) throw error
      actualizados += data?.length || 0
    }
  }
  // Solo conteos, sin PII ni texto de las conversaciones.
  console.log(JSON.stringify({ apply, desdeMexico: '2026-10-14', encontrados: filas.length, preparados, actualizados, sinDatos }))
}
main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1 })
