-- Revisión diaria de conversaciones dentro del CRM (reemplaza el flujo manual por
-- Google Sheet). Una fila por lead/teléfono con actividad reciente; Harold deja
-- instrucciones en notas_harold, marca "pendiente_analisis" cuando ya terminó de
-- revisar, y Claude (en sesión, no automático) llena propuesta_claude después.

CREATE TABLE IF NOT EXISTS revision_diaria_conversaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,

  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  conversacion_id UUID REFERENCES whatsapp_conversaciones(id) ON DELETE CASCADE,
  telefono TEXT NOT NULL,
  nombre TEXT,

  notas_harold TEXT,
  propuesta_claude TEXT,

  estado TEXT NOT NULL DEFAULT 'nuevo'
    CHECK (estado IN ('nuevo', 'pendiente_analisis', 'analizado', 'resuelto')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (fecha, telefono)
);

CREATE INDEX IF NOT EXISTS revision_diaria_fecha_idx  ON revision_diaria_conversaciones(fecha);
CREATE INDEX IF NOT EXISTS revision_diaria_estado_idx ON revision_diaria_conversaciones(estado);

ALTER TABLE revision_diaria_conversaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin full access revision_diaria_conversaciones"
  ON revision_diaria_conversaciones FOR ALL USING (true);
