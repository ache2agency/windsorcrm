import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { detectarPrograma, canonicalizarPrograma } from '@/lib/whatsapp/programas'
import { REGLAS_NEGOCIO } from '@/lib/whatsapp/reglasNegocio'

export const maxDuration = 60

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const AGENDAR_PATH = '/agendar/hola@windsor.edu.mx'

function buildAgendarLink(tipo: string, baseUrl: string, nombre?: string | null, email?: string | null, programa?: string | null, telefono?: string | null): string {
  const p = new URLSearchParams({ tipo })
  if (nombre) p.set('nombre', nombre)
  if (email) p.set('email', email)
  if (programa) p.set('programa', programa)
  if (telefono) p.set('telefono', telefono)
  return `${baseUrl}${AGENDAR_PATH}?${p.toString()}`
}

// ─── MENSAJES DE INFO POR PROGRAMA ───────────────────────────────────────────

const INFO_MSGS: Record<string, string> = {
  'Inglés para adultos': `😊 Los cursos regulares de inglés para adultos inician en *septiembre 2026*. ¿Te gustaría que te contactemos cuando abran las inscripciones?`,

  'Inglés para niños': `😊 Los cursos regulares de inglés para niños inician en *septiembre 2026*. ¿Te gustaría que te contactemos cuando abran las inscripciones?`,

  'Psicología': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Psicología:

*🎓 Licenciatura en Psicología*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Salud, educación, medio ambiente, producción, consumo y convivencia social.

📄 Plan de estudios: https://drive.google.com/file/d/1CuvtEmWZ8TdrI48xYXBxUBPb2PyGveBw/view`,

  'Licenciatura en Inglés': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Inglés:

*🎓 Licenciatura en Inglés*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Docente, traductor, asesor editorial, call centers, centros de investigación y organismos internacionales.

📄 Plan de estudios: https://drive.google.com/file/d/1NZeL0KEroyx0eVFeAKSaxgr5bnjjKR_Z/view`,

  'Licenciatura en Inglés online': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Inglés Online:

*🎓 Licenciatura en Inglés*
Modalidad: Online | Duración: 3 años

*🕐 Horarios:* Online

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Docente, traductor, asesor editorial, call centers, centros de investigación y organismos internacionales.

📄 Plan de estudios: https://drive.google.com/file/d/1wy4BiHspFFBZ3d1dBfO0ki-koDhR3MNg/view`,

  'Administración turística': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Administración Turística:

*🎓 Licenciatura en Administración Turística*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Agencias de viajes, hoteles, resorts, operadores turísticos, eventos y convenciones, emprendimiento propio.

📄 Plan de estudios: https://drive.google.com/file/d/18QTS1qOE5DDJuI--RCqhuIv89hPv0DiK/view`,

  'Administración turística online': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Administración Turística Online:

*🎓 Licenciatura en Administración Turística*
Modalidad: Online | Duración: 3 años

*🕐 Horarios:* Online

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Agencias de viajes, hoteles, resorts, operadores turísticos, eventos y convenciones, emprendimiento propio.

📄 Plan de estudios: https://drive.google.com/file/d/1JEhS0iVIkATLicd6wqGqUXcHyB_lzT4C/view`,

  'Relaciones públicas y mercadotecnia': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Relaciones Públicas y Mercadotecnia:

*🎓 Licenciatura en Relaciones Públicas y Mercadotecnia*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*✨ Incluye 3 certificaciones:* Marketing digital, creación de páginas web y diseño gráfico.

*💼 Campo laboral:* Agencias de publicidad, marketing, medios de comunicación, gobierno, tecnología, entretenimiento, emprendimiento propio.

📄 Plan de estudios: https://drive.google.com/file/d/1GtQPIwHcopnkvfBh4oQpUNZw0ekkyayf/view`,

  'Relaciones públicas y mercadotecnia online': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Relaciones Públicas y Mercadotecnia Online:

*🎓 Licenciatura en Relaciones Públicas y Mercadotecnia*
Modalidad: Online | Duración: 3 años

*🕐 Horarios:* Online

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*✨ Incluye 3 certificaciones:* Marketing digital, creación de páginas web y diseño gráfico.

*💼 Campo laboral:* Agencias de publicidad, marketing, medios de comunicación, gobierno, tecnología, entretenimiento, emprendimiento propio.

📄 Plan de estudios: https://drive.google.com/file/d/18VDNvOjsG39KdHr31VxfYHlJJC83TKgt/view`,

  'Bachillerato': `¡Excelente elección! 😊 Te comparto la información de nuestra Prepa Windsor:

*🎓 Bachillerato — Prepa Windsor*
Modalidad: Presencial | Duración: 2 años

*🕐 Horarios:* Matutino y Vespertino

*💰 Inversión:*
• Inscripción cuatrimestral: $1,100
• Mensualidad: $1,800
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$1,100~ → $550 (50% de descuento)
• Mensualidad: ~$1,800~ → $1,440 (20% de descuento)

📄 Más información: https://drive.google.com/file/d/1txVAaLEpi-WPTybWtSKKMu3mn6fC5TkK/view`,
}

