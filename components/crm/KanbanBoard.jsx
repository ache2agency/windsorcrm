"use client";
import { useState } from 'react';
import { BLOQUES, PASOS, bloqueDe, siguientePaso, preguntaPendiente } from '@/lib/whatsapp/ruta';

const FbIcon = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.253h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>;
const fecha = s => s ? new Date(s).toLocaleString('es-MX',{timeZone:'America/Mexico_City',dateStyle:'medium'}) : 'Fecha histórica desconocida';
const tag={fontSize:10,padding:'3px 5px',borderRadius:4,background:'#eef2fb',color:'#2C4A8C'};
export default function KanbanBoard({leads=[],formatPeso,setSelectedLead,getNombreVendedor,goToConversation,hasConversation}) {
  const [vista,setVista]=useState('activos'),[paso,setPaso]=useState(''),[rutaLead,setRutaLead]=useState(null),[limites,setLimites]=useState({});
  const visibles=leads.filter(l=>String(l.whatsapp||'').replace(/\D/g,'').replace(/^521(?=\d{10}$)/,'52')!=='527474722466' && l.ruta && l.ruta.salida!=='vacante' && (vista==='activos'?!l.ruta.salida&&l.paso!==17:vista==='inscritos'?l.paso===17:l.ruta.salida===vista));
  return <>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
      {['activos','inscritos','archivado','perdido'].map(v=><button className="btn" key={v} onClick={()=>setVista(v)} aria-pressed={vista===v} style={{background:vista===v?'#2C4A8C':'white',color:vista===v?'white':'#2C4A8C'}}>{v}</button>)}
      <select className="select" aria-label="Filtrar por paso" value={paso} onChange={e=>setPaso(e.target.value)}><option value="">Todos los pasos</option>{PASOS.map(p=><option key={p.n} value={p.n}>{p.n}. {p.nombre}</option>)}</select>
      <span style={{fontSize:11}}>Ruta automática · solo lectura · {visibles.length} leads</span>
      {leads.some(l=>!l.ruta)&&<span role="alert">Hay leads sin ruta; falta aplicar la migración.</span>}
    </div>
    <div style={{display:'flex',gap:14,paddingBottom:8,minWidth:'max-content'}}>
      {(vista==='inscritos'?BLOQUES.filter(b=>b.pasos.includes(17)):BLOQUES.filter(b=>!b.pasos.includes(17))).map(b=>{
        const items=visibles.filter(l=>b.pasos.includes(l.paso)&&(!paso||l.paso===Number(paso))).sort((a,c)=>a.paso-c.paso||String(c.paso_desde).localeCompare(String(a.paso_desde)));
        const limite=limites[b.nombre]||40;
        return <section key={b.nombre} style={{minWidth:232,flex:'0 0 232px'}}>
          <div style={{display:'flex',justifyContent:'space-between',padding:'10px 12px',background:b.bg,borderRadius:8,border:`1px solid ${b.color}22`,marginBottom:10}}>
            <div><div style={{fontSize:12,color:b.color,fontWeight:500}}>{b.nombre}</div><div style={{fontSize:10,color:'#555'}}>{formatPeso(items.reduce((a,l)=>a+(l.valor||0),0))}</div></div><span style={{color:b.color}}>{items.length}</span>
          </div>
          <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:10}}>{b.pasos.map(n=><button key={n} onClick={()=>setPaso(paso===String(n)?'':String(n))} style={{...tag,border:'1px solid #e2e8f0',cursor:'pointer'}}>{n}. {PASOS[n-1].nombre}</button>)}</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>{items.slice(0,limite).map(l=>{
            const dias=Math.floor((Date.now()-Date.parse(l.paso_desde||l.created_at))/86400000),atorado=dias>=3&&l.paso!==17&&!l.ruta.salida;
            return <article key={l.id} className="card" onClick={()=>setSelectedLead(l)} style={{padding:12,borderColor:atorado?'#A8263C':undefined}}>
              <div style={{fontSize:13,fontWeight:700,color:'#111'}}>{l.nombre||l.whatsapp} <span style={{fontSize:11}}>{l.origen==='meta_ads'?<FbIcon/>:l.origen==='bot'?'🤖':'👤'}</span></div>
              <div style={{fontSize:10,color:'#555',marginTop:3}}>{l.whatsapp}</div><div style={{fontSize:10,color:'#555',margin:'4px 0 8px'}}>{l.curso}</div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11}}><b style={{color:b.color}}>{formatPeso(l.valor)}</b><span>{getNombreVendedor(l.asignado_a)}</span></div>
              <div style={{fontSize:10,color:'#777',marginTop:5}}>Entró: {fecha(l.created_at)}<br/>Últ. actividad: {fecha(l.ultima_actividad_at||l.updated_at||l.created_at)}</div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:b.color,marginTop:8}}><span>{b.nombre} › {l.paso}. {PASOS[l.paso-1]?.nombre}</span><span>{l.paso}/17</span></div>
              <div aria-label={`${l.paso} de 17`} style={{display:'flex',gap:2,margin:'5px 0'}}>{PASOS.map(p=><i key={p.n} title={`${p.nombre}: ${l.ruta.pasos[p.n]?.estado||'pendiente'}`} style={{height:5,flex:1,background:l.ruta.pasos[p.n]?.estado==='cumplido'?b.color:l.ruta.pasos[p.n]?.estado==='saltado'?'repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1 2px,#fff 2px,#fff 4px)':'#e2e8f0'}}/>)}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                {l.ruta.persona&&<span style={{...tag,background:'#fef3c7'}}>👤 lo atiende una persona · {l.ruta.persona.includes('histórica')?l.ruta.persona:fecha(l.ruta.persona)}</span>}
                {atorado&&<span style={{...tag,color:'#A8263C',background:'#fee2e8'}}>🔴 atorado {dias} días</span>}
                {l.edad&&<span style={tag}>{l.edad} años</span>}
                {l.ruta.dudas?.length>0&&<span style={tag}>Dudas: {l.ruta.dudas.join(', ')}</span>}
              </div>
              {l.notas&&<div style={{fontSize:10,color:'#666',borderTop:'1px solid #222',paddingTop:6,marginTop:8}}>{l.notas.slice(0,60)}{l.notas.length>60?'…':''}</div>}
              <div style={{display:'flex',gap:6,marginTop:8}}>{hasConversation(l)&&<button onClick={e=>{e.stopPropagation();goToConversation(l)}} style={{...tag,flex:1,border:'1px solid #25D36633',background:'#e8f5e9',color:'#128C7E',cursor:'pointer'}}>💬 Conversación</button>}<button onClick={e=>{e.stopPropagation();setRutaLead(l)}} style={{...tag,flex:1,border:'1px solid #2C4A8C33',cursor:'pointer'}}>📋 Ver ruta</button></div>
            </article>
          })}{items.length===0&&<div style={{textAlign:'center',padding:20,fontSize:11}}>vacío</div>}
          {items.length>limite&&<button className="btn" onClick={()=>setLimites({...limites,[b.nombre]:limite+40})}>Ver más ({items.length-limite})</button>}</div>
        </section>
      })}
    </div>
    {rutaLead&&<div role="presentation" onClick={()=>setRutaLead(null)} style={{position:'fixed',inset:0,zIndex:100,background:'#0f172a88',display:'flex',alignItems:'center',justifyContent:'center',padding:12}}>
      <div role="dialog" aria-modal="true" aria-label="Ruta del lead" onClick={e=>e.stopPropagation()} style={{background:'white',borderRadius:14,maxWidth:520,width:'100%',maxHeight:'90vh',overflowY:'auto',fontFamily:'DM Mono,monospace'}}>
        <div style={{position:'sticky',top:0,background:'#2C4A8C',padding:16,color:'white'}}><button aria-label="Cerrar ruta" onClick={()=>setRutaLead(null)} style={{float:'right',cursor:'pointer'}}>✕</button><b>{rutaLead.nombre||rutaLead.whatsapp}</b><div style={{fontSize:11}}>{rutaLead.whatsapp} · {rutaLead.curso}</div></div>
        <div style={{padding:16,fontSize:12}}><div style={{background:'#eef2fb',padding:10,borderRadius:8}}>Siguiente: {preguntaPendiente(rutaLead.ruta,rutaLead)}</div>
          {PASOS.map(p=>{const estado=rutaLead.ruta.pasos[p.n];return <div key={p.n} style={{padding:'8px 0',borderBottom:'1px dashed #e2e8f0',color:p.n===rutaLead.paso?bloqueDe(p.n).color:'#444'}}><b>{estado?.estado==='cumplido'?'✅':estado?.estado==='saltado'?'⏭️':'⏳'} {p.n}. {p.nombre}{p.n===rutaLead.paso?' ← aquí va':''}</b><div style={{fontSize:10,color:'#64748b'}}>{p.descripcion}<br/>{estado?`${fecha(estado.fecha)} · ${estado.fuente}${estado.motivo?` · ${estado.motivo}`:''}`:'Pendiente'}</div></div>})}
        </div>
      </div>
    </div>}
  </>
}
