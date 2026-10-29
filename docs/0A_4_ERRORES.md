# 0A — Cuatro correcciones WindsorCRM (24-oct-2026)

Alcance: inscripción por curso guardado; avisos únicamente a Harold; vencimiento de revisiones nuevas; texto real de templates. Sin cambios a reglas de seguimiento 3h/20h/días 2/3/7, ni al cupo de 40 templates/día. No incluye 0B.

## Revisión y activación posterior por Harold

1. Revisar el PR. Antes de desplegar, aplicar manualmente `supabase/revision_timeout_2026_10_24.sql` (Codex no lo ejecutó en Supabase). El runtime nuevo requiere esas columnas y funciones RPC.
2. Configuración opcional: `REVISION_RECORDATORIO_HORAS=4`, `REVISION_REACTIVAR_HORAS=20`. Se exige 0 < recordatorio < reactivar < 23; una configuración inválida usa 4/20. El cron existente dispara ambos solo dentro del horario del motor (08:00–21:00 México). Los recordatorios nocturnos esperan la apertura; la reanudación se adelanta a la última corrida en horario antes del cierre de ventana si no habrá otra oportunidad. Se supone una corrida por hora, conservando los minutos del cron. No se agregó otro cron.
3. Solo las escalaciones creadas por el código nuevo tienen `revision_timeout_desde_at`. No rellenar esa columna para revisiones antiguas: las 13 pausadas se dejan intactas. Un borrador recibido de Harold desactiva el reloj. El control manual (`tomado_por`) también se respeta.
4. Las RPC reclaman una revisión por vez y guardan atómicamente reanudación/mensaje/actividad. Una reserva abandonada se recupera tras 10 minutos. Si un envío falla se libera para reintento. La aceptación remota y el commit SQL no forman una transacción: una caída entre ambos puede repetir el envío.
5. A las 20h: mensaje con hechos ya existentes (modalidad/duración en diplomados, formulario en otros programas), pregunta de ayuda adicional, fase `dudas`, código liberado y bot activo. Cuenta como toque del día para evitar otro mensaje inmediato del motor. Si la última oportunidad se perdió y el cron vuelve en horario cuando la ventana ya cerró (margen 23.5h desde el último usuario), se reactiva y registra `revision_reactivar_sin_ventana`, sin mandar texto libre fuera de ventana.
6. El recordatorio a Harold sigue siendo texto libre y puede sufrir 131047 si su ventana está cerrada. El template Utility está reservado para 0B; no se creó ni solicitó aquí.

## Texto de templates e histórico

El motor consulta `fetchApprovedTemplateBody`, sustituye parámetros numéricos literalmente, guarda el contenido y conserva nombre, parámetros y `wamid` en `raw_payload`. Si Meta no devuelve el BODY o faltan parámetros, se conserva el marcador con `template_body_resolved=false`; no se inventa texto.

`backfill-template-text-2026-10-14.mts` no fue ejecutado. Por defecto consulta y muestra conteos; solo `--apply` escribe. No manda WhatsApps. Recorre marcadores desde el 14-oct a las 00:00 México; preserva el payload y actualiza con comparación del contenido previo para no pisar una corrección concurrente.

```sh
# Preparar variables de entorno del proyecto antes de ejecutar manualmente.
node --import tsx scripts/backfill-template-text-2026-10-14.mts
node --import tsx scripts/backfill-template-text-2026-10-14.mts --parameters-file=/ruta/parametros-originales.json
# Solo al decidir aplicar el lote:
node --import tsx scripts/backfill-template-text-2026-10-14.mts --parameters-file=/ruta/parametros-originales.json --apply
```

Formato del JSON: `{ "id-del-mensaje": ["Nombre original", "Programa original"] }`. Para los mensajes antiguos cuyos parámetros no se guardaron, esos valores deben venir de una fuente original; el script omite los que no puede reconstruir. No deduce valores del lead actual ni inventa `wamid` históricos. El BODY recuperado es el aprobado actualmente en Meta y queda marcado `body_source=meta_current`; no acredita que el template no haya cambiado desde el envío.

## Validación

`npm test`: 71 casos de clasificación + 4 filtros + 11 pruebas del motor + 22 de 0A/0A-bis + 13 de horario = 121. Servicios simulados, incluyendo webhook real y persistencia del motor. `npm run build` pasa con variables públicas ficticias para prerender de login. Migración validada solo en PostgreSQL efímero: claim concurrente único, legacy intacto, recordatorio único, mensaje/actividad/código liberado atómicamente.


## 0A-bis — revisión corregida (26-oct-2026)

Los textos fijos se guardan y envían íntegros; el detector de promesas solo examina la respuesta de IA y deriva a revisión con código. Revalidación conserva las instrucciones del kardex con el cierre corregido. En `inscripcion_programa`, una respuesta sin programa concreto sigue las reglas/IA; después de dos listas enviadas se usa la misma revisión con código. La selección de un programa reconocido tiene prioridad.

El candado de horario se aplica antes de revisar vencimientos, también dentro del worker y de la RPC. La ventana se cuenta desde el último usuario con margen de 30 min; se calcula la próxima corrida en horario para adelantar el cierre solo cuando no habrá otra antes de vencer. Casos con reloj fijo: escalado 08h → último turno de 20h; 19h → recordatorio a apertura y cierre a 15h; 23h → recordatorio a apertura y cierre a 19h. Si el cron perdió la última oportunidad, reanuda sin texto en la siguiente corrida en horario. Las revisiones antiguas siguen sin marca y excluidas. Aplicar la versión actualizada del mismo archivo SQL antes del despliegue; Codex no la ejecutó en producción.
