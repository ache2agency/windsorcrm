# CODEX REPORTE — Motor de seguimiento automático

Fecha: 2026-10-13  
Rama/worktree: `codex-motor-seguimiento` en `/Users/harold/software/windsorcrm-motor-seguimiento`  
Base: `origin/main` actualizado a `4c9dd65`

## Qué se hizo

- Nuevo motor único en `lib/whatsapp/seguimiento-motor.ts`:
  - Reglas por fase del bot × carril:
    - A: idiomas / examen / clase.
    - B: bachillerato, licenciaturas, maestrías.
    - C: diplomados.
  - Decide `texto`, `template`, `archivar`, `perder` o `aviso_asesor`.
  - Respeta 8:00-21:00 México, ventana de 24 h para texto libre, máximo 1 automático por día, modo humano, inscrito/perdido, último mensaje del lead y backlog >30 días.
  - Backlog >30 días: no cierra de golpe; manda solo 1 template de rescate y luego no repite si ya hay `seguimiento_motor` después del último mensaje del lead.

- Nuevo endpoint `GET/POST /api/whatsapp/seguimiento-motor?dry=1`:
  - Protegido con `CRON_SECRET`.
  - `dry=1` lista acciones sin enviar ni escribir.
  - En vivo registra cada envío en `whatsapp_mensajes.raw_payload.seguimiento_motor` con `reglaId`, etapa, carril, acción y template.
  - Actualiza fase/stage solo en reglas terminales y registra `lead_activities`.
  - Avisos al asesor usan WhatsApp + `lead_activities`.

- Cron:
  - `.github/workflows/reactivacion-ventana.yml` ahora llama `/api/whatsapp/seguimiento-motor`.
  - Con eso el cron horario deja de usar `reactivacion-ventana`; los endpoints viejos quedan en el código para compatibilidad/manual, pero ya no son el camino horario.

- Botones programados en webhook:
  - `Sí, envíame la info` sin programa conocido → menú de oferta.
  - `Bachillerato / Licenciaturas / Maestrías / Idiomas / Diplomados` → guarda Bachillerato si aplica o pregunta programa específico.
  - `Aún lo estoy pensando` → Archivado.
  - `Necesito más tiempo` → se queda en Inscribiéndose.
  - `Ya tengo mis documentos` → link al formulario; no ofrece WhatsApp.
  - Problemas para subir/adjuntar → fase `pendiente` + aviso al asesor.

- Templates aprobados agregados al catálogo local:
  - `windsor_elige_programa`
  - `windsor_diplomado_seguimiento`
  - `windsor_diplomado_beneficios`
  - `windsor_examen_clase`

## Dry-run final

Ejecutado local contra Supabase real con `?dry=1`, sin envíos:

```json
{
  "ok": true,
  "dryRun": true,
  "horaMexico": 15,
  "revisadas": 700,
  "acciones": 60,
  "muestra": [
    { "whatsapp": "5274***00", "fase": "accion", "accion": "dry_archivar", "regla": "informado_dia10_archivar", "etapa": "Informado", "carril": "B", "detalle": "Informado sin respuesta al dia 10" },
    { "whatsapp": "5274***78", "fase": "accion", "accion": "dry_archivar", "regla": "informado_dia10_archivar", "etapa": "Informado", "carril": "A", "detalle": "Informado sin respuesta al dia 10" },
    { "whatsapp": "5274***64", "fase": "accion", "accion": "dry_template", "regla": "informado_ab_dia3_template", "etapa": "Informado", "carril": "A", "detalle": "seguimiento_general" },
    { "whatsapp": "5274***66", "fase": "saludo", "accion": "dry_template", "regla": "nuevo_dia2_template_menu", "etapa": "Nuevo", "carril": "B", "detalle": "windsor_elige_programa" },
    { "whatsapp": "5274***17", "fase": "accion", "accion": "dry_template", "regla": "backlog30_informado_ab", "etapa": "Informado", "carril": "A", "detalle": "windsor_promo" },
    { "whatsapp": "5295***51", "fase": "cerrado", "accion": "dry_template", "regla": "backlog30_archivado", "etapa": "Archivado", "carril": "B", "detalle": "windsor_reactivacion_seguimiento" }
  ]
}
```

Ojo: todavía hay `dry_archivar` para leads de 5-30 días porque el mapa dice Nuevo día 5 e Informado día 10 → Archivado. Para el primer deploy quizá conviene que Harold revise si quiere encender cierres automáticos desde la primera corrida o arrancar en modo solo templates.

## Riesgos / ambiguo

- El endpoint procesa hasta 700 conversaciones por corrida para mantenerse dentro de `maxDuration = 300`. El dry-run tardó ~98 s. Si el universo real supera ese cap, hay que paginar/optimizar antes de mergear.
- Aviso “Pendiente/Asesor sin respuesta humana en 2 h”: implementado dentro del horario general 8:00-21:00 México. El mapa dice “horario de oficina”, pero no define turnos exactos.
- `windsor_bienvenida_lead_manual` tiene botón para recibir info, pero el código no conoce el texto exacto de todos sus botones salvo los interceptores agregados.
- El formulario propio de inscripción todavía no existe; el botón “Ya tengo mis documentos” usa `https://www.windsor.edu.mx/solicitud-de-inscripcion`.
- Los endpoints viejos (`reactivacion-ventana`, `reactivacion`, `seguimientos`) no se borran. El ordenamiento real se hace quitándolos del cron horario y registrando `seguimiento_motor` para el tope diario.

## Verificación

- `npm run test:clasificacion` → 71/71 pasan.
- `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy SUPABASE_SERVICE_ROLE_KEY=dummy CRON_SECRET=dummy npm run build` → OK.

## Recomendación antes de merge

1. Revisar el dry-run completo en local si Harold quiere ver los 60 candidatos.
2. Decidir si se permiten cierres automáticos (`archivar`/`perder`) desde la primera corrida.
3. Si se aprueba, mergear manualmente; merge a `main` despliega producción.
