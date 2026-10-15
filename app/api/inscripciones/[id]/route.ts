import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { consultarInscripcion } from '@/lib/inscripcion/consulta'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Inicia sesión.' }, { status: 401 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  const db = createServiceRoleClient()
  try {
    const solicitud = await consultarInscripcion(db, session, id)
    if (!solicitud) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
    return NextResponse.json(solicitud, { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } })
  } catch { return NextResponse.json({ error: 'No pudimos abrir la solicitud.' }, { status: 503 }) }
}
