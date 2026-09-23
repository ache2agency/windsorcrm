import { createServiceRoleClient } from '@/utils/supabase/server'
import { sendMetaWhatsAppMessage } from '@/lib/whatsapp/provider'
import { detectarPrograma } from '@/lib/whatsapp/programas'
import { INFO_MSGS, buildCTA } from '@/lib/whatsapp/infoMsgs'
import { esTrackA, obtenerMensajeReactivacion20h } from '@/lib/whatsapp/reactivacion-messages'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Reactivación automática DENTRO de la ventana de 24h de WhatsApp (texto libre, sin template).
 * Corre cada hora (GitHub Actions, .github/workflows/reactivacion-ventana.yml).
 *
 * Antes solo existía el paso "20h" de /api/whatsapp/reactivacion: corría 1 vez al día (14:00 UTC)
 * con ventana de 20-28h de silencio — solo alcanzaba a quien dejó de contestar entre 4am y 12pm
 * hora México. Los leads de Ads que escriben de noche (la mayoría) nunca se reactivaban, y además
 * solo se encolaba en mensajes_pendientes esperando aprobación manual (casos +527471892212 y
 * +527541038883, 2026-09-23).
 *
 * Toques (contados desde el último mensaje del lead, solo si el último mensaje es del bot):
 *  - Fases de captura (saludo / correo / programa):
 *      toque 1 a las 3h de silencio → empujón corto (nombre / correo opcional / programa)
 *      toque 2 a las 20h → si ya sabemos el programa, mandar la ficha aunque falten nombre/correo
 *  - Resto de fases: un solo toque a las 20h con el texto de REACTIVACION_20H.
 * Nunca manda de noche (solo 8:00–21:00 hora Chilpancingo) ni pasadas 23.5h del último mensaje
 * del lead (fuera de ventana Meta rechaza texto libre — de ahí en adelante sigue el pipeline de
 * templates de /api/whatsapp/reactivacion).
 */

const FASES_CAPTURA = ['saludo', 'correo', 'programa']
const FASES_REACTIVABLES = [...FASES_CAPTURA, 'accion', 'dudas', 'info_enviada', 'inscripcion', 'inscripcion_pendiente', 'convenios']
const STAGES_EXCLUIDOS = ['archivado', 'perdido', 'inscrito', 'cerrado']
const HORAS_TOQUE_1 = 3
const HORAS_TOQUE_2 = 20
const HORAS_VENTANA_SEGURA = 23.5

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.replace(/\\n$/, '').trim()
  if (!secret) return false
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() === secret
  return request.headers.get('x-cron-secret') === secret
}

function horaMexico(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', hour: 'numeric', hour12: false }).format(d)) % 24
}

