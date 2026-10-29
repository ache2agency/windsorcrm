-- Ejecutar MANUALMENTE antes del merge. No aplica nada desde Next.js.
-- Documentos y solicitudes: únicamente service_role; lectura CRM mediante API con sesión.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inscripciones-privadas', 'inscripciones-privadas', false, 768000,
  array['application/pdf','image/jpeg','image/png','image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Incluso una policy permisiva de otro módulo no debe abrir este bucket.
create policy inscripciones_solo_backend on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'inscripciones-privadas')
with check (bucket_id <> 'inscripciones-privadas');

create table public.inscripciones (
  id uuid primary key,
  lead_id uuid not null references public.leads(id),
  programa text not null check (programa in ('licenciaturas','cursos-libres','diplomados','verano')),
  datos jsonb not null,
  documentos jsonb not null,
  created_at timestamptz not null default now()
);
create index inscripciones_lead_idx on public.inscripciones (lead_id, created_at desc);
alter table public.inscripciones enable row level security;
revoke all on public.inscripciones from anon, authenticated;
grant all on public.inscripciones to service_role;

-- Límite compartido entre instancias serverless, antes de subir archivos.
-- Solo conserva hashes de IP con sal privada, nunca IPs ni teléfonos en claro.
create table public.inscripcion_intentos (
  clave text primary key,
  inicio timestamptz not null default now(),
  intentos integer not null default 1
);
alter table public.inscripcion_intentos enable row level security;
revoke all on public.inscripcion_intentos from anon, authenticated;
grant all on public.inscripcion_intentos to service_role;
create function public.limitar_inscripcion(p_clave text) returns boolean
language sql security definer set search_path = public as $$
  insert into public.inscripcion_intentos(clave) values(p_clave)
  on conflict(clave) do update set
    intentos = case when inscripcion_intentos.inicio < now() - interval '1 hour' then 1 else inscripcion_intentos.intentos + 1 end,
    inicio = case when inscripcion_intentos.inicio < now() - interval '1 hour' then now() else inscripcion_intentos.inicio end
  returning intentos <= 20;
$$;
revoke all on function public.limitar_inscripcion(text) from public, anon, authenticated;
grant execute on function public.limitar_inscripcion(text) to service_role;

create function public.telefono_inscripcion(p_telefono text) returns text
language sql immutable set search_path = public as $$
  select case when length(n) = 10 then '52' || n
    when n ~ '^521[0-9]{10}$' then '52' || substring(n from 4)
    else n end
  from (select regexp_replace(p_telefono, '[^0-9]', '', 'g') as n) t;
$$;

create function public.registrar_inscripcion(
  p_id uuid, p_programa text, p_datos jsonb, p_documentos jsonb, p_asesor uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lead uuid;
  v_asignado uuid;
  v_whatsapp text := p_datos->>'whatsapp';
  v_previa public.inscripciones;
begin
  if v_whatsapp is null or v_whatsapp !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'WhatsApp inválido';
  end if;
  -- Serializa envíos simultáneos del mismo teléfono sin exigir un índice único
  -- sobre los leads históricos (pueden contener duplicados previos).
  perform pg_advisory_xact_lock(hashtextextended(v_whatsapp, 0));
  select * into v_previa from public.inscripciones where id = p_id;
  if found then
    if v_previa.datos->>'whatsapp' <> v_whatsapp or v_previa.programa <> p_programa then
      raise exception 'Identificador utilizado';
    end if;
    return jsonb_build_object('lead_id',v_previa.lead_id,'nuevo',false);
  end if;
  select id into v_lead from public.leads
  where public.telefono_inscripcion(whatsapp) = substring(v_whatsapp from 2)
  order by created_at asc, id asc limit 1;
  if v_lead is null then
    select id into v_asignado from public.profiles where id = p_asesor;
    if v_asignado is null then
      select id into v_asignado from public.profiles where rol = 'admin' order by id limit 1;
    end if;
    insert into public.leads (nombre,email,whatsapp,curso,stage,asignado_a)
    values (concat_ws(' ',p_datos->>'nombres',p_datos->>'apellido_paterno',nullif(p_datos->>'apellido_materno','')),
      p_datos->>'email',v_whatsapp,p_datos->>'curso','inscripcion_pendiente',v_asignado)
    returning id into v_lead;
  else
    -- Un formulario público no sobrescribe identidad, programa ni asesor ya existentes.
    update public.leads set stage = 'inscripcion_pendiente'
      where id = v_lead and stage is distinct from 'inscrito';
  end if;
  insert into public.inscripciones (id,lead_id,programa,datos,documentos)
    values (p_id,v_lead,p_programa,p_datos,p_documentos);
  update public.whatsapp_conversaciones set fase = 'inscribiendo', lead_id = v_lead
    where (lead_id = v_lead or public.telefono_inscripcion(whatsapp) = substring(v_whatsapp from 2))
    and not exists (select 1 from public.leads where id = v_lead and stage = 'inscrito');
  insert into public.lead_activities (lead_id,actor_id,event_type,title,detail,meta)
    values (v_lead,null,'inscripcion_recibida','Solicitud de inscripción recibida',
      'Documentos pendientes de revisión por coordinación.',
      jsonb_build_object('source','formulario_inscripcion','inscripcion_id',p_id,'programa',p_programa));
  return jsonb_build_object('lead_id',v_lead,'nuevo',true);
end;
$$;
revoke all on function public.registrar_inscripcion(uuid,text,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.registrar_inscripcion(uuid,text,jsonb,jsonb,uuid) to service_role;
commit;
