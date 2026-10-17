import type { ProgramaInscripcion } from './config'

// Los documentos van al Drive de Windsor a través del Apps Script del Sheet
// "SOLICITUD DE INSCRIPCIÓN LICENCIATURAS (respuestas)" (apps-script/InscripcionCRM.gs):
// misma pestaña, carpeta por alumno y ficha PDF que un envío de Google Forms.
export type ArchivoDrive = { tipo: string; file: File; extension: string; contentType: string }
export type ResultadoDrive = { pestana: string; fila: number; carpeta: string; ficha: string }
export type EnviarDrive = (solicitud: {
  id: string; programa: ProgramaInscripcion; datos: Record<string, string>; archivos: ArchivoDrive[]
}) => Promise<ResultadoDrive>

export const enviarAlDrive: EnviarDrive = async ({ id, programa, datos, archivos }) => {
  const url = process.env.INSCRIPCION_DRIVE_URL
  const secreto = process.env.INSCRIPCION_DRIVE_SECRETO
  if (!url || !secreto) throw new Error('El formulario no está configurado.')
  const payload = {
    secreto, id, programa, datos,
    archivos: await Promise.all(archivos.map(async a => ({
      tipo: a.tipo, extension: a.extension, mimeType: a.contentType,
      base64: Buffer.from(await a.file.arrayBuffer()).toString('base64'),
    }))),
  }
  let respuesta: { ok?: boolean; error?: string } & Partial<ResultadoDrive>
  try {
    // Apps Script responde con un redirect 302 a googleusercontent; fetch lo sigue.
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload), redirect: 'follow', signal: AbortSignal.timeout(120_000),
    })
    respuesta = await res.json()
  } catch (error) {
    console.error('[inscripcion] Apps Script no respondió:', id, error)
    throw new Error('No pudimos guardar los documentos. Inténtalo más tarde.')
  }
  if (!respuesta.ok || !respuesta.carpeta) {
    console.error('[inscripcion] Apps Script rechazó la solicitud:', id, respuesta.error)
    throw new Error('No pudimos guardar los documentos. Inténtalo más tarde.')
  }
  return { pestana: respuesta.pestana || '', fila: Number(respuesta.fila), carpeta: respuesta.carpeta, ficha: respuesta.ficha || '' }
}
