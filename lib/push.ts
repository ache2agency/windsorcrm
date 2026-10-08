import webpush from 'web-push'
import { createServiceRoleClient } from '@/utils/supabase/server'

let vapidConfigured = false

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails('mailto:hola@windsor.edu.mx', publicKey, privateKey)
  vapidConfigured = true
  return true
}

type PushPayload = {
  title: string
  body: string
  url?: string
}

export async function enviarPushATodos(payload: PushPayload) {
  if (!ensureVapidConfigured()) return

  const supabase = createServiceRoleClient()
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')

  for (const sub of subs || []) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload)
      )
    } catch (e) {
      const statusCode = (e as { statusCode?: number })?.statusCode
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      } else {
        console.error('[push] error enviando notificación:', e)
      }
    }
  }
}
