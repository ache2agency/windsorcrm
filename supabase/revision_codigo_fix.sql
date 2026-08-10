-- Fix del bug de colisión de código A/B/C (88 conversaciones compartiendo 'c' desde jun-2026).
-- Agrega el timestamp de asignación que faltaba: permite auto-expirar códigos viejos
-- (en vez de quedarse pegados para siempre) y desempatar por recencia si alguna vez
-- llegara a haber más de una conversación con el mismo código.

ALTER TABLE whatsapp_conversaciones
  ADD COLUMN IF NOT EXISTS revision_codigo_asignado_at TIMESTAMPTZ;

-- Limpieza única de las conversaciones atoradas en el código 'c': con el pool ampliado
-- a a-z y la auto-expiración de 48h, ya no lo necesitan. Correr por separado, solo
-- después de confirmar con Harold en el chat (no es parte de la migración automática).
-- update whatsapp_conversaciones set revision_codigo = null, revision_draft = null
--   where revision_codigo is not null;