// ─── MENSAJES DE FLUJO ────────────────────────────────────────────────────────

// Pendiente: agregar link del PDF del examen cuando el usuario lo proporcione
const EXAMEN_UBICACION_MSG = `¡Perfecto! 😊 El examen de ubicación es completamente *gratuito* y te tomará solo unos minutos.

Te enviamos las instrucciones paso a paso para realizarlo:

📄 *Instrucciones del examen:* [PENDIENTE — link PDF]

Una vez que lo termines, confírmanos aquí por WhatsApp y te agendaremos tu clase de prueba gratuita. 🎓`

function buildClasePruebaMsg(baseUrl: string, nombre?: string | null, email?: string | null, programa?: string | null, telefono?: string | null): string {
  const link = buildAgendarLink('clase_prueba', baseUrl, nombre, email, programa, telefono)
  return `¡Excelente! 🎉 Ahora te invitamos a vivir una *clase de prueba gratuita*.

Tendrás la oportunidad de conocer a tu profesor(a), la metodología y a tus futuros compañeros — sin compromiso.

👉 Agenda tu clase aquí:
${link}

¿Te animas? 😊`
}

const INSCRIPCION_LICS_MSG = `🎉 ¡Felicidades por tomar esta decisión!

¿Cómo prefieres hacer tu inscripción?

*A)* En línea desde aquí 💻
*B)* Presencial en las instalaciones 🏫`

const INSCRIPCION_ONLINE_MSG = `¡Perfecto! Aquí está todo lo que necesitas:

*📄 Documentos necesarios:*
1. Acta de nacimiento
2. Certificado de bachillerato
3. Comprobante de pago de inscripción

*🏦 Información bancaria:*
https://drive.google.com/file/d/1Hj9rRk1zHMWGnG_CjF287W-hxY2AoTe9/view?usp=drivesdk

*📋 Pasos a seguir:*
1️⃣ Realiza el pago de inscripción con los datos bancarios del enlace anterior.
2️⃣ Ingresa a https://www.windsor.edu.mx/solicitud-de-inscripcion y llena la *Solicitud de Inscripción para Licenciaturas* — ahí podrás adjuntar tus documentos directamente.
3️⃣ Confírmanos aquí por WhatsApp cuando hayas completado el formulario.
4️⃣ Un asesor revisará todo y confirmará tu inscripción. 😊`

