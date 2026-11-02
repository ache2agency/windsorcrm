import { PASOS, type LeadRuta } from '../whatsapp/ruta'
export function semanaEntrada(fecha:string) {
  const mx=new Date(fecha).toLocaleDateString('en-CA',{timeZone:'America/Mexico_City'})
  const d=new Date(mx+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10)
}
export function calcularEmbudo(leads:LeadRuta[],ahora=new Date()) {
  const base=leads.filter(l=>l.ruta&&l.ruta.salida!=='vacante'&&String(l.whatsapp||'').replace(/\D/g,'').replace(/^521(?=\d{10}$)/,'52')!=='527474722466')
  const pasos=PASOS.map(p=>{
    const cumplidos=base.filter(l=>l.ruta?.pasos[p.n]?.estado==='cumplido')
    const intervalos=cumplidos.flatMap(l=>{const a=l.ruta?.pasos[p.n-1],b=l.ruta?.pasos[p.n];if(!a?.fecha||a.estado!=='cumplido'||!b?.fecha) return [];const delta=Date.parse(b.fecha)-Date.parse(a.fecha);return delta>=0?[delta/3600000]:[]})
    return {...p,total:cumplidos.length,porcentaje:base.length?100*cumplidos.length/base.length:0,horas:intervalos.length?intervalos.reduce((a,b)=>a+b,0)/intervalos.length:null,muestra:intervalos.length,
      archivados:base.filter(l=>l.paso===p.n&&l.ruta?.salida==='archivado').length,perdidos:base.filter(l=>l.paso===p.n&&l.ruta?.salida==='perdido').length}
  })
  const grupos=new Map<string,LeadRuta[]>()
  for(const l of base) if(l.created_at) {const semana=semanaEntrada(l.created_at);grupos.set(semana,[...(grupos.get(semana)||[]),l])}
  const cohortes=[...grupos].sort(([a],[b])=>a.localeCompare(b)).map(([semana,grupo])=>({semana,total:grupo.length,
    ventanas:[30,60].map(dias=>{
      const maduros=grupo.filter(l=>ahora.getTime()-Date.parse(l.created_at!)>=dias*86400000)
      const inscritos=maduros.filter(l=>{const fecha=l.ruta?.pasos[17]?.fecha;return fecha&&Date.parse(fecha)-Date.parse(l.created_at!)<=dias*86400000&&Date.parse(fecha)>=Date.parse(l.created_at!)})
      const sinFecha=maduros.filter(l=>l.ruta?.pasos[17]?.estado==='cumplido'&&!l.ruta?.pasos[17]?.fecha).length
      return {dias,elegibles:maduros.length,inscritos:inscritos.length,sinFecha,porcentaje:maduros.length?100*inscritos.length/maduros.length:null,completa:maduros.length===grupo.length}
    })}))
  return {total:base.length,pasos,cohortes}
}
