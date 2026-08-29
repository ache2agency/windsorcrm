## CONTEXTO DEL PROYECTO WINDSOR CRM

Este documento resume, en alto nivel, lo que se ha ido construyendo y cómo está organizado el proyecto. La idea es irlo actualizando cada día de trabajo.

### 1. Arquitectura general

- **Framework**: Next.js (App Router).
- **Backend / BaaS**: Supabase (auth, base de datos, RLS, funciones RPC).
- **UI principal**: `app/crm.jsx` (orquestación del CRM de leads).
- **Componentes del CRM extraídos**:
  - `components/crm/ConversationsPanel.jsx`
  - `components/crm/AgendaPanel.jsx`
  - `components/crm/LeadDetailModal.jsx`
  - `components/crm/KanbanBoard.jsx`
  - `components/crm/LeadsTable.jsx`
  - `components/crm/NewLeadModal.jsx`
  - `components/crm/NewAppointmentModal.jsx`
- **Base de datos principal**:
  - Tabla `leads`: gestión de leads y pipeline de ventas.
  - Tabla `profiles`: perfiles de usuario (nombre, rol).
  - Tabla `citas`: agenda de citas (clases de prueba / reuniones).
  - Tabla `lead_activities`: historial comercial persistente por lead.
  - Tabla `email_sequences`: secuencias automáticas de email.
  - Tabla `documentos`: base vectorial para RAG.
  - Tablas WhatsApp: `whatsapp_conversaciones` (incl. `fase`, `modo_humano`, `tomado_por`), `whatsapp_mensajes` (rol: usuario | bot | agente), `whatsapp_flows` (config con reglas por palabra clave).

### 2. Roles y permisos

- **Admin**:
  - Ve todos los leads.
  - Puede reasignar leads a cualquier vendedor.
  - Puede eliminar leads.
  - Ve todas las citas en la agenda (según RLS en Supabase).
  - Ve y edita la pestaña **FLOWS** (reglas del bot WhatsApp).
  - Ve todas las conversaciones de WhatsApp en **CONVERSACIONES**.
- **Vendedor**:
  - Ve solo leads asignados a él.
  - Ve solo sus citas (según RLS).
  - Ve en **CONVERSACIONES** solo las conversaciones de WhatsApp ligadas a sus leads (según RLS).

La lógica de roles se basa en el campo `rol` en `profiles` y/o metadatos de usuario en Supabase (`raw_user_meta_data.role`).

### 3. Funcionalidades principales implementadas

- **CRM de leads (`app/crm.jsx`)**:
  - Vistas: KANBAN, LISTA, AGENDA, CONVERSACIONES y (solo admin) BASE, BOT y FLOWS.
  - Kanban por etapas (`primer_contacto`, `examen_ubicacion`, `clase_muestra`, `segundo_contacto`, `promocion_enviada`, `tercer_contacto`, `inscripcion_pendiente`, `inscrito`, `perdido`, `archivado`).
  - Filtros por vendedor, búsqueda, drag & drop de etapas.
  - Modal de detalle de lead con reasignación (admin), timeline de seguimiento, siguiente paso sugerido y botón para agendar cita.
  - Desde el modal del lead existe envío directo de información por WhatsApp sin abrir WhatsApp Web; el mensaje es editable y se registra en conversación + timeline.
  - La timeline del lead mezcla el historial persistente de `lead_activities` con los últimos eventos recientes de WhatsApp y citas.

- **Conversaciones WhatsApp (vista CONVERSACIONES en `app/crm.jsx`)**:
  - Visible para todos los usuarios autenticados (admin ve todas; vendedor solo las de sus leads).
  - Lista de conversaciones con búsqueda, filtros por modo/fase y badges visuales de estado.
  - Al seleccionar una: historial de mensajes (usuario, bot, agente) y detalle ampliado del lead, fase, modo y responsable.
  - **Tomar control** / **Volver a BOT**: alternan `modo_humano` y `tomado_por` en `whatsapp_conversaciones`.
  - Cuadro para responder como vendedor (envío vía `/api/whatsapp/send` y registro en `whatsapp_mensajes` como rol `agente`).
  - Carga de conversaciones con fallback si en BD faltan columnas `modo_humano`, `fase`, `tomado_por`.

