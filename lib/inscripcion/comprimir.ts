// Fotos de celular (3-8 MB) → JPEG de máx. 1800 px, bajando calidad hasta caber.
// Si el navegador no puede decodificar la imagen (HEIC fuera de Safari), se deja igual
// y la validación de tamaño decide.
export const OBJETIVO_FOTO = 700 * 1024

export async function comprimirFoto(file: File, objetivo = OBJETIVO_FOTO): Promise<File> {
  if (!/^image\/(jpeg|png|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|heic)$/i.test(file.name)) return file
  if (file.size <= objetivo) return file
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { return file }
  const escala = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.fillStyle = '#fff' // PNG con transparencia → fondo blanco en JPEG.
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  let blob: Blob | null = null
  for (const calidad of [0.82, 0.7, 0.58, 0.46]) {
    blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', calidad))
    if (blob && blob.size <= objetivo) break
  }
  if (!blob || blob.size >= file.size) return file
  const nombre = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], nombre, { type: 'image/jpeg' })
}
