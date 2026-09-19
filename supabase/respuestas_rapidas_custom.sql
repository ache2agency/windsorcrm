-- Respuestas rápidas agregadas por los usuarios desde el CRM (además de las
-- que ya vienen fijas en el código). Se agrupan dentro de los mismos grupos
-- existentes (Idiomas, Inscripción, etc.), compartidas entre todos los agentes.

create table if not exists public.respuestas_rapidas_custom (
  id uuid primary key default gen_random_uuid(),
  grupo text not null,
  label text not null,
  texto text not null,
  created_at timestamptz not null default now()
);

alter table public.respuestas_rapidas_custom enable row level security;

create policy "usuarios autenticados leen respuestas rapidas"
  on public.respuestas_rapidas_custom
  for select
  using (auth.role() = 'authenticated');

create policy "usuarios autenticados agregan respuestas rapidas"
  on public.respuestas_rapidas_custom
  for insert
  with check (auth.role() = 'authenticated');

create policy "usuarios autenticados borran respuestas rapidas"
  on public.respuestas_rapidas_custom
  for delete
  using (auth.role() = 'authenticated');
