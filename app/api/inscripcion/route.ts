import { NextResponse, after } from 'next/server'
import { createHmac } from 'node:crypto'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { recibirInscripcion, LimiteInscripcion } from '@/lib/inscripcion/servicio'
import { MAX_SOLICITUD } from '@/lib/inscripcion/config'
import { avisarInscripcion } from '@/lib/whatsapp/aviso-asesor'

export const runtime = 'nodejs'
export async function POST(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Origen inválido.' }, { status: 403 })
  }
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) return NextResponse.json({ error: 'Formato inválido.' }, { status: 415 })
  if (Number(request.headers.get('content-length')) > MAX_SOLICITUD) return NextResponse.json({ error: 'La solicitud supera 4 MB.' }, { status: 413 })
  // Se cuenta el cuerpo real: no confiar únicamente en Content-Length.
  const reader = request.body?.getReader()
  if (!reader) return NextResponse.json({ error: 'Solicitud vacía.' }, { status: 400 })
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_SOLICITUD) {
      await reader.cancel()
      return NextResponse.json({ error: 'La solicitud supera 4 MB.' }, { status: 413 })
    }
    chunks.push(value)
  }
  let form: FormData
  try {
    form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': request.headers.get('content-type')! } }).formData()
  } catch { return NextResponse.json({ error: 'Formulario inválido.' }, { status: 400 }) }
  const db = createServiceRoleClient()
  try {
    const ip = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'
    const secreto = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
    if (!secreto) throw new Error('El formulario no está configurado.')
    const clave = createHmac('sha256', secreto).update(ip.trim()).digest('hex')
    const resultado = await recibirInscripcion(db, form, clave)
    if (resultado.nuevo) after(async () => {
      try { await avisarInscripcion(db, resultado.id) }
      catch { console.error('[inscripcion] Falló aviso al asesor; solicitud conservada:', resultado.id) }
    })
    return NextResponse.json({ id: resultado.id, message: 'Solicitud recibida. Coordinación revisará tus documentos y pago.' }, {
      status: 200, headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No pudimos enviar tu solicitud.' }, { status: error instanceof LimiteInscripcion ? 429 : 400 })
  }
}
