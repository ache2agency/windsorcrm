import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'

// El usuario sale de la sesión (cookies), nunca del body: antes cualquiera podía
// registrar o borrar suscripciones a nombre de otro userId.
async function usuarioSesion() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return data.user
}

export async function POST(request: Request) {
  try {
    const user = await usuarioSesion()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { subscription } = (await request.json()) as {
      subscription?: { endpoint: string; keys: { p256dh: string; auth: string } }
    }

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: 'Faltan datos de la suscripción' }, { status: 400 })
    }

    const supabase = createServiceRoleClient()
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      { onConflict: 'endpoint' }
    )

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await usuarioSesion()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { endpoint } = (await request.json()) as { endpoint?: string }
    if (!endpoint) return NextResponse.json({ error: 'Falta endpoint' }, { status: 400 })

    const supabase = createServiceRoleClient()
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
