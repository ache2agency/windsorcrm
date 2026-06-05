import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { normalizePhoneNumber } from '@/lib/whatsapp/provider'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// ─── Helpers ─────────────────────────────────────────────────────────────────

function horasDesde(fecha: Date): number {
  return (Date.now() - fecha.getTime()) / (1000 * 60 * 60)
}

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() === secret
  return request.headers.get('x-cron-secret') === secret
}

const STAGES_ACTIVOS = [
  'primer_contacto', 'contactado', 'interesado',
  'examen_ubicacion', 'clase_muestra',
  'seguimiento', 'inscripcion_pendiente',
]

// Umbrales en horas para cada tier según tipo de lead
const UMBRALES_ESTANDAR   = [12,  48,  96, 144, 192]  // tiers 1-5
const UMBRALES_INSCRIPCION = [24,  48,  72, 120, 168]  // inscripcion_pendiente

const TIPOS_POR_TIER = ['mensaje_wa', 'llamada', 'template', 'llamada', 'template'] as const

function selectTemplate(tier: number, stage: string): string {
  if (stage === 'inscripcion_pendiente') return 'windsor_inscripcion_pendiente'
  if (tier === 5) return 'windsor_promocion'
  return 'seguimiento_general'
}

// ─── Draft Tier 1 via GPT-4o-mini ────────────────────────────────────────────

async function draftTier1(
  nombre: string | null,
  curso: string | null,
  historial: string
): Promise<string> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) return `Hola${nombre ? ' ' + nombre : ''} 👋 ¿Pudiste revisar la información sobre Instituto Windsor? Con gusto resuelvo cualquier duda 😊`

  const prompt = `Eres el director de ventas de Instituto Windsor (escuela en México).
Redacta un mensaje de WhatsApp de seguimiento para un prospecto que no respondió.

Nombre del prospecto: ${nombre || 'desconocido'}
Programa de interés: ${curso || 'por definir'}

Últimos mensajes de la conversación (del más antiguo al más reciente):
${historial || '(sin historial disponible)'}

REGLAS:
- Máximo 2 líneas
- Tono: cercano, genuino, sin presión
- NO menciones precios ni urgencia de cupo
- Empieza con "Hola [nombre]" si tienes el nombre
- Usa solo texto plano, sin markdown

Responde ÚNICAMENTE con el mensaje, sin comillas.`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() || `Hola${nombre ? ' ' + nombre : ''} 👋 ¿Pudiste revisar la información? Con gusto te ayudo 😊`
  } catch {
    return `Hola${nombre ? ' ' + nombre : ''} 👋 ¿Pudiste revisar la información sobre Instituto Windsor? Con gusto resuelvo cualquier duda 😊`
  }
}

// ─── GET — Lista pendientes filtrada por asesor ───────────────────────────────

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  const supabase = createServiceRoleClient()

  let leadIdsPermitidos: string[] | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('rol')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.rol !== 'admin') {
      const { data: leads } = await supabase
        .from('leads')
        .select('id')
        .eq('asignado_a', user.id)
      leadIdsPermitidos = (leads || []).map((l: { id: string }) => l.id)
    }
  }

  let query = supabase
    .from('seguimientos')
    .select('*')
    .eq('estado', 'pendiente')
    .order('tier', { ascending: true })
    .order('fecha_programada', { ascending: true })

  if (leadIdsPermitidos !== null) {
    if (leadIdsPermitidos.length === 0) return Response.json({ seguimientos: [] })
    query = query.in('lead_id', leadIdsPermitidos)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Enriquecer con último mensaje del usuario para mostrar contexto
  const convIds = [...new Set((data || []).map((s: { conversacion_id: string | null }) => s.conversacion_id).filter(Boolean))]
  let ultimosUsuario: Record<string, { at: string; contenido: string }> = {}

  if (convIds.length > 0) {
    const { data: msgs } = await supabase
      .from('whatsapp_mensajes')
      .select('conversacion_id, created_at, contenido')
      .in('conversacion_id', convIds)
      .eq('rol', 'usuario')
      .order('created_at', { ascending: false })

    for (const m of msgs || []) {
      if (!ultimosUsuario[m.conversacion_id]) {
        ultimosUsuario[m.conversacion_id] = { at: m.created_at, contenido: m.contenido }
      }
    }
  }

  const ahora = Date.now()
  const enriquecidos = (data || []).map((s: Record<string, unknown>) => {
    const uu = s.conversacion_id ? ultimosUsuario[s.conversacion_id as string] : null
    const enVentana = uu ? (ahora - new Date(uu.at).getTime()) < 24 * 60 * 60 * 1000 : false
    return {
      ...s,
      ultimo_usuario_at: uu?.at || null,
      ultimo_usuario_msg: uu?.contenido || null,
      en_ventana_24h: enVentana,
    }
  })

  return Response.json({ seguimientos: enriquecidos })
}

