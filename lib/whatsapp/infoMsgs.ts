// Fichas de información por programa + CTA — movido desde app/api/whatsapp/webhook/route.ts
// (2026-09-23) para compartirlo con el cron de reactivación dentro de la ventana de 24h.
import { esInglesIdioma } from '@/lib/whatsapp/programas'

// ─── INFO_MSGS: fuente de verdad por programa (igual que el lab) ─────────────
// Para programas conocidos usamos esto directamente — sin GPT/RAG —
// para garantizar que siempre incluya promo y sea consistente.

export const INFO_MSGS: Record<string, string> = {
  'Inglés para adultos': `¡Con gusto! 😊 Te comparto la información de nuestro curso de *Inglés para adultos*:

*🎓 Inglés para adultos*
Dirigido a: 13 años en adelante | Modalidad: Presencial y Online
Duración: 5 meses (10 meses en sabatino)

*🕐 Horarios presenciales:* Matutino 10-12h, Vespertino 17-19h, Sabatino 9-13h
*🕐 Horarios online:* Vespertino 17-19h, Sabatino 9-13h

*💰 Inversión:*
• Inscripción anual: $800 → *$400 con promo* (50% de descuento)
• Mensualidad matutino/vespertino: $1,220 (Básico, Elemental y Pre-Intermedio) o $1,250 (Intermedio, Intermedio Avanzado y Avanzado)
• Mensualidad sabatino: $1,040 (Básico, Elemental y Pre-Intermedio) o $1,060 (Intermedio, Intermedio Avanzado y Avanzado)
• Material (libros): aprox. $900 aparte

🎓 Obtienes diploma con validez oficial.

Las clases inician en *septiembre*, pero *puedes inscribirte desde ahora* para asegurar tu lugar 😊`,

  'Inglés para niños': `¡Con gusto! 😊 Te comparto la información de nuestro curso de *Inglés para niños*:

*🎓 Inglés para niños*
Dirigido a: 4 a 12 años | Modalidad: Presencial y Online
Duración: 5 meses (10 meses en sabatino)

*🕐 Horarios presenciales:* Martes a jueves 13-14h o 17-18h, Sabatino 9-13h
*🕐 Horarios online:* Lunes a jueves 17-18h, Sabatino 9-13h

*💰 Inversión:*
• Inscripción: $800 → *$400 con promo* (50% de descuento)
• Mensualidad: $780
• Material: aprox. $700 aparte

🎓 Obtienes diploma con validez oficial.

Las clases inician en *septiembre*, pero *puedes inscribirte desde ahora* para asegurar tu lugar 😊`,

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

📄 Plan de estudios: https://drive.google.com/file/d/12o2Xiao5gBGMIr1R5nzbNQzViUzuOKPo/view`,

  'Licenciatura en Inglés': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Inglés:

*🎓 Licenciatura en Inglés*
Modalidad: Presencial y online | Duración: 3 años (9 cuatrimestres)

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
Modalidad: Online | Duración: 3 años (9 cuatrimestres)

*🕐 Horarios:* La materia de inglés se cursa en línea lunes y martes de 7:00pm a 9:00pm. Las materias complementarias se cursan en sesiones sabatinas, con horario por materia de aprox. 8:30am a 3:30pm.

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

*💼 Campo laboral:* Agencias de viajes, hoteles, resorts, operadores turísticos, eventos y convenciones.

📄 Plan de estudios: https://drive.google.com/file/d/18QTS1qOE5DDJuI--RCqhuIv89hPv0DiK/view`,

  'Administración turística online': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Administración Turística Online:

*🎓 Licenciatura en Administración Turística*
Modalidad: Online | Duración: 3 años

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Agencias de viajes, hoteles, resorts, operadores turísticos, eventos y convenciones.

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

*💼 Campo laboral:* Agencias de publicidad, marketing, medios de comunicación, gobierno, tecnología, entretenimiento.

📄 Plan de estudios: https://drive.google.com/file/d/1GtQPIwHcopnkvfBh4oQpUNZw0ekkyayf/view`,

  'Relaciones públicas y mercadotecnia online': `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Relaciones Públicas y Mercadotecnia Online:

*🎓 Licenciatura en Relaciones Públicas y Mercadotecnia*
Modalidad: Online | Duración: 3 años

*💰 Inversión:*
• Inscripción semestral: $2,300
• Mensualidad: $2,750
📌 No incluye credencial de estudiante (trámite por separado)

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*✨ Incluye 3 certificaciones:* Marketing digital, creación de páginas web y diseño gráfico.

*💼 Campo laboral:* Agencias de publicidad, marketing, medios de comunicación, gobierno, tecnología, entretenimiento.

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

  'Cursos de verano niños': `👋 ¡Hola! Gracias por tu interés en *My Best Summer 2026* de Instituto Windsor. ☀️

📅 *Fechas:* Del 20 de julio al 07 de agosto.

👧🧒 Contamos con grupos por edades:

🔹 *Kids* (4 a 6 años)
• Idiomas (Inglés y Francés)
• Origami
• Arte y pintura
• Ritmo y movimiento musical
• Repostería
• Kung Fu

🔹 *Juniors* (7 a 9 años)
• Idiomas
• Repostería
• Robótica
• Origami
• Arte y pintura
• Diseño de videojuegos
• Ritmo y movimiento musical
• Kung Fu

🔹 *Seniors* (10 a 12 años)
• Arte y pintura
• Robótica
• Idiomas
• Kung Fu
• Origami
• Repostería
• Diseño de videojuegos

🕘 *Horario:* De 9:00 a.m. a 1:30 p.m.

🍽️ *Cafetería:* Las instalaciones cuentan con servicio de cafetería, el cual opera de manera independiente. Los paquetes y costos los podrás consultar directamente con ellos — lo que sí podemos confirmar es que ofrecen opciones especiales para los cursos de verano.

🚌 Los viernes realizamos salidas especiales al Zoológico, Museo La Avispa y Bomberos.

📍 *Ubicación:* Calle Sofía Tena #1, Col. Viguri.

💰 *Inversión:* $1,650 MXN + $300 materiales.
💳 *Pago:* Puedes apartar tu lugar con el 50% y cubrir el resto al inicio del curso.

🚨 *Inscripciones abiertas | Cupo limitado*`,

  'Cursos de verano adultos': `👋 ¡Hola! Gracias por tu interés en *My Best Summer* para Adolescentes y Adultos de Instituto Windsor. 🌟

📅 *Fechas:* Del 20 de julio al 07 de agosto.

Ofrecemos cursos Extra Intensivos de Idiomas para que avances tu nivel en pocas semanas.

🇬🇧 *Inglés*

🔹 Beginner X Intensivo
🕘 9:00 a.m. a 12:00 p.m. o 1:00 p.m. a 4:00 p.m.

🔹 Elementary X Intensivo
🕐 1:00 p.m. a 4:00 p.m.

🔹 Pre-Intermediate X Intensivo
🕐 1:00 p.m. a 4:00 p.m.

🇫🇷 *Francés Intensivo*
🕐 1:00 p.m. a 3:00 p.m.

🇮🇹 *Italiano Intensivo*
🕐 1:00 p.m. a 3:00 p.m.

💰 *Inversión:* $1,700 MXN por curso.
📚 Manual para cursos de inglés: $150 MXN adicionales.

📍 *Ubicación:* Calle Sofía Tena #1, Col. Viguri.

🚨 *Inscripciones abiertas | Cupo limitado*`,

  'Habilidades para la práctica psicoterapéutica': `📚 Te comparto la información de nuestro curso *Habilidades para la práctica psicoterapéutica*:

Existen diversas habilidades básicas para el correcto desarrollo de la labor clínica del psicólogo, que no siempre se desarrollan en la formación tradicional. Este curso desarrolla el análisis, la evaluación, el moldeamiento verbal y la dirección de actividades para brindar intervenciones psicoterapéuticas confiables y eficientes.

*🎯 Objetivo:* Que el estudiante desarrolle habilidades de análisis conductual en el área clínica, para predecir, explicar e intervenir de manera eficiente ante distintos problemas psicológicos.

*📋 Competencias a desarrollar:*
• Análisis conductual aplicado
• Análisis de casos clínicos
• Análisis de la conducta verbal y no verbal
• Moldeamiento verbal
• Regulación y autorregulación de las emociones
• Estrategias conductuales y emocionales en tratamientos multidisciplinares

*👨‍🏫 Responsable:* Psic. Carlos Manuel Palacios Pita

*🗓️ Duración:* 4 módulos de 3 sesiones cada uno (4 semanas), lunes a miércoles de 3:00 p.m. a 4:30 p.m.
1️⃣ Introducción y habilidades básicas — 20 al 22 de julio
2️⃣ Análisis funcional aplicado — 27 al 29 de julio
3️⃣ Moldeamiento verbal — 3 al 5 de agosto
4️⃣ Autorregulación emocional — 10 al 12 de agosto

*💰 Costo* (incluye constancia):
• Alumnos Windsor: $300
• Público en general: $400

🚨 *Cupo limitado:* mínimo 10, máximo 25 participantes.`,
}

/** CTA siempre en código, nunca delegado a GPT */
export function buildCTA(programa: string | null | undefined): string {
  if (esInglesIdioma(programa)) {
    // El examen de ubicación es opcional — nunca debe bloquear la inscripción
    return `\n\n¿Cómo te gustaría continuar?\n*A)* Tengo dudas 🤔\n*B)* Quiero inscribirme ✍️\n*C)* Agendar mi examen de ubicación gratuito (opcional) 📝`
  }
  return `\n\n¿Cómo te gustaría continuar?\n*A)* Tengo dudas 🤔\n*B)* Quiero inscribirme ✍️`
}

// My Best Summer 2026 ya concluyó (ver reglasNegocio.ts, TEXTO_MY_BEST_SUMMER_CERRADO) —
// antes estos dos mensajes ofrecían inscripción activa a esa edición ya cerrada (fechas de
// julio, cuenta bancaria, formulario) apenas alguien decía "quiero inscribirme"/"quiero
// apartar mi lugar" estando en curso "verano". Ahora redirigen de forma explícita al curso
// regular de idiomas (abierto todo el año), que es el proceso vigente real (caso real:
// Tania Itzel, lead de "Verano adultos", 2026-09-04, marcado como error en el CRM).
const VERANO_NINOS_REDIRECT_BASE = `¡Buena noticia! 🎈 La edición de este año de *My Best Summer* ya concluyó, pero tenemos nuestro curso regular de *Inglés para niños* abierto todo el año — te comparto cómo inscribirte:

