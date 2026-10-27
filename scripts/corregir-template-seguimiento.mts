// Alta/edición NO automática. Sin --apply muestra la propuesta local, sin red.
// Harold puede ejecutar con --apply para corregir el BODY de Meta tras revisarlo.
// Nunca envía mensajes ni crea templates nuevos.
import { getMetaConfig } from '../lib/whatsapp/provider'
import { TEMPLATES_APROBADOS } from '../lib/whatsapp/templates-aprobados'
import { corregirComillaSeguimiento } from '../lib/whatsapp/template-correcciones'
const esperado = TEMPLATES_APROBADOS.find(t => t.name === 'seguimiento_general')!.body
if (!process.argv.includes('--apply')) console.log(JSON.stringify({ name: 'seguimiento_general', language: 'es_MX', body_propuesto: esperado, aplica: false }, null, 2))
else {
  const { accessToken, businessAccountId } = getMetaConfig()
  if (!accessToken || !businessAccountId) throw new Error('Falta configuración Meta')
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  const res = await fetch(`https://graph.facebook.com/v23.0/${businessAccountId}/message_templates?name=seguimiento_general&fields=id,name,language,status,components`, { headers })
  if (!res.ok) throw new Error(`No se pudo leer template: HTTP ${res.status}`)
  const json = await res.json()
  const template = json.data?.find((t: { name: string; language: string; status: string }) => t.name === 'seguimiento_general' && t.language === 'es_MX' && t.status === 'APPROVED')
  if (!template) throw new Error('No existe seguimiento_general aprobado en es_MX')
  let cambiado = false
  const components = template.components.map((c: { type: string; text?: string }) => {
    if (c.type !== 'BODY' || !c.text) return c
    const text = corregirComillaSeguimiento(c.text)
    cambiado ||= text !== c.text
    return { ...c, text }
  })
  if (!cambiado) console.log('Sin cambios: no se encontró la comilla sobrante conocida.')
  else {
    const edit = await fetch(`https://graph.facebook.com/v23.0/${template.id}`, { method: 'POST', headers, body: JSON.stringify({ components }) })
    if (!edit.ok) throw new Error(`Meta rechazó la edición: HTTP ${edit.status}`)
    console.log('Corrección enviada a Meta. Revisar estado/aprobación antes de usarla.')
  }
}
