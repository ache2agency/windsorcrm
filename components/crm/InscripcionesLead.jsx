'use client'
import { useEffect, useState } from 'react'
export default function InscripcionesLead({ leadId }) {
  const [solicitudes, setSolicitudes] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/leads/${leadId}/inscripciones`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'No se pudieron cargar las inscripciones.')
        setSolicitudes(body.solicitudes || [])
      }).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    return () => controller.abort()
  }, [leadId])
  return <section style={{ margin: '16px 0' }}><h3>Solicitudes de inscripción</h3>
    {error && <p role="alert">{error}</p>}
    {solicitudes.map(s => <p key={s.id}><a href={`/inscripciones/${s.id}`} target="_blank" rel="noreferrer">Revisar {s.programa} · {new Date(s.created_at).toLocaleDateString('es-MX')}</a></p>)}
    {!error && !solicitudes.length && <p style={{ fontSize: 12, opacity: 0.7 }}>Sin solicitudes recibidas.</p>}
  </section>
}