function buildInscripcionPresencialMsg(baseUrl: string, nombre?: string | null, email?: string | null, programa?: string | null, telefono?: string | null): string {
  const link = buildAgendarLink('inscripcion', baseUrl, nombre, email, programa, telefono)
  return `¡Perfecto! Para tu inscripción presencial necesitas traer los siguientes documentos:

📄 Acta de Nacimiento (original y 2 copias)
📄 Certificado de Bachillerato (original y 2 copias)
📄 2 Copias de la CURP (al 200%)
📷 6 Fotografías tamaño infantil blanco y negro
📁 1 Sobre-bolsa tamaño oficio plastificado
📝 Llenar la solicitud de inscripción

Te esperamos en cualquiera de nuestros planteles:

🏢 *Chilpancingo:* Sofía Tena #1, Col. Viguri
🏢 *Iguala:* Ignacio Zaragoza 99, Col. Centro

🕐 *Horarios:* Lun–Vie 8:00–14:00 y 17:00–20:00 | Sáb 8:00–14:00

👉 Agenda tu visita aquí:
${link}`
}

const CATALOGO_OFERTA = `¿Cuál de nuestras ofertas educativas te interesa?

🔴PRESENCIALES

🔵BACHILLERATO

🔵LICENCIATURAS
•Licenciatura en Inglés
•Relaciones públicas y mercadotecnia
•Administracion turística
•Psicologia

🔵MAESTRIAS
•Innovación empresarial
•Multiculturalidad y plurilingüismo

🔵CURSOS DE IDIOMAS
•Inglés
•Francés
•Italiano
•Inglés para niños

🔴EN LINEA
•Cursos de Inglés
•Licenciatura en inglés
•Relaciones públicas y mercadotecnia
•Administracion turística

🔵DIPLOMADOS
•Administración de Instituciones de la Salud
•Administración de recursos humanos
•Administración de restaurantes
•Análisis y Evaluación de Políticas Públicas
•Comunicación y Liderazgo en el Sector Público
•Comunicación y Liderazgo empresarial
•Competencias educativas
•Comunicación y Gobierno Digital
•Contabilidad
•Creación y dirección de franquicias
•Ciencias del deporte
•Enfermería
•Epidemiología
•Equidad de genero y diversidad sexual
•Farmacología
•Gamificación educativa
•Gerontología
•Innovación y Gobierno Digital
•Mindfulness
•Nutrición deportiva
•Nutrición y Dietética
•Políticas y Procesos de Participación Ciudadana
•Piscología criminológica
•Psicología educativa
•Realidad Virtual
•Salud pública
•Tecnología educativa
•Terapia ocupacional
•Tanatología
•Enseñanza del idioma inglés
•Enseñanza del idioma español`

const NEXT_STEP_LABEL: Record<string, string> = {
  saludo: 'Capturar nombre',
  programa: 'Elegir programa',
  correo: 'Capturar correo',
  accion: 'Esperar elección A/B',
  examen: 'Examen de ubicación',
  clase_prueba: 'Clase de prueba',
  inscripcion: 'Proceso de inscripción',
  asesor: 'Conectar con asesor',
  seguimiento: 'Conversación abierta',
}

// ─── DETECCIÓN (código, no GPT) ───────────────────────────────────────────────

function esIngles(programa: string | null | undefined): boolean {
  return /ingl[eé]s para (ni[ñn]os?|adultos?)|ingl[eé]s (ni[ñn]os?|adultos?)/i.test(programa || '')
}

function esInglesAmbiguo(msg: string): boolean {
  return /ingl[eé]s/i.test(msg) && !/ni[ñn]o|adulto|licenciatura|lic\b/i.test(msg)
}

function detectarEmail(msg: string): string | null {
  const match = msg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return match ? match[0] : null
}

function noQuiereEmail(msg: string): boolean {
  const m = msg.toLowerCase()
  if (/no ten|sin correo|no.*correo|no.*email|no.*mail|no quiero|no doy|no hay|no pos|nop/i.test(m)) return true
  if (!m.includes('@') && /^(info|siguiente|dale|ok|omite|salta|después|despues|luego|no|nada|sin|omitir|skip)$/i.test(m.trim())) return true
  return false
}