- **Flows WhatsApp (vista FLOWS, solo admin)**:
  - Editor en tabla: palabra clave (match), acción (texto fijo o RAG), texto de respuesta.
  - Guardado en `whatsapp_flows` (campo `config` con array `rules`). El webhook aplica la primera regla que coincida antes de RAG.

- **Configuración BOT (vista BOT, solo admin)**:
  - Un área editable desde el CRM para definir la identidad y comportamiento general del bot.
  - Se guarda en `whatsapp_flows.config.bot_prompt`.

- **LAB BOT (vista LAB BOT, solo admin)**:
  - Simulador conversacional para probar el bot desde el CRM sin tocar el bot productivo.
  - Soporta dos escenarios: `ads` (arranca desde cero) y `walkin` (contexto precargado).
  - Consulta la `BASE` real vía `/api/rag/query`.

- **Agenda interna (vista AGENDA en `app/crm.jsx`)**:
  - **Vista de calendario mensual** (`components/crm/AgendaPanel.jsx`): navegación mes anterior/siguiente, días con citas marcados con punto naranja, número si hay más de una.
  - Clic en día → lista de citas de ese día. Clic en cita → modal con info completa del prospecto (nombre, email, WhatsApp, curso, horario, notas, status).
  - Botón para crear nuevas citas. Cambio de status desde el modal de detalle.
  - Al crear una cita, el stage del lead se actualiza según el tipo: `clase_prueba→clase_muestra`, `examen_ubicacion→examen_ubicacion`, `inscripcion→inscripcion_pendiente`, `asesoria→segundo_contacto`.
  - Query de citas incluye: `leads(nombre, email, whatsapp, curso, notas)`.

- **Página pública de agendado (`app/agendar/[vendedor]/page.jsx`)**:
  - Pública (sin login). URL por vendedor: `/agendar/hola@windsor.edu.mx`.
  - Paso 1: Selector de tipo de alumno — **Adulto** (12+ años) o **Niño** (4-12 años).
  - Paso 2: Calendario mensual con navegación adelante/atrás (no retrocede más allá del mes actual). Encabezados de días con offset correcto. Días sin horario deshabilitados.
  - Paso 3: Bloques de horario fijos según tipo + día:
    - Adulto Lun–Vie: `10:00–12:00` · `17:00–19:00`
    - Adulto Sábado: `09:00–13:00` · `13:00–17:00`
    - Adulto Domingo: sin disponibilidad
    - Niño Mar/Mié/Jue: `13:00–14:00` · `17:00–18:00`
    - Niño Sábado: `09:00–13:00`
  - Formulario: nombre, **edad**, email, WhatsApp, notas. La edad se guarda en `notas` como `"Edad: X años\n..."`.
  - Al confirmar: crea lead con `stage: "clase_muestra"` y cita con `tipo: "clase_prueba"`, `duracion: 60`.
    4. Al confirmar:
       - Crea lead en `leads` con `stage: "interesado"` y asignado al vendedor.
       - Crea cita en `citas` con status `confirmada`.
       - Llama a `/api/emails/sequence` para iniciar secuencia de correos.

### 4. Integraciones externas

- **OpenAI (Chatbot CRM y RAG)**:
  - Variable: `OPENAI_API_KEY` en `.env.local`.
  - **Chat de CRM**:
    - Endpoint: `app/api/chat/route.ts`.
    - Modelo: `gpt-4o`.
    - Prompt de sistema: asistente comercial para Instituto Windsor.
    - Recibe `messages` y `leads` para dar recomendaciones sobre el pipeline.
  - **RAG**:
    - Tabla `documentos` con columna `embedding` (`vector(1536)`).
    - SQL función `match_documents(query_embedding vector(1536), match_count int)` para buscar por similitud.
    - Endpoint de carga: `app/api/rag/upload/route.ts`
      - Recibe texto largo (`contenido`), lo trocea en chunks de ~500 palabras.
      - Genera embeddings con `text-embedding-ada-002`.
      - Inserta `contenido` + `embedding` (como string en formato vector de PostgreSQL).
    - Endpoint de consulta: `app/api/rag/query/route.ts`
      - Genera embedding de la pregunta.
      - Llama a `match_documents` vía RPC.
      - Concatena contexto y pregunta, responde con `gpt-4o`.

