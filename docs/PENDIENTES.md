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
- [x] Crear un panel manual de **Reactivaciones sugeridas** para revisar, editar, enviar o descartar registros de `mensajes_pendientes`; no automatizar envíos antes de validar textos y proveedor — **hecho 2026-09-03:** ya no admite texto libre, obliga a elegir uno de los templates aprobados por Meta (preview de solo lectura), sin auto-envío. Desplegado.

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
- **Panel de Reactivaciones sugeridas — hecho (2026-09-03):** ya no admite texto libre; obliga a elegir uno de los templates aprobados por Meta (preview de solo lectura, sin auto-envío). Además se agregaron filtros por Fuente y por Oferta educativa (desglosado por programa) en Kanban/Lista, y se resolvió el bloqueante de `META_WHATSAPP_BUSINESS_ACCOUNT_ID` faltante en Vercel. Detalle completo en `PROYECTOS.md` (carpeta madre) → sesión 2026-09-03.
- **Campaña `lic_mkt` (2026-09-03):** nuevo template de Meta para sondear interés en abrir grupo de Relaciones Públicas y Mercadotecnia, enviado a 32/33 leads del programa (excluido 1 que canceló inscripción). Script: `scripts/campana-lic-mkt.mjs`.
- [ ] **Campaña `windsor_nuevo_ciclo` — EN CURSO, día 1 de 6 (2026-09-04):** template aprobado por Meta y **50/2,119 ya enviados** (4% de respuesta hasta ahora — muestra chica, checar de nuevo tras 24-48h). Reactiva a TODOS los leads con WhatsApp (texto genérico a propósito), excluyendo `inscrito`/`perdido`/`cerrado` (`cerrado` = nombre legacy de `inscrito`, ver `LEGACY_STAGE_MAP` en `app/crm.jsx`) y RR.PP./Mercadotecnia (ya contactados con `lic_mkt`). Texto: "Hola {{1}} 👋 Se acerca el nuevo ciclo escolar en Instituto Windsor y tenemos promociones vigentes para ti. Por favor, selecciona una opción." Botones: "Me quiero inscribir" / "Tengo dudas" / "Quizás más adelante" / "Ya no me interesa" (Meta sí permite >3 Quick Reply tipo Custom). Auto-clasificación en el webhook (buscar "windsor_nuevo_ciclo" y "seguimiento_general"): → `inscripcion_pendiente` / `tercer_contacto` / `archivado` / `perdido` respectivamente. Al enviar, el script mueve el lead a `promocion_enviada`.
  - **Ritmo acordado — conservador, exponencial:** Día 1: 50 ✅ | Día 2: 100 | Día 3: 200 | Día 4: 400 | Día 5: 800 | Día 6: resto (~569). Comando: `node --env-file=.env.local scripts/campana-ciclo-escolar.mjs --send --limit=100` (subir el número cada día).
  - **Próximo paso al retomar:** lanzar el lote de 100 (día 2), y volver a medir tasa de respuesta con las 24h completas del día 1.
- **Bug encontrado y corregido (2026-09-04) — leads de "verano" recibían inscripción a My Best Summer ya cerrado:** al decir "quiero inscribirme"/"quiero apartar mi lugar", cualquier lead con curso de verano recibía el proceso de inscripción activo a *My Best Summer 2026*, que según `reglasNegocio.ts` ya concluyó y el bot nunca debe ofrecer. Detectado vía la bandera 🚩 (lead Tania Itzel, primer caso real usando la bandera). Corregido y desplegado: `INSCRIPCION_VERANO_NINOS_MSG`/`INSCRIPCION_VERANO_ADULTOS_MSG` en `app/api/whatsapp/webhook/route.ts` ahora redirigen explícitamente al curso regular de idiomas (abierto todo el año). **Pendiente decidir:** ¿le mando yo un mensaje de corrección a Tania con la info real, o lo hace Harold? — sin resolver al cierre de sesión.
- **Bug encontrado y corregido (2026-09-04) — fase `inscripcion` repetía el checklist ante cualquier pregunta:** en Bachillerato/Diplomado/Habilidades Psicoterapéutica/Idiomas, el bot reenviaba el checklist fijo de documentos sin importar qué preguntara el lead después (caso real: Naomi Yamileth Dimas Arcos preguntó por horarios y recibió el checklist de nuevo). Corregido con el mismo escape "si parece pregunta → cae a GPT" que ya usaba `inscripcion_pendiente`. Desplegado.
- **Bandera 🚩 de mensajes con error — ahora persistente (2026-09-04):** antes vivía solo en memoria del navegador (`useState`), se perdía al refrescar. Migración `supabase/migration_mensajes_marcado_error.sql` corrida, columna `marcado_error`/`marcado_error_at` en `whatsapp_mensajes`. Al marcar un mensaje en CONVERSACIONES queda guardado y consultable — es el mecanismo para que Harold reporte bugs del bot y Claude los revise después (así se encontró el bug de "verano"/My Best Summer arriba).
- **Respuestas rápidas de horarios agregadas (2026-09-04):** grupo "Horarios" en CONVERSACIONES → ⚡, con datos exactos de `reglasNegocio.ts` (Inglés adultos/niños, Italiano, Licenciaturas, Bachillerato matutino). Francés y Bachillerato vespertino derivan a asesor por no tener horario confirmado en la base de conocimiento.

*Última actualización (2026-09-04): campaña `windsor_nuevo_ciclo` en curso (50/2,119 enviados, día 1 de 6), 2 bugs reales del bot corregidos y desplegados (verano/My Best Summer, checklist repetido), bandera de error persistente, y respuestas rápidas de horarios agregadas.*