function nombreValido(nombre: string | null | undefined, whatsapp: string): boolean {
  const n = (nombre || '').trim()
  if (!n || n.length < 2 || n.length > 50 || n === whatsapp) return false
  if (/[\d@¿?¡!,;]/.test(n)) return false
  return /^[\p{L}\s'\-.]+$/u.test(n)
}

function tieneProgramaReal(curso: string | null | undefined): boolean {
  const c = (curso || '').trim().toLowerCase()
  return !!c && c !== 'whatsapp - instituto windsor' && c !== 'messenger - instituto windsor'
}

type Plan = { mensaje: string; nuevaFase?: string }

function planToque(params: {
  fase: string
  toque: 1 | 2
  nombre: string | null
  programa: string | null
  pidioIngles: boolean
  trackA: boolean
}): Plan | null {
  const { fase, toque, nombre, programa, pidioIngles, trackA } = params
  const primerNombre = nombre ? nombre.split(' ')[0].replace(/[.,;:]+$/, '') : ''
  const saludo = primerNombre ? `¡Hola ${primerNombre}! 😊` : '¡Hola! 😊'
  const ficha = programa ? INFO_MSGS[programa] : null
  // Ficha sin su propio saludo inicial ("¡Excelente elección! 😊 Te comparto…")
  const fichaSinSaludo = ficha ? ficha.replace(/^[^\n]*\n\n/, '') : null

  if (fase === 'saludo') {
    if (toque === 1) {
      const que = programa ? `de *${programa}*` : 'que nos pediste'
      return { mensaje: `${saludo} Para enviarte la información ${que} solo necesito tu nombre. ¿Cómo te llamas?` }
    }
    if (fichaSinSaludo && programa) {
      return {
        mensaje: `${saludo} Te comparto la información que nos pediste:\n\n${fichaSinSaludo}${buildCTA(programa)}\n\n(Y si gustas, compártenos tu nombre para darte seguimiento personalizado 😊)`,
        nuevaFase: 'accion',
      }
    }
    if (pidioIngles) {
      return {
        mensaje: `${saludo} Con gusto te comparto la información. Tenemos tres opciones de inglés, ¿cuál te interesa?\n\nA) Inglés para adultos\nB) Inglés para niños\nC) Licenciatura en Inglés`,
        nuevaFase: 'programa',
      }
    }
    return {
      mensaje: `${saludo} Con gusto te comparto la información. ¿Qué programa te interesa?\n\n• Bachillerato\n• Licenciaturas\n• Maestrías\n• Idiomas (inglés adultos, inglés niños, francés, italiano)\n• Diplomados`,
      nuevaFase: 'programa',
    }
  }

  if (fase === 'correo') {
    if (toque === 1) {
      return { mensaje: `${saludo} ¿Me compartes tu correo para darte seguimiento? Si prefieres no darlo, responde *por aquí* y te mando la información por WhatsApp.` }
    }
    if (fichaSinSaludo && programa) {
      return { mensaje: `${saludo} Te comparto por aquí la información de *${programa}*:\n\n${fichaSinSaludo}${buildCTA(programa)}`, nuevaFase: 'accion' }
    }
    // Programas sin ficha fija (maestrías, diplomados…): la info la arma el webhook con RAG.
    return { mensaje: `${saludo} Si prefieres no dar correo no hay problema — responde *por aquí* y te mando la información por WhatsApp.` }
  }

  if (fase === 'programa') {
    if (toque === 1) return { mensaje: `${saludo} ¿Qué programa te interesa? Con gusto te comparto toda la información.` }
    return { mensaje: obtenerMensajeReactivacion20h('programa', trackA, nombre || 'ahí') }
  }

  // Resto de fases: un solo toque a las 20h
  if (toque === 1) return null
  return { mensaje: obtenerMensajeReactivacion20h(fase, trackA, nombre || 'ahí') }
}

async function run(request: Request) {
  if (!verifyCronSecret(request)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  const dryRun = new URL(request.url).searchParams.get('dry') === '1'

  const ahora = new Date()
  const hora = horaMexico(ahora)
  if (!dryRun && (hora < 8 || hora >= 21)) {
    return Response.json({ ok: true, omitido: `fuera de horario (${hora}h México)` })
  }

  const supabase = createServiceRoleClient()
  const desde = new Date(ahora.getTime() - 24 * 3600_000).toISOString()
  const { data: convs, error } = await supabase
    .from('whatsapp_conversaciones')
    .select('id, whatsapp, lead_id, fase, provider, revision_codigo')
    .eq('estado', 'abierta')
    .eq('modo_humano', false)
    .in('fase', FASES_REACTIVABLES)
    .gte('ultimo_mensaje_at', desde)
    .limit(500)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const resultados: Array<{ conversacion_id: string; whatsapp: string; accion: string; detalle?: string }> = []

  for (const conv of convs || []) {
    const r = (accion: string, detalle?: string) => resultados.push({ conversacion_id: conv.id, whatsapp: conv.whatsapp, accion, detalle })
    if (conv.provider === 'messenger') { r('omitido', 'messenger'); continue }
    if (conv.revision_codigo) { r('omitido', 'esperando respuesta de asesor'); continue }

    const { data: msgs } = await supabase
      .from('whatsapp_mensajes')
      .select('rol, contenido, created_at, raw_payload')
      .eq('conversacion_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(40)
    const mensajes = msgs || []
    const ultimo = mensajes[0]
    if (!ultimo || ultimo.rol !== 'bot') { r('omitido', 'último mensaje no es del bot'); continue }
    const idxUser = mensajes.findIndex(m => m.rol === 'usuario')
    if (idxUser === -1) { r('omitido', 'el lead nunca escribió'); continue }
    const ultimoUser = mensajes[idxUser]

    const horasDesdeUser = (ahora.getTime() - new Date(ultimoUser.created_at).getTime()) / 3600_000
    const horasDesdeBot = (ahora.getTime() - new Date(ultimo.created_at).getTime()) / 3600_000
    if (horasDesdeUser >= HORAS_VENTANA_SEGURA) { r('omitido', 'fuera de ventana 24h'); continue }

    const toquesPrevios = mensajes
      .slice(0, idxUser)
      .filter(m => (m.raw_payload as { reactivacion_auto?: number } | null)?.reactivacion_auto).length
    if (toquesPrevios >= 2) { r('omitido', 'ya tiene 2 toques'); continue }

    const esCaptura = FASES_CAPTURA.includes(conv.fase)
    let toque: 1 | 2 | null = null
    if (esCaptura) {
      if (toquesPrevios === 0 && horasDesdeUser >= HORAS_TOQUE_2) toque = 2 // se saltó el toque 1 (p. ej. por la noche)
      else if (toquesPrevios === 0 && horasDesdeBot >= HORAS_TOQUE_1) toque = 1
      else if (toquesPrevios === 1 && horasDesdeUser >= HORAS_TOQUE_2) toque = 2
    } else if (toquesPrevios === 0 && horasDesdeUser >= HORAS_TOQUE_2) {
      toque = 2
    }
    if (!toque) { r('omitido', `aún no toca (${horasDesdeUser.toFixed(1)}h desde el lead)`); continue }

    const { data: lead } = conv.lead_id
      ? await supabase.from('leads').select('nombre, curso, stage').eq('id', conv.lead_id).maybeSingle()
      : { data: null }
    if (lead?.stage && STAGES_EXCLUIDOS.includes(lead.stage)) { r('omitido', `stage ${lead.stage}`); continue }

    const textoLead = mensajes.filter(m => m.rol === 'usuario').map(m => m.contenido).join(' ')
    const programa = tieneProgramaReal(lead?.curso) ? lead!.curso : detectarPrograma(textoLead)
    const plan = planToque({
      fase: conv.fase,
      toque,
      nombre: nombreValido(lead?.nombre, conv.whatsapp) ? lead!.nombre : null,
      programa: programa || null,
      pidioIngles: /ingl[eé]s/i.test(textoLead),
      trackA: esTrackA(programa),
    })
    if (!plan) { r('omitido', 'sin mensaje para esta fase/toque'); continue }

    if (dryRun) { r(`dry_toque_${toque}`, plan.mensaje.slice(0, 160)); continue }

    try {
      await sendMetaWhatsAppMessage({ to: conv.whatsapp, body: plan.mensaje })
    } catch (e) {
      r('error', e instanceof Error ? e.message : String(e))
      continue
    }
    await supabase.from('whatsapp_mensajes').insert([{
      conversacion_id: conv.id,
      rol: 'bot',
      contenido: plan.mensaje,
      raw_payload: { reactivacion_auto: toque },
    }])
    await supabase
      .from('whatsapp_conversaciones')
      .update({ ultimo_mensaje_at: new Date().toISOString(), ...(plan.nuevaFase ? { fase: plan.nuevaFase } : {}) })
      .eq('id', conv.id)
    if (programa && conv.lead_id && !tieneProgramaReal(lead?.curso) && plan.nuevaFase === 'accion') {
      await supabase.from('leads').update({ curso: programa }).eq('id', conv.lead_id)
    }
    r(`enviado_toque_${toque}`)
  }

  const enviados = resultados.filter(x => x.accion.startsWith('enviado') || x.accion.startsWith('dry_'))
  return Response.json({ ok: true, dryRun, horaMexico: hora, revisadas: resultados.length, enviados: enviados.length, resultados: dryRun ? resultados : enviados })
}

export async function GET(request: Request) {
  return run(request)
}

export async function POST(request: Request) {
  return run(request)
}
