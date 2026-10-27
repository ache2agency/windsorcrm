-- ARCHIVO DE REVERSA, no ejecutado en producción. Revisar con Harold.
-- Conserva respaldos y columnas de auditoría; no borra leads ni mensajes.
-- Aborta si hubo tarjetas nuevas o cambios de etapa tras migrar: conciliar esos
-- cambios manualmente antes de volver al código anterior, sin pisar comisiones.
BEGIN;
LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.leads l LEFT JOIN public.kanban_20261027_respaldo b ON b.id=l.id
   WHERE b.id IS NULL OR l.kanban_etapa_actualizada_at IS NOT NULL OR l.stage IS DISTINCT FROM b.stage_nueva) THEN
  RAISE EXCEPTION 'Hay etapas nuevas/editadas después de migrar: revisar reversa manual sin sobrescribirlas';
 END IF;
END $$;
DROP TRIGGER kanban_guardar_etapa ON public.leads;
DROP TRIGGER kanban_registrar_cierre ON public.leads;
DROP TRIGGER kanban_proteger_evento_cierre ON public.lead_activities;
DROP TRIGGER kanban_autor_mensaje ON public.whatsapp_mensajes;
DROP POLICY kanban_equipo_lee_perfiles ON public.profiles;
DROP POLICY kanban_equipo_lee_leads ON public.leads;
DROP POLICY kanban_equipo_lee_conversaciones ON public.whatsapp_conversaciones;
DROP POLICY kanban_equipo_lee_mensajes ON public.whatsapp_mensajes;
DROP POLICY kanban_equipo_lee_actividades ON public.lead_activities;
ALTER TABLE public.leads DROP CONSTRAINT leads_kanban_7_etapas;
UPDATE public.leads l SET stage=b.stage_anterior FROM public.kanban_20261027_respaldo b WHERE l.id=b.id;
DO $$ DECLARE r record; defecto text; BEGIN
 FOR r IN SELECT * FROM public.kanban_20261027_esquema WHERE clave LIKE 'constraint:%' LOOP
  EXECUTE format('ALTER TABLE public.leads ADD CONSTRAINT %I %s',substr(r.clave,12),r.valor);
 END LOOP;
 SELECT valor INTO defecto FROM public.kanban_20261027_esquema WHERE clave='default_stage';
 IF defecto IS NULL THEN ALTER TABLE public.leads ALTER COLUMN stage DROP DEFAULT;
 ELSE EXECUTE 'ALTER TABLE public.leads ALTER COLUMN stage SET DEFAULT '||defecto; END IF;
END $$;
DROP FUNCTION public.avanzar_etapa_bot(uuid,text);
DROP FUNCTION public.kanban_autor_mensaje();
DROP FUNCTION public.kanban_proteger_evento_cierre();
DROP FUNCTION public.kanban_registrar_cierre();
DROP FUNCTION public.kanban_guardar_etapa();
DROP FUNCTION public.kanban_es_equipo();
DROP FUNCTION public.kanban_etapa_migrada(text,text,text);
DROP FUNCTION public.kanban_tras_bot(text,text,text);
DROP FUNCTION public.kanban_es_idioma(text);
DROP FUNCTION public.kanban_normalizar_etapa(text);
COMMIT;
