import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  try {
    const { subscription, userId } = (await request.json()) as {
      subscription?: { endpoint: string; keys: { p256dh: string; auth: string } }
      userId?: string
    }

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth || !userId) {
      return NextResponse.json({ error: 'Faltan datos de la suscripción' }, { status: 400 })
    }

    const supabase = createServiceRoleClient()
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
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
    const { endpoint } = (await request.json()) as { endpoint?: string }
    if (!endpoint) return NextResponse.json({ error: 'Falta endpoint' }, { status: 400 })

    const supabase = createServiceRoleClient()
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
