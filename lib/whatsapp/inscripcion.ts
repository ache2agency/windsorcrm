import { tipoInscripcion, detectarPrograma, type TipoInscripcion } from './programas'
import { urlInscripcion } from '../inscripcion/enlace'

export const INSCRIPCION_LICS_MSG = `🎉 ¡Felicidades por tomar esta decisión!

¿Cómo prefieres hacer tu inscripción?

*A)* En línea desde aquí 💻
*B)* Presencial en las instalaciones 🏫`

export const INSCRIPCION_ONLINE_MSG = `¡Perfecto! Aquí está todo lo que necesitas:

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
4️⃣ Confírmanos por aquí si necesitas ayuda con tu inscripción. 😊`

export const INSCRIPCION_BACHILLERATO_MSG = `🔴PROCESO DE INSCRIPCIÓN BACHILLERATO 🔴

Antes que nada permítenos felicitarte por tomar acción en tu proceso de crecimiento profesional y personal, estamos seguros que has tomado la decisión correcta y nos dará mucho gusto acompañarte en este proceso.

Para empezar tu proceso de inscripción vas a necesitar los siguientes archivos:

Acta de nacimiento, el archivo debe llevar el siguiente nombre:
Acta de nacimiento (tu nombre)

Certificado de secundaria, el archivo debe llevar el siguiente nombre:
Certificado de secundaria (tu nombre)

Comprobante de pago, el archivo debe llevar el siguiente nombre:
Comprobante de pago (tu nombre)

Haz clic en la liga para descargar la información de nuestra cuenta bancaria:
https://drive.google.com/file/d/1Hj9rRk1zHMWGnG_CjF287W-hxY2AoTe9/view?usp=drivesdk

🔵¿Ya tienes todos los documentos?

Por favor, sigue las indicaciones para completar tu inscripción.

1️⃣ Ingresar a https://www.windsor.edu.mx/solicitud-de-inscripcion y llenar la "solicitud de inscripción bachillerato / licenciatura"

2️⃣ Envíanos un mensaje por este medio cuando hayas terminado.

Listo, ya eres parte de la familia Windsor 🎉🎉🎉

¡¡BIENVENID@!!`

export const INSCRIPCION_DIPLOMADO_MSG = `🔴PROCESO DE INSCRIPCIÓN DIPLOMADOS🔴

1️⃣ Enviar documentación escaneada al correo hola@windsor.edu.mx (copia de Acta de Nacimiento)

2️⃣ Ingresar a https://www.windsor.edu.mx/solicitud-de-inscripcion y llenar la solicitud de inscripción.

3️⃣ Una vez recibida la solicitud, te enviamos una referencia y la cuenta a la que harás tu pago.

Listo, ya eres parte de la familia Windsor 🎉🎉🎉

¡¡BIENVENID@!!`

export const INSCRIPCION_IDIOMA_MSG = `🔴PROCESO DE INSCRIPCIÓN CURSOS DE IDIOMAS🔴

Antes que nada permítenos felicitarte por tomar acción en tu proceso de crecimiento profesional y personal, estamos seguros que has tomado la decisión correcta y nos dará mucho gusto acompañarte en este proceso.

Para empezar tu proceso de inscripción vas a necesitar los siguientes archivos:

Acta de nacimiento, el archivo debe llevar el siguiente nombre:
Acta de nacimiento (tu nombre)

Comprobante de pago, el archivo debe llevar el siguiente nombre:
Comprobante de pago (tu nombre)

Haz clic en la liga para descargar la información de nuestra cuenta bancaria:
https://drive.google.com/file/d/1Hj9rRk1zHMWGnG_CjF287W-hxY2AoTe9/view?usp=drivesdk

🔵¿Ya tienes todos los documentos?

Por favor, sigue las indicaciones para completar tu inscripción.

1️⃣ Ingresar a https://www.windsor.edu.mx/solicitud-de-inscripcion y llenar la "solicitud de inscripción cursos de idiomas"

2️⃣ Envíanos un mensaje por este medio cuando hayas terminado.

Listo, ya eres parte de la familia Windsor 🎉🎉🎉

¡¡BIENVENID@!!`

