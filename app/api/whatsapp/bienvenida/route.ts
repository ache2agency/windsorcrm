import { createServiceRoleClient } from '@/utils/supabase/server'
import { enviarBienvenidaLeadManual } from '@/lib/whatsapp/bienvenida'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const { lead_id } = await request.json()
  if (!lead_id) return Response.json({ error: 'lead_id requerido' }, { status: 400 })

  const supabase = createServiceRoleClient()
  const result = await enviarBienvenidaLeadManual(supabase, lead_id)

  if (!result.ok) {
    const status = result.error === 'Lead no encontrado' ? 404 : result.error === 'Lead sin número WhatsApp' ? 400 : 500
    return Response.json({ error: result.error }, { status })
  }

  return Response.json({ ok: true, enviado_a: result.enviado_a })
}
