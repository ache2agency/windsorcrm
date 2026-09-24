import { quitarAcentos, detectarPrograma } from '@/lib/whatsapp/programas'

// Validación de "¿esto es un nombre de persona?" — compartida entre el webhook (captura
// de nombre) y la reactivación automática (saludo "¡Hola X!"). Antes la reactivación tenía
// su propia versión más laxa y saludó "¡Hola Gracias!" (caso +527474991567, 2026-09-24).
export function hasLeadName(nombre: string | null | undefined, whatsapp: string | null | undefined) {
  let value = String(nombre || '').trim()
  // Normalizar: abreviaciones con punto (Ma. → Ma, Dr. → Dr) y punto final
  value = value.replace(/\b([A-ZÁÉÍÓÚ][a-záéíóú]{0,2})\.\s*/g, '$1 ').replace(/\.\s*$/, '').trim()
  // "Me llamo X" / "Mi nombre es X" / "Soy X": validar solo el nombre, no el prefijo
  value = value.replace(/^\s*(me\s+llamo|mi\s+nombre\s+es|soy)\s*:?\s+/i, '').trim()
  // Mínimo 3 letras: "Ol" (error de dedo) se guardó como nombre (caso +527471850523, 2026-09-24)
  if (!value || value.replace(/[^\p{L}]/gu, '').length < 3) return false
  if (value === String(whatsapp || '').trim()) return false
  // Rechazar si la PRIMERA palabra no puede iniciar un nombre: "Gracias por la información",
  // "Me interresa", "Ok gracias" se guardaron como nombre (casos 2026-09-24: +527474991567,
  // +527472077733). La lista de abajo (noNombres) solo atrapaba la palabra sola.
  const primeraPalabra = quitarAcentos(value.split(/\s+/)[0].toLowerCase())
  if (/^(gracias|muchas|ok|okay|oki|va|vale|sale|claro|perfecto|excelente|listo|bien|hola|ola|buenas?|buenos|me|mi|te|yo|ya|si|no|quiero|quisiera|necesito|info|informacion|interesa|interesad[oa]|estoy|tengo|tienen|cuanto|cual|que|como|donde|cuando|para|por|en|el|los|las|un|una)$/.test(primeraPalabra)) return false
  if (/inter+es/i.test(quitarAcentos(value))) return false
  if (/@/.test(value)) return false
  // Rechazar si tiene más de 4 palabras "de nombre" (nombres reales tienen máx 4). Las
  // partículas (de, la, del, los, las, y) no cuentan — antes "Angel de la cruz roque"
  // (5 palabras) se rechazaba y el bot preguntaba "¿Cómo te llamas?" en loop (🚩 2026-09-17).
  if (value.split(/\s+/).filter(w => !/^(de|la|las|los|del|y)$/i.test(w)).length > 4) return false
  // Rechazar si contiene dígitos
  if (/\d/.test(value)) return false
  // Rechazar si contiene signos de puntuación o interrogación (es una frase)
  if (/[¿?¡!,;:.\/\\]/.test(value)) return false
  // Rechazar si contiene emojis o caracteres no válidos en un nombre
  if (!/^[\p{L}\s'\-]+$/u.test(value)) return false
  // Rechazar palabras que claramente no son nombres propios
  // Nota: "buen[oa]?s?" (con la vocal también opcional) para cubrir "Buen día" suelto,
  // no solo "Buenos días" — caso real confirmado: "Buen día" guardado como nombre.
  const noNombres = /^(hola|buenas?|buen|d[ií]a|tardes?|noches?|info|informaci[oó]n|costos?|precios?|horarios?|quiero|quisiera|necesito|ayuda|gracias|ok|s[ií]|no|nada|nope|oye|hey|buenos|saludos|permiso|disculp|por\s+favor|favor|buen[oa]?s?\s+d[ií]as?|buen[oa]?s?\s+tardes?|buen[oa]?s?\s+noches?)$/i
  if (noNombres.test(value.trim())) return false
  // Rechazar si claramente es la respuesta a OTRA pregunta del flujo (para quién es,
  // modalidad, costos, petición de reenvío, etc.) colada como si fuera el nombre.
  // Causa raíz confirmada de nombres corruptos guardados en leads.nombre: "Para adultos",
  // "De costos", "Para mi hija", "Enviar nuevamente", "Sistema habierto" (ver memoria
  // windsorcrm: bug nombre corrupto). Un nombre real de pila nunca empieza con "para"
  // ni contiene estas palabras sueltas.
  if (/^para\b/i.test(value)) return false
  const respuestaOtraCosa = /\b(adultos?|ni[ñn]os?|sistema|abiert[oa]|cerrad[oa]|escolarizad[oa]|semiescolarizad[oa]|presencial(es)?|virtual(es)?|modalidad(es)?|en\s*l[ií]nea|online|costos?|precios?|mensualidad(es)?|colegiatur(a|as)|inscripci[oó]n(es)?|descuentos?|becas?|env[ií]a(r|me)?|reenv[ií]a(r|me)?|manda(r|me)?|nuevamente|hij[oa]s?)\b/i
  if (respuestaOtraCosa.test(value)) return false
  // Rechazar si el texto coincide con un programa/curso conocido (ej. "Mercadotecnia"):
  // quien lo escribe está diciendo qué le interesa estudiar, no su nombre. Reutiliza el
  // mismo detector que usa el resto del flujo para reconocer programas, en vez de
  // mantener una lista de palabras aparte.
  if (detectarPrograma(value)) return false
  return true
}
