import { camposPrograma, documentosPrograma, MAX_ARCHIVO, type ProgramaInscripcion } from './config'

export function normalizarWhatsapp(value: string) {
  let n = value.replace(/^whatsapp:/i, '').replace(/[\s()+.-]/g, '')
  if (/^\d{10}$/.test(n)) n = `52${n}`
  if (/^521\d{10}$/.test(n)) n = `52${n.slice(3)}`
  if (!/^[1-9]\d{7,14}$/.test(n)) throw new Error('Escribe un WhatsApp válido con código de país.')
  return `+${n}`
}
export function validarDatos(programa: ProgramaInscripcion, input: Record<string, unknown>) {
  const datos: Record<string, string> = {}
  for (const campo of camposPrograma(programa)) {
    const raw = input[campo.id]
    const valor = typeof raw === 'string' ? raw.trim() : ''
    if (valor.length > 250) throw new Error(`${campo.label}: máximo 250 caracteres.`)
    if (campo.required && !valor) throw new Error(`Falta: ${campo.label}.`)
    if (valor && campo.options && !campo.options.includes(valor)) throw new Error(`${campo.label}: opción inválida.`)
    datos[campo.id] = valor
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) throw new Error('Correo electrónico inválido.')
  const fecha = Date.parse(datos.fecha_nacimiento)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha_nacimiento) || !Number.isFinite(fecha) || new Date(fecha).toISOString().slice(0,10) !== datos.fecha_nacimiento || datos.fecha_nacimiento > new Date().toISOString().slice(0, 10)) throw new Error('Fecha de nacimiento inválida.')
  if (datos.edad && (!/^\d{1,3}$/.test(datos.edad) || Number(datos.edad) > 120)) throw new Error('Edad inválida.')
  if (datos.curp && !/^[A-Z0-9]{18}$/i.test(datos.curp)) throw new Error('La CURP debe tener 18 caracteres.')
  if (datos.lengua_indigena === 'Sí' && !datos.lengua_cual) throw new Error('Especifica la lengua indígena.')
  datos.whatsapp = normalizarWhatsapp(datos.whatsapp)
  return datos
}
const tipos: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic' }
export async function validarArchivo(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  const mime = tipos[extension]
  if (!mime || (file.type && file.type !== mime && !(extension === 'heic' && file.type === 'image/heif'))) throw new Error('Solo se aceptan PDF, JPG, PNG o HEIC con su tipo correcto.')
  if (!file.size || file.size > MAX_ARCHIVO) throw new Error('Cada documento debe pesar entre 1 byte y 750 KB.')
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const ascii = new TextDecoder('latin1').decode(bytes)
  const valido = extension === 'pdf' ? ascii.startsWith('%PDF-')
    : ['jpg', 'jpeg'].includes(extension) ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : extension === 'png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
    : ascii.slice(4, 8) === 'ftyp' && /heic|heix|hevc|hevx/.test(ascii.slice(8))
  if (!valido) throw new Error('El contenido del archivo no corresponde a su formato.')
  return { extension, contentType: mime }
}
export async function validarDocumentos(programa: ProgramaInscripcion, form: FormData) {
  const archivos = []
  const permitidos = new Set(documentosPrograma(programa).map(d => d.id))
  for (const [key, value] of form.entries()) {
    if (value instanceof File && value.size && !permitidos.has(key)) throw new Error('Documento no reconocido.')
    if (form.getAll(key).length > 1) throw new Error('Campo repetido.')
  }
  for (const doc of documentosPrograma(programa)) {
    const file = form.get(doc.id)
    if (!(file instanceof File) || !file.size) {
      if (doc.required) throw new Error(`Falta: ${doc.label}.`)
      continue
    }
    archivos.push({ tipo: doc.id, file, ...await validarArchivo(file) })
  }
  return archivos
}
