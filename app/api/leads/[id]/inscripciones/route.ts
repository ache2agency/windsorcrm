import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Inicia sesión.' }, { status: 401 })
  const { id } = await params
  const { data: lead } = await session.from('leads').select('id').eq('id', id).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  const db = createServiceRoleClient()
  const { data, error } = await db.from('inscripciones').select('id,programa,created_at').eq('lead_id', id).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'No pudimos cargar las solicitudes.' }, { status: 503 })
  return NextResponse.json({ solicitudes: data }, { headers: { 'Cache-Control': 'private, no-store' } })
}
