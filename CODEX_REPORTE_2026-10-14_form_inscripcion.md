# Tarea 2 — Formulario de inscripción Windsor

**Implementación en [PR borrador #46](https://github.com/ache2agency/windsorcrm/pull/46), sin merge.** Rama `formulario-inscripcion`, worktree `/Users/harold/software/windsorcrm-form-inscripcion`, base `origin/main` `94f071b`. Trabajo cerrado el 15-oct; nombre del reporte conservado según la tarea del 14-oct.

## Qué quedó

- Cuatro rutas públicas `/inscripcion/licenciaturas`, `/inscripcion/cursos-libres`, `/inscripcion/diplomados`, `/inscripcion/verano`, sin cuenta Google. Prellenado por WhatsApp/nombre/programa.
- Documentos PDF/JPG/PNG/HEIC en bucket privado `inscripciones-privadas`, subidos solo desde el backend. Valida extensión, MIME, firma y tamaño: **750 KB por documento, 4 MB por solicitud**. Acta y comprobante obligatorios; licenciaturas también certificado; CURP e INE opcionales.
- RPC transaccional reutiliza el lead por WhatsApp normalizado, registra solicitud y `lead_activities`, deja stage `inscripcion_pendiente` y fase `inscribiendo`. Conserva identidad, asesor y modo humano existentes; no retrocede un inscrito. Reintentos por folio no duplican solicitud.
- Botón **Ya tengo mis documentos** del webhook usa el helper compartido del motor y manda el enlace nuevo prellenado. Otros mensajes históricos y bachillerato conservan enlaces anteriores.
- Aviso al asesor por Meta, con fallback a admin con WhatsApp, como el mecanismo de seguimiento-motor. Revisión autenticada desde el modal del lead y `/inscripciones/[id]`; la API comprueba acceso RLS al lead antes de mostrar datos o generar links firmados de cinco minutos.
- Límite persistente: 20 solicitudes nuevas por IP/hora, sin guardar la IP en claro. No valida pagos ni copia respuestas al Sheet/Drive.

## Verificación

- **14/14 pruebas nuevas**: SQL ejecutado en PostgreSQL local embebido (PGlite), deduplicación, transacción, idempotencia, conservación de inscritos, archivos inválidos, bucket/policies privadas, acceso de otro asesor, enlaces y límite de intentos. SDK de Storage simulado; no se usó producción.
- **71/71 regresiones del bot**. Caso adicional de Francés al formulario de cursos libres comprobado.
- **Build webpack OK**, con variables públicas ficticias de Supabase; lint de archivos nuevos y `git diff --check` limpios.
- HTTP local: cuatro formularios 200; programa inexistente 404; revisión sin sesión 307/API 401; formato/origen/tamaño rechazados con 415/403/413.
- No ejecuté SQL en producción, ni envié avisos reales, ni hice deploy/merge. No existe `CLAUDE.md` en la raíz del proyecto; leí su `docs/CONTEXT.md`.

## Cómo probarlo

1. Revisar `supabase/inscripciones_publicas.sql` y aplicarlo **manualmente en una base de prueba** antes de probar un envío real. Codex no lo aplicó a Supabase.
2. Usar las variables existentes de Supabase y Meta; no agregué variables obligatorias. `NEXT_PUBLIC_APP_URL` permite que el bot genere enlaces al entorno de prueba. El asesor/admin necesita `profiles.whatsapp`.
3. `npm ci`, `npm run test:inscripcion`, `npm run dev`. Abrir `/inscripcion/diplomados?wa=%2B527471234567&nombre=Ana` con datos y archivos ficticios.
4. Confirmar solicitud, actividad y etapa en CRM; abrir los documentos desde el modal del lead. Comprobar en Supabase real que no existe acceso público y que otro asesor sin permiso no obtiene links. Probar la notificación Meta en ese entorno.
5. Guía completa: `docs/INSCRIPCIONES.md`. Smoke HTTP reproducible: levantar en localhost:3187 y ejecutar `node scripts/smoke-inscripcion.mjs`.

## Pendientes antes de publicar

- **Verano pendiente de cotejo:** su Google Form exige login; no encontré una hoja vinculada accesible y pregunté a Harold por el enlace. Usa provisionalmente los campos de cursos libres. No debe darse por validado como copia exacta.
- LIC/CL/diplomados se cotejaron con encabezados de Sheets por API. Forms API devolvió 403: las opciones de selección y la obligatoriedad exacta necesitan confirmación; curso/modalidad/medio quedan como texto.
- Fotos mayores de 750 KB requieren reducirse antes de subir; no hay compresión automática. La solicitud usa el WhatsApp declarado, sin OTP, y exige revisión humana antes de confirmar inscripción.
- Si falla el aviso, la solicitud queda visible en CRM y el error se registra en servidor. Si se pierde la respuesta del RPC pueden quedar objetos huérfanos; se conservan para no borrar documentos de una transacción posiblemente confirmada.

**Tarea 3 no iniciada. Detenido para que Harold revise este reporte.**
