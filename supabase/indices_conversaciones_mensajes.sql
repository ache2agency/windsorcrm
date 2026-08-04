-- Índices faltantes en whatsapp_conversaciones y whatsapp_mensajes.
-- Ambas columnas son FOREIGN KEY pero Postgres no crea índice automático sobre la
-- columna que referencia (solo garantiza integridad referencial) — sin esto, las
-- consultas .in('lead_id', ...) y .in('conversacion_id', ...) hacen sequential scan.
-- Beneficia al fix de /api/seguimientos (batch queries) y a otros endpoints que ya
-- consultan por estas columnas hoy (ej. app/api/whatsapp/webhook/route.ts).

CREATE INDEX IF NOT EXISTS whatsapp_conversaciones_lead_id_idx
  ON whatsapp_conversaciones(lead_id);

CREATE INDEX IF NOT EXISTS whatsapp_mensajes_conv_rol_created_idx
  ON whatsapp_mensajes(conversacion_id, rol, created_at DESC);