export const INSCRIPCION_HABILIDADES_MSG = `¡Perfecto! 😊 Para inscribirte al curso *Habilidades para la práctica psicoterapéutica* solo necesitas:

1️⃣ Llenar este formulario: https://docs.google.com/forms/d/e/1FAIpQLSf2QqhL5xo-C35_g2suWzMpX0oWpdvZS082DPHNksY-CcPNBQ/viewform
2️⃣ Realizar tu pago en efectivo directamente en las instalaciones ($300 alumnos Windsor / $400 público)

Confírmanos aquí cuando hayas completado el formulario. 🎉`

// Con INSCRIPCION_FORMULARIO_BOT=on los diplomados se inscriben en el formulario propio del CRM
// (sin cuenta de Google; registra la fila en el Sheet y crea carpeta + ficha vía Apps Script).
export function inscripcionDiplomadoFormularioMsg(lead: { curso?: string | null; whatsapp?: string | null; nombre?: string | null }) {
  return `🔴PROCESO DE INSCRIPCIÓN DIPLOMADOS🔴

¡Felicidades por tomar esta decisión! 🎉 Aquí está todo lo que necesitas:

*📄 Documentos que vas a subir:*
1. Acta de nacimiento
2. Comprobante de pago de inscripción y primer módulo

*🏦 Información bancaria:*
https://drive.google.com/file/d/1Hj9rRk1zHMWGnG_CjF287W-hxY2AoTe9/view?usp=drivesdk

*📋 Pasos a seguir:*
1️⃣ Realiza tu pago de inscripción y primer módulo con los datos bancarios del enlace anterior (es la misma cuenta para todos nuestros programas).
2️⃣ Llena tu solicitud y sube tus documentos aquí:
${urlInscripcion(lead.curso || 'Diplomado', lead.whatsapp, lead.nombre)}
3️⃣ Confírmanos por aquí cuando la envíes y te damos acceso a la plataforma.

Listo, ya eres parte de la familia Windsor 🎉🎉🎉`
}

export function mensajeInscripcionPara(
  tipo: Exclude<TipoInscripcion, 'desconocido'>,
  lead?: { curso?: string | null; whatsapp?: string | null; nombre?: string | null },
): string {
  if (tipo === 'diplomado' && lead && process.env.INSCRIPCION_FORMULARIO_BOT?.trim() === 'on') {
    return inscripcionDiplomadoFormularioMsg(lead)
  }
  switch (tipo) {
    // Verano ya concluyó: quien dice "me quiero inscribir" recibe directo el proceso de idiomas
    // (antes recibía otra vez la ficha con "B) Quiero inscribirme"). Cubre también Francés/Italiano.
    case 'verano': return INSCRIPCION_IDIOMA_MSG
    case 'habilidades': return INSCRIPCION_HABILIDADES_MSG
    case 'bachillerato': return INSCRIPCION_BACHILLERATO_MSG
    case 'diplomado': return INSCRIPCION_DIPLOMADO_MSG
    case 'idioma': return INSCRIPCION_IDIOMA_MSG
    case 'licenciatura': return INSCRIPCION_LICS_MSG
  }
}

export const INSCRIPCION_DESCONOCIDA_MSG = `¿A qué programa quieres inscribirte? Elige una opción:
• Licenciatura (indica cuál)
• Bachillerato
• Diplomado (indica cuál)
• Curso de idiomas (inglés, francés o italiano)
• Habilidades para la práctica psicoterapéutica`

// Primero el curso persistido; el texto/GPT solo completa un curso no reconocido.
export function resolverTipoInscripcion(curso?: string | null, ...alternativas: Array<string | null | undefined>): TipoInscripcion {
  for (const candidato of [curso, ...alternativas]) {
    const tipo = tipoInscripcion(candidato)
    if (tipo !== 'desconocido') return tipo
    const detectado = detectarPrograma(candidato || '')
    const inferido = tipoInscripcion(detectado)
    if (inferido !== 'desconocido') return inferido
  }
  return 'desconocido'
}
