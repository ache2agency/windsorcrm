export type WhatsAppProvider = 'twilio' | 'meta' | 'messenger'

export function getWhatsAppProvider(): WhatsAppProvider {
  return process.env.WHATSAPP_PROVIDER === 'meta' ? 'meta' : 'twilio'
}

export function normalizePhoneNumber(value: string) {
  let normalized = (value || '').replace(/^whatsapp:/i, '').trim()
  if (normalized && !normalized.startsWith('+')) normalized = `+${normalized}`
  // Números mexicanos: +521XXXXXXXXXX → +52XXXXXXXXXX (quita el "1" extra heredado)
  if (/^\+521\d{10}$/.test(normalized)) normalized = '+52' + normalized.slice(4)
  return normalized
}

export function getTwilioConfig() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_WHATSAPP_NUMBER,
  }
}

export function getMetaConfig() {
  return {
    accessToken: process.env.META_WHATSAPP_TOKEN || process.env.META_WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID,
    verifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.META_APP_SECRET,
  }
}

export function getMessengerConfig() {
  return {
    pageAccessToken: process.env.META_MESSENGER_PAGE_TOKEN,
  }
}

export async function sendMessengerMessage({
  to,
  body,
}: {
  to: string
  body: string
}) {
  const { pageAccessToken } = getMessengerConfig()
  if (!pageAccessToken) {
    throw new Error('Falta variable de entorno META_MESSENGER_PAGE_TOKEN')
  }

  const response = await fetch(
    `https://graph.facebook.com/v23.0/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: to },
        message: { text: body },
      }),
    }
  )

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const code = data?.error?.code ? `#${data.error.code} ` : ''
    const detail = `${code}${data?.error?.message || `HTTP ${response.status}`}`
    throw new Error(detail)
  }
  return { id: data?.message_id || null, raw: data }
}

export async function sendMetaWhatsAppTemplate({
  to,
  templateName,
  parameters,
}: {
  to: string
  templateName: string
  parameters: string[]
}) {
  const { accessToken, phoneNumberId } = getMetaConfig()
  if (!accessToken || !phoneNumberId) throw new Error('Faltan variables de entorno de Meta')

  const toNormalized = normalizePhoneNumber(to)

  const response = await metaPostWithRetry(phoneNumberId, accessToken, toNormalized, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'es_MX' },
      components: [{ type: 'body', parameters: parameters.map(v => ({ type: 'text', text: v })) }],
    },
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const code = data?.error?.code ? `#${data.error.code} ` : ''
    const detail = `${code}${data?.error?.message || `HTTP ${response.status}`}`
    throw new Error(detail)
  }
  return { id: data?.messages?.[0]?.id || null, raw: data }
}

const _templateBodyCache = new Map<string, string | null>()

/**
 * Trae el texto BODY real de un template aprobado directo de Meta (no una copia
 * hardcodeada en el código, que se puede desincronizar si el template se edita
 * en Meta Business Manager). Cachea en memoria por invocación del proceso —
 * suficiente para una sola corrida del cron, que puede repetir el mismo template
 * para varios leads. Devuelve null si falla (llamador debe tener un texto de
 * respaldo, nunca debe romper el flujo por esto).
 */
export async function fetchApprovedTemplateBody(templateName: string): Promise<string | null> {
  if (_templateBodyCache.has(templateName)) return _templateBodyCache.get(templateName) ?? null

  const { accessToken, businessAccountId } = getMetaConfig()
  if (!accessToken || !businessAccountId) {
    console.error('[fetchApprovedTemplateBody] faltan META_WHATSAPP_TOKEN / META_WHATSAPP_BUSINESS_ACCOUNT_ID')
    _templateBodyCache.set(templateName, null)
    return null
  }

  try {
    const url = `https://graph.facebook.com/v23.0/${businessAccountId}/message_templates?name=${encodeURIComponent(templateName)}&fields=name,status,language,components`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error('[fetchApprovedTemplateBody] error HTTP', res.status, await res.text().catch(() => ''))
      _templateBodyCache.set(templateName, null)
      return null
    }
    const data = await res.json()
    const match = (data?.data || []).find((t: { name: string; language?: string }) =>
      t.name === templateName && (!t.language || t.language.startsWith('es'))
    ) || (data?.data || [])[0]

    const bodyComponent = match?.components?.find((c: { type: string }) => c.type === 'BODY')
    const texto = bodyComponent?.text || null

    _templateBodyCache.set(templateName, texto)
    return texto
  } catch (e) {
    console.error('[fetchApprovedTemplateBody]', e)
    _templateBodyCache.set(templateName, null)
    return null
  }
}

/** Intenta enviar y si falla con #133010 reintenta con formato +521 (México legacy) */
async function metaPostWithRetry(phoneNumberId: string, accessToken: string, toNormalized: string, payload: object): Promise<Response> {
  const toFormatted = toNormalized.replace(/^\+/, '')
  const url = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...payload, to: toFormatted }) })
  if (!res.ok) {
    const data = await res.clone().json().catch(() => null)
    const errCode = data?.error?.code || data?.error?.error_data?.details || ''
    if ((String(errCode).includes('133010') || JSON.stringify(data).includes('133010')) &&
        toNormalized.startsWith('+52') && !toNormalized.startsWith('+521')) {
      const withOne = '+521' + toNormalized.slice(3)
      return fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...payload, to: withOne.replace(/^\+/, '') }) })
    }
  }
  return res
}

export async function sendMetaWhatsAppMessage({
  to,
  body,
}: {
  to: string
  body: string
}) {
  const { accessToken, phoneNumberId } = getMetaConfig()

  if (!accessToken || !phoneNumberId) {
    throw new Error(
      'Faltan variables de entorno de Meta (META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID)'
    )
  }

  const toNormalized = normalizePhoneNumber(to)
  const toFormatted = toNormalized.replace(/^\+/, '')

  const response = await metaPostWithRetry(phoneNumberId, accessToken, toNormalized, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    type: 'text',
    text: { body },
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const code = data?.error?.code ? `#${data.error.code} ` : ''
    const detail = `${code}${data?.error?.message || `HTTP ${response.status}`}`
    throw new Error(detail)
  }

  const firstMessage =
    data &&
    typeof data === 'object' &&
    'messages' in data &&
    Array.isArray(data.messages) &&
    data.messages.length > 0
      ? data.messages[0]
      : null

  return {
    id:
      firstMessage &&
      typeof firstMessage === 'object' &&
      'id' in firstMessage &&
      typeof firstMessage.id === 'string'
        ? firstMessage.id
        : null,
    raw: data,
  }
}