- **Resend (secuencias de email)**:
  - Variables: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
  - SQL tabla: `email_sequences` (una fila por correo programado).
  - Endpoint: `app/api/emails/sequence/route.ts`
    - Recibe `lead_id`, `email`, `nombre`.
    - Crea 7 registros para días 1, 7, 14, 21, 28, 35, 42.
    - Envía el correo del día 1 inmediatamente (si hay API key).
  - Endpoint: `app/api/emails/send-pending/route.ts`
    - Calcula qué correos tocan “hoy” según `created_at + dia_envio`.
    - Envía pendientes y marca `enviado = true`.

- **WhatsApp (Twilio / Meta Cloud API)**:
  - Selector: `WHATSAPP_PROVIDER=twilio|meta`
  - Variables Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`.
  - Variables Meta: `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_VERIFY_TOKEN`, `META_WHATSAPP_BUSINESS_ACCOUNT_ID`.
  - Estado productivo actual:
    - Producción corriendo con `Twilio`
    - Número oficial activo: `+5217474785589`
    - Display name: `Instituto Windsor`
    - Webhook estable: `https://crm.windsor.edu.mx/api/whatsapp/webhook`
  - Webhook entrante: `app/api/whatsapp/webhook/route.ts`
    - Soporta `POST` de Twilio (form-data) y `GET/POST` de Meta Cloud API para verificación + mensajes entrantes.
    - Crea leads automáticamente con el número de WhatsApp (**GRUPO 4a**): número nuevo → lead con `stage: contactado`, `asignado_a` al admin por defecto (`DEFAULT_LEAD_ASIGNADO_A` / `WHATSAPP_DEFAULT_ADMIN_USER_ID` o primer `profiles.rol = admin`), registro en `lead_activities` con `event_type: primer_contacto`. No duplica si ya existe un lead con el mismo `whatsapp`.
    - **Modo humano**: si la conversación tiene `modo_humano = true`, solo registra el mensaje y no responde (el vendedor contesta desde el CRM).
    - **Captura flexible de datos**: si el prospecto escribe nombre, programa o correo en el mismo mensaje, el webhook intenta guardarlos sin obligarlo a seguir un formato rígido.
    - **Intenciones globales**: detecta antes solicitudes de asesor humano y expresiones de no interés para actualizar la conversación y el stage sin esperar a una fase específica.
    - **Info por programa**: al llegar al paso de información, envía un bloque base distinto para cursos de inglés, bachillerato, licenciaturas, maestrías o diplomados.
    - **Sync conversación ↔ lead**: mantiene `lead_id`, `estado`, `fase` y `stage` más alineados durante el flujo y en cierres (`cerrado` / `perdido`).
    - **GPT-4o como cerebro principal**: toda la detección (nombre, programa, correo, intenciones) y generación de respuestas pasa por GPT-4o. Ya no hay regex ni strings hardcodeados para el flujo conversacional.
    - `askGPT()`: función central que recibe fase actual + datos del lead + contexto RAG + mensaje del usuario. Devuelve JSON estructurado: `{ respuesta, siguienteFase, nombre, email, programa, requestedHuman, noInterest }`.
    - **RAG siempre activo**: se consulta `/api/rag/query` en cada mensaje y se pasa como contexto a GPT-4o (no solo en fase dudas).
    - **Reglas por palabra clave (FLOWS)**: siguen funcionando como override rápido antes de GPT. Si hay match en `whatsapp_flows`, responde sin llamar a GPT.
    - GPT-4o puede capturar nombre + programa + correo en un solo mensaje sin atascarse.
    - Respuestas de máximo 3 oraciones, tono natural y cálido.
    - Registra cada mensaje entrante y respuesta del bot en `whatsapp_mensajes`.
    - Usa `createServiceRoleClient()` (no `createClient()`) para bypassear RLS — el webhook no tiene sesión de usuario.
    - **Proveedor dual**: responde con `TwiML` si entra por Twilio o envía respuesta saliente con Graph API si entra por Meta.
    - **TwiML seguro**: las respuestas escapan caracteres XML para evitar que mensajes con `&`, `<` o `>` rompan la respuesta a Twilio.
  - Envío saliente: `app/api/whatsapp/send/route.ts`
    - Permite enviar mensajes de WhatsApp programáticamente (usado por el panel CONVERSACIONES para respuestas del vendedor).
    - Usa el proveedor activo (`twilio` o `meta`) sin cambiar el resto del CRM.
  - **Logging de conversaciones**:
    - Tabla `whatsapp_conversaciones`: una fila por número (`whatsapp`, `lead_id`, `estado`, `ultimo_mensaje_at`, `fase`, `modo_humano`, `tomado_por`). `fase`: saludo | programa | correo | info_enviada | dudas | accion | seguimiento | cerrado | perdido.
    - Tabla `whatsapp_mensajes`: historial (`conversacion_id`, `rol: 'usuario'|'bot'|'agente'`, `contenido`, `raw_payload`). Rol `agente` = mensaje enviado por un vendedor desde el CRM.
    - Tabla `whatsapp_flows`: flujo activo con `config.rules` (match, answer, use_rag). El CRM guarda/edita desde la vista FLOWS.
    - RLS: admin acceso total; vendedor SELECT/UPDATE solo conversaciones de sus leads; INSERT en `whatsapp_mensajes` (rol agente).
    - El INSERT desde el webhook funciona con service role (no con anon key).
  - Vista en CRM: pestaña **CONVERSACIONES** (lista, detalle, tomar control / volver a BOT, responder); pestaña **FLOWS** (solo admin) para editar reglas.

