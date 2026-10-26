-- 0B. ARCHIVO para revisión. No ejecutar en producción desde Codex.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS tipo_contacto text NOT NULL DEFAULT 'prospecto' CHECK(tipo_contacto IN ('alumno','prospecto'));
ALTER TABLE public.whatsapp_conversaciones
  ADD COLUMN IF NOT EXISTS tipo_contacto text NOT NULL DEFAULT 'prospecto' CHECK(tipo_contacto IN ('alumno','prospecto')),
  ADD COLUMN IF NOT EXISTS tipo_contacto_manual boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.sincronizar_tipo_contacto() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$ BEGIN
 IF NEW.lead_id IS NOT NULL THEN UPDATE public.leads SET tipo_contacto=NEW.tipo_contacto WHERE id=NEW.lead_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sincronizar_tipo_contacto AFTER INSERT OR UPDATE OF tipo_contacto,lead_id ON public.whatsapp_conversaciones
 FOR EACH ROW EXECUTE FUNCTION public.sincronizar_tipo_contacto();

ALTER TABLE public.whatsapp_mensajes
 ADD COLUMN IF NOT EXISTS delivery_status text,
 ADD COLUMN IF NOT EXISTS delivery_error_code integer,
 ADD COLUMN IF NOT EXISTS delivery_error text,
 ADD COLUMN IF NOT EXISTS delivery_status_at timestamptz;
CREATE INDEX IF NOT EXISTS whatsapp_mensajes_wamid_idx ON public.whatsapp_mensajes((raw_payload->>'wamid')) WHERE raw_payload->>'wamid' IS NOT NULL;
CREATE TABLE public.whatsapp_template_bloqueos (
 whatsapp text NOT NULL, template_name text NOT NULL, wamid text NOT NULL,
 error_code integer, motivo text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(whatsapp,template_name)
);
ALTER TABLE public.whatsapp_template_bloqueos ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.whatsapp_template_bloqueos TO service_role;
CREATE OR REPLACE FUNCTION public.registrar_entrega_whatsapp(p_wamid text,p_estado text,p_fecha timestamptz,p_codigo integer,p_motivo text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE m record; cambios integer:=0; numero text;
BEGIN
 IF p_estado NOT IN ('sent','delivered','read','failed') THEN RETURN 0; END IF;
 FOR m IN SELECT w.id,w.raw_payload,c.whatsapp FROM public.whatsapp_mensajes w
  JOIN public.whatsapp_conversaciones c ON c.id=w.conversacion_id
  WHERE w.raw_payload->>'wamid'=p_wamid AND w.rol<>'usuario' FOR UPDATE OF w LOOP
  UPDATE public.whatsapp_mensajes SET delivery_status=p_estado,delivery_status_at=p_fecha,
    delivery_error_code=CASE WHEN p_estado='failed' THEN p_codigo ELSE NULL END,
    delivery_error=CASE WHEN p_estado='failed' THEN p_motivo ELSE NULL END
   WHERE id=m.id AND (delivery_status IS NULL OR
    (p_fecha>=delivery_status_at AND delivery_status<>'failed' AND
      (p_estado='failed' OR array_position(ARRAY['sent','delivered','read'],p_estado)>=array_position(ARRAY['sent','delivered','read'],delivery_status))));
  IF p_estado='failed' AND m.raw_payload->'seguimiento_motor'->>'templateName' IS NOT NULL THEN
   numero:=regexp_replace(m.whatsapp,'\D','','g');
   IF numero ~ '^521[0-9]{10}$' THEN numero:='52'||substr(numero,4); END IF;
   INSERT INTO public.whatsapp_template_bloqueos(whatsapp,template_name,wamid,error_code,motivo)
    VALUES('+'||numero,m.raw_payload->'seguimiento_motor'->>'templateName',p_wamid,p_codigo,p_motivo)
    ON CONFLICT(whatsapp,template_name) DO NOTHING;
  END IF;
  cambios:=cambios+1;
 END LOOP;
 RETURN cambios;
END $$;

-- No se toca ningún código viejo: se reserva contra TODOS los pendientes,
-- incluidos borradores antiguos; el lock serializa solo asignaciones nuevas.
CREATE OR REPLACE FUNCTION public.asignar_revision_codigo(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE existente text; candidato text; n integer:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('windsor_revision_codigo'));
 SELECT revision_codigo INTO existente FROM public.whatsapp_conversaciones WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversacion inexistente'; END IF;
 IF existente IS NOT NULL THEN RETURN existente; END IF;
 LOOP
  candidato:=chr(97+n%26)||CASE WHEN n<26 THEN '' ELSE (n/26)::text END;
  EXIT WHEN NOT EXISTS(SELECT 1 FROM public.whatsapp_conversaciones WHERE lower(revision_codigo)=candidato);
  n:=n+1;
 END LOOP;
 UPDATE public.whatsapp_conversaciones SET revision_codigo=candidato,revision_codigo_asignado_at=now(),
  revision_timeout_desde_at=now(),revision_recordatorio_at=NULL,revision_timeout_claim_at=NULL,
  modo_humano=true,ultimo_mensaje_at=now() WHERE id=p_id;
 RETURN candidato;
END $$;
REVOKE ALL ON FUNCTION public.asignar_revision_codigo(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.registrar_entrega_whatsapp(text,text,timestamptz,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asignar_revision_codigo(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_entrega_whatsapp(text,text,timestamptz,integer,text) TO service_role;
