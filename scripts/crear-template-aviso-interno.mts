// Harold lo ejecuta: por defecto solo muestra el payload. Nunca manda mensajes.
import { getMetaConfig } from '../lib/whatsapp/provider'
const body = { name: 'windsor_aviso_interno', category: 'UTILITY', language: 'es_MX',
 components: [{ type: 'BODY', text: 'Aviso CRM Windsor: {{1}}. Lead: {{2}} – {{3}}. Revísalo en crm.windsor.edu.mx',
 example: { body_text: [['Consulta administrativa pendiente', 'Contacto de prueba', 'Consulta pendiente']] } }] }
if (!process.argv.includes('--apply')) console.log(JSON.stringify(body, null, 2))
else {
 const { accessToken, businessAccountId } = getMetaConfig()
 if (!accessToken || !businessAccountId) throw new Error('Faltan credenciales Meta')
 const res = await fetch(`https://graph.facebook.com/v23.0/${businessAccountId}/message_templates`, {
 method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
 if (!res.ok) throw new Error(`Meta rechazó el alta: ${res.status}`)
 console.log(JSON.stringify(await res.json()))
}
