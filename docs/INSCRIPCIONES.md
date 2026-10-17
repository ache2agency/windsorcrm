# Formulario público de inscripción

## Documentos → Drive de Windsor (decisión de Harold, 17-oct-2026)

Los documentos **no** se guardan en Supabase Storage. El CRM valida la solicitud y la manda al Apps Script del Sheet "SOLICITUD DE INSCRIPCIÓN LICENCIATURAS (respuestas)" (`apps-script/InscripcionCRM.gs`, archivo nuevo junto al script existente, que no se modifica). El Apps Script:

1. Escribe la siguiente fila de la pestaña del programa (LIC, CL o DIPLOMADOS), con cada dato en su columna y los links de los documentos en las columnas de documentos.
2. Llama a `onFormSubmit` del script existente: carpeta por alumno, documentos movidos, ficha PDF y columnas "Carpeta Drive"/"Ficha PDF", igual que con Google Forms.
3. Devuelve carpeta y ficha; el CRM las guarda en `inscripciones.documentos` y la página de revisión las enlaza.

Un reintento con el mismo folio no duplica la fila: se busca en la columna "Folio CRM". Diplomados se agrega a `FORM_CONFIGS` en memoria con la propiedad `DIPLOMADOS_FOLDER_ID`. Las fotos se comprimen en el navegador (≤700 KB, máx. 1800 px); los PDF aceptan hasta 1.5 MB; total ≤4 MB.

**Configuración:**
- Apps Script → Propiedades del script: `INSCRIPCION_SECRETO` (secreto largo aleatorio) y `DIPLOMADOS_FOLDER_ID`. Implementar como aplicación web (Ejecutar como: Yo · Acceso: Cualquier usuario).
- Vercel (Production): `INSCRIPCION_DRIVE_URL` (URL `/exec`) e `INSCRIPCION_DRIVE_SECRETO` (mismo secreto).

El bucket `inscripciones-privadas` del SQL ya corrido queda sin uso.

Rutas: `/inscripcion/licenciaturas`, `/inscripcion/cursos-libres`, `/inscripcion/diplomados`, `/inscripcion/verano`. Prellenado opcional: `?wa=%2B527471234567&nombre=Ana&curso=...`. El formulario retira esos parámetros del historial una vez cargados y no muestra datos privados del CRM al visitante.

**Pendiente antes del merge:** cotejar verano con su formulario original. Usa provisionalmente los campos de cursos libres. Los otros tres conjuntos se cotejaron con encabezados de las pestañas LIC, CL y DIPLOMADOS del Sheet `17kjIw5WR73i7I86XTyYr03YYcd7qU1OFvcxd7yHvlfg`, por API. Google Forms requiere login y Forms API devolvió 403: no se pudieron comprobar sus opciones de selección ni obligatoriedad exacta; curso, modalidad y medio se capturan como texto. Se incluyen los datos de los encabezados, sin columnas calculadas de Drive/ficha PDF.

## Preparar y probar

1. Revisar y aplicar manualmente `supabase/inscripciones_publicas.sql` en un proyecto de prueba con las tablas actuales del CRM. **Codex no aplicó esta migración en producción.** Crea bucket privado, restricción de Storage, solicitudes, RPC transaccional y contador de intentos. El archivo es una migración de una sola ejecución.
2. Configurar las variables existentes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (solo backend), credenciales Meta del proyecto. Opcionales existentes: `NEXT_PUBLIC_APP_URL` (si falta, usa `https://crm.windsor.edu.mx`) y `DEFAULT_LEAD_ASIGNADO_A` / `WHATSAPP_DEFAULT_ADMIN_USER_ID`.
3. El asesor debe tener `profiles.whatsapp`. Si no tiene, se usa el primer admin con WhatsApp; si tampoco existe, la solicitud queda en CRM y el fallo de aviso se registra en el log. El envío usa Meta, como `seguimiento-motor`; no se validó enviando mensajes reales.
4. `npm ci`, `npm run dev`. Abrir un formulario con un teléfono de prueba y adjuntar archivos ficticios. Acta y comprobante obligatorios; licenciaturas también certificado. CURP e INE se pueden adjuntar opcionalmente.
5. Verificar que el mismo teléfono —incluido el formato mexicano antiguo `+521`— reutiliza el lead, conserva identidad/asignación existentes y pasa a `inscripcion_pendiente`. La conversación pasa a `inscribiendo`, respetando `modo_humano`. Un lead `inscrito` no retrocede. La solicitud guarda los datos capturados y registra `inscripcion_recibida` en `lead_activities`.
6. Entrar al CRM y abrir el lead → **Solicitudes de inscripción** → revisar. La página `/inscripciones/[id]` requiere sesión y la API autoriza con RLS del lead antes de devolver datos o firmar documentos. Otro asesor sin acceso al lead debe recibir 404; sin sesión, API 401 y página redirige a login.
7. Probar PDF/JPG/PNG/HEIC válidos, archivo renombrado incorrectamente, formatos no aceptados y tamaño excesivo. Máximo **1.5 MB por documento y 4 MB por solicitud** (límite de cuerpo de Vercel); las fotos se comprimen solas en el navegador.