### 5. Autenticación y Supabase

- Cliente servidor (`utils/supabase/server.ts`):
  - Usa `@supabase/ssr` y `cookies` de Next.
  - `setAll` es `no-op` para evitar errores de modificación de cookies en Server Components.
- Cliente cliente (`@/utils/supabase/client`):
  - Usado en componentes client-side como `app/crm.jsx` y `app/agendar/[vendedor]/page.jsx`.

### 6. Detalles de configuración importantes

- `.env.local` típico:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (solo backend, nunca exponer en frontend)
  - `OPENAI_API_KEY`
  - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
  - `WHATSAPP_PROVIDER`
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`
  - `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_VERIFY_TOKEN`, `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
  - Opcional — asignación de leads nuevos desde WhatsApp: `DEFAULT_LEAD_ASIGNADO_A` o `WHATSAPP_DEFAULT_ADMIN_USER_ID` (UUID de `profiles.id` del admin/asesor por defecto; si falta, se usa el primer perfil con `rol = admin`).

- RLS (Row Level Security) clave:
  - `profiles`: política de lectura pública para página `/agendar/[vendedor]`.
  - `citas`: políticas separadas para admin (todas las citas) y vendedores (solo las suyas).
  - `email_sequences`: política “Admin acceso total”.
  - `whatsapp_conversaciones` / `whatsapp_mensajes`: admin acceso total; vendedor SELECT/UPDATE/INSERT según RLS. INSERTs desde el webhook usan service role.

- **Regla importante**: cualquier endpoint de API que reciba requests externos sin sesión (ej. webhooks de Twilio) debe usar `createServiceRoleClient()` de `utils/supabase/server.ts`, nunca `createClient()`. De lo contrario los inserts fallan silenciosamente por RLS.

- **Pendientes**: ver `docs/PENDIENTES.md`.

### 7. Operación y QA

- Script de verificación rápida de entorno WhatsApp:
  - `npm run whatsapp:check`
  - Archivo: `scripts/check-whatsapp-dev.sh`
