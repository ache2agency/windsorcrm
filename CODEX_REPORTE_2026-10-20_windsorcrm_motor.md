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
