-- MIGRACIÓN — marcar conversaciones como leídas/no leídas en el CRM
-- (estado compartido entre todos los usuarios, como un solo WhatsApp:
-- en cuanto alguien abre la conversación queda "leída" para todos).

alter table public.whatsapp_conversaciones
  add column if not exists visto_at timestamptz;

-- Backfill: todo lo que ya existe se marca como visto al momento del
-- último mensaje, para no inundar el CRM de "no leídos" históricos al
-- desplegar esta función. Solo mensajes nuevos a partir de aquí generan
-- el indicador de no leído.
update public.whatsapp_conversaciones
  set visto_at = ultimo_mensaje_at
  where visto_at is null;
