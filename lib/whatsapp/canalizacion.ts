import type { LeadRuta } from './ruta'
export type PersonaProgramada = {
  desde: string; hasta?: string|null; a: string; motivo: string;
  estado: 'pendiente'|'vencida'; ultimoAcuseDia?: string; aviso24At?: string;
}
export const diaMexico=(fecha:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(fecha))
export function textoCanalizacion(p:PersonaProgramada,ahora:string):string {
  if(p.hasta && Date.parse(p.hasta)<=Date.parse(ahora)) return `Tu solicitud sigue pendiente con ${p.a}; está señalada en el CRM para seguimiento. 😊`
  if(!p.hasta) return `Tu solicitud está con ${p.a} para darle seguimiento. 😊`
  const fecha=new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(p.hasta))
  return `¡Claro! ${p.a} se comunica contigo el ${fecha} 😊`
}
export function esCertificacion(texto:string):boolean {
  const t=texto.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
  return /\btoefl\b|\bielts\b|\bb[12]\b|comprension lectora|(?:constancia|certificacion|certificado) (?:de |del |en )?ingles/.test(t)
}
export function textoPersona(lead:LeadRuta,ahora=new Date().toISOString()):string {
  const p=lead.ruta?.persona
  return typeof p==='object'&&p ? textoCanalizacion(p,ahora) : p?'Atención humana pendiente':''
}
