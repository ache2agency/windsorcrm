-- SOLO ARCHIVO. Aplicar manualmente ANTES del código. No toca documentos/Drive.
-- Respaldo inmutable de primera ejecución; volver a ejecutar no pisa el respaldo.
begin;
create table if not exists public.ruta17_respaldo_leads as select * from public.leads;
create table if not exists public.ruta17_respaldo_convs as select * from public.whatsapp_conversaciones;
revoke all on public.ruta17_respaldo_leads,public.ruta17_respaldo_convs from public,anon,authenticated;
alter table public.ruta17_respaldo_leads enable row level security;
alter table public.ruta17_respaldo_convs enable row level security;
alter table public.leads add column if not exists ruta jsonb;
alter table public.leads add column if not exists paso integer not null default 1 check (paso between 1 and 17);
alter table public.leads add column if not exists bloque text not null default 'Contacto';
alter table public.leads add column if not exists edad integer check (edad between 1 and 110);
alter table public.leads add column if not exists modalidad text;
alter table public.leads add column if not exists ruta_version integer not null default 0;
alter table public.leads add column if not exists ultima_actividad_at timestamptz;
alter table public.leads add column if not exists paso_desde timestamptz not null default now();
create table if not exists public.lead_ruta_eventos (
 id bigint generated always as identity primary key, lead_id uuid not null references public.leads(id),
 version integer not null, fuente text not null, actor_id uuid, ruta jsonb not null, created_at timestamptz not null default now(),
 unique(lead_id,version)
);
alter table public.lead_ruta_eventos enable row level security;
revoke all on public.lead_ruta_eventos from anon,authenticated;
grant select on public.lead_ruta_eventos to authenticated;
grant all on public.lead_ruta_eventos to service_role;
grant usage,select on sequence public.lead_ruta_eventos_id_seq to service_role;
create or replace function public.ruta17_equivalencia(f text) returns integer language sql immutable as $$
 select case f when 'saludo' then 1 when 'programa' then 2 when 'verano_disambig' then 4
 when 'datos' then 2 when 'info_programa' then 4 when 'correo' then 2 when 'info_enviada' then 6
 when 'dudas' then 7 when 'convenios' then 8 when 'accion' then 9 when 'examen' then 9
 when 'clase_prueba' then 9 when 'inscripcion_programa' then 4 when 'inscripcion' then 13
 when 'inscripcion_pendiente' then 13 when 'inscribiendo' then 13 else null end;
$$;
-- Nunca inventar fechas de pasos históricos. Solo fechas con evidencia; huecos saltados con motivo.
create or replace function public.ruta17_inicial(l public.leads,f text) returns jsonb
language plpgsql stable set search_path=public as $$
declare r jsonb := '{"pasos":{},"dudas":[]}'::jsonb; n integer; ultimo integer := coalesce(ruta17_equivalencia(f),1);
begin
 if l.nombre is not null and trim(l.nombre)<>'' and l.nombre !~ '[0-9@]' then
  r=jsonb_set(r,'{pasos,2}',jsonb_build_object('estado','cumplido','fecha',null,'fuente','migracion','motivo','Nombre presente; fecha histórica desconocida')); ultimo=greatest(ultimo,2);
 end if;
 if l.email like '%@%.%' then
  r=jsonb_set(r,'{pasos,3}',jsonb_build_object('estado','cumplido','fecha',null,'fuente','migracion','motivo','Correo presente; fecha histórica desconocida')); ultimo=greatest(ultimo,3);
 end if;
 if l.curso is not null and l.curso<>'' and l.curso !~* 'instituto windsor' then
  r=jsonb_set(r,'{pasos,4}',jsonb_build_object('estado','cumplido','fecha',null,'fuente','migracion','motivo','Programa presente; fecha histórica desconocida')); ultimo=greatest(ultimo,4);
 end if;
 if l.stage in ('inscripcion_pendiente','inscribiendo') then ultimo=greatest(ultimo,13); end if;
 if l.stage in ('segundo_contacto','promocion_enviada') then ultimo=greatest(ultimo,6); end if;
 if l.stage='inscrito' then ultimo=17; end if;
 r=jsonb_set(r,'{pasos,1}',jsonb_build_object('estado','cumplido','fecha',l.created_at,'fuente','migracion'));
 for n in 2..ultimo loop
  if r->'pasos'->n::text is null then
   r=jsonb_set(r,array['pasos',n::text],jsonb_build_object('estado',case when n=ultimo then 'cumplido' else 'saltado' end,
     'fecha',null,'fuente','migracion','motivo','Equivalencia histórica; no acredita pasos intermedios ni fechas'));
  end if;
 end loop;
 if l.stage in ('archivado','perdido') or f in ('archivado','perdido','vacante') then
  r=r||jsonb_build_object('salida',case when l.stage in ('archivado','perdido') then l.stage else f end);
 end if;
 if f in ('asesor','pendiente','con_asesor') then r=r||'{"persona":"histórica; fecha desconocida"}'::jsonb; end if;
 return r;