function eligeB(msg: string): boolean {
  const m = msg.toLowerCase()
  return /\bb\b|opci[oó]n.*b|\b2\b|quiero.*clase|clase.*prueba|prueba.*clase|quiero inscrib|inscribirme|agendar.*examen|examen.*ubicaci[oó]n|quiero.*agendar|clase.*prueba|prueba.*gratuita/.test(m)
}

function eligeA(msg: string): boolean {
  const m = msg.toLowerCase()
  return /\ba\b|opci[oó]n.*a|\b1\b|tengo duda|más duda|tengo preguntas/.test(m)
}

function pidioAsesor(msg: string): boolean {
  return /hablar.*persona|asesor|humano|representante|llamar|llamada/i.test(msg)
}

function confirmoExamen(msg: string): boolean {
  return /ya.*hice|lo.*hice|realic[eé]|termin[eé]|complet[eé]|lo.*hiz|ya.*lo|listo|lo.*realic[eé]|hice.*examen/i.test(msg)
}

function buildCTA(programa: string | null | undefined): string {
  const opcionB = esIngles(programa)
    ? '*B)* Agendar mi examen de ubicación gratuito 📝'
    : '*B)* Quiero inscribirme ✍️'
  return `\n\n¿Cómo te gustaría continuar?\n*A)* Tengo dudas 🤔\n${opcionB}`
}

// ─── RAG ─────────────────────────────────────────────────────────────────────

async function queryRAG(question: string, matchCount = 8): Promise<string> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'https://crm.windsor.edu.mx'}/api/rag/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, match_count: matchCount }),
        signal: AbortSignal.timeout(10000),
      }
    )
    if (!res.ok) return ''
    const data = await res.json()
    return data?.answer || ''
  } catch {
    return ''
  }
}

// ─── GPT — SOLO genera texto, nunca decide el flujo ──────────────────────────

async function getBotPrompt(): Promise<string> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data } = await supabase
      .from('whatsapp_flows')
      .select('config')
      .eq('activo', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const prompt = data?.config?.bot_prompt
    return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : ''
  } catch {
    return ''
  }
}

async function gpt(params: {
  instruccion: string
  nombre: string | null
  programa: string | null
  ragContext: string
  userMessage: string
  history: Array<{ role: string; content: string }>
  botPrompt: string
}): Promise<{ texto: string; nombre: string | null; email: string | null; programa: string | null }> {
  const system = `${params.botPrompt || 'Eres un asesor comercial de Instituto Windsor (escuela en México) que atiende prospectos por WhatsApp. Eres amable, directo y hablas como persona real.'}

DATOS DEL PROSPECTO:
Nombre: ${params.nombre || 'no capturado aún'}
Programa de interés: ${params.programa || 'no identificado aún'}

TAREA: ${params.instruccion}

${params.ragContext ? `BASE DE CONOCIMIENTO (usa esta información):\n${params.ragContext}\n` : ''}
REGLAS:
- Formato WhatsApp: *negrita* con un asterisco. Nunca ** ni encabezados con #.
- NUNCA menciones "clase de prueba" para licenciaturas, maestrías o diplomados — esa opción es exclusiva de cursos de idiomas (inglés, francés, italiano).
- NUNCA uses links que no provengan de la BASE DE CONOCIMIENTO.
- Para promociones, reproduce EXACTAMENTE lo que dice la BASE, sin modificar ni agregar nada.
- Si la BASE no menciona promociones para un programa, no las inventes ni las menciones.
${REGLAS_NEGOCIO}
- Responde ÚNICAMENTE con JSON válido:
{"texto":"mensaje al prospecto","nombre":null,"email":null,"programa":null}
- "nombre": si el prospecto mencionó su nombre en este mensaje, sino null
- "email": si dio su correo en este mensaje, sino null
- "programa": si mencionó un programa específico en este mensaje, sino null`

  const history = Array.isArray(params.history) ? params.history.slice(-8) : []
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: params.userMessage },
      ],
      temperature: 0.5,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return { texto: '', nombre: null, email: null, programa: null }
  const data = await res.json()
  const result = JSON.parse(data.choices?.[0]?.message?.content || '{}')
  return {
    texto: result.texto || '',
    nombre: result.nombre || null,
    email: result.email || null,
    programa: result.programa ? canonicalizarPrograma(result.programa, params.userMessage) : null,
  }
}

