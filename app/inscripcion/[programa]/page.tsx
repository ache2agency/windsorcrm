import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { esPrograma, TITULOS } from '@/lib/inscripcion/config'
import FormularioInscripcion from './FormularioInscripcion'

export const metadata: Metadata = { title: 'Solicitud de inscripción · Windsor', robots: { index: false, follow: false }, referrer: 'no-referrer' }
export default async function InscripcionPage({ params }: { params: Promise<{ programa: string }> }) {
  const { programa } = await params
  if (!esPrograma(programa)) notFound()
  return <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px', background: '#fff', color: '#182230', minHeight: '100vh' }}>
    <p style={{ color: '#835711', fontWeight: 700 }}>INSTITUTO WINDSOR</p>
    <h1 style={{ fontSize: 30, margin: '12px 0' }}>Solicitud de inscripción · {TITULOS[programa]}</h1>
    <p>Completa tus datos y adjunta tus documentos. No necesitas una cuenta de Google. Coordinación revisará tu solicitud y tu comprobante de pago.</p>
    <FormularioInscripcion programa={programa} />
  </main>
}
