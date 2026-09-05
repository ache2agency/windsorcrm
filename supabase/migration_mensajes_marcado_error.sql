-- MIGRACIÓN — marcar mensajes salientes del bot como "error" en el CRM.
-- Antes vivía solo como useState local en ConversationsPanel.jsx (se perdía
-- al refrescar y nadie más lo veía) — con esto queda compartido y consultable
-- (Claude puede revisarlos vía Supabase para dar seguimiento a fallas del bot).

alter table public.whatsapp_mensajes
  add column if not exists marcado_error boolean not null default false;

alter table public.whatsapp_mensajes
  add column if not exists marcado_error_at timestamptz;

create index if not exists idx_whatsapp_mensajes_marcado_error
  on public.whatsapp_mensajes (marcado_error)
  where marcado_error = true;