// ─── POST — Generar seguimientos (cron) ──────────────────────────────────────

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const generados: string[] = []
  const saltados: string[] = []
  const cerrados: string[] = []

  // 1. Obtener todos los leads activos con su conversación y asesor
  const { data: leads } = await supabase
    .from('leads')
    .select('id, nombre, whatsapp, curso, stage, asignado_a')
    .in('stage', STAGES_ACTIVOS)
    .not('whatsapp', 'is', null)

  for (const lead of leads || []) {
    try {
      // 2. ¿Ya tiene un seguimiento pendiente? → saltar
      const { data: pendiente } = await supabase
        .from('seguimientos')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('estado', 'pendiente')
        .maybeSingle()

      if (pendiente) { saltados.push(lead.id); continue }

      // 3. Obtener conversación activa
      const { data: conv } = await supabase
        .from('whatsapp_conversaciones')
        .select('id, ultimo_mensaje_at, fase')
        .eq('lead_id', lead.id)
        .order('ultimo_mensaje_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!conv) { saltados.push(lead.id); continue }

      // 4. Último mensaje del usuario
      const { data: lastUserMsg } = await supabase
        .from('whatsapp_mensajes')
        .select('created_at')
        .eq('conversacion_id', conv.id)
        .eq('rol', 'usuario')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      // Fecha de referencia: último mensaje del usuario, o último mensaje de la conv
      const refDate = lastUserMsg?.created_at
        ? new Date(lastUserMsg.created_at)
        : conv.ultimo_mensaje_at
          ? new Date(conv.ultimo_mensaje_at)
          : null

      if (!refDate) { saltados.push(lead.id); continue }

      const horas = horasDesde(refDate)

      // 5. Máximo tier completado/saltado para este lead
      const { data: anteriores } = await supabase
        .from('seguimientos')
        .select('tier')
        .eq('lead_id', lead.id)
        .in('estado', ['completado', 'saltado'])
        .order('tier', { ascending: false })
        .limit(1)

      const ultimoTier = (anteriores?.[0] as { tier?: number } | undefined)?.tier ?? 0
      const nextTier = ultimoTier + 1

      // 6. ¿Se agotaron todos los tiers? → cerrar como perdido
      if (nextTier > 5) {
        if (horas > 264) { // 11 días
          await supabase.from('leads').update({ stage: 'perdido' }).eq('id', lead.id)
          cerrados.push(lead.id)
        }
        continue
      }

      // 7. ¿Cumple el umbral de horas?
      const esInscripcion = lead.stage === 'inscripcion_pendiente'
      const umbrales = esInscripcion ? UMBRALES_INSCRIPCION : UMBRALES_ESTANDAR
      if (horas < umbrales[nextTier - 1]) { saltados.push(lead.id); continue }

      // 8. Determinar tipo y contenido
      // Tier 1 es mensaje_wa solo si la ventana de 24h sigue abierta; si no, degradar a template
      let tipo: string = TIPOS_POR_TIER[nextTier - 1]
      let contenidoSugerido: string | null = null
      let templateName: string | null = null

      if (tipo === 'mensaje_wa' && horas > 24) {
        tipo = 'template'
      }

      if (tipo === 'mensaje_wa') {
        const nombre = lead.nombre ? ` ${lead.nombre.split(' ')[0]}` : ''
        contenidoSugerido = `Hola${nombre} 👋 ¿Pudiste revisar la información sobre Instituto Windsor? Si tienes alguna duda, con gusto te ayudo 😊`
      } else if (tipo === 'template') {
        templateName = selectTemplate(nextTier, lead.stage)
        contenidoSugerido = templateName === 'seguimiento_general'
          ? `Hola {{nombre}} 👋 ¿Pudiste revisar la información que te compartimos sobre Instituto Windsor? Si tienes alguna duda, con gusto te ayudamos. 😊`
          : templateName === 'windsor_promocion'
            ? `¡Hola {{nombre}}! 🎉 Tenemos una promoción especial activa para ti. ¿Te gustaría que un asesor te llame para darte los detalles?`
            : `Hola {{nombre}}, notamos que tu inscripción quedó pendiente. ¿Te ayudamos a completarla hoy? 😊`
      }

      // 9. Crear el seguimiento
      await supabase.from('seguimientos').insert([{
        lead_id: lead.id,
        conversacion_id: conv.id,
        lead_nombre: lead.nombre,
        lead_whatsapp: normalizePhoneNumber(lead.whatsapp),
        lead_curso: lead.curso,
        lead_stage: lead.stage,
        tier: nextTier,
        tipo,
        contenido_sugerido: contenidoSugerido,
        template_name: templateName,
        fecha_programada: new Date().toISOString(),
      }])

      generados.push(lead.id)
    } catch (e) {
      console.error('[seguimientos/generar] lead', lead.id, e)
    }
  }

  // Notificar a cada asesor si tiene pendientes nuevos
  try {
    const { data: asesores } = await supabase
      .from('profiles')
      .select('id, nombre, whatsapp')
      .not('whatsapp', 'is', null)

    for (const asesor of asesores || []) {
      const { data: misLeads } = await supabase
        .from('leads')
        .select('id')
        .eq('asignado_a', asesor.id)
      const misIds = (misLeads || []).map((l: { id: string }) => l.id)
      if (!misIds.length) continue

      const { data: misPendientes } = await supabase
        .from('seguimientos')
        .select('id, tier, tipo')
        .in('lead_id', misIds)
        .eq('estado', 'pendiente')

      if (!misPendientes?.length) continue

      const mensajes = misPendientes.filter((s: { tipo: string }) => s.tipo === 'mensaje_wa').length
      const llamadas = misPendientes.filter((s: { tipo: string }) => s.tipo === 'llamada').length
      const templates = misPendientes.filter((s: { tipo: string }) => s.tipo === 'template').length

      const lineas = [`📋 *Hola ${asesor.nombre?.split(' ')[0] || 'asesor'}*, tienes seguimientos pendientes hoy:\n`]
      if (mensajes) lineas.push(`💬 ${mensajes} mensaje${mensajes > 1 ? 's' : ''} por aprobar`)
      if (llamadas) lineas.push(`📞 ${llamadas} llamada${llamadas > 1 ? 's' : ''} por realizar`)
      if (templates) lineas.push(`📋 ${templates} template${templates > 1 ? 's' : ''} por enviar`)
      lineas.push(`\nEntra al CRM → pestaña SEGUIMIENTOS`)

      const { sendMetaWhatsAppMessage } = await import('@/lib/whatsapp/provider')
      await sendMetaWhatsAppMessage({ to: asesor.whatsapp, body: lineas.join('\n') }).catch(() => {})
    }
  } catch (e) {
    console.error('[seguimientos/generar] notificaciones error:', e)
  }

  return Response.json({
    ok: true,
    generados: generados.length,
    saltados: saltados.length,
    cerrados: cerrados.length,
  })
}
