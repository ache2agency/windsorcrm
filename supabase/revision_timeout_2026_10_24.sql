-- 0A. Solo archivo para revisión. NO ejecutar en producción desde Codex.
-- Sin backfill: las 13 conversaciones antiguas conservan NULL y no participan.
ALTER TABLE public.whatsapp_conversaciones
  ADD COLUMN IF NOT EXISTS revision_timeout_desde_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision_recordatorio_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision_timeout_claim_at timestamptz;

CREATE OR REPLACE FUNCTION public.reclamar_revision_timeout(
  p_id uuid, p_codigo text, p_desde timestamptz,
  p_recordatorio_horas double precision, p_reactivar_horas double precision
) RETURNS SETOF public.whatsapp_conversaciones
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF p_recordatorio_horas <= 0 OR p_reactivar_horas <= p_recordatorio_horas OR p_reactivar_horas >= 23 THEN
    RAISE EXCEPTION 'Plazos de revision invalidos';
  END IF;
  RETURN QUERY UPDATE public.whatsapp_conversaciones c
    SET revision_timeout_claim_at=clock_timestamp()
    WHERE c.id=p_id AND c.revision_codigo=p_codigo AND c.revision_timeout_desde_at=p_desde
      AND c.modo_humano AND c.tomado_por IS NULL AND c.revision_draft IS NULL
      AND (c.revision_timeout_claim_at IS NULL OR c.revision_timeout_claim_at < now()-interval '10 minutes')
      AND (p_desde <= now()-p_reactivar_horas*interval '1 hour'
        OR (c.revision_recordatorio_at IS NULL AND p_desde <= now()-p_recordatorio_horas*interval '1 hour'))
    RETURNING c.*;
END $$;

CREATE OR REPLACE FUNCTION public.terminar_revision_timeout(
  p_id uuid, p_codigo text, p_claim timestamptz, p_accion text,
  p_texto text, p_raw jsonb, p_exito boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE c public.whatsapp_conversaciones;
BEGIN
  SELECT * INTO c FROM public.whatsapp_conversaciones
    WHERE id=p_id AND revision_codigo=p_codigo AND revision_timeout_claim_at=p_claim
      AND revision_timeout_desde_at IS NOT NULL AND modo_humano AND tomado_por IS NULL AND revision_draft IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT p_exito THEN
    UPDATE public.whatsapp_conversaciones SET revision_timeout_claim_at=NULL WHERE id=p_id;
    RETURN false;
  END IF;
  IF p_accion NOT IN ('recordatorio','reactivar','reactivar_sin_ventana') THEN RAISE EXCEPTION 'Accion invalida'; END IF;
  IF p_accion='recordatorio' THEN
    UPDATE public.whatsapp_conversaciones SET revision_recordatorio_at=now(),revision_timeout_claim_at=NULL WHERE id=p_id;
  ELSE
    IF p_accion='reactivar' THEN
      INSERT INTO public.whatsapp_mensajes(conversacion_id,rol,contenido,raw_payload)
        VALUES(p_id,'bot',p_texto,p_raw);
    END IF;
    UPDATE public.whatsapp_conversaciones SET modo_humano=false, revision_codigo=NULL,
      revision_codigo_asignado_at=NULL,revision_draft=NULL,revision_timeout_desde_at=NULL,
      revision_timeout_claim_at=NULL,fase='dudas',estado='abierta',
      ultimo_mensaje_at=CASE WHEN p_accion='reactivar' THEN now() ELSE ultimo_mensaje_at END
      WHERE id=p_id;
  END IF;
  IF c.lead_id IS NOT NULL THEN
    INSERT INTO public.lead_activities(lead_id,actor_id,event_type,title,detail,meta)
      VALUES(c.lead_id,NULL,'revision_'||p_accion,'Revisión pendiente: '||p_accion,
        'Código '||upper(p_codigo),jsonb_build_object('source','revision_timeout','codigo',p_codigo,'desde',c.revision_timeout_desde_at));
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.reclamar_revision_timeout(uuid,text,timestamptz,double precision,double precision) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.terminar_revision_timeout(uuid,text,timestamptz,text,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reclamar_revision_timeout(uuid,text,timestamptz,double precision,double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.terminar_revision_timeout(uuid,text,timestamptz,text,text,jsonb,boolean) TO service_role;
