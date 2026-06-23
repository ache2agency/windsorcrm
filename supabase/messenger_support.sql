-- Soporte para leads/conversaciones que llegan por Facebook Messenger
-- en vez de WhatsApp. Misma lógica de bot/CRM, identificador distinto (PSID).

-- leads.whatsapp se queda exclusivamente para números de teléfono reales
-- (tiene constraint unique y se usa para abrir links wa.me). El PSID de
-- Messenger se guarda en su propia columna.
alter table public.leads
  add column if not exists messenger_psid text unique;

comment on column public.leads.messenger_psid is 'Page-Scoped ID de Facebook Messenger — identidad del lead cuando llega por ese canal en vez de WhatsApp';

-- whatsapp_conversaciones.provider ya existe (ver reactivacion_intentos.sql).
-- Se reusa con el valor 'messenger'; la columna whatsapp de esa tabla también
-- se reusa como llave de texto genérica y guarda el PSID en esas filas.
comment on column public.whatsapp_conversaciones.provider is 'twilio | meta | messenger — si null, usa WHATSAPP_PROVIDER en el servidor';