${INFO_MSGS['Inglés para niños'].replace(/^[^\n]*\n\n/, '')}`

const VERANO_ADULTOS_REDIRECT_BASE = `¡Buena noticia! 🎈 La edición de este año de *My Best Summer* ya concluyó, pero tenemos nuestro curso regular de *Inglés para adultos* abierto todo el año — te comparto cómo inscribirte:

${INFO_MSGS['Inglés para adultos'].replace(/^[^\n]*\n\n/, '')}`

export const INSCRIPCION_VERANO_NINOS_MSG = VERANO_NINOS_REDIRECT_BASE + buildCTA('Inglés para niños')
export const INSCRIPCION_VERANO_ADULTOS_MSG = VERANO_ADULTOS_REDIRECT_BASE + buildCTA('Inglés para adultos')

// El bug de arriba (Tania Itzel) solo se corrigió para el paso de "quiero inscribirme".
// Pero INFO_MSGS['Cursos de verano niños'/'adultos'] (definidos arriba, con las fechas de
// julio-agosto y "Inscripciones abiertas") se siguen usando tal cual en varios otros sitios
// de este archivo (info general del programa, resend tras capturar correo, etc., todos los
// cuales agregan su propio buildCTA() aparte — por eso aquí se usa el _BASE sin CTA, igual
// que el resto de las entradas de INFO_MSGS) — cualquiera de esos sitios le habría mandado a
// un lead la misma promoción de una temporada ya concluida sin pasar por "inscribirme". Se
// sobreescriben aquí para que TODOS los consumidores de INFO_MSGS (fuente de verdad única)
// redirijan al curso regular vigente.
INFO_MSGS['Cursos de verano niños'] = VERANO_NINOS_REDIRECT_BASE
INFO_MSGS['Cursos de verano adultos'] = VERANO_ADULTOS_REDIRECT_BASE
