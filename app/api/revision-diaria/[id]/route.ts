import { createClient, createServiceRoleClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

const ESTADOS_VALIDOS = ['nuevo', 'pendiente_analisis', 'analizado', 'resuelto']

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 })

  const body = await request.json()
  const { notas_harold, estado } = body as { notas_harold?: string; estado?: string }

  if (estado !== undefined && !ESTADOS_VALIDOS.includes(estado)) {
    return Response.json({ error: 'Estado inválido' }, { status: 400 })
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (notas_harold !== undefined) update.notas_harold = notas_harold
  if (estado !== undefined) update.estado = estado

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('revision_diaria_conversaciones')
    .update(update)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ fila: data })
}
