import { DATOS_DIPLOMADOS, CALENDARIO_INICIO_DIPLOMADOS } from './reglasNegocio'
import { urlPlanDiplomado } from './planesDiplomado'
import { PROGRAMAS_DIPLOMADO, ALIAS_DIPLOMADO, normDiplomado } from './programas'
export function fichaDiplomado(curso:string,ahora=new Date()):string|null {
  const n=normDiplomado(curso.replace(/^diplomado\s+(?:en\s+)?/i,''))
  const nombre=PROGRAMAS_DIPLOMADO.find(p=>normDiplomado(p)===n)||ALIAS_DIPLOMADO.find(([p])=>normDiplomado(p)===n)?.[1]
  const pdf=nombre&&urlPlanDiplomado(nombre)
  if(!nombre||!pdf) return null
  const hoy=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(ahora)
  const meses=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const proxima=CALENDARIO_INICIO_DIPLOMADOS.split('; ').find(f=>{
    const m=f.match(/(\d+) de (\w+) de (\d{4})/);return m&&`${m[3]}-${String(meses.indexOf(m[2])+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`>=hoy
  })
  const promo=hoy<='2026-11-30'?`\n${DATOS_DIPLOMADOS.promocionVigente}`:''
  return `*Diplomado en ${nombre}*\n\n100% en línea, con clases en vivo los miércoles de 7:00 a 9:00 p.m. (hora del centro de México).\nDuración: ${DATOS_DIPLOMADOS.duracion}\nPróximo grupo: ${proxima||'fecha por confirmar'}. Puedes inscribirte hasta el día de inicio.\n\n${DATOS_DIPLOMADOS.inversionRegular}${promo}\n\n¿No puedes los miércoles? También existe modalidad individual en el horario que elijas; consulta sus condiciones vigentes.\n\n${DATOS_DIPLOMADOS.aval}\n\n📄 Plan de estudios:\n${pdf}`
}
