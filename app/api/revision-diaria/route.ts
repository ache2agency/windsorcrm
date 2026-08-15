import { createClient, createServiceRoleClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── GET: filas de la revisión de una fecha (default: hoy, America/Mexico_City) ──

function todayCST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fecha = searchParams.get('fecha') || todayCST()

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('revision_diaria_conversaciones')
    .select('*')
    .eq('fecha', fecha)
    .order('created_at', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ filas: data || [] })
}

// ─── POST: generar/poblar las filas del día con conversaciones de últimas 24h ──

export async function POST() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 })

  const supabase = createServiceRoleClient()
  const fecha = todayCST()
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: convs, error: convError } = await supabase
    .from('whatsapp_conversaciones')
    .select('id, whatsapp, lead_id, ultimo_mensaje_at')
    .gte('ultimo_mensaje_at', desde)
    .order('ultimo_mensaje_at', { ascending: false })

  if (convError) return Response.json({ error: convError.message }, { status: 500 })
  if (!convs || convs.length === 0) return Response.json({ insertadas: 0, filas: [] })

  const leadIds = Array.from(new Set(convs.map((c) => c.lead_id).filter(Boolean)))
  const { data: leads } = leadIds.length
    ? await supabase.from('leads').select('id, nombre').in('id', leadIds)
    : { data: [] as { id: string; nombre: string | null }[] }
  const nombreById = new Map((leads || []).map((l) => [l.id, l.nombre]))

  const filas = convs.map((c) => ({
    fecha,
    telefono: c.whatsapp,
    nombre: (c.lead_id && nombreById.get(c.lead_id)) || null,
    lead_id: c.lead_id,
    conversacion_id: c.id,
  }))

  // upsert: no pisa notas_harold/propuesta_claude/estado si la fila ya existía hoy
  const { data: inserted, error: upsertError } = await supabase
    .from('revision_diaria_conversaciones')
    .upsert(filas, { onConflict: 'fecha,telefono', ignoreDuplicates: true })
    .select()

  if (upsertError) return Response.json({ error: upsertError.message }, { status: 500 })

  const { data: todasHoy } = await supabase
    .from('revision_diaria_conversaciones')
    .select('*')
    .eq('fecha', fecha)
    .order('created_at', { ascending: true })

  return Response.json({ insertadas: inserted?.length || 0, filas: todasHoy || [] })
}
