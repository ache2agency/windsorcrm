'use client'
import { useEffect, useState } from 'react'
import { camposPrograma, diplomadoCanonico, documentosPrograma, MAX_ARCHIVO, MAX_SOLICITUD, type ProgramaInscripcion } from '@/lib/inscripcion/config'
import { comprimirFoto } from '@/lib/inscripcion/comprimir'

export default function FormularioInscripcion({ programa }: { programa: ProgramaInscripcion }) {
  const [initial, setInitial] = useState<Record<string, string>>({})
  const [id, setId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState('')
  const [comprimiendo, setComprimiendo] = useState(0)
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const curso = search.get('curso') || ''
    setInitial({ whatsapp: search.get('wa') || '', nombres: search.get('nombre') || '', curso: programa === 'diplomados' ? diplomadoCanonico(curso) : curso })
    setId(crypto.randomUUID())
    // El prellenado ya está en memoria; evita conservar datos de contacto en el historial.
    window.history.replaceState(null, '', window.location.pathname)
  }, [programa])
  if (success) return <section role="status" style={{ padding: 24, marginTop: 24, background: '#effaf1' }}>
    <h2>Solicitud recibida</h2><p>Gracias. Coordinación revisará tus documentos y pago; tu inscripción aún está en proceso.</p><p>Folio: {success}</p>
  </section>
  async function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true)
    const form = new FormData(event.currentTarget)
    let total = 0
    for (const [, value] of form.entries()) if (value instanceof File) total += value.size
    if (total > MAX_SOLICITUD - 200 * 1024) {
      setBusy(false)
      setError('Los documentos juntos pesan más de 4 MB. Sube fotos en lugar de PDF escaneados o reduce el tamaño de los PDF.')
      return
    }
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
      {campo.options ? <select key={`${campo.id}-${initial[campo.id] || ''}`} name={campo.id} required={campo.required} defaultValue={initial[campo.id] || ''} style={{ padding: 10, border: '1px solid #aaa', borderRadius: 6 }}>
        <option value="">Selecciona</option>{campo.options.map(o => <option key={o}>{o}</option>)}
      </select> : <input key={`${campo.id}-${initial[campo.id] || ''}`} name={campo.id} type={campo.type || 'text'} required={campo.required}
        defaultValue={initial[campo.id] || ''} maxLength={250} min={campo.type === 'number' ? 0 : undefined}
        max={campo.type === 'date' ? new Date().toISOString().slice(0, 10) : campo.type === 'number' ? 120 : undefined}
        style={{ padding: 10, border: '1px solid #aaa', borderRadius: 6, width: '100%', boxSizing: 'border-box' }} />}
    </label>)}
    <h2 style={{ fontSize: 22, marginTop: 16, paddingTop: 20, borderTop: '2px solid #19394d' }}>📎 Documentos</h2>
    <p style={{ margin: 0 }}>Sube una foto o PDF de cada documento (PDF, JPG, PNG o HEIC). Las fotos se reducen solas; los PDF deben pesar máximo 1.5 MB. Los marcados con * son obligatorios.</p>
    {documentosPrograma(programa).map(doc => <label key={doc.id} style={{ display: 'grid', gap: 8, padding: 14, border: '2px dashed #8aa4b8', borderRadius: 10, background: '#f4f8fb', cursor: 'pointer' }}>
      <strong>{doc.label}{doc.required ? ' *' : ' (opcional)'}</strong>
      <input type="file" name={doc.id} required={doc.required} accept=".pdf,.jpg,.jpeg,.png,.heic" style={{ fontSize: 16 }} onChange={async event => {
        const input = event.currentTarget
        const original = input.files?.[0]
        if (original) {
          setComprimiendo(n => n + 1)
          try {
            const reducido = await comprimirFoto(original)
            if (reducido !== original) {
              const dt = new DataTransfer()
              dt.items.add(reducido)
              input.files = dt.files
            }
          } finally { setComprimiendo(n => n - 1) }
        }
        const file = input.files?.[0]
        input.setCustomValidity(file && file.size > MAX_ARCHIVO ? 'El documento supera 1.5 MB. Si es PDF, sube mejor una foto.' : '')
        input.reportValidity()
      }} />
    </label>)}
    <p>Usaremos tus datos y documentos para tramitar tu solicitud. Solo personal autorizado de Windsor podrá revisarlos. Puedes solicitar aclaraciones a tu asesor. <a href="https://www.windsor.edu.mx" target="_blank" rel="noreferrer">Contacto Instituto Windsor</a>.</p>
    <label><input type="checkbox" name="consentimiento" value="si" required /> Autorizo el uso de mis datos para este trámite (o cuento con autorización del tutor).</label>
    {error && <p role="alert" style={{ color: '#a01616' }}>{error}</p>}
    <button type="submit" disabled={busy || !id || comprimiendo > 0} style={{ padding: 14, background: '#19394d', color: 'white', borderRadius: 8, cursor: 'pointer' }}>{comprimiendo > 0 ? 'Preparando fotos…' : busy ? 'Enviando…' : 'Enviar solicitud de inscripción'}</button>
  </form>
}
