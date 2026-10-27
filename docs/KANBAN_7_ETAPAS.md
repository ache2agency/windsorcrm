# Kanban de siete etapas — 27-oct-2026

Fuente: `windsor/seguimiento/MAPA_SEGUIMIENTO.md`, tabla Mapa por etapa y decisiones de Harold del 12-oct. Rama `codex/kanban-7-etapas`, base `codex/windsor-mejoras` (PR #49). SQL preparado para revisión; no aplicado en producción.

| Columna | ID persistido | Qué esperamos | Fases del bot |
|---|---|---|---|
| Nuevo | primer_contacto | Nombre + programa | saludo, programa, correo; compatibilidad datos/info_programa/inscripcion_programa |
| Informado | segundo_contacto | Que decida o pregunte | info_enviada, accion, dudas; compatibilidad seguimiento/convenios |
| Agendado | examen_ubicacion | Que haga el examen o vaya a la clase, solo idiomas | examen, clase_prueba |
| Inscribiéndose | inscripcion_pendiente | Documentos + pago | inscripcion, inscripcion_pendiente, inscribiendo |
| Inscrito | inscrito | Bienvenida manual; cierre por asesor | Solo acción humana |
| Archivado | archivado | Reactivar más adelante | archivado, cerrado |
| Perdido | perdido | Sin seguimiento; decisión de un asesor | Solo acción humana en runtime |

Se conservan IDs existentes para las integraciones. `examen_ubicacion` reúne examen y clase; la conversación/cita conserva el subtipo. Agendado excluye licenciaturas, maestrías y diplomados aunque el nombre contenga inglés. Pendiente/asesor/con_asesor/vacante/nota no promueven tarjetas.

## Mapeo inicial

| Stage anterior | Base nueva |
|---|---|
| nuevo, contactado, saludo, primer_contacto | Nuevo |
| interesado, seguimiento, promocion_enviada, promo_enviada, tercer_contacto, segundo_contacto | Informado |
| clase_muestra, clase_prueba, agendado, examen_ubicacion | Agendado si idioma; Informado en otro programa |
| inscripcion, inscribiendo, inscribiendose, propuesta, inscripcion_pendiente | Inscribiéndose |
| inscrito | Inscrito |
| cerrado, archivado | Archivado |
| perdido | Perdido |

La migración combina esa base con la **última conversación** (último mensaje, creación e ID como desempate), promoviendo hacia la fase más avanzada. Si una fila archivada conserva una fase activa, la migración también la reactiva. Inscrito/Perdido explícitos se conservan. `cerrado` significa conversación terminada, no inscripción pagada. Una fase histórica `perdido` se conserva en el backfill manual; no autoriza cierres nuevos del bot. Valores desconocidos/nulos parten de Nuevo.

## Reglas y auditoría

`lib/crm/kanban.ts` centraliza columnas/mapeo; `etapas-bot.ts` usa la RPC atómica `avanzar_etapa_bot`, que bloquea la fila y evalúa su estado actual. El trigger SQL también protege escrituras automáticas directas: el bot solo avanza dentro de las etapas activas. **Archivado no es un escalón final del orden:** cuando el prospecto vuelve a escribir, el bot lo devuelve a Nuevo/Informado/Agendado/Inscribiéndose según su mensaje; desde Inscribiéndose puede preguntar precio y permanecer ahí. Inscrito/Perdido son estados humanos protegidos; el bot no los marca ni revierte. Tampoco archiva Inscribiéndose. Un asesor autenticado puede retroceder o cerrar conforme a sus permisos de escritura existentes.

Webhook, agenda pública y rutas de seguimiento/reactivación usan la protección. La agenda pública deriva la etapa del tipo de cita/programa y no acepta un stage arbitrario del visitante. Agotar la secuencia de seguimiento pide revisión humana en lugar de marcar Perdido; no se cambian los plazos ni textos de las secuencias.

El equipo admin/vendedor puede leer leads, conversaciones, mensajes, actividades y nombres de asesores de todo el equipo. El filtro por asesor es opcional. Las políticas previas de escritura se conservan: ver una tarjeta ajena no concede permiso para editarla. `tipo_contacto='alumno'` queda fuera de las tarjetas de prospectos.

Los mensajes nuevos del endpoint de envío guardan `enviado_por` y `enviado_por_nombre` a partir de la sesión comprobada; los envíos internos llevan Sistema. El trigger impide suplantar la autoría desde el navegador y conserva el nombre histórico aunque se renombre/elimine el perfil. Mensajes antiguos sin autor muestran «Asesor sin registro histórico»; no se deduce el autor del asesor asignado.

Al pasar manualmente a Inscrito, el trigger guarda `cerrado_por`, `cerrado_por_nombre`, `cerrado_at` y una actividad `inscrito_confirmado` con el actor real, cambio y fecha. La UI muestra «Cerró: …». Volver a guardar la misma etapa no duplica el cierre. Al salir de Inscrito se limpia el cierre actual; el historial permanece. Los inscritos históricos sin evidencia muestran «Sin registro histórico».

## Conteos de solo lectura

`scripts/contar-kanban.mts` solo hace GET paginados y emite agregados; no envía mensajes ni escribe datos. Ejecutar con URL y service key cargadas en el entorno, por ejemplo `node --env-file=.env.local --import tsx scripts/contar-kanban.mts`. No publicar las credenciales.

Lectura inicial del 27-oct-2026 19:45:25 UTC (13:45 México), 3,401 leads:

| Etapa proyectada | Leads |
|---|---:|
| Nuevo | 157 |
| Informado | 2,763 |
| Agendado | 8 |
| Inscribiéndose | 103 |
| Inscrito | 83 |
| Archivado | 140 |
| Perdido | 147 |
| Total | 3,401 |

**Límite del conteo:** producción aún no tiene `tipo_contacto` (respuesta 42703); estas cifras incluyen todos los registros, sin poder descontar alumnos. No significa que haya cero alumnos. La UI sí los excluye cuando el campo de 0B esté disponible. Repetir después de habilitar/clasificar 0B para obtener el total final de prospectos. Los GET no forman una instantánea transaccional; entradas posteriores pueden cambiar los totales. El detalle agregado viejo → nuevo está en el reporte de la tarea.

Segunda lectura GET (22:33:56 UTC / 16:33 México): 3,403 leads, dos más que antes. Bajo la lógica anterior, 142 terminarían en Archivado; con la reactivación nueva quedan 82. De los 60 reactivados por fase vigente, 59 pasan a Informado (57 venían del stage `archivado`, dos de `cerrado`) y uno a Inscribiéndose. Proyección nueva: Nuevo 156, Informado 2,824, Agendado 7, Inscribiéndose 104, Inscrito 83, Archivado 82, Perdido 147. El cambio de distribución es el efecto esperado de traer a etapas activas leads archivados que siguen conversando; dos nuevos registros aparecieron entre lecturas. El conteo aún incluye alumnos no identificables.

## SQL y reversa, pendientes de aprobación/ejecución

1. Revisar PR #49 y esta rama dependiente. **Orden obligatorio: SQL primero, código después.** Antes de ejecutar código nuevo se requieren `supabase/lead_activities.sql`, `supabase/windsor_mejoras_0b_2026_10_26.sql` y los prerrequisitos documentados de 0A/0B.
2. Revisar/aplicar una vez `supabase/kanban_7_etapas_2026_10_27.sql` con el rol propietario de migraciones. Transacción con bloqueo de leads; respalda todas las etapas/fases en `kanban_20261027_respaldo` y default/CHECK anteriores en `kanban_20261027_esquema`, protegidos por RLS. Añade CHECK de siete IDs, políticas de lectura, campos de auditoría, triggers y RPC. El helper de pertenencia al equipo es SECURITY DEFINER, sin UUID proporcionado por el cliente, para evitar recursión de RLS en profiles.
3. Comparar los agregados del respaldo y las etapas, revisar una muestra con Harold, y coordinar el cambio de código. Esta tarea no ejecutó estos pasos en producción ni autorizó merge/deploy.
4. Si no hubo nuevas tarjetas ni cambios de etapa, la reversa `supabase/kanban_7_etapas_2026_10_27_reversa.sql` restaura etapas/default/CHECK/políticas previos. **Aborta** si detecta cambios posteriores para no pisar cierres/comisiones: en ese caso conciliar manualmente antes de revertir código. Mantiene tablas de respaldo y columnas de auditoría; no borra leads/mensajes. Un borrado posterior de leads no se reconstruye desde este respaldo de etapas.

Los archivos no son reejecutables a ciegas: el forward falla si el respaldo/columnas ya existen, incluido después de una reversa. Preparar otra migración revisada para un nuevo intento, conservando el respaldo original. La regla previa del MAPA (12-oct) de pasar automáticamente a Perdido al día 90 queda sustituida: **Perdido solo lo marca una persona**; Archivado sí puede reactivarse con una respuesta entrante.

## Validación

- `npm test`: 181 comprobaciones (71 casos de clasificación + 110 pruebas Node), sin fallos; incluye reapertura desde Archivado y un webhook cuya RPC falla pero aun así responde.
- `npx tsc --noEmit` y `npm run build` OK con Supabase ficticio.
- `scripts/test-kanban-sql.sql`: prueba portable con `psql`, **solo en base local desechable** cuyo nombre empiece `kanban_test_`. Ejemplo: `psql -v ON_ERROR_STOP=1 -d kanban_test_local -f scripts/test-kanban-sql.sql`. Carga fixtures, aplica el SQL real, comprueba RLS/autoría/cierre/no regresión y revierte. Se ejecutó localmente mediante PostgreSQL embebido; también se probó cierre humano concurrente con el bot y bloqueo seguro de reversa tras cambios.
- Chrome con datos ficticios antes de 5-bis: siete columnas/expectativas, vendedor ve tarjeta ajena, filtro opcional, exclusión de alumno, cierre devuelto por DB y autores distintos en historial. Escritorio y móvil de 390 px; desplazamiento horizontal dentro del tablero. Capturas en `codex/historial/` de la carpeta madre.
