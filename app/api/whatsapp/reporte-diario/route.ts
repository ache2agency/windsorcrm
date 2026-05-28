import { createServiceRoleClient } from '@/utils/supabase/server'
import { sendMetaWhatsAppMessage } from '@/lib/whatsapp/provider'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ADMIN_WHATSAPP = '527471028306'
const ETAPAS_SEGUIMIENTO = ['segundo_contacto', 'seguimiento', 'tercer_contacto']
const ETAPAS_ACTIVAS = [
  'primer_contacto', 'contactado', 'examen_ubicacion', 'clase_muestra',
  'segundo_contacto', 'seguimiento', 'tercer_contacto', 'promocion_enviada',
  'interesado',
]

function normProg(curso: string | null | undefined): string {
  const c = (curso || '').trim()
  if (!c || c.startsWith('WhatsApp')) return 'Sin programa'
  const s = c.split(' - ')[0].trim()
  if (/licenciatura en ingl/i.test(s)) return 'Lic. Inglés'
  if (/ingl[eé]s para ni/i.test(s)) return 'Inglés niños'
  if (/ingl[eé]s para adulto/i.test(s)) return 'Inglés adultos'
  if (/psicolog/i.test(s)) return 'Psicología'
  if (/bachillerato/i.test(s)) return 'Bachillerato'
  if (/administraci/i.test(s)) return 'Adm. turística'
  if (/maestr/i.test(s)) return 'Maestría'
  if (/verano/i.test(s)) return 'Verano niños'
  return s.substring(0, 18)
}

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() === secret
  return request.headers.get('x-cron-secret') === secret
}

export async function GET(request: Request) {
  return POST(request)
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()

  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  ayer.setHours(0, 0, 0, 0)
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const { data: leads } = await supabase
    .from('leads')
    .select('stage, curso')
    .neq('stage', 'archivado')

  const { data: archivados } = await supabase
    .from('leads')
    .select('id')
    .eq('stage', 'archivado')

  const { data: nuevosAyer } = await supabase
    .from('leads')
    .select('nombre, curso, whatsapp, origen')
    .gte('created_at', ayer.toISOString())
    .lt('created_at', hoy.toISOString())

  const total = leads?.length || 0
  const porEtapa: Record<string, number> = {}
  const porProg: Record<string, { total: number; activos: number; inscripcion: number; inscrito: number; perdido: number; nuevos: number }> = {}

  for (const l of leads || []) {
    porEtapa[l.stage] = (porEtapa[l.stage] || 0) + 1
    const p = normProg(l.curso)
    if (!porProg[p]) porProg[p] = { total: 0, activos: 0, inscripcion: 0, inscrito: 0, perdido: 0, nuevos: 0 }
    porProg[p].total++
    if (ETAPAS_ACTIVAS.includes(l.stage)) porProg[p].activos++
    if (l.stage === 'inscripcion_pendiente') porProg[p].inscripcion++
    else if (l.stage === 'inscrito') porProg[p].inscrito++
    else if (l.stage === 'perdido') porProg[p].perdido++
  }

  for (const l of nuevosAyer || []) {
    const p = normProg(l.curso)
    if (porProg[p]) porProg[p].nuevos++
  }

  const seguimiento = ETAPAS_SEGUIMIENTO.reduce((s, e) => s + (porEtapa[e] || 0), 0)
  const fecha = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  const fechaAyer = ayer.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })

  const ordenPipeline = [
    ['segundo_contacto', porEtapa['segundo_contacto'] || 0],
    ['perdido', porEtapa['perdido'] || 0],
    ['tercer_contacto', porEtapa['tercer_contacto'] || 0],
    ['primer_contacto', porEtapa['primer_contacto'] || 0],
    ['insc. pendiente', porEtapa['inscripcion_pendiente'] || 0],
    ['inscritos', porEtapa['inscrito'] || 0],
  ] as [string, number][]

  const lines: string[] = [
    `*WINDSOR CRM · ${fecha}*`,
    '',
    `📊 *Pipeline* — ${total} activos · ${nuevosAyer?.length || 0} nuevos ayer`,
    ...ordenPipeline.filter(([, v]) => v > 0).map(([k, v]) => `├ ${k.padEnd(18)} ${v}`),
    `└ archivados      ${archivados?.length || 0}`,
    '',
    '📚 *Por programa*',
    ...Object.entries(porProg)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 7)
      .map(([k, v]) => {
        const detalles = [
          v.inscripcion ? `${v.inscripcion} pend` : '',
          v.inscrito ? `${v.inscrito} ins` : '',
          v.perdido ? `${v.perdido} ❌` : '',
          v.nuevos ? `+${v.nuevos} hoy` : '',
        ].filter(Boolean).join(' · ')
        return `• ${k} → ${v.total}${detalles ? ` (${detalles})` : ''}`
      }),
    '',
    `🆕 *Nuevos ${fechaAyer}*`,
    ...(nuevosAyer?.length
      ? nuevosAyer.map(l => `${l.origen === 'bot' ? '🤖' : '👤'} ${(l.nombre || 'Sin nombre').substring(0, 20)} — ${normProg(l.curso)}`)
      : ['Sin leads nuevos']),
    '',
    '_Reporte automático — Windsor CRM_',
  ]

  const body = lines.join('\n')

  await sendMetaWhatsAppMessage({ to: ADMIN_WHATSAPP, body })

  return Response.json({ ok: true, enviado_a: ADMIN_WHATSAPP, lineas: lines.length })
}