// ─── HELPER de respuesta ─────────────────────────────────────────────────────

function ok(
  respuesta: string,
  siguienteFase: string,
  state: { nombre: string | null; email: string | null; programa: string | null; telefono?: string | null }
) {
  return NextResponse.json({
    respuesta,
    siguienteFase,
    nextStep: NEXT_STEP_LABEL[siguienteFase] || '',
    nombre: state.nombre,
    email: state.email,
    programa: state.programa,
    telefono: state.telefono ?? null,
    requestedHuman: false,
  })
}

// ─── MÁQUINA DE ESTADOS ───────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const { messages, state, userMessage } = await request.json()

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'Falta OPENAI_API_KEY' }, { status: 500 })
    }

    const fase = state?.fase || 'saludo'
    const nombre = state?.nombre || null
    const email = state?.email || null
    const programa = state?.programa || null
    const telefono = state?.telefono || null
    const botPrompt = await getBotPrompt()
    const appOrigin = new URL(request.url).origin

    // Asesor: detectado en cualquier fase
    if (pidioAsesor(userMessage)) {
      const asesorInfo = `🏢 *CHILPANCINGO:* Sofía Tena #1, Col. Viguri | Tel: 747 472 8775 / 747 472 2466 / 747 491 4498
🏢 *IGUALA:* Ignacio Zaragoza 99, Col. Centro | Tel: 733 334 0498
🕐 Horarios: Lun–Vie 8:00–14:00 y 17:00–20:00 | Sáb 8:00–14:00

¿Qué día y horario te vendría mejor para que te llame un asesor?`
      return ok(asesorInfo, 'asesor', { nombre, email, programa })
    }

    // Inglés ambiguo: avanza siempre a 'programa'
    if (!programa && esInglesAmbiguo(userMessage)) {
      return ok(
        'Tenemos tres opciones de inglés, ¿cuál te interesa?\n\nA) Inglés para adultos\nB) Inglés para niños\nC) Licenciatura en Inglés',
        'programa',
        { nombre, email, programa: null }
      )
    }

    const programaMsg = detectarPrograma(userMessage)
    const programaActual = programaMsg || programa

    // Cambio de programa en cualquier fase — solo si ya tenía un programa asignado
    if (programaMsg && programa && programaMsg !== programa && INFO_MSGS[programaMsg]) {
      const cta = buildCTA(programaMsg)
      return ok(INFO_MSGS[programaMsg] + cta, 'accion', { nombre, email, programa: programaMsg })
    }

    // Elección A/B de inscripción — detectar globalmente cuando fase es inscripcion
    if (fase === 'inscripcion') {
      const msgI = userMessage.toLowerCase()
      if (/\ba\b|en l[ií]nea|online|desde aqu[ií]|digital|virtual/i.test(msgI)) {
        return ok(INSCRIPCION_ONLINE_MSG, 'inscripcion', { nombre, email, programa: programaActual })
      }
      if (/\bb\b|mejor b|presencial|instalaci[oó]n|ir a|plantel|visitar/i.test(msgI)) {
        return ok(buildInscripcionPresencialMsg(appOrigin, nombre, email, programaActual, telefono), 'inscripcion', { nombre, email, programa: programaActual, telefono })
      }
      if (/ya.*llené|ya.*llene|ya.*hice|ya.*complet|listo|ya.*pagu[eé]|ya.*realic[eé]/i.test(msgI)) {
        return ok(
          `¡Perfecto${nombre ? ' ' + nombre : ''}! 🎉 Un asesor revisará tu información y confirmará tu inscripción en breve. ¡Bienvenid@ a la familia Windsor!`,
          'seguimiento', { nombre, email, programa: programaActual }
        )
      }
    }

    switch (fase) {

      // ── SALUDO ────────────────────────────────────────────────────────────
      case 'saludo': {
        const yaRespondio = Array.isArray(messages) && messages.length > 0
        const g = await gpt({
          instruccion: yaRespondio
            ? 'El prospecto acaba de responder. Extrae su nombre en "nombre" si lo mencionó. Salúdalo por su nombre si lo tienes y pregunta qué programa le interesa.'
            : 'Saluda brevemente y pide el nombre del prospecto.',
          nombre, programa: programaActual, ragContext: '', userMessage, history: messages, botPrompt,
        })
        const nombreFinal = g.nombre || nombre
        const sigueFase = (nombreFinal || yaRespondio) ? 'programa' : 'saludo'
        return ok(g.texto, sigueFase, {
          nombre: nombreFinal,
          email: g.email || email,
          programa: g.programa || programaActual,
        })
      }

      // ── PROGRAMA ──────────────────────────────────────────────────────────
      case 'programa': {
        if (esInglesAmbiguo(userMessage)) {
          return ok(
            'Tenemos tres opciones de inglés:\n\nA) Inglés para adultos\nB) Inglés para niños\nC) Licenciatura en Inglés',
            'programa', { nombre, email, programa: null }
          )
        }
        const msgL = userMessage.toLowerCase()
        let programaIngles: string | null = null
        if (/\ba\b|adulto/i.test(msgL)) programaIngles = 'Inglés para adultos'
        else if (/\bb\b|ni[ñn]o/i.test(msgL)) programaIngles = 'Inglés para niños'
        else if (/\bc\b|licenciatura/i.test(msgL)) programaIngles = /online|en l[ií]nea|virtual|distancia/i.test(msgL) ? 'Licenciatura en Inglés online' : 'Licenciatura en Inglés'
        const progFinal = programaIngles || programaActual
        if (progFinal) {
          const msg = `¡Excelente elección! Para contarte todo sobre *${progFinal}*, ¿me compartes tu correo electrónico para darte seguimiento personalizado? 📧`
          return ok(msg, 'correo', { nombre, email, programa: progFinal })
        }
        const cat = nombre
          ? `${nombre}, aquí está nuestra oferta educativa:\n\n${CATALOGO_OFERTA}`
          : CATALOGO_OFERTA
        return ok(cat, 'programa', { nombre, email, programa: null })
      }

      // ── CORREO ────────────────────────────────────────────────────────────
      case 'correo': {
        const emailDetectado = detectarEmail(userMessage) || null
        const skip = noQuiereEmail(userMessage)
        const yaSePreguntoEmail = Array.isArray(messages) && messages.length >= 2

        if (emailDetectado || skip || yaSePreguntoEmail) {
          // Usar mensaje hardcodeado si existe, sino fallback a RAG+GPT
          const infoMsg = programaActual ? INFO_MSGS[programaActual] : null
          if (infoMsg) {
            const cta = buildCTA(programaActual)
            return ok(infoMsg + cta, 'accion', {
              nombre,
              email: emailDetectado || email,
              programa: programaActual,
            })
          }
          // Fallback RAG+GPT para maestrías, diplomados, francés, italiano
          const rag = await queryRAG(`${programaActual} en Instituto Windsor: costos, horarios, duración, modalidad`, 10)
          const g = await gpt({
            instruccion: `Da la información completa del programa usando la BASE: duración, costos, horarios, modalidad. NO incluyas proceso de inscripción ni links de pago.`,
            nombre, programa: programaActual, ragContext: rag,
            userMessage: `Dame información completa de ${programaActual}`,
            history: [], botPrompt,
          })
          const cta = buildCTA(programaActual)
          return ok(g.texto + cta, 'accion', {
            nombre,
            email: emailDetectado || email,
            programa: programaActual,
          })
        }

        // Primera vez → pedir correo
        const g = await gpt({
          instruccion: 'Pide brevemente el correo electrónico para dar seguimiento personalizado.',
          nombre, programa: programaActual, ragContext: '', userMessage, history: messages, botPrompt,
        })
        return ok(g.texto, 'correo', { nombre: g.nombre || nombre, email, programa: programaActual })
      }

      // ── ACCION (CTA A/B) ──────────────────────────────────────────────────
      case 'accion': {
        if (eligeB(userMessage)) {
          if (esIngles(programaActual)) {
            // Track A: idiomas → primero examen de ubicación
            return ok(EXAMEN_UBICACION_MSG, 'examen', { nombre, email, programa: programaActual })
          } else {
            // Track B: licenciaturas/bachillerato → proceso de inscripción
            return ok(INSCRIPCION_LICS_MSG, 'inscripcion', { nombre, email, programa: programaActual })
          }
        }
        // Responder duda solo si parece pregunta real (no si es el texto del botón B)
        const esTextoBotonB = /agendar|examen|inscrib|clase.*prueba/i.test(userMessage)
        if (!esTextoBotonB && (eligeA(userMessage) || userMessage.trim().endsWith('?') || userMessage.length > 15)) {
          const rag = await queryRAG(`${programaActual} en Instituto Windsor: ${userMessage}`, 10)
          const g = await gpt({
            instruccion: 'Responde la duda con información concreta de la BASE. Sé directo y útil.',
            nombre, programa: programaActual, ragContext: rag, userMessage, history: messages, botPrompt,
          })
          const cta = buildCTA(programaActual)
          return ok(g.texto + cta, 'accion', { nombre, email, programa: programaActual })
        }
        const ctaRepeat = buildCTA(programaActual)
        return ok(
          `${nombre ? nombre + ', ' : ''}¿cuál de estas opciones te interesa?${ctaRepeat}`,
          'accion', { nombre, email, programa: programaActual }
        )
      }

      // ── EXAMEN DE UBICACIÓN (solo idiomas) ────────────────────────────────
      case 'examen': {
        if (confirmoExamen(userMessage)) {
          return ok(buildClasePruebaMsg(appOrigin, nombre, email, programaActual, telefono), 'clase_prueba', { nombre, email, programa: programaActual, telefono })
        }
        // Responder dudas sobre el examen
        const g = await gpt({
          instruccion: 'El prospecto está en proceso del examen de ubicación. Responde su pregunta o anímalo a realizarlo y confirmar cuando lo termine.',
          nombre, programa: programaActual, ragContext: '', userMessage, history: messages, botPrompt,
        })
        return ok(g.texto, 'examen', { nombre: g.nombre || nombre, email: g.email || email, programa: programaActual })
      }

      // ── CLASE DE PRUEBA ───────────────────────────────────────────────────
      case 'clase_prueba': {
        if (/inscri|quiero entrar|me anoto|ya decid/i.test(userMessage)) {
          return ok(INSCRIPCION_LICS_MSG, 'inscripcion', { nombre, email, programa: programaActual })
        }
        const g = await gpt({
          instruccion: 'El prospecto está en proceso de agendar su clase de prueba. Responde su pregunta o anímalo a agendar usando el link ya proporcionado.',
          nombre, programa: programaActual, ragContext: '', userMessage, history: messages, botPrompt,
        })
        return ok(g.texto, 'clase_prueba', { nombre: g.nombre || nombre, email: g.email || email, programa: programaActual })
      }

      // ── INSCRIPCIÓN ───────────────────────────────────────────────────────
      case 'inscripcion': {
        const msgL = userMessage.toLowerCase()
        if (/\ba\b|online|desde aqu[ií]|digital|virtual/i.test(msgL)) {
          return ok(INSCRIPCION_ONLINE_MSG, 'inscripcion', { nombre, email, programa: programaActual })
        }
        if (/\bb\b|presencial|instalacion|ir|visitar|plantel/i.test(msgL)) {
          return ok(buildInscripcionPresencialMsg(appOrigin, nombre, email, programaActual, telefono), 'inscripcion', { nombre, email, programa: programaActual, telefono })
        }
        if (/ya.*subi|ya.*mand|ya.*pagu[eé]|ya.*hice|listo|complet/i.test(msgL)) {
          return ok(
            `¡Perfecto ${nombre ? nombre : ''}! 🎉 Recibimos tu información. Un asesor revisará todo y te confirmará tu inscripción en breve. ¡Bienvenid@ a la familia Windsor!`,
            'seguimiento', { nombre, email, programa: programaActual }
          )
        }
        const g = await gpt({
          instruccion: 'El prospecto está en proceso de inscripción. Responde su duda o guíalo en el siguiente paso.',
          nombre, programa: programaActual, ragContext: '', userMessage, history: messages, botPrompt,
        })
        return ok(g.texto, 'inscripcion', { nombre: g.nombre || nombre, email: g.email || email, programa: programaActual })
      }

      // ── ASESOR ────────────────────────────────────────────────────────────
      case 'asesor': {
        const g = await gpt({
          instruccion: `El prospecto quiere hablar con un asesor.
1. Si aún no preguntaste día/hora: pregunta qué día y horario le viene mejor.
2. Si ya tienes día/hora: pide su número de teléfono.
3. Si ya tienes el teléfono: confirma que un asesor lo llamará en ~1 hora.
Captura el teléfono en "telefono" del JSON si lo da.`,
          nombre, programa: programaActual, ragContext: '', userMessage, history: messages, botPrompt,
        })
        return NextResponse.json({
          respuesta: g.texto,
          siguienteFase: 'asesor',
          nextStep: NEXT_STEP_LABEL['asesor'],
          nombre: g.nombre || nombre,
          email: g.email || email,
          programa: programaActual,
          telefono: null,
          requestedHuman: true,
        })
      }

      // ── SEGUIMIENTO (conversación abierta) ────────────────────────────────
      default: {
        // Shortcuts directos
        if (esIngles(programaActual) && eligeB(userMessage)) {
          return ok(EXAMEN_UBICACION_MSG, 'examen', { nombre, email, programa: programaActual })
        }
        if (!esIngles(programaActual) && /inscri/i.test(userMessage)) {
          return ok(INSCRIPCION_LICS_MSG, 'inscripcion', { nombre, email, programa: programaActual })
        }
        if (!programaActual && esInglesAmbiguo(userMessage)) {
          return ok(
            'Tenemos tres opciones de inglés:\n\nA) Inglés para adultos\nB) Inglés para niños\nC) Licenciatura en Inglés',
            'seguimiento', { nombre, email, programa: null }
          )
        }

        const esPromo = /promo|descuento|oferta|precio especial|rebaja/i.test(userMessage)
        const ragQuery = programaActual
          ? `${programaActual} en Instituto Windsor: ${userMessage}`
          : `Instituto Windsor: ${userMessage}`
        const [rag, ragPromo] = await Promise.all([
          queryRAG(ragQuery, 10),
          esPromo ? queryRAG('promoción vigente licenciaturas Instituto Windsor descuento inscripción mensualidad', 5) : Promise.resolve(''),
        ])
        const ragContext = [rag, ragPromo].filter(Boolean).join('\n\n')
        const g = await gpt({
          instruccion: `Presenta DIRECTAMENTE la información del programa usando la BASE DE CONOCIMIENTO.
NUNCA menciones "clase de prueba" para licenciaturas, maestrías o diplomados.
Para promociones, reproduce EXACTAMENTE lo que dice la BASE.
Solo redirige a asesor si la BASE está completamente vacía para ese programa.`,
          nombre, programa: programaActual, ragContext, userMessage, history: messages, botPrompt,
        })
        return ok(g.texto, 'seguimiento', {
          nombre: g.nombre || nombre,
          email: g.email || email,
          programa: programaActual,
        })
      }
    }
  } catch (err) {
    console.error('[LAB ERROR]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
