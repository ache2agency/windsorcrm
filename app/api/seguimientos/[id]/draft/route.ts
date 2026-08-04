import { createServiceRoleClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServiceRoleClient()

  const { data: seg } = await supabase
    .from('seguimientos')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!seg) return Response.json({ error: 'No encontrado' }, { status: 404 })

  // Obtener historial de conversación
  let historial = ''
  if (seg.conversacion_id) {
    const { data: msgs } = await supabase
      .from('whatsapp_mensajes')
      .select('rol, contenido')
      .eq('conversacion_id', seg.conversacion_id)
      .order('created_at', { ascending: false })
      .limit(8)

    historial = (msgs || [])
      .reverse()
      .map((m: { rol: string; contenido: string }) =>
        `${m.rol === 'usuario' ? 'Lead' : 'Bot'}: ${m.contenido.slice(0, 120)}`
      )
      .join('\n')
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) return Response.json({ error: 'Sin API key' }, { status: 500 })

  const nombre = seg.lead_nombre?.split(' ')[0] || null
  const prompt = `Eres el director de ventas de Instituto Windsor (escuela en México).
Redacta un mensaje de WhatsApp de seguimiento para un prospecto que no respondió.

Nombre: ${nombre || 'desconocido'}
Programa: ${seg.lead_curso || 'por definir'}
Etapa: ${seg.lead_stage || ''}

Últimos mensajes:
${historial || '(sin historial)'}

REGLAS:
- Máximo 2 líneas
- Tono cercano, genuino, sin presión
- NO menciones precios ni urgencia de cupo
- Empieza con "Hola [nombre]" si tienes el nombre
- Solo texto plano

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
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json()
    const draft = data.choices?.[0]?.message?.content?.trim()
    if (!draft) throw new Error('GPT sin respuesta')

    // Actualizar el contenido sugerido en la DB
    await supabase
      .from('seguimientos')
      .update({ contenido_sugerido: draft })
      .eq('id', id)

    return Response.json({ ok: true, draft })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
