# Pendientes – Windsor CRM

Documento para anotar lo que queda por hacer y los errores a resolver. Actualizar al cerrar cada sesión.

---

## Pendiente (próxima sesión)

### **Bot WhatsApp — Siguiente paso inmediato**
- [ ] Probar flujo completo en LAB: saludo → catálogo → correo → info → CTA A/B → inscripción/clase prueba
- [ ] Probar fase `asesor`: pedir día/hora → capturar teléfono → confirmar llamada
- [ ] Verificar que `info_enviada` da información correcta del programa elegido desde la BASE
- [ ] Agregar **fechas de inicio** de cada programa a la BASE (RAG)
- [ ] Definir y cargar el prompt maestro del bot desde la pestaña `BOT` en el CRM
- [ ] Probar bot en producción (WhatsApp real) con el flujo completo
- [ ] Probar etiquetas claras de fases en UI, sin cambiar el flujo del bot: `accion` = "Información enviada · esperando decisión", `cerrado` = "Flujo del bot finalizado", `seguimiento` = "Pendiente de retomar"
- [ ] Diseñar el relevo humano → bot: al volver a BOT, elegir fase de reanudación (dudas, siguiente paso, inscripción o cerrar), sin inferirla por cada mensaje humano
- [ ] Crear un panel manual de **Reactivaciones sugeridas** para revisar, editar, enviar o descartar registros de `mensajes_pendientes`; no automatizar envíos antes de validar textos y proveedor

### **Técnico / Producto**
- [ ] Ejecutar Fase 1 y Fase 2 de `docs/IMPLEMENTACION_ESCUELA.md`
- [ ] Revisar manualmente el CRM con `docs/CRM_QA_CHECKLIST.md`
- [ ] Diseñar la evolución de `FLOWS` a un constructor visual tipo canvas
- [ ] Validar en uso real la sincronía completa `lead.stage` ↔ `whatsapp_conversaciones.fase`
- [ ] Integrar al CRM el envío de template inicial para leads `walkin`
- [ ] Terminar activación de Meta Cloud API en producción
  - **Sesión 2026-05-20 — avance:**
  - ✅ Webhook verificado: `https://crm.windsor.edu.mx/api/whatsapp/webhook` responde correctamente
  - ✅ `WHATSAPP_PROVIDER=meta` activado en Vercel y desplegado
  - ✅ `META_WHATSAPP_VERIFY_TOKEN=windsor-waba-2026` configurado
  - ✅ `META_PHONE_NUMBER_ID=1049147001613376` configurado
  - ✅ `META_WHATSAPP_TOKEN` actualizado con token permanente (usuario del sistema)
  - ✅ Webhook fields: `messages` suscrito en Meta Developer Portal
  - ⏳ **ESPERANDO RESPUESTA DE META SUPPORT:** caso abierto en Direct Support (Dev: Phone Number & Registration) el 2026-05-20. Esperando que reseteen el contador de verificación.
  - ⏳ **Siguiente paso:** esperar ~30 min y solicitar código por llamada de voz con:
    `TOKEN=$(cat salescrm/tokenMeta.txt) && curl -X POST "https://graph.facebook.com/v20.0/1049147001613376/request_code" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"code_method": "VOICE", "language": "es"}'`
  - ⏳ Luego registrar con: `curl -X POST "https://graph.facebook.com/v20.0/1049147001613376/register" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"messaging_product": "whatsapp", "pin": "CODIGO"}'`
  - ✅ `tokenMeta.txt` protegido en `.gitignore` — se queda como respaldo local
- [ ] Correr migración de `lead_activities` en Supabase y validar que el historial persista entre sesiones
- [ ] Afinar el guardado de notas del lead para registrar un solo evento al guardar/blurear, no por cada tecla

