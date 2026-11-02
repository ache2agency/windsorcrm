'use client'
import {useEffect,useState} from 'react'
import {PASOS} from '@/lib/whatsapp/ruta'
import {textoPersona} from '@/lib/whatsapp/canalizacion'
export default function RutaManual({leadId}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[mensaje,setMensaje]=useState(''),[busy,setBusy]=useState(false)
  const [accion,setAccion]=useState('canalizar'),[paso,setPaso]=useState(''),[a,setA]=useState('coordinación'),[hasta,setHasta]=useState(''),[motivo,setMotivo]=useState('')
  async function cargar(signal) {
    const res=await fetch(`/api/leads/${leadId}/ruta`,{cache:'no-store',signal}),body=await res.json()
    if(!res.ok) throw Error(body.error||'No pudimos cargar la ruta')
    setData(body)
  }
  useEffect(()=>{if(!leadId)return;const c=new AbortController();setData(null);setError('');cargar(c.signal).catch(e=>{if(e.name!=='AbortError')setError(e.message)});return()=>c.abort()},[leadId])
  async function guardar(e) {
    e.preventDefault();setBusy(true);setError('');setMensaje('')
    try {
      const res=await fetch(`/api/leads/${leadId}/ruta`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion,version:data.lead.ruta_version,motivo,paso:accion==='paso'?Number(paso):null,a:accion==='canalizar'?a:null,hasta:accion==='canalizar'?new Date(hasta+'-06:00').toISOString():null})}),body=await res.json()
      if(!res.ok) throw Error(body.error||'No se pudo guardar')
      await cargar();setMensaje('Ruta guardada con auditoría. No se envió ningún mensaje.');setMotivo('')
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  if(!leadId) return null
  const p=data?.lead.ruta?.persona,vencido=typeof p==='object'&&p?.hasta&&Date.parse(p.hasta)<=Date.now()
  return <details style={{margin:'12px 0',padding:10,border:'1px solid #cbd5e1',borderRadius:8,fontSize:12}}>
    <summary style={{cursor:'pointer',fontWeight:600,color:vencido?'#A8263C':undefined}}>{vencido?'⚠ Canalización vencida: contactar':'Editar paso o canalización'}</summary>
    {error&&<p role="alert">{error}</p>}{mensaje&&<p role="status">{mensaje}</p>}
    {data&&<><p>Paso {data.lead.paso}/17 · {textoPersona(data.lead)||'Sin canalización activa'}</p>
      {data.puedeEditar?<form onSubmit={guardar} style={{display:'grid',gap:8}}>
        <label>Acción <select value={accion} onChange={e=>setAccion(e.target.value)}><option value="canalizar">Canalizar con fecha</option><option value="paso">Confirmar paso manualmente</option><option value="retomar">Retirar marca de persona</option></select></label>
        {accion==='paso'&&<label>Paso confirmado <select required value={paso} onChange={e=>setPaso(e.target.value)}><option value="">Selecciona…</option>{PASOS.filter(p=>p.n>=data.lead.paso&&p.n<=16).map(p=><option key={p.n} value={p.n}>{p.n}. {p.nombre}</option>)}</select></label>}
        {accion==='canalizar'&&<><label>A quién <input required minLength={2} maxLength={120} value={a} onChange={e=>setA(e.target.value)}/></label><label>Fecha y hora (Ciudad de México) <input required type="datetime-local" value={hasta} onChange={e=>setHasta(e.target.value)}/></label></>}
        <label>Motivo / evidencia <textarea required minLength={5} maxLength={500} value={motivo} onChange={e=>setMotivo(e.target.value)}/></label>
        <p>Los pasos intermedios pendientes se registran como saltados con este motivo. Inscrito y Perdido se confirman con sus controles habituales. Retirar la marca no cambia un modo humano activo.</p>
        <button disabled={busy} type="submit">{busy?'Guardando…':'Guardar cambio'}</button>
      </form>:<p>Solo administración o el asesor asignado pueden editar.</p>}
      <p>Últimos cambios (autor y motivo)</p><ul>{data.eventos?.map(ev=><li key={ev.version}>{new Date(ev.created_at).toLocaleString('es-MX')} · {ev.autor||ev.actor_id||'Automático'} · {ev.fuente}</li>)}</ul>
    </>}
  </details>
}
