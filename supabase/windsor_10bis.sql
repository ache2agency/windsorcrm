-- SOLO ARCHIVO. Revisar/aplicar antes del código. Requiere ruta17. No se aplica desde Next.js.
begin;
create or replace function public.ruta17_guardar_control() returns trigger language plpgsql set search_path=public as $$
declare humano boolean := auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid());
 n integer; r jsonb;
begin
 if tg_op='INSERT' then
  if new.stage in ('inscrito','perdido') and not humano then raise exception 'Cierre requiere persona'; end if;
  new.ruta=jsonb_build_object('pasos',jsonb_build_object('1',jsonb_build_object('estado','cumplido','fecha',new.created_at,'fuente','alta')),'dudas','[]'::jsonb);
  new.paso=1;new.bloque='Contacto';new.ruta_version=0;
  return new;
 end if;
 if tg_op='UPDATE' then
  if not humano and (new.stage in ('inscrito','perdido') and new.stage is distinct from old.stage) then
   raise exception 'Inscrito y Perdido requieren una persona';
  end if;
  if old.stage in ('inscrito','perdido') and not humano then new.stage=old.stage; end if;
  if humano and pg_trigger_depth()=1 and coalesce(current_setting('ruta17.manual',true),'')<>'1' and (new.ruta is distinct from old.ruta or new.paso is distinct from old.paso or new.bloque is distinct from old.bloque or new.ruta_version<>old.ruta_version) then
   raise exception 'La ruta es solo lectura';
  end if;
  if humano and pg_trigger_depth()=1 and coalesce(current_setting('ruta17.manual',true),'')<>'1' and new.stage is distinct from old.stage and new.stage not in ('inscrito','perdido') then raise exception 'Solo se puede confirmar Inscrito o Perdido'; end if;
  if humano and new.stage='inscrito' and old.stage is distinct from 'inscrito' then
   r=old.ruta;
   for n in 1..16 loop
    if r->'pasos'->n::text is null then r=jsonb_set(r,array['pasos',n::text],jsonb_build_object('estado','saltado','fecha',now(),'fuente','persona','motivo','Inscripción confirmada manualmente; paso sin evidencia')); end if;
   end loop;
   r=jsonb_set(r,'{pasos,17}',jsonb_build_object('estado','cumplido','fecha',now(),'fuente','persona'));
   new.ruta=r||'{"salida":null}'::jsonb; new.paso=17;new.bloque='Inscrito';new.ruta_version=old.ruta_version+1;new.paso_desde=now();
  elsif humano and new.stage='perdido' and old.stage is distinct from 'perdido' then
   new.ruta=old.ruta||'{"salida":"perdido"}'::jsonb;new.ruta_version=old.ruta_version+1;
  end if;
  if new.paso<old.paso then raise exception 'La ruta no retrocede'; end if;
 end if;
 return new;
end $$;
create or replace function public.ruta17_conversacion() returns trigger language plpgsql security definer set search_path=public as $$
declare l public.leads; r jsonb;
begin
 if new.lead_id is null then return new; end if;
 update leads set ultima_actividad_at=new.ultimo_mensaje_at where id=new.lead_id and (ultima_actividad_at is null or ultima_actividad_at<new.ultimo_mensaje_at);
 if new.modo_humano is distinct from old.modo_humano then
  select * into l from leads where id=new.lead_id for update;
  r=l.ruta||jsonb_build_object('persona',case when new.modo_humano then case when jsonb_typeof(l.ruta->'persona')='object' then l.ruta->'persona' else to_jsonb(now()) end else 'null'::jsonb end);
  perform guardar_ruta_lead(l.id,l.ruta_version,r,'{}','control_humano',l.paso,l.bloque);
 end if;
 return new;
end $$;

create or replace function public.editar_ruta_manual(p_id uuid,p_version integer,p_accion text,p_motivo text,p_paso integer default null,p_a text default null,p_hasta timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l public.leads; r jsonb; n integer; maximo integer; b text;
begin
 if auth.uid() is null then raise exception 'No autenticado'; end if;
 select * into l from leads where id=p_id for update;
 if l.id is null or not exists(select 1 from profiles where id=auth.uid() and (rol='admin' or l.asignado_a=auth.uid())) then raise exception 'Sin permiso'; end if;
 if l.ruta_version<>p_version then return null; end if;
 if length(trim(coalesce(p_motivo,'')))<5 or length(p_motivo)>500 then raise exception 'Explica el motivo (5 a 500 caracteres)'; end if;
 r=l.ruta;
 if p_accion='paso' then
  if p_paso is null or p_paso<l.paso or p_paso>16 or p_paso<1 or l.stage in ('inscrito','perdido') then raise exception 'Paso manual inválido; sin retrocesos ni cierres'; end if;
  for n in 1..p_paso loop
   if r->'pasos'->n::text is null then r=jsonb_set(r,array['pasos',n::text],jsonb_build_object('estado','saltado','fecha',now(),'fuente','persona','motivo',p_motivo)); end if;
  end loop;
  if r->'pasos'->p_paso::text->>'estado' is distinct from 'cumplido' then
   r=jsonb_set(r,array['pasos',p_paso::text],jsonb_build_object('estado','cumplido','fecha',now(),'fuente','persona','motivo',p_motivo));
  end if;
 elsif p_accion='canalizar' then
  if length(trim(coalesce(p_a,'')))<2 or length(p_a)>120 or p_hasta is null or p_hasta<=now() then raise exception 'Indica destinatario y fecha futura'; end if;
  r=r||jsonb_build_object('persona',jsonb_build_object('desde',now(),'hasta',p_hasta,'a',trim(p_a),'motivo',p_motivo,'estado','pendiente'));
 elsif p_accion='retomar' then r=r||'{"persona":null}'::jsonb;
 else raise exception 'Acción inválida'; end if;
 select coalesce(max(key::int),1) into maximo from jsonb_each(r->'pasos') where value->>'estado'='cumplido';
 b=case when maximo<=5 then 'Contacto' when maximo<=9 then 'Información' when maximo<=12 then 'Agenda' when maximo<=16 then 'Inscripción' else 'Inscrito' end;
 perform set_config('ruta17.manual','1',true);
 return guardar_ruta_lead(l.id,l.ruta_version,r,'{}','manual: '||p_motivo,maximo,b);
end $$;
revoke all on function public.editar_ruta_manual(uuid,integer,text,text,integer,text,timestamptz) from public,anon;
grant execute on function public.editar_ruta_manual(uuid,integer,text,text,integer,text,timestamptz) to authenticated;
-- No permitir que una revisión de 20 h borre una canalización con fecha.
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
  IF c.lead_id IS NOT NULL THEN
    PERFORM 1 FROM public.leads WHERE id=c.lead_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.leads WHERE id=c.lead_id AND jsonb_typeof(ruta->'persona')='object' AND coalesce(ruta->'persona'->>'origen','')<>'automatica') THEN RETURN false; END IF;
  END IF;
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

revoke all on function public.terminar_revision_timeout(uuid,text,timestamptz,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.terminar_revision_timeout(uuid,text,timestamptz,text,text,jsonb,boolean) to service_role;
commit;
