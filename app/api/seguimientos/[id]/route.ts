import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import {
  normalizePhoneNumber,
  sendMetaWhatsAppMessage,
  sendMetaWhatsAppTemplate,
} from '@/lib/whatsapp/provider'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 })

  const supabase = createServiceRoleClient()
  const body = await request.json()
  const { accion, mensaje_editado, notas } = body as {
    accion: 'enviar' | 'completar_llamada' | 'saltar'
    mensaje_editado?: string
    notas?: string
  }

  if (!['enviar', 'completar_llamada', 'saltar'].includes(accion)) {
    return Response.json({ error: 'Acción inválida' }, { status: 400 })
  }

  // Cargar seguimiento
  const { data: seg, error: fetchErr } = await supabase
    .from('seguimientos')
    .select('*')
    .eq('id', id)
    .eq('estado', 'pendiente')
    .maybeSingle()

  if (fetchErr || !seg) {
    return Response.json({ error: 'Seguimiento no encontrado' }, { status: 404 })
  }

  // Verificar que el usuario tiene acceso (asesor asignado o admin)
  const { data: profile } = await supabase
    .from('profiles')
    .select('rol')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.rol !== 'admin') {
    const { data: lead } = await supabase
      .from('leads')
      .select('asignado_a')
      .eq('id', seg.lead_id)
      .maybeSingle()
    if (lead?.asignado_a !== user.id) {
      return Response.json({ error: 'Sin acceso a este lead' }, { status: 403 })
    }
  }

  const ahora = new Date().toISOString()

  // ── Saltar ────────────────────────────────────────────────────────────────
  if (accion === 'saltar') {
    await supabase
      .from('seguimientos')
      .update({ estado: 'saltado', fecha_completado: ahora, completado_por: user.id })
      .eq('id', id)
    return Response.json({ ok: true, accion: 'saltado' })
  }

  // ── Completar llamada ─────────────────────────────────────────────────────
  if (accion === 'completar_llamada') {
    await supabase
      .from('seguimientos')
      .update({
        estado: 'completado',
        notas_asesor: notas || null,
        fecha_completado: ahora,
        completado_por: user.id,
      })
      .eq('id', id)

    // Registrar actividad en el lead
    if (notas) {
      await supabase.from('lead_activities').insert([{
        lead_id: seg.lead_id,
        actor_id: user.id,
        event_type: 'llamada_seguimiento',
        title: `Llamada Tier ${seg.tier} realizada`,
        detail: notas,
        meta: { tier: seg.tier, seguimiento_id: id },
      }])
    }

    return Response.json({ ok: true, accion: 'llamada_completada' })
  }

  // ── Enviar mensaje WA / template ──────────────────────────────────────────
  if (accion === 'enviar') {
    const to = normalizePhoneNumber(seg.lead_whatsapp)
    const textoFinal = (mensaje_editado || seg.contenido_sugerido || '').trim()

    if (!textoFinal && !seg.template_name) {
      return Response.json({ error: 'Sin contenido para enviar' }, { status: 400 })
    }

    try {
      // Si tiene template_name Y no fue editado manualmente → enviar template
      let textoParaHistorial = textoFinal
      if (seg.template_name && !mensaje_editado) {
        // {{1}} siempre requerido — usar primer nombre o fallback genérico
        const primerNombre = (seg.lead_nombre || '').trim().split(/\s+/)[0] || 'amig@'
        await sendMetaWhatsAppTemplate({
          to,
          templateName: seg.template_name,
          parameters: [primerNombre],
        })
        // Texto real enviado (con nombre sustituido) para el historial
        textoParaHistorial = (seg.contenido_sugerido || textoFinal).replace('{{nombre}}', primerNombre).replace('{{1}}', primerNombre)
      } else {
        await sendMetaWhatsAppMessage({ to, body: textoFinal })
      }

      // Guardar en historial de conversación
      if (seg.conversacion_id) {
        await supabase.from('whatsapp_mensajes').insert([{
          conversacion_id: seg.conversacion_id,
          rol: 'bot',
          contenido: textoParaHistorial,
        }])
        await supabase
          .from('whatsapp_conversaciones')
          .update({ ultimo_mensaje_at: ahora })
          .eq('id', seg.conversacion_id)
      }

      // Marcar como completado
      await supabase
        .from('seguimientos')
        .update({
          estado: 'completado',
          fecha_completado: ahora,
          completado_por: user.id,
          contenido_sugerido: textoFinal, // guardar lo que se envió realmente
        })
        .eq('id', id)

      return Response.json({ ok: true, accion: 'enviado' })
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
    }
  }

  return Response.json({ error: 'Acción no procesada' }, { status: 400 })
}
