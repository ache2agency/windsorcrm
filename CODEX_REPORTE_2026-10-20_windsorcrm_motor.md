# Reporte — WindsorCRM: motor de seguimiento

20-oct-2026. Tarea 1 terminada; Codex se detiene antes de saas-base/TOEFL.

- Rama: `codex/motor-seguimiento-limit`, desde `origin/main` actualizado (`94f071b`).
- Worktree: `/Users/harold/software/windsorcrm-motor-limit`.
- PR: [#47](https://github.com/ache2agency/windsorcrm/pull/47), abierto sin merge. Implementación: `7d005ba`.

## Cambios

1. Sustituido `.limit(700)` por páginas de 500, ordenadas por `ultimo_mensaje_at DESC NULLS LAST` + `id ASC`, hasta agotar candidatas. Se conserva el backlog porque el mapa incluye reglas de más de 30 días: filtrar solo actividad reciente las eliminaría. Se cargan todas las páginas antes de ejecutar acciones, pues los envíos cambian la fecha usada para ordenar. Procesamiento en grupos de 10 para reducir duración.
2. Canal interno **+527474722466** excluido por número normalizado (incluye formato Meta y +521 heredado), tanto al evaluar conversación/lead como antes de ejecutar y al avisar al asesor.
3. Recordatorios de datos: mínimo **24 horas por tipo** (nombre/correo/programa), independientemente de una nueva respuesta del lead o del cambio de día. Consulta paginada del historial de recordatorios de las últimas 24 horas, sin depender de los últimos 60 mensajes; registra el tipo en `raw_payload`, reconoce mensajes anteriores sin ese campo y omite el envío si falla la lectura del historial.
4. Interruptor `SEGUIMIENTO_MOTOR_CIERRES` sin cambios. No se prendieron cierres.

## Validación

- `npm test`: **78/78** (71 regresiones, 4 filtros y 3 pruebas nuevas con varios escenarios).
- Prueba del GET real con Supabase simulado: **3,134 revisadas vs. 700**; lead reciente fuera de los primeros 700, siete páginas, canal interno, avisos al canal, recordatorios de nombre y correo en <24 h tras nueva respuesta, formatos anteriores, límite exacto de 24 h y errores de consulta. Bloquea cualquier escritura/envío durante la prueba.
- `npm run build`: **OK**, Turbopack y TypeScript, con variables ficticias de Supabase. El primer intento falló al descargar Google Fonts en sandbox; repetido con acceso de red, pasó.
- `npx tsc --noEmit`, lint de los cuatro archivos TypeScript modificados y `git diff --check`: OK.

## Dry-run con datos reales, solo lectura

Ejecutado el GET **local de esta rama** con `?dry=1` y lecturas reales de Supabase; un guard de fetch permite únicamente GET al host de Supabase, bloqueando escrituras y Meta. Script reproducible: `scripts/dry-run-seguimiento-motor.mts`.

| Medida | Resultado |
|---|---:|
| Consulta anterior con límite | 700 |
| Motor corregido | **3,152** |
| Duración | 69 segundos |
| Lecturas (incluye comparación anterior) | 3,551 |
| Textos propuestos | 6 |
| Templates propuestos | 159 |
| Cierres apagados | 253 |
| Omitidas | 2,734 |
| Envíos y escrituras | **0** |

El canal interno no apareció entre las candidatas actuales; tampoco hubo un recordatorio bloqueado por 24 h en esta muestra. Ambos casos se verificaron con fixtures en el endpoint.

La cobertura recuperada aumenta el volumen potencial del siguiente cron: este dry-run propone 165 mensajes. Los 69 s miden lecturas y decisiones, no latencia de envíos Meta; `maxDuration=300` se conserva. Revisar estos números antes del merge.

Sin SQL, merge, deploy manual ni envíos. PR #46 y crmanax #53 intactos. No existía `windsor/windsorcrm/CLAUDE.md`; se leyó `docs/CONTEXT.md`. Checkout principal con cambios ajenos intacto.


## 1b — Tope diario de templates (20-oct-2026)

Implementado en la misma rama y PR #47, sin merge:

- `SEGUIMIENTO_MOTOR_MAX_TEMPLATES_DIA`: **40 por defecto**; acepta enteros ≥0 (0 pausa templates). Valores inválidos usan 40.
- Conteo exacto en Supabase de mensajes del bot con `raw_payload.seguimiento_motor.accion=template` dentro del día de México. Resta los envíos anteriores de hoy; si falla el conteo, no ejecuta acciones.
- Primero evalúa todas las conversaciones en paralelo; después restaura el orden `ultimo_mensaje_at DESC` (ID para desempates) y ejecuta los templates seleccionados en serie. La latencia de consultas no altera la prioridad.
- Los que exceden el cupo quedan `omitido`, detalle **`tope diario de templates`**, sin escrituras ni marca de envío; vuelven a evaluarse en próximas corridas/días. Textos y avisos al asesor no consumen cupo.
- Corregido `inicioDiaMexicoIso` para que dé la medianoche real de México aunque el servidor use UTC; pruebas antes/después del cambio de día y con tres zonas del servidor.
- Workflow horario/manual de GitHub serializado con `concurrency`, sin cancelar una corrida activa. Esto evita solapamientos de ese workflow; llamadas directas simultáneas desde otros sistemas no tienen un bloqueo distribuido en BD.
- Recordatorios de datos permanecen en **24 h**; cierres siguen apagados.

**Pruebas:** `npm test` OK: 71 casos de regresión, 4 pruebas de filtros y 11 pruebas del motor (incluyen 6 escenarios del tope). Cubren cupo lleno, 38 ya enviados → solo dos más recientes, nueva corrida sin cupo, textos/avisos independientes, configuración/0/default y error de conteo. Se simulan también envíos y persistencia; no acceden a Meta real. `npm run build`, TypeScript, lint de archivos modificados y `git diff --check`: OK. Build con credenciales ficticias; repetido con red para Google Fonts tras fallar en sandbox.

**Nuevo dry-run real, solo lectura (GET/HEAD a Supabase, cualquier escritura/envío bloqueado):**

| Medida | Resultado |
|---|---:|
| Conversaciones revisadas | 3,153 (antes 700) |
| Templates candidatos | 159 |
| Templates ya enviados hoy por el motor | 2 |
| Cupo diario | 40 |
| Templates propuestos para esta corrida | **38** |
| Templates diferidos | **121** |
| Textos propuestos (fuera del cupo) | 3 |
| Cierres apagados | 255 |
| Duración / lecturas | 66 s / 3,554 |
| Envíos / escrituras de este dry-run | **0 / 0** |

Los 121 diferidos se reevaluarán con el cupo de días posteriores; el número final puede variar por respuestas, cambios de fase y nuevos leads. No se creó una cola ni se marcaron como enviados.

**DETENIDO después de 1b.** Sin SQL, merge, deploy manual, cambio de variables de producción ni envíos. Tareas 2 y 3 no iniciadas.