### **Mobile / UX — Revisión pendiente**
- [ ] Probar el CRM completo en iPhone/Android después de los cambios responsive y de rendimiento del 2026-08-28
- [ ] Validar en celular: Kanban sin rebote horizontal, filtros sin desbordamiento y tabla LISTA con scroll horizontal táctil
- [ ] Validar en celular una cuenta con muchas conversaciones: scroll fluido, abrir → volver → reabrir el mismo chat y llegada de mensajes nuevos sin parpadeo
- [ ] Aplicar/verificar `supabase/migration_conversaciones_visto.sql` en producción y comprobar que el punto verde solo aparece cuando el último mensaje es del prospecto
- [ ] Verificar que el menú hamburguesa se cierra al hacer scroll o al tocar fuera
- [ ] Revisar que las demás vistas (KANBAN, LISTA, AGENDA, BASE, FLOWS, BOT) se ven bien en móvil — sólo se ajustaron STATS, LAB BOT, modales y CONVERSACIONES por ahora

---

## Pendientes Marketing

### **Inmediato (Esta semana)**
- [ ] Configurar IDs reales de analytics (GA4, Meta Pixel, Hotjar)
- [ ] Lanzar primera campaña de LinkedIn Ads ($200)
- [ ] Setup email sequences en Resend
- [ ] Agendar primeras 5 demos con prospects
- [ ] Testear landing page con tráfico real

### **Corto Plazo (Próximo mes)**
- [ ] Escalar campañas a $1,000/mes
- [ ] Crear primer case study real
- [ ] Lanzar webinar mensual
- [ ] Optimizar landing page basado en datos
- [ ] Implementar programa de referidos

### **Mediano Plazo (Próximos 3 meses)**
- [ ] Expandir a Colombia y Argentina
- [ ] Crear mobile app (iOS/Android)
- [ ] Implementar advanced reporting
- [ ] Alcanzar $10,000 MRR
- [ ] Certificaciones SOC 2

---

## Pendientes Técnicos

- **Secuencia de la plática:** ver `docs/FLUJO_BOT_WHATSAPP.md` (fases, mensajes del bot, qué espera en cada paso y sincronía con el CRM).
- **Twilio productivo:** ya no se usa sandbox; el número oficial `+5217474785589` está activo en producción.
- **Migración a Meta:** el código ya acepta `WHATSAPP_PROVIDER=meta` y el webhook soporta verificación `GET` + eventos de mensajes de WhatsApp Cloud API.
- **QA operativo:** usar `npm run crm:check` antes de cerrar cambios importantes.
- **Ruta de implementacion:** seguir `docs/IMPLEMENTACION_ESCUELA.md` para preparar el despliegue real en la escuela.

---

## Hecho (referencia rápida)

