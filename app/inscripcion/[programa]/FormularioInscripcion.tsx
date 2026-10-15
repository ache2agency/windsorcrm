'use client'
import { useEffect, useState } from 'react'
import { camposPrograma, documentosPrograma, MAX_ARCHIVO, type ProgramaInscripcion } from '@/lib/inscripcion/config'

export default function FormularioInscripcion({ programa }: { programa: ProgramaInscripcion }) {
  const [initial, setInitial] = useState<Record<string, string>>({})
  const [id, setId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState('')
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    setInitial({ whatsapp: search.get('wa') || '', nombres: search.get('nombre') || '', curso: search.get('curso') || '' })
    setId(crypto.randomUUID())
    // El prellenado ya está en memoria; evita conservar datos de contacto en el historial.
    window.history.replaceState(null, '', window.location.pathname)
  }, [])
  if (success) return <section role="status" style={{ padding: 24, marginTop: 24, background: '#effaf1' }}>
    <h2>Solicitud recibida</h2><p>Gracias. Coordinación revisará tus documentos y pago; tu inscripción aún está en proceso.</p><p>Folio: {success}</p>
  </section>
  async function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true)
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/inscripcion', { method: 'POST', body: form })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'No pudimos enviar la solicitud.')
      setSuccess(result.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Revisa tu conexión e inténtalo de nuevo.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={enviar} style={{ display: 'grid', gap: 18, marginTop: 28 }}>
    <input type="hidden" name="programa" value={programa} />
    <input type="hidden" name="solicitud_id" value={id} />
    <div aria-hidden="true" style={{ display: 'none' }}><label>Sitio web<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
    {camposPrograma(programa).map(campo => <label key={campo.id} style={{ display: 'grid', gap: 6 }}>
      <span>{campo.label}{campo.required ? ' *' : ''}</span>
      {campo.options ? <select name={campo.id} required={campo.required} style={{ padding: 10, border: '1px solid #aaa', borderRadius: 6 }}>
        <option value="">Selecciona</option>{campo.options.map(o => <option key={o}>{o}</option>)}
      </select> : <input key={`${campo.id}-${initial[campo.id] || ''}`} name={campo.id} type={campo.type || 'text'} required={campo.required}
        defaultValue={initial[campo.id] || ''} maxLength={250} min={campo.type === 'number' ? 0 : undefined}
        max={campo.type === 'date' ? new Date().toISOString().slice(0, 10) : campo.type === 'number' ? 120 : undefined}
        style={{ padding: 10, border: '1px solid #aaa', borderRadius: 6, width: '100%', boxSizing: 'border-box' }} />}
    </label>)}
    <h2 style={{ fontSize: 22 }}>Documentos</h2>
    <p>PDF, JPG, PNG o HEIC. Máximo 750 KB por documento. Los campos con * son obligatorios.</p>
    {documentosPrograma(programa).map(doc => <label key={doc.id} style={{ display: 'grid', gap: 6 }}>{doc.label}{doc.required ? ' *' : ' (opcional)'}
      <input type="file" name={doc.id} required={doc.required} accept=".pdf,.jpg,.jpeg,.png,.heic" onChange={event => {
        const input = event.currentTarget
        input.setCustomValidity(input.files?.[0] && input.files[0].size > MAX_ARCHIVO ? 'El documento supera 750 KB.' : '')
        input.reportValidity()
      }} />
    </label>)}
    <p>Usaremos tus datos y documentos para tramitar tu solicitud. Solo personal autorizado de Windsor podrá revisarlos. Puedes solicitar aclaraciones a tu asesor. <a href="https://www.windsor.edu.mx" target="_blank" rel="noreferrer">Contacto Instituto Windsor</a>.</p>
    <label><input type="checkbox" name="consentimiento" value="si" required /> Autorizo el uso de mis datos para este trámite (o cuento con autorización del tutor).</label>
    {error && <p role="alert" style={{ color: '#a01616' }}>{error}</p>}
    <button type="submit" disabled={busy || !id} style={{ padding: 14, background: '#19394d', color: 'white', borderRadius: 8, cursor: 'pointer' }}>{busy ? 'Enviando…' : 'Enviar solicitud de inscripción'}</button>
  </form>
}
