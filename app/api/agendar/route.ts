import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'

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

    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .insert([{
        nombre: nombre.trim(),
        email: email.trim(),
        whatsapp: (whatsapp || '').trim(),
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

    if (leadError || !leadData) {
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
