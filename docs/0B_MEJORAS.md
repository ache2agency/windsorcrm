# 0B — alumnos, avisos internos, entregas y códigos (26-oct-2026)

Rama `codex/windsor-mejoras`, desde `origin/main` `7e8f56b` (0A/0A-bis del PR #48 ya incorporados). Sin cambios a los tiempos comerciales de 3h/20h/días 2/3/7, sin SQL en producción, merge, deploy ni mensajes reales.

## Cambios

- Clasificación persistente alumno/prospecto por señales del mensaje; alumno se conserva en mensajes posteriores. Inscrito se considera alumno salvo corrección manual. El selector de conversaciones permite corregirlo y conservar esa decisión. La clasificación se sincroniza al lead mediante trigger; alumnos quedan fuera de Kanban/lista de prospectos y del seguimiento comercial. Sus consultas generan código para Harold, sin otro contacto. El cierre de revisión de un alumno no contiene formularios ni venta.
- Avisos del webhook y recordatorios del motor pasan por `avisarAdmin`: texto si Harold escribió en las últimas 23.5 horas (margen de seguridad); fuera de ventana, `windsor_aviso_interno` únicamente si Meta informa `APPROVED`, `UTILITY`, `es_MX`. Si falta aprobación/configuración, conserva el texto como pidió Harold. En ese estado Meta todavía puede rechazarlo con 131047; no se afirma que ya esté habilitado.
- Callback `statuses` verifica HMAC `X-Hub-Signature-256` con `META_APP_SECRET`, recorre los estados del lote y los registra mediante RPC por `raw_payload.wamid`. Sin secreto devuelve 503; firma incorrecta 401; fallo de DB 503 para permitir reintento. No genera nuevos avisos por fallos de avisos internos. Mensajes manuales y textos del motor también guardan wamid.
- El CRM refresca cambios de entrega aunque no aparezca un mensaje nuevo y muestra ❌, código y motivo. Un template fallido del motor bloquea esa combinación template/número, incluso en corridas posteriores; normaliza +521 heredado a +52. No bloquea todos los templates ni elimina mensajes. Estados/reintentos no degradan delivered/read a sent ni borran un fallo ya registrado.
- Asignación de códigos en una transacción con lock: A…Z, A1…Z1, etc., reservando todos los códigos anteriores sin caducarlos a las 48h. Instrucciones `A1: explicación` / `A1 ok` aceptadas. Los códigos viejos duplicados no se renumeran: siguen con el comportamiento heredado de selección por fecha. Las 13 revisiones antiguas no se reactivan ni adquieren timeout.
- Extras autorizados en HOY: reabrir cerrado/perdido solo cuando el contacto vuelve a escribir, respetando modo humano; no saltar la fase correo si llega otro correo y ya había uno guardado; rechazar “Saludos cordiales”/“Saluditos” como nombres. No se modifica el nombre histórico que Harold decidió dejar.

## Activación por Harold, después de revisión

1. Aplicar **una vez** `supabase/windsor_mejoras_0b_2026_10_26.sql` antes de desplegar este código. Requiere la migración de timeout de 0A ya instalada. Agrega columnas, trigger, bloqueos y dos RPC restringidas a service_role; no hace backfill ni cambios masivos de revisiones.
2. Verificar `META_APP_SECRET` del mismo App de Meta y las variables ya existentes `META_WHATSAPP_TOKEN` (o `META_WHATSAPP_ACCESS_TOKEN`), `META_PHONE_NUMBER_ID` (o `META_WHATSAPP_PHONE_NUMBER_ID`), `META_WHATSAPP_BUSINESS_ACCOUNT_ID`. Ninguna variable fue modificada por Codex.
3. Script de alta: `node --env-file=.env.local --import tsx scripts/crear-template-aviso-interno.mts` solo muestra el payload. **Harold** añade `--apply` para crear el template en Meta. El script no envía mensajes. No fue ejecutado contra Meta. Esperar aprobación Utility en es_MX; el código consulta su estado antes de usarlo.
4. Merge/deploy únicamente con autorización de Harold. Después verificar una consulta de alumno, una corrección en CRM, una revisión con código y un estado real de entrega. No reactivar masivamente conversaciones antiguas.

## Validación

`npm test`: 147/147; `npx tsc --noEmit`; `npm run build`. APIs simuladas, sin accesos a servicios reales. Casos de las cuatro preguntas reales de alumnos, edición manual estable, inscrito, respuestas de venta negativas, correo ya guardado, reapertura cerrado/perdido y legacy humano intacto; avisos con ventana abierta/cerrada y aprobación pendiente/rechazada/pausada/idioma/categoría incorrectos; HMAC, lotes, errores DB, normalización y exclusión del motor.

PostgreSQL temporal local con datos ficticios: SQL original completo, 77 reservas concurrentes únicas (>26), 13 filas legacy intactas, reserva idempotente, trigger de clasificación, estados fuera de orden y repetidos, fallo persistente, bloqueo por número/template, wamid desconocido y permisos de RPC. No es una prueba contra el esquema/datos de producción; Harold debe revisar la migración antes de aplicarla.

Chrome local, CRM real compilado con el cliente de DB simulado: alumno ausente del Kanban; selector alumno/prospecto guarda `tipo_contacto_manual=true`; corrección devuelve el contacto al Kanban; ❌ 131049 y motivo visibles; cero errores JavaScript y cero servicios reales. No sustituye una prueba en producción tras la activación.