- Script de validación técnica del CRM:
  - `npm run crm:check`
  - Archivo: `scripts/check-crm-quality.sh`
- Checklist manual de QA:
  - `docs/CRM_QA_CHECKLIST.md`
- Ruta de implementacion en la escuela:
  - `docs/IMPLEMENTACION_ESCUELA.md`
- Webhook estable de WhatsApp en Vercel:
  - `https://crm.windsor.edu.mx/api/whatsapp/webhook`

### 7.1 Estado operativo del bot (actualizado 2026-03-30)

- **Flujo conversacional definido y simulado**:
  - `saludo → programa (catálogo) → correo → info_enviada → accion (CTA A/B) → dudas / inscripcion / clase_prueba`
  - El correo se pide **antes** de dar información del programa; si no lo da, avanza igual.
  - La fase `programa` ahora retorna el catálogo **hardcodeado** directamente (sin RAG), interceptando cualquier transición a esa fase desde GPT.
  - Catálogo hardcodeado en `CATALOGO_OFERTA` (constante en `lab/route.ts` y `webhook/route.ts`).

- **Mensajes hardcodeados implementados**:
  - `INSCRIPCION_LICS_MSG`: proceso de inscripción completo (documentos, banco, link de forma).
  - `CLASE_PRUEBA_MSG`: invitación a clase de prueba gratuita con link CRM.
  - `CATALOGO_OFERTA`: lista completa de programas organizada por categoría.
  - Contacto de planteles (Chilpancingo e Iguala) embebido en instrucción de fase `asesor`.

- **CTA A/B por tipo de programa**:
  - Licenciaturas/otros: A) Dudas / B) Quiero inscribirme → fase `inscripcion`.
  - Inglés (niños/adultos): A) Dudas / B) Clase de prueba gratuita → fase `clase_prueba`.

- **Fase `asesor`** (cuando pide hablar con humano):
  - Muestra horarios de ambos planteles.
  - Pregunta día y hora disponible.
  - Captura teléfono y confirma que llamarán en ~1hr con los números del plantel.
  - Captura `telefono` en JSON de GPT.

- **RAG**: sigue activo para fases `info_enviada`, `dudas`, `correo` (info específica de programa).
- **max_tokens webhook**: aumentado a 800 para respuestas completas.
- **Pendiente**: agregar fechas de inicio de cada programa a la BASE.

### 8. Diseño responsive, rendimiento móvil y PWA (actualizado 2026-08-28)

- **PWA instalable en móvil**:
  - `public/manifest.json`: nombre, theme_color `#E8A838`, background `#0e0e0e`, iconos `icon-192.png` / `icon-512.png`.
  - `app/layout.tsx`: viewport meta, `apple-mobile-web-app-capable`, `theme-color`, `link rel="manifest"`, `link rel="apple-touch-icon"`.

- **Header sticky con menú hamburguesa**:
  - En desktop: nav horizontal completo + email de usuario + botón "+ NUEVO LEAD".
  - En mobile (`≤768px`): solo "WINDSOR CRM" (22px) + botón "+" + ícono hamburguesa.
  - "CRM v1.0" y badge ADMIN se ocultan en mobile (`.crm-tagline`, `.crm-admin-badge { display: none !important }`).
  - Dropdown del menú hamburguesa renderizado **dentro** del header con `position: absolute; top: 100%; left: 0; right: 0; z-index: 400` — se ancla al borde inferior del header sin necesidad de valores `top` hardcodeados.

- **Stats grid**: 4 columnas desktop → 2 columnas mobile (`stat-card-grid`).

- **LAB BOT**: 2 columnas desktop → 1 columna mobile (`lab-grid`). Chat arriba, estado del bot abajo.

- **Modales**: en mobile se abren como sheet desde la parte inferior (`position: fixed; bottom: 0; border-radius: 12px 12px 0 0`).

