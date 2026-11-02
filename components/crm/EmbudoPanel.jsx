"use client";
import { calcularEmbudo } from '@/lib/crm/embudo';
import { useMemo } from 'react';
export default function EmbudoPanel({leads}) {
  const datos=useMemo(()=>calcularEmbudo(leads),[leads]);
  return <div style={{fontFamily:'DM Mono,monospace',fontSize:12}}>
    <h2 style={{fontFamily:'Bebas Neue,sans-serif',color:'#2C4A8C'}}>CONVERSIÓN DEL EMBUDO</h2>
    <p>{datos.total} leads · Los filtros de programa, origen y asesor se aplican a este reporte.</p>
    <p>Los saltos no cuentan como pasos cumplidos. Fechas históricas desconocidas quedan fuera del promedio. Las semanas incompletas aún pueden cambiar.</p>
    <div style={{overflowX:'auto'}}><table style={{width:'100%',minWidth:600,textAlign:'left',borderSpacing:8}}><thead><tr><th>Paso</th><th>Leads</th><th>% entrada</th><th>Horas desde anterior (muestra)</th><th>Archivados aquí</th><th>Perdidos aquí</th></tr></thead><tbody>{datos.pasos.map(p=><tr key={p.n}><td>{p.n}. {p.nombre}</td><td>{p.total}</td><td><div style={{background:'#eef2fb',width:100}}><div style={{width:`${p.porcentaje}%`,background:'#2C4A8C',height:4}}/></div>{p.porcentaje.toFixed(1)}%</td><td>{p.horas===null?'Sin datos':`${p.horas.toFixed(1)} h (${p.muestra})`}</td><td>{p.archivados}</td><td>{p.perdidos}</td></tr>)}</tbody></table></div>
    <h3>Conversión por semana de entrada</h3><p>Inscripción a 30/60 días: fecha de confirmación humana dentro de la ventana desde entrada. “Sin fecha” indica inscritos históricos cuyo cierre no puede atribuirse a 30/60 días.</p>
    <div style={{overflowX:'auto'}}><table style={{width:'100%',minWidth:600,textAlign:'left',borderSpacing:8}}><thead><tr><th>Semana</th><th>Entraron</th><th>A 30 días</th><th>A 60 días</th></tr></thead><tbody>{datos.cohortes.map(c=><tr key={c.semana}><td>{c.semana}</td><td>{c.total}</td>{c.ventanas.map(v=><td key={v.dias}>{v.porcentaje===null?'Pendiente':`${v.porcentaje.toFixed(1)}% (${v.inscritos}/${v.elegibles})`}{!v.completa?' · semana inmadura':''}{v.sinFecha?` · ${v.sinFecha} sin fecha`:''}</td>)}</tr>)}</tbody></table></div>
  </div>
}
