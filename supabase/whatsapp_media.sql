-- Guarda la URL del archivo multimedia real (imagen/sticker) subido a Supabase Storage,
-- para que el CRM pueda mostrar la imagen en vez de solo un texto generado por IA
-- (o el sentinel crudo __MEDIA__ cuando la descripción de IA fallaba).
-- Bug reportado 2-sep-2026: "cuando envían imagen o emojis no se pueden ver".

alter table public.whatsapp_mensajes
  add column if not exists media_url text,
  add column if not exists media_tipo text; -- 'image' | 'sticker'