- **ConversationsPanel** (`components/crm/ConversationsPanel.jsx`):
  - Estado `mobileView: 'list' | 'chat'` controla qué panel se muestra en mobile.
  - Tap en conversación → vista de chat; botón "← Conversaciones" → regresa a la lista.
  - Filtros apilados verticalmente en mobile.
  - CSS en `<style>` interno con clases `.convs-list-panel` / `.convs-chat-panel` toggled por `mobileView`.

- **Ajustes de UX móvil y rendimiento (2026-08-28)**:
  - El contenedor principal ahora respeta el ancho real del viewport (`width: 100%`, `minWidth: 0` y `boxSizing: border-box`); eliminó el layout que podía quedar forzado a ~1400 px en móvil.
  - La fila de filtros de leads permite wrap y sus controles se encogen de forma segura. La tabla de LISTA conserva todas sus columnas mediante scroll horizontal táctil, en vez de recortarlas.
  - El scroll horizontal del Kanban queda contenido para evitar el rebote/scroll encadenado de iOS que se percibía como infinito.
  - Los filtros y agrupaciones de leads se memoizan, y la comprobación de conversación ligada usa un `Set`; evita cálculos repetidos al renderizar Kanban y KPIs.
  - La lista de CONVERSACIONES está virtualizada: solo monta las filas visibles más un margen, por lo que una cuenta con ~2,000 conversaciones sigue respondiendo al abrir o cambiar chats. La búsqueda de lead ligado usa un `Map` memoizado.
  - En móvil se puede volver a abrir la misma conversación tras usar la flecha de regreso; también recarga el historial de forma silenciosa.
  - Con un chat abierto, los mensajes se consultan cada 8 s solo si la app está visible. Los refrescos silenciosos no vacían, parpadean ni fuerzan scroll si el historial no cambió.
  - Indicador de no leído compartido entre asesores: punto verde, nombre/previsualización destacados y marcado como visto al abrir. La condición usa el último mensaje del prospecto (`rol: usuario`), no una respuesta reciente del bot o asesor. Requiere que esté aplicada `supabase/migration_conversaciones_visto.sql` (`visto_at`).
  - El resumen **Por programa** del Kanban es un acordeón compacto. Al abrirlo ordena los leads activos por: cursos de idiomas, bachillerato, licenciaturas y maestrías; suma las modalidades presencial/en línea de cada licenciatura. Los diplomados son el único submenú, para no saturar la pantalla con su catálogo.

### 9. Marketing y Ventas (Ecosistema Externo)

- **Documentación completa**: Ver `docs/marketing/` para toda la estrategia
- **Landing Page**: `landing.html` con SEO optimizado y analytics tracking
- **Email Marketing**: Secuencias automatizadas en `docs/marketing/EMAIL_SEQUENCES.md`
- **Sales Deck**: Presentación corporativa en `docs/marketing/SALES_DECK.md`
- **Analytics Setup**: Configuración completa en `docs/marketing/ANALYTICS.md`
- **Campaign Strategy**: Plan de campañas en `docs/marketing/CAMPAIGNS.md`
- **API Documentation**: Endpoints para integraciones en `docs/marketing/API_DOCS.md`
- **Landing Details**: Detalles técnicos en `docs/marketing/LANDING_PAGE.md`
- **Marketing Overview**: Estrategia general en `docs/marketing/OVERVIEW.md`

### 10. Cómo seguir usando este archivo

- **Cada nueva funcionalidad grande**: agregar un bloque corto aquí (qué hace, en qué archivos vive).
- **Cambios en tablas de Supabase**: anotar nuevas tablas, columnas o funciones SQL.
- **Flujos importantes de negocio** (por ejemplo, “nuevo lead desde WhatsApp” o “secuencia de correos desde página pública”): describirlos en 3–5 bullets.

Con esto, cualquier persona (incluyéndote tú en unas semanas) puede entender rápido qué hace el proyecto y por dónde empezar.

*Última actualización (2026-08-28): Se documentaron las mejoras de UX y rendimiento móvil: layout sin ancho forzado, filtros/tablas adaptables, Kanban sin rebote horizontal, lista de conversaciones virtualizada, reapertura correcta del chat, refresco silencioso y no leídos basados en mensajes del prospecto.*