end $$;
update public.leads l set ultima_actividad_at=coalesce((select max(c.ultimo_mensaje_at) from public.whatsapp_conversaciones c where c.lead_id=l.id),l.created_at) where ultima_actividad_at is null;
update public.leads l set ruta=ruta17_inicial(l,(select c.fase from public.whatsapp_conversaciones c where c.lead_id=l.id order by c.ultimo_mensaje_at desc nulls last,c.id limit 1)) where ruta is null;
update public.leads l set paso=(select coalesce(max(key::int),1) from jsonb_each(l.ruta->'pasos') where value->>'estado'='cumplido'),
 bloque=case when l.stage='inscrito' then 'Inscrito' else 'Contacto' end where ruta_version=0;
update public.leads set bloque=case when paso<=5 then 'Contacto' when paso<=9 then 'Información' when paso<=12 then 'Agenda' when paso<=16 then 'Inscripción' else 'Inscrito' end;
alter table public.leads alter column ruta set default '{"pasos":{},"dudas":[]}'::jsonb;
alter table public.leads alter column ruta set not null;
insert into public.lead_ruta_eventos(lead_id,version,fuente,ruta) select id,0,'migracion',ruta from public.leads on conflict do nothing;
-- "cerrado" era despedida, no cierre comercial. Se conserva en respaldo, deja de bloquear respuestas.
update public.whatsapp_conversaciones set fase='accion',estado='abierta' where fase='cerrado';

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
  if humano and pg_trigger_depth()=1 and (new.ruta is distinct from old.ruta or new.paso is distinct from old.paso or new.bloque is distinct from old.bloque or new.ruta_version<>old.ruta_version) then
   raise exception 'La ruta es solo lectura';
  end if;
  if humano and pg_trigger_depth()=1 and new.stage is distinct from old.stage and new.stage not in ('inscrito','perdido') then raise exception 'Solo se puede confirmar Inscrito o Perdido'; end if;
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
drop trigger if exists ruta17_control on public.leads;
create trigger ruta17_control before insert or update on public.leads for each row execute function public.ruta17_guardar_control();
create or replace function public.ruta17_auditar() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.ruta_version<>old.ruta_version then
  insert into lead_ruta_eventos(lead_id,version,fuente,actor_id,ruta) values(new.id,new.ruta_version,coalesce(nullif(current_setting('ruta17.fuente',true),''),'persona'),auth.uid(),new.ruta);
 end if; return new;
