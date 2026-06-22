import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { createServiceRoleClient } from '@/utils/supabase/server'
import {
  getMetaConfig,
  getTwilioConfig,
  getWhatsAppProvider,
  normalizePhoneNumber,
  sendMetaWhatsAppMessage,
  sendMetaWhatsAppTemplate,
} from '@/lib/whatsapp/provider'

export async function POST(request: Request) {
  let to: string | undefined
  let body: string | undefined
  let leadId: string | undefined
  let agentUserId: string | undefined
  let fase: string | undefined
  let templateName: string | undefined
  let templateParams: string[] | undefined
  let modoHumano: boolean = true
  try {
    ;({ to, body, leadId, agentUserId, fase, templateName, templateParams, modoHumano = true } = (await request.json()) as {
      to?: string
      body?: string
      leadId?: string
      agentUserId?: string
      fase?: string
      templateName?: string
      templateParams?: string[]
      modoHumano?: boolean
    })

    if (!to || (!body && !templateName)) {
      return NextResponse.json(
        { error: 'Parámetros to y body (o templateName) son obligatorios' },
        { status: 400 }
      )
    }

    const provider = getWhatsAppProvider()

    const normalizedTo = normalizePhoneNumber(to)

    // Fases iniciales que deben avanzar a 'accion' cuando se envía info manualmente
    const FASES_INICIALES = ['saludo', 'programa', 'correo', 'verano_disambig']

    if (provider === 'meta') {
      let messageId: string | null = null
      if (templateName) {
        const result = await sendMetaWhatsAppTemplate({ to, templateName, parameters: templateParams || [] })
        messageId = result.id
      } else {
        const result = await sendMetaWhatsAppMessage({ to, body: body! })
        messageId = result.id
      }

      // Siempre actualizar la conversación (con o sin leadId)
      const supabase = await createServiceRoleClient()
      const now = new Date().toISOString()
      const { data: existingConv } = await supabase
        .from('whatsapp_conversaciones')
        .select('id, fase')
        .eq('whatsapp', normalizedTo)
        .order('ultimo_mensaje_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      // Si la fase actual es inicial y no se pasó fase explícita, avanzar a 'accion'
      const faseActual = (existingConv as { fase?: string } | null)?.fase || 'saludo'
      const nuevaFase = fase || (FASES_INICIALES.includes(faseActual) ? 'accion' : faseActual)

      let conversacionId = (existingConv as { id?: string } | null)?.id || null

      if (!conversacionId) {
        if (leadId) {
          const { data: createdConv } = await supabase
            .from('whatsapp_conversaciones')
            .insert([
              {
                whatsapp: normalizedTo,
                lead_id: leadId,
                estado: 'abierta',
                ultimo_mensaje_at: now,
                fase: nuevaFase,
                modo_humano: modoHumano,
                tomado_por: agentUserId || null,
              },
            ])
            .select('id')
            .single()
          conversacionId = (createdConv as { id?: string } | null)?.id || null
        }
      } else {
        const updateData: Record<string, unknown> = {
          estado: 'abierta',
          ultimo_mensaje_at: now,
          fase: nuevaFase,
          modo_humano: modoHumano,
          tomado_por: agentUserId || null,
        }
        if (leadId) updateData.lead_id = leadId
        await supabase
          .from('whatsapp_conversaciones')
          .update(updateData)
          .eq('id', conversacionId)
      }

      if (conversacionId) {
        await supabase.from('whatsapp_mensajes').insert([
          {
            conversacion_id: conversacionId,
            rol: 'agente',
            contenido: body || `[Template: ${templateName}]`,
          },
        ])
      }

      return NextResponse.json({
        provider,
        id: messageId,
        to: normalizedTo,
        status: 'accepted',
      })
    }

    const { accountSid, authToken, fromNumber } = getTwilioConfig()

    if (!accountSid || !authToken || !fromNumber) {
      return NextResponse.json(
        { error: 'Faltan variables de entorno de Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER)' },
        { status: 500 }
      )
    }

    const client = twilio(accountSid, authToken)

    const from =
      fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`
    const toFormatted = `whatsapp:${normalizedTo}`

    console.log('[send] Twilio attempt', {
      accountSid: accountSid?.slice(0, 8) + '…',
      from,
      to: toFormatted,
    })

    const message = await client.messages.create({
      from,
      to: toFormatted,
      body,
    })

    if (leadId) {
      const supabase = await createServiceRoleClient()
      const now = new Date().toISOString()
      const { data: existingConv } = await supabase
        .from('whatsapp_conversaciones')
        .select('id')
        .eq('whatsapp', normalizedTo)
        .order('ultimo_mensaje_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let conversacionId = existingConv?.id || null

      if (!conversacionId) {
        const { data: createdConv } = await supabase
          .from('whatsapp_conversaciones')
          .insert([
            {
              whatsapp: normalizedTo,
              lead_id: leadId,
              estado: 'abierta',
              ultimo_mensaje_at: now,
              fase: fase || 'seguimiento',
              modo_humano: modoHumano,
              tomado_por: agentUserId || null,
            },
          ])
          .select('id')
          .single()
        conversacionId = createdConv?.id || null
      } else {
        await supabase
          .from('whatsapp_conversaciones')
          .update({
            lead_id: leadId,
            estado: 'abierta',
            ultimo_mensaje_at: now,
            fase: fase || 'seguimiento',
            modo_humano: true,
            tomado_por: agentUserId || null,
          })
          .eq('id', conversacionId)
      }

      if (conversacionId) {
        await supabase.from('whatsapp_mensajes').insert([
          {
            conversacion_id: conversacionId,
            rol: 'agente',
            contenido: body,
          },
        ])
      }
    }

    return NextResponse.json({
      provider,
      sid: message.sid,
      status: message.status,
      to: message.to,
      from: message.from,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const detail = e instanceof Error ? e.message : String(e)
    const twilioCode = (e as { code?: number })?.code
    const provider = getWhatsAppProvider()
    console.error('[send] Error', { code: twilioCode, msg })

    if (provider === 'meta') {
      const { phoneNumberId, accessToken } = getMetaConfig()
      if (!phoneNumberId || !accessToken) {
        return NextResponse.json(
          {
            error: 'Faltan variables de entorno de Meta',
            detail:
              'Define META_WHATSAPP_ACCESS_TOKEN y META_WHATSAPP_PHONE_NUMBER_ID para enviar mensajes con WhatsApp Cloud API.',
          },
          { status: 500 }
        )
      }
      if (msg.includes('133010') || msg.includes('131047') || msg.toLowerCase().includes('not registered') || msg.toLowerCase().includes('24 hours')) {
        const { phoneNumberId, accessToken } = getMetaConfig()
        return NextResponse.json(
          {
            error: 'No se pudo enviar el mensaje',
            detail: 'El número no está disponible en WhatsApp o la ventana de 24h venció. El lead debe escribirte primero para poder responderle.',
            debug_meta_error: msg,
            debug_to_raw: to,
            debug_to_normalized: normalizePhoneNumber(to ?? ''),
            debug_phone_number_id: phoneNumberId,
            debug_has_token: !!accessToken,
          },
          { status: 422 }
        )
      }
    }

    // Guía clara cuando Twilio rechaza el número "From" (configuración WhatsApp)
    if (
      /from address|could not find.*channel|invalid.*from/i.test(msg) ||
      (typeof (e as { code?: number })?.code === 'number' && [21211, 21608, 63007].includes((e as { code: number }).code))
    ) {
      const { fromNumber } = getTwilioConfig()
      return NextResponse.json(
        {
          error: 'El número de WhatsApp no puede enviar mensajes salientes vía API',
          detail: `El número ${fromNumber} recibe mensajes (webhook/TwiML) pero no está habilitado como WhatsApp Business sender en Twilio para envíos salientes. Ve a Twilio Console → Messaging → Senders → WhatsApp y verifica que ${fromNumber} aparezca como sender aprobado. Si solo usas el Sandbox, el "From" debe ser +14155238886. Error original: ${detail}`,
          from: fromNumber,
          action: 'Verifica en Twilio Console → Messaging → Senders → WhatsApp',
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: 'Error enviando mensaje de WhatsApp', detail, code: twilioCode ?? null },
      { status: 500 }
    )
  }
}
