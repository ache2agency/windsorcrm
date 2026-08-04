-- Agrega columnas para el sistema de revisión human-in-the-loop con códigos [A][B]
-- revision_codigo: 'a', 'b', 'c' — identifica qué conversación está esperando respuesta de Harold
-- revision_draft:  borrador redactado por GPT, pendiente de aprobación de Harold

ALTER TABLE whatsapp_conversaciones
  ADD COLUMN IF NOT EXISTS revision_codigo TEXT,
  ADD COLUMN IF NOT EXISTS revision_draft  TEXT;
