'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
type Solicitud = { programa: string; datos: Record<string, string>; documentos: { tipo: string; url: string }[] }
export default function RevisionInscripcion({ id }: { id: string }) {
  const [solicitud, setSolicitud] = useState<Solicitud | null>(null)
  const [error, setError] = useState('')
  async function cargar() {
    setError('')
    try {
      const response = await fetch(`/api/inscripciones/${id}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setSolicitud(body)
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al cargar.') }
  }
  useEffect(() => { void cargar() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  return <main style={{ maxWidth: 760, padding: 24, margin: '0 auto' }}>
    <Link href="/">← Volver al CRM</Link><h1>Solicitud de inscripción</h1>
    <p>Documentación y pago pendientes de revisión. Este envío no confirma la inscripción.</p>
    {error && <p role="alert">{error}</p>}
    {!solicitud && !error && <p>Cargando…</p>}
    {solicitud && <><h2>{solicitud.programa}</h2>
      <dl>{Object.entries(solicitud.datos).filter(([, valor]) => valor).map(([campo, valor]) => <div key={campo} style={{ marginBottom: 12 }}><dt style={{ fontWeight: 700 }}>{campo.replaceAll('_', ' ')}</dt><dd>{valor}</dd></div>)}</dl>
      <h2>Documentos</h2><p>Se abren en el Drive de Windsor (con una cuenta que tenga acceso a la carpeta).</p>
      <ul>{solicitud.documentos.map(d => <li key={d.tipo}><a href={d.url} target="_blank" rel="noreferrer">{d.tipo === 'carpeta_drive' ? 'Carpeta del alumno' : d.tipo === 'ficha_pdf' ? 'Ficha de inscripción (PDF)' : d.tipo.replaceAll('_', ' ')}</a></li>)}</ul>
    </>}
  </main>
}
