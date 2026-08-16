import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { normalizePhoneNumber } from '@/lib/whatsapp/provider'

export async function POST(request: Request) {
  try {
    const {
      vendedorEmail,
      nombre,
      email,
      whatsapp,
      cursoLabel,
      notas,
      stage,
      fechaIso,
      hora,
      duracion,
      citaTipo,
      citaTitulo,
    } = (await request.json()) as {
      vendedorEmail?: string
      nombre?: string
      email?: string
      whatsapp?: string
      cursoLabel?: string
      notas?: string
      stage?: string
      fechaIso?: string
      hora?: string
      duracion?: number
      citaTipo?: string
      citaTitulo?: string
    }

    if (!vendedorEmail || !nombre?.trim() || !email?.trim() || !fechaIso || !hora) {
      return NextResponse.json({ error: 'Faltan datos obligatorios' }, { status: 400 })
    }

    const supabase = createServiceRoleClient()

    const { data: vendedor, error: vendedorError } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', vendedorEmail)
      .maybeSingle()

    if (vendedorError || !vendedor) {
      return NextResponse.json({ error: 'No encontramos a este vendedor' }, { status: 404 })
    }

    // Buscar primero si ya existe un lead con este WhatsApp antes de crear uno nuevo —
    // antes siempre se insertaba, generando un registro duplicado y desconectado del
    // historial real cada vez que un lead existente agendaba una visita (ver
    // PROYECTOS.md sesión 2026-08-06/2026-08-16).
    const whatsappTrimmed = (whatsapp || '').trim()
    const whatsappNormalizado = whatsappTrimmed ? normalizePhoneNumber(whatsappTrimmed) : ''
    let leadData: { id: string; nombre: string } | null = null

    if (whatsappNormalizado) {
      const { data: leadExistente } = await supabase
        .from('leads')
        .select('id, nombre')
        .eq('whatsapp', whatsappNormalizado)
        .maybeSingle()

      if (leadExistente) {
        const { data: leadActualizado, error: updateError } = await supabase
          .from('leads')
          .update({
            nombre: nombre.trim(),
            email: email.trim(),
            stage: stage || 'inscripcion_pendiente',
            fecha: fechaIso,
          })
          .eq('id', leadExistente.id)
          .select()
          .single()

        if (updateError || !leadActualizado) {
          return NextResponse.json({ error: 'No pudimos actualizar tus datos' }, { status: 500 })
        }
        leadData = leadActualizado
      }
    }

    if (!leadData) {
      const { data: leadNuevo, error: leadError } = await supabase
        .from('leads')
        .insert([{
          nombre: nombre.trim(),
          email: email.trim(),
          whatsapp: whatsappNormalizado,
          curso: cursoLabel || 'Inscripción',
          valor: 0,
          notas: notas || '',
          stage: stage || 'inscripcion_pendiente',
          fecha: fechaIso,
          user_id: vendedor.id,
          asignado_a: vendedor.id,
        }])
        .select()
        .single()

      if (leadError || !leadNuevo) {
        return NextResponse.json({ error: 'No pudimos guardar tus datos' }, { status: 500 })
      }
      leadData = leadNuevo
    }

    if (!leadData) {
      return NextResponse.json({ error: 'No pudimos guardar tus datos' }, { status: 500 })
    }

    const { data: citaData, error: citaError } = await supabase
      .from('citas')
      .insert([{
        lead_id: leadData.id,
        vendedor_id: vendedor.id,
        titulo: citaTitulo || `Cita - ${leadData.nombre}`,
        fecha: fechaIso,
        hora,
        duracion: duracion || 30,
        tipo: citaTipo || 'inscripcion',
        notas: notas || '',
        status: 'confirmada',
      }])
      .select()
      .single()

    if (citaError || !citaData) {
      return NextResponse.json({ error: 'No pudimos registrar la cita' }, { status: 500 })
    }

    return NextResponse.json({ lead: leadData, cita: citaData })
  } catch {
    return NextResponse.json({ error: 'Error inesperado' }, { status: 500 })
  }
}
