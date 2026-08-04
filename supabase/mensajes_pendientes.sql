create table if not exists mensajes_pendientes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  conversacion_id uuid,
  whatsapp text not null,
  nombre text,
  curso text,
  stage text,
  etapa text,
  intento integer,
  template_name text,
  template_params jsonb,
  mensaje text not null,
  estado text not null default 'pendiente', -- pendiente | enviado | descartado
  creado_at timestamptz not null default now(),
  procesado_at timestamptz
);

create index if not exists mensajes_pendientes_estado_idx on mensajes_pendientes(estado);
create index if not exists mensajes_pendientes_lead_id_idx on mensajes_pendientes(lead_id);

-- RLS
alter table mensajes_pendientes enable row level security;

create policy "admin full access mensajes_pendientes"
  on mensajes_pendientes for all
  using (true);