end $$;
drop trigger if exists ruta17_auditoria on public.leads;
create trigger ruta17_auditoria after update on public.leads for each row execute function public.ruta17_auditar();
create or replace function public.guardar_ruta_lead(p_id uuid,p_version integer,p_ruta jsonb,p_datos jsonb,p_fuente text,p_paso integer,p_bloque text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l public.leads; k text;v jsonb; esperado integer;
begin
 select * into l from leads where id=p_id for update;
 if l.ruta_version<>p_version then return null; end if;
 if p_ruta->'pasos' is null or jsonb_typeof(p_ruta->'pasos')<>'object' then raise exception 'Ruta inválida'; end if;
 if p_ruta->'pasos'->'17' is distinct from l.ruta->'pasos'->'17' then raise exception 'Inscrito solo humano'; end if;
 for k,v in select * from jsonb_each(l.ruta->'pasos') loop
  if v->>'estado'='cumplido' and p_ruta->'pasos'->k is distinct from v then raise exception 'No se pierde un cumplimiento'; end if;
 end loop;
 for k,v in select * from jsonb_each(p_ruta->'pasos') loop
  if k !~ '^([1-9]|1[0-7])$' or v->>'estado' not in ('cumplido','saltado') or (v->>'estado'='saltado' and coalesce(v->>'motivo','')='') then raise exception 'Paso inválido'; end if;
 end loop;
 select coalesce(max(key::int),1) into esperado from jsonb_each(p_ruta->'pasos') where value->>'estado'='cumplido';
 if esperado<>p_paso or p_bloque<>(case when p_paso<=5 then 'Contacto' when p_paso<=9 then 'Información' when p_paso<=12 then 'Agenda' when p_paso<=16 then 'Inscripción' else 'Inscrito' end) then raise exception 'Paso/bloque inconsistente'; end if;
 if p_ruta->>'salida'='perdido' and l.ruta->>'salida' is distinct from 'perdido' then raise exception 'Perdido solo humano'; end if;
 if p_ruta=l.ruta and (coalesce(nullif(p_datos->>'nombre',''),l.nombre) is not distinct from l.nombre)
 and (coalesce(nullif(p_datos->>'email',''),l.email) is not distinct from l.email)
 and (coalesce(nullif(p_datos->>'curso',''),l.curso) is not distinct from l.curso)
 and (coalesce(nullif(p_datos->>'modalidad',''),l.modalidad) is not distinct from l.modalidad)
 and (coalesce((p_datos->>'edad')::int,l.edad) is not distinct from l.edad) then return to_jsonb(l); end if;
 perform set_config('ruta17.fuente',p_fuente,true);
 update leads set ruta=p_ruta,paso=p_paso,bloque=p_bloque,ruta_version=ruta_version+1,
 paso_desde=case when paso<>p_paso then now() else paso_desde end,
 nombre=coalesce(nullif(p_datos->>'nombre',''),nombre),email=coalesce(nullif(p_datos->>'email',''),email),
 curso=coalesce(nullif(p_datos->>'curso',''),curso),modalidad=coalesce(nullif(p_datos->>'modalidad',''),modalidad),
 edad=coalesce((p_datos->>'edad')::int,edad),
 stage=case when stage in ('inscrito','perdido') then stage when p_ruta->>'salida'='archivado' then 'archivado'
   when p_paso>=13 then 'inscripcion_pendiente' when p_paso>=10 then 'examen_ubicacion' when p_paso>=6 then 'segundo_contacto' else 'primer_contacto' end
 where id=p_id returning * into l;
 return to_jsonb(l);
end $$;
revoke all on function public.guardar_ruta_lead(uuid,integer,jsonb,jsonb,text,integer,text) from public,anon,authenticated;
grant execute on function public.guardar_ruta_lead(uuid,integer,jsonb,jsonb,text,integer,text) to service_role;
-- Compartir lectura del equipo, conservando restricciones de escritura de políticas existentes.
drop policy if exists ruta17_equipo_lee on public.leads;
create policy ruta17_equipo_lee on public.leads for select to authenticated using(exists(select 1 from profiles where id=auth.uid()));
drop policy if exists ruta17_equipo_eventos on public.lead_ruta_eventos;
create policy ruta17_equipo_eventos on public.lead_ruta_eventos for select to authenticated using(exists(select 1 from profiles where id=auth.uid()));
drop policy if exists ruta17_equipo_convs on public.whatsapp_conversaciones;
create policy ruta17_equipo_convs on public.whatsapp_conversaciones for select to authenticated using(exists(select 1 from profiles where id=auth.uid()));
drop policy if exists ruta17_equipo_mensajes on public.whatsapp_mensajes;
create policy ruta17_equipo_mensajes on public.whatsapp_mensajes for select to authenticated using(exists(select 1 from profiles where id=auth.uid()));
-- Conteo después de migrar (solo lectura); excluir canal interno y vacantes.
select paso,bloque,count(*) from public.leads where coalesce(ruta->>'salida','')<>'vacante'
 and public.telefono_inscripcion(whatsapp) is distinct from '527474722466' group by paso,bloque order by paso;
create table if not exists public.ruta_inscripcion_trabajos (
 id uuid primary key references public.inscripciones(id),lead_id uuid not null references public.leads(id),pestana text not null,fila integer not null,
 estado text not null default 'pendiente',aviso_estado text not null default 'pendiente',confirmacion_estado text not null default 'pendiente',
 ultimo_error text, actualizado_at timestamptz not null default now(), wamid text
);
alter table public.ruta_inscripcion_trabajos enable row level security;
revoke all on public.ruta_inscripcion_trabajos from public,anon,authenticated;
grant all on public.ruta_inscripcion_trabajos to service_role;
-- Citas confirmadas y asistencia son evidencia del sistema, no inferencias por fase "examen".
create or replace function public.ruta17_cita() returns trigger language plpgsql security definer set search_path=public as $$
declare l public.leads;r jsonb;n integer;i integer;
begin
 if new.lead_id is null then return new; end if;
 n=case when new.status in ('asistio','completada') then 12 when new.status in ('confirmada','pendiente') and new.tipo='examen_ubicacion' then 10 when new.status in ('confirmada','pendiente') and new.tipo='clase_prueba' then 11 else null end;
 if n is null then return new; end if;
 select * into l from leads where id=new.lead_id for update;
 r=l.ruta;
 -- La agenda es opcional. Ausencia de un paso se registra, no se inventa una asistencia.
 for i in 1..n-1 loop
  if r->'pasos'->i::text is null then r=jsonb_set(r,array['pasos',i::text],jsonb_build_object('estado','saltado','fecha',now(),'fuente','agenda','motivo','Cita externa al flujo; paso no observado')); end if;
 end loop;
 if r->'pasos'->n::text->>'estado' is distinct from 'cumplido' then
  r=jsonb_set(r,array['pasos',n::text],jsonb_build_object('estado','cumplido','fecha',now(),'fuente','agenda'));
  perform guardar_ruta_lead(l.id,l.ruta_version,r,'{}','agenda',greatest(l.paso,n),case when greatest(l.paso,n)<=12 then 'Agenda' when l.paso<=16 then 'Inscripción' else 'Inscrito' end);
 end if;
 return new;
end $$;
drop trigger if exists ruta17_citas on public.citas;
create trigger ruta17_citas after insert or update of status on public.citas for each row execute function public.ruta17_cita();
create or replace function public.ruta17_aplicar_formulario(s public.inscripciones) returns void language plpgsql security definer set search_path=public as $$
declare l public.leads;r jsonb;n integer; origen jsonb;
begin
 select * into l from leads where id=s.lead_id for update;
 r=l.ruta;
 if r->>'salida'='archivado' then r=r||'{"salida":null}'::jsonb; end if;
 for n in 1..13 loop
  if r->'pasos'->n::text is null then r=jsonb_set(r,array['pasos',n::text],jsonb_build_object('estado','saltado','fecha',s.created_at,'fuente','formulario','motivo','Solicitud recibida fuera del flujo; paso sin evidencia')); end if;
 end loop;
 if r->'pasos'->'14'->>'estado' is distinct from 'cumplido' then
  r=jsonb_set(r,'{pasos,14}',jsonb_build_object('estado','cumplido','fecha',s.created_at,'fuente','formulario'));
 end if;
 -- Recuperar datos antes saltados cuando llegan en la solicitud, sin sobreescribir identidad existente.
 if coalesce(s.datos->>'nombres','')<>'' and r->'pasos'->'2'->>'estado' is distinct from 'cumplido' then
  r=jsonb_set(r,'{pasos,2}',jsonb_build_object('estado','cumplido','fecha',s.created_at,'fuente','formulario'));
 end if;
 if s.datos->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' and r->'pasos'->'3'->>'estado' is distinct from 'cumplido' then
  r=jsonb_set(r,'{pasos,3}',jsonb_build_object('estado','cumplido','fecha',s.created_at,'fuente','formulario'));
 end if;
 for n in 4..5 loop
  if nullif(s.datos->>(case when n=4 then 'curso' else 'modalidad' end),'') is not null and r->'pasos'->n::text->>'estado' is distinct from 'cumplido' then
   r=jsonb_set(r,array['pasos',n::text],jsonb_build_object('estado','cumplido','fecha',s.created_at,'fuente','formulario'));
  end if;
 end loop;
 perform guardar_ruta_lead(l.id,l.ruta_version,r,jsonb_build_object('curso',s.datos->>'curso','modalidad',s.datos->>'modalidad',
  'nombre',coalesce(nullif(l.nombre,''),nullif(trim(concat_ws(' ',s.datos->>'nombres',s.datos->>'apellido_paterno',s.datos->>'apellido_materno')),'')),
  'email',coalesce(nullif(l.email,''),s.datos->>'email'),
  'edad',case when s.datos->>'edad' ~ '^[0-9]{1,3}$' and (s.datos->>'edad')::int between 1 and 110 then (s.datos->>'edad')::int else l.edad end),
  'formulario',greatest(l.paso,14),case when l.paso=17 then 'Inscrito' else 'Inscripción' end);
 select value into origen from jsonb_array_elements(s.documentos) where value->>'tipo'='origen_sheet' limit 1;
 if origen is not null then
  insert into ruta_inscripcion_trabajos(id,lead_id,pestana,fila) values(s.id,s.lead_id,origen->>'pestana',(origen->>'fila')::integer) on conflict do nothing;
 end if;
 return;
end $$;
create or replace function public.ruta17_formulario() returns trigger language plpgsql security definer set search_path=public as $$
begin perform ruta17_aplicar_formulario(new);return new;end $$;
drop trigger if exists ruta17_formularios on public.inscripciones;
create trigger ruta17_formularios after insert on public.inscripciones for each row execute function public.ruta17_formulario();
-- Recuperación de formularios CRM ya recibidos antes de la migración;
select public.ruta17_aplicar_formulario(s) from public.inscripciones s order by created_at; -- no duplica solicitudes.
-- La revisión de Drive requiere reemitir su fila por Apps Script si aún no tiene origen_sheet.

revoke all on function public.ruta17_aplicar_formulario(public.inscripciones) from public,anon,authenticated;
-- Citas históricas: acreditar agenda solo con filas de citas, nunca solo por fase.
update public.citas set status=status where status in ('confirmada','pendiente','completada','asistio') and tipo in ('examen_ubicacion','clase_prueba');
create or replace function public.ruta17_conversacion() returns trigger language plpgsql security definer set search_path=public as $$
declare l public.leads; r jsonb;
begin
 if new.lead_id is null then return new; end if;
 update leads set ultima_actividad_at=new.ultimo_mensaje_at where id=new.lead_id and (ultima_actividad_at is null or ultima_actividad_at<new.ultimo_mensaje_at);
 if new.modo_humano is distinct from old.modo_humano then
  select * into l from leads where id=new.lead_id for update;
  r=l.ruta||jsonb_build_object('persona',case when new.modo_humano then to_jsonb(now()) else 'null'::jsonb end);
  perform guardar_ruta_lead(l.id,l.ruta_version,r,'{}','control_humano',l.paso,l.bloque);
 end if;
 return new;
end $$;
drop trigger if exists ruta17_conversacion on public.whatsapp_conversaciones;
create trigger ruta17_conversacion after update of modo_humano,ultimo_mensaje_at on public.whatsapp_conversaciones for each row execute function public.ruta17_conversacion();
commit;