## Comportamiento y límites

- Los archivos solo se suben desde el servidor con service role. Se guardan con nombres aleatorios; ningún nombre original ni URL pública se persiste. Los enlaces de revisión duran 300 segundos y la API no los almacena en caché. Una policy restrictiva bloquea el bucket para anon/authenticated incluso si hay otras policies permisivas.
- Todos los documentos se validan antes de escribir en Storage. La creación/actualización del lead, solicitud, conversación y actividad ocurre en un RPC transaccional con bloqueo por teléfono e idempotencia por folio. Esto serializa los envíos de este formulario; no modifica el webhook de alta de leads.
- Un fallo de subida limpia exclusivamente los objetos de ese intento. Si se pierde la respuesta del RPC se conservan los archivos, porque podría haberse confirmado la transacción. Puede quedar un objeto huérfano que requiera revisión posterior; nunca se borran documentos de una solicitud confirmada para resolver una respuesta ambigua.
- Límite persistente de 20 solicitudes nuevas por IP por hora, guardando un HMAC con el secreto privado existente. Usa las cabeceras de IP del proxy; Vercel debe recibir el tráfico directamente. Un reintento de un folio ya guardado no vuelve a subir ni notifica otra vez.
- La solicitud pública vincula por WhatsApp declarado, **sin verificación OTP**. No devuelve datos de leads, ni sobrescribe su identidad existente, ni confirma que el pago sea válido. Coordinación debe revisar la documentación antes de marcar inscrito.
- El botón **Ya tengo mis documentos** usa el helper compartido del motor para generar el link prellenado en el webhook. Otros textos históricos de inscripción y bachillerato conservan sus enlaces anteriores.
- Los datos quedan en Supabase (`inscripciones.datos`) y en el Sheet; los documentos solo en Drive.

## Pruebas

`npm run test:inscripcion`: PostgreSQL embebido PGlite, sin conexión a producción. Ejecuta el SQL contra un esquema mínimo que reproduce los campos usados del CRM y las tablas de Storage; pruebas de deduplicación, transacción, idempotencia, archivos, permisos y rate limit. Storage y la generación de enlaces se simulan en la capa SDK. Después de aplicar en un entorno de prueba, comprobar también la API real de Supabase Storage y el WhatsApp del asesor.

`npm run test:clasificacion` verifica la regresión del bot. `npm run build -- --webpack` compila; el worktree puede usar valores ficticios de las dos variables públicas de Supabase para prerenderizar `/login` sin tocar producción.

## Migración gradual (16-oct-2026)

- Los Google Forms siguen siendo el canal principal. El bot manda la página de Windsor (`/solicitud-de-inscripcion`) mientras `INSCRIPCION_FORMULARIO_BOT` no sea `on`.
- Los asesores comparten a mano `https://crm.windsor.edu.mx/inscripcion/{licenciaturas|cursos-libres|diplomados}` para probarlo. Verano en pausa (`PROGRAMAS_PAUSADOS`).
- Para que el botón "Ya tengo mis documentos" use el formulario nuevo: variable `INSCRIPCION_FORMULARIO_BOT=on` en Vercel (Production) y redeploy.