- **Flujo bot simulado y definido (2026-03-30):** saludo → programa (catálogo hardcodeado) → correo → info_enviada (RAG) → accion (CTA A/B) → dudas/inscripcion/clase_prueba. Mensajes hardcodeados: catálogo, inscripción lics, clase de prueba. Fase asesor con planteles, horarios y captura de teléfono. Interceptor para bloquear que GPT genere el catálogo por su cuenta.
- **Flujo del bot WhatsApp por fases:** saludo → programa → correo → info_enviada → dudas → accion → cerrado/perdido. Se actualiza `fase` y lead (stage, nombre, email, curso).
- **Twilio productivo activo:** sender oficial `Instituto Windsor` en línea con webhook apuntando a `https://crm.windsor.edu.mx/api/whatsapp/webhook`.
- **Separar oferta educativa:** Solo programas de *idiomas* (niños/adultos) ofrecen clase de prueba; el resto ofrece llamada o inscripción. Config en webhook (`tieneClasePrueba`) y CTA distinto según programa (link agendar vs contacto).
- **Sync pipeline CRM ↔ fase WhatsApp:** Al avanzar en WhatsApp se actualiza el stage del lead y al mover etapas en CRM también se empuja una fase coherente a la conversación ligada.
- **RLS y panel CONVERSACIONES:** Contestar, Tomar control y Volver a BOT funcionando (variables Twilio en Vercel; modo humano = el bot no responde hasta "Volver a BOT").
- Memoria del bot: contexto del lead se envía a RAG en cada mensaje.
- Modo humano: "Tomar control" / "Volver a BOT" y cuadro para responder como vendedor en la vista CONVERSACIONES.
- Flows por palabra clave (FLOWS en CRM): reglas con match, respuesta fija o RAG; guardado en `whatsapp_flows`.
- Configuración BOT en CRM: nueva pestaña `BOT` para centralizar identidad y comportamiento del bot en `whatsapp_flows.config.bot_prompt`, sin reemplazar todavía el flujo actual.
- LAB BOT en CRM: simulador conversacional para escenarios `ads` y `walkin`, conectado a la `BASE` por RAG para probar respuestas sin afectar producción.
- LAB BOT mejorado: ya consulta la `BASE`, muestra respuestas con mejor estructura y valida mejor correos mal capturados como programa, pero todavía queda pendiente el cambio fluido entre ofertas dentro del mismo chat.
- Campo `fase` y columnas `modo_humano`, `tomado_por` en `whatsapp_conversaciones`.
- Vista de conversaciones mejorada: búsqueda, filtros, badges, lead ligado y responsable.
- Modal del lead mejorado: siguiente paso, última actividad y timeline.
- Envío directo desde modal del lead: botón `Enviar información` por API de WhatsApp, sin depender de WhatsApp Web.
- Timeline comercial persistente: nueva tabla `lead_activities` y registro de etapas, reasignación, citas y respuestas del agente.
- Agenda mejorada: validación de fecha, status operativos y paso automático a `propuesta`.
- Refactor inicial del CRM: conversaciones, agenda, lead modal, kanban, lista y modales extraídos a `components/crm/`.
- Scripts de soporte: `npm run whatsapp:check`, `npm run crm:check`.
- Checklist operativa: `docs/CRM_QA_CHECKLIST.md`.
- Compatibilidad dual de WhatsApp: envío y webhook soportan `Twilio` y `Meta Cloud API` vía `WHATSAPP_PROVIDER`.

---

- **CRM mobile-ready (2026-03-30):** viewport meta + PWA (manifest.json, iconos). Hamburger menu con dropdown `position:absolute top:100%` anclado al header. Stats 2col, LAB BOT stack vertical, modales bottom-sheet en mobile. ConversationsPanel con toggle list/chat y botón "← Conversaciones". Header limpio en mobile: oculta "CRM v1.0", badge ADMIN, reduce título a 22px.
- **UX y rendimiento móvil (2026-08-28):** se corrigió el layout forzado a ~1400 px; filtros responsivos, tabla LISTA con scroll táctil y Kanban sin scroll/rebote horizontal infinito. Se memoizaron filtros/etapas y lookups de leads. CONVERSACIONES ahora virtualiza su lista para cuentas de ~2,000 chats, permite reabrir el mismo chat en móvil y actualiza mensajes cada 8 s sin vaciar ni saltar el historial. Se agregó punto verde de no leído compartido, basado exclusivamente en el último mensaje del prospecto; migración requerida: `supabase/migration_conversaciones_visto.sql`.
- **Revisión cualitativa de 30 conversaciones (2026-08-29):** los prospectos suelen indicar el programa desde el inicio y sus preguntas reales se concentran en costos, horarios, edades, ubicación, documentos y cupo. El correo no debe ser una etapa del Kanban. Pendiente validar un flujo centrado en contactos/seguimientos (`Contacto 1–3`) y siguiente paso, sin modificar todavía el bot.
- **Respuestas rápidas e ícono PWA (2026-08-29):** en CONVERSACIONES → ⚡ se agregaron “Oferta educativa” y “Contacto y dirección”; los procesos de inscripción quedaron identificados como “Cursos libres” y “Licenciaturas (en línea)”. La burbuja del asistente subió 72 px para no cubrir el envío. El ícono instalable usa ahora el logo Windsor blanco sobre fondo azul, con rutas nuevas para evitar caché en iPhone. Cambios desplegados a producción.
- **Próximo trabajo acordado:** construir el panel manual de **Reactivaciones sugeridas** para que los asesores revisen, editen, envíen o descarten recordatorios; no automatizar el envío hasta validar los textos y el proveedor.

*Última actualización (2026-08-29): Se registraron los hallazgos de conversaciones reales, las respuestas rápidas, el ícono PWA y el siguiente experimento de reactivaciones.*
