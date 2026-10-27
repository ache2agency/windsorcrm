-- TAREA 5: ARCHIVO PARA REVISIÓN, NO EJECUTADO EN PRODUCCIÓN.
-- Requiere primero windsor_mejoras_0b_2026_10_26.sql y lead_activities.sql.
-- Aplicar una vez con rol de migraciones. Reversa en archivo *_reversa.sql.
BEGIN;
LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.kanban_20261027_respaldo (
 id uuid PRIMARY KEY, stage_anterior text, fase_anterior text, stage_nueva text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.kanban_20261027_esquema (clave text PRIMARY KEY, valor text);
ALTER TABLE public.kanban_20261027_respaldo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kanban_20261027_esquema ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kanban_20261027_respaldo,public.kanban_20261027_esquema FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.kanban_20261027_respaldo,public.kanban_20261027_esquema TO service_role;
INSERT INTO public.kanban_20261027_esquema
 SELECT 'default_stage',pg_get_expr(d.adbin,d.adrelid) FROM pg_attribute a
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.leads'::regclass AND a.attname='stage';
INSERT INTO public.kanban_20261027_esquema
 SELECT 'constraint:'||conname,pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='public.leads'::regclass AND contype='c' AND
  conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.leads'::regclass AND attname='stage')]::smallint[];

CREATE FUNCTION public.kanban_normalizar_etapa(s text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE lower(trim(COALESCE(s,'')))
 WHEN 'primer_contacto' THEN 'primer_contacto' WHEN 'nuevo' THEN 'primer_contacto' WHEN 'contactado' THEN 'primer_contacto' WHEN 'saludo' THEN 'primer_contacto'
 WHEN 'segundo_contacto' THEN 'segundo_contacto' WHEN 'informado' THEN 'segundo_contacto' WHEN 'interesado' THEN 'segundo_contacto' WHEN 'seguimiento' THEN 'segundo_contacto'
 WHEN 'promocion_enviada' THEN 'segundo_contacto' WHEN 'promo_enviada' THEN 'segundo_contacto' WHEN 'tercer_contacto' THEN 'segundo_contacto'
 WHEN 'examen_ubicacion' THEN 'examen_ubicacion' WHEN 'agendado' THEN 'examen_ubicacion' WHEN 'clase_muestra' THEN 'examen_ubicacion' WHEN 'clase_prueba' THEN 'examen_ubicacion'
 WHEN 'inscripcion_pendiente' THEN 'inscripcion_pendiente' WHEN 'inscripcion' THEN 'inscripcion_pendiente' WHEN 'propuesta' THEN 'inscripcion_pendiente' WHEN 'inscribiendose' THEN 'inscripcion_pendiente' WHEN 'inscribiendo' THEN 'inscripcion_pendiente'
 WHEN 'inscrito' THEN 'inscrito' WHEN 'archivado' THEN 'archivado' WHEN 'cerrado' THEN 'archivado' WHEN 'perdido' THEN 'perdido' ELSE 'primer_contacto' END
$$;
CREATE FUNCTION public.kanban_es_idioma(curso text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(curso,'') !~* 'licenciatura|diplomado|maestr[ií]a'
 AND COALESCE(curso,'') ~* 'ingl[eé]s|franc[eé]s|italiano|idioma|verano|summer' $$;
CREATE FUNCTION public.kanban_tras_bot(actual text,destino text,curso text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE a text:=kanban_normalizar_etapa(actual); d text:=kanban_normalizar_etapa(destino);
 orden_activo text[]:=ARRAY['primer_contacto','segundo_contacto','examen_ubicacion','inscripcion_pendiente'];
BEGIN
 IF destino IS NULL OR a IN ('inscrito','perdido') OR d IN ('inscrito','perdido') THEN RETURN a; END IF;
 IF d='examen_ubicacion' AND NOT kanban_es_idioma(curso) THEN RETURN a; END IF;
 IF a='archivado' AND d IN ('primer_contacto','segundo_contacto','examen_ubicacion','inscripcion_pendiente') THEN RETURN d; END IF;
 IF a='inscripcion_pendiente' AND d='archivado' THEN RETURN a; END IF;
 IF d='archivado' THEN RETURN CASE WHEN a='archivado' THEN a ELSE d END; END IF;
 RETURN CASE WHEN array_position(orden_activo,d)>array_position(orden_activo,a) THEN d ELSE a END;
END $$;
CREATE FUNCTION public.kanban_etapa_migrada(stage text,fase text,curso text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE base text:=kanban_normalizar_etapa(stage); destino text;
BEGIN
 IF base IN ('inscrito','perdido') THEN RETURN base; END IF;
 IF base='examen_ubicacion' AND NOT kanban_es_idioma(curso) THEN base:='segundo_contacto'; END IF;
 destino:=CASE
 WHEN fase IN ('saludo','programa','correo','datos','info_programa','inscripcion_programa') THEN 'primer_contacto'
 WHEN fase IN ('info_enviada','accion','dudas','seguimiento','convenios') THEN 'segundo_contacto'
 WHEN fase IN ('examen','clase_prueba') THEN CASE WHEN kanban_es_idioma(curso) THEN 'examen_ubicacion' ELSE 'segundo_contacto' END
 WHEN fase IN ('inscripcion','inscripcion_pendiente','inscribiendo') THEN 'inscripcion_pendiente'
 WHEN fase IN ('archivado','cerrado') THEN 'archivado' WHEN fase='perdido' THEN 'perdido' ELSE NULL END;
 -- Solo backfill manual de historia; el runtime del bot nunca marca Perdido.
 IF destino='perdido' THEN RETURN 'perdido'; END IF;
 RETURN kanban_tras_bot(base,destino,curso);
END $$;

INSERT INTO public.kanban_20261027_respaldo(id,stage_anterior,fase_anterior,stage_nueva)
 SELECT l.id,l.stage,c.fase,kanban_etapa_migrada(l.stage,c.fase,l.curso)
 FROM public.leads l LEFT JOIN LATERAL (
  SELECT fase FROM public.whatsapp_conversaciones WHERE lead_id=l.id
  ORDER BY ultimo_mensaje_at DESC NULLS LAST,created_at DESC NULLS LAST,id DESC LIMIT 1
 ) c ON true;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT clave FROM public.kanban_20261027_esquema WHERE clave LIKE 'constraint:%' LOOP
  EXECUTE format('ALTER TABLE public.leads DROP CONSTRAINT %I',substr(r.clave,12));
 END LOOP;
END $$;
UPDATE public.leads l SET stage=b.stage_nueva FROM public.kanban_20261027_respaldo b WHERE l.id=b.id AND l.stage IS DISTINCT FROM b.stage_nueva;
ALTER TABLE public.leads ALTER COLUMN stage SET DEFAULT 'primer_contacto';
ALTER TABLE public.leads ADD CONSTRAINT leads_kanban_7_etapas CHECK(stage IN ('primer_contacto','segundo_contacto','examen_ubicacion','inscripcion_pendiente','inscrito','archivado','perdido'));
ALTER TABLE public.leads ADD COLUMN kanban_etapa_actualizada_at timestamptz,
 ADD COLUMN cerrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 ADD COLUMN cerrado_por_nombre text, ADD COLUMN cerrado_at timestamptz;
ALTER TABLE public.whatsapp_mensajes ADD COLUMN enviado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 ADD COLUMN enviado_por_nombre text;

CREATE FUNCTION public.kanban_es_equipo() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND rol IN ('admin','vendedor'))
$$;
-- El helper solo devuelve si auth.uid() es del equipo; no acepta un UUID ajeno.
REVOKE ALL ON FUNCTION public.kanban_es_equipo() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kanban_es_equipo() TO authenticated,service_role;
-- Solo se amplía lectura: UPDATE/INSERT/DELETE conservan sus políticas previas.
CREATE POLICY kanban_equipo_lee_perfiles ON public.profiles FOR SELECT TO authenticated USING(kanban_es_equipo());
CREATE POLICY kanban_equipo_lee_leads ON public.leads FOR SELECT TO authenticated USING(kanban_es_equipo());
CREATE POLICY kanban_equipo_lee_conversaciones ON public.whatsapp_conversaciones FOR SELECT TO authenticated USING(kanban_es_equipo());
CREATE POLICY kanban_equipo_lee_mensajes ON public.whatsapp_mensajes FOR SELECT TO authenticated USING(kanban_es_equipo());
CREATE POLICY kanban_equipo_lee_actividades ON public.lead_activities FOR SELECT TO authenticated USING(kanban_es_equipo());

CREATE FUNCTION public.kanban_guardar_etapa() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE asesor uuid:=auth.uid(); nombre text; humano boolean;
BEGIN
 SELECT COALESCE(NULLIF(trim(p.nombre),''),p.email,'Asesor') INTO nombre FROM public.profiles p
 WHERE p.id=asesor AND p.rol IN ('admin','vendedor');
 humano:=nombre IS NOT NULL;
 NEW.stage:=kanban_normalizar_etapa(NEW.stage);
 IF TG_OP='INSERT' THEN
  IF NOT humano AND NEW.stage IN ('inscrito','perdido') THEN NEW.stage:='primer_contacto'; END IF;
  NEW.cerrado_por:=NULL; NEW.cerrado_por_nombre:=NULL; NEW.cerrado_at:=NULL;
 ELSE
  IF NOT humano THEN NEW.stage:=kanban_tras_bot(OLD.stage,NEW.stage,NEW.curso); END IF;
  -- Estos campos son autoritativos; no se aceptan del body del navegador.
  NEW.cerrado_por:=CASE WHEN EXISTS(SELECT 1 FROM public.profiles WHERE id=OLD.cerrado_por) THEN OLD.cerrado_por ELSE NULL END; NEW.cerrado_por_nombre:=OLD.cerrado_por_nombre; NEW.cerrado_at:=OLD.cerrado_at;
 END IF;
 IF humano AND NEW.stage='examen_ubicacion' AND NOT kanban_es_idioma(NEW.curso) THEN
  RAISE EXCEPTION 'Agendado solo aplica a cursos de idiomas';
 END IF;
 IF TG_OP='INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
  NEW.kanban_etapa_actualizada_at:=now();
  IF NEW.stage='inscrito' AND humano THEN NEW.cerrado_por:=asesor; NEW.cerrado_por_nombre:=nombre; NEW.cerrado_at:=now();
  ELSIF NEW.stage<>'inscrito' THEN NEW.cerrado_por:=NULL; NEW.cerrado_por_nombre:=NULL; NEW.cerrado_at:=NULL;
  END IF;
 ELSIF TG_OP='UPDATE' THEN NEW.kanban_etapa_actualizada_at:=OLD.kanban_etapa_actualizada_at;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kanban_guardar_etapa BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.kanban_guardar_etapa();
CREATE FUNCTION public.kanban_registrar_cierre() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$ BEGIN
 IF NEW.stage='inscrito' AND NEW.cerrado_por IS NOT NULL AND (TG_OP='INSERT' OR OLD.stage IS DISTINCT FROM NEW.stage) THEN
  INSERT INTO public.lead_activities(lead_id,actor_id,event_type,title,detail,meta)
   VALUES(NEW.id,NEW.cerrado_por,'inscrito_confirmado','Inscripción confirmada','Cerró: '||NEW.cerrado_por_nombre,
    jsonb_build_object('from',CASE WHEN TG_OP='UPDATE' THEN OLD.stage ELSE NULL END,'to','inscrito','cerrado_por_nombre',NEW.cerrado_por_nombre,'cerrado_at',NEW.cerrado_at));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kanban_registrar_cierre AFTER INSERT OR UPDATE OF stage ON public.leads FOR EACH ROW EXECUTE FUNCTION public.kanban_registrar_cierre();
CREATE FUNCTION public.kanban_proteger_evento_cierre() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.event_type='inscrito_confirmado' AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'El cierre se registra al cambiar la etapa, no como actividad manual'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kanban_proteger_evento_cierre BEFORE INSERT ON public.lead_activities FOR EACH ROW EXECUTE FUNCTION public.kanban_proteger_evento_cierre();
CREATE FUNCTION public.kanban_autor_mensaje() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$ BEGIN
 IF TG_OP='UPDATE' THEN NEW.enviado_por:=CASE WHEN EXISTS(SELECT 1 FROM public.profiles WHERE id=OLD.enviado_por) THEN OLD.enviado_por ELSE NULL END; NEW.enviado_por_nombre:=OLD.enviado_por_nombre;
 ELSIF NEW.rol='agente' AND auth.uid() IS NOT NULL THEN
  SELECT p.id,COALESCE(NULLIF(trim(p.nombre),''),p.email,'Asesor') INTO NEW.enviado_por,NEW.enviado_por_nombre
   FROM public.profiles p WHERE p.id=auth.uid() AND p.rol IN ('admin','vendedor');
  IF NEW.enviado_por IS NULL THEN RAISE EXCEPTION 'Falta perfil de asesor'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kanban_autor_mensaje BEFORE INSERT OR UPDATE ON public.whatsapp_mensajes FOR EACH ROW EXECUTE FUNCTION public.kanban_autor_mensaje();

CREATE FUNCTION public.avanzar_etapa_bot(p_lead_id uuid,p_etapa text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE l record; siguiente text;
BEGIN
 SELECT id,stage,curso INTO l FROM public.leads WHERE id=p_lead_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 siguiente:=kanban_tras_bot(l.stage,p_etapa,l.curso);
 IF siguiente IS DISTINCT FROM l.stage THEN UPDATE public.leads SET stage=siguiente WHERE id=p_lead_id; END IF;
 RETURN siguiente;
END $$;
REVOKE ALL ON FUNCTION public.avanzar_etapa_bot(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.avanzar_etapa_bot(uuid,text) TO service_role;
COMMIT;
