-- Tabla de secuencias de seguimiento por lead
-- Cada lead tiene una cola de acciones ordenadas por tier (1-5)
-- El sistema genera las acciones y los asesores las ejecutan

CREATE TABLE IF NOT EXISTS seguimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  conversacion_id UUID,

  -- Snapshot del lead para mostrar sin joins
  lead_nombre TEXT,
  lead_whatsapp TEXT NOT NULL,
  lead_curso TEXT,
  lead_stage TEXT,

  -- Secuencia
  tier INT NOT NULL CHECK (tier BETWEEN 1 AND 5),
  tipo TEXT NOT NULL CHECK (tipo IN ('mensaje_wa', 'llamada', 'template')),

  -- Contenido
  contenido_sugerido TEXT,  -- mensaje redactado por GPT (tier 1) o texto del template
  template_name TEXT,

  -- Estado
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'completado', 'saltado', 'cancelado')),
  notas_asesor TEXT,

  -- Scheduling
  fecha_programada TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Completion
  fecha_completado TIMESTAMPTZ,
  completado_por UUID REFERENCES profiles(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS seguimientos_lead_id_idx       ON seguimientos(lead_id);
CREATE INDEX IF NOT EXISTS seguimientos_estado_idx        ON seguimientos(estado);
CREATE INDEX IF NOT EXISTS seguimientos_fecha_idx         ON seguimientos(fecha_programada);
CREATE INDEX IF NOT EXISTS seguimientos_lead_estado_idx   ON seguimientos(lead_id, estado);

ALTER TABLE seguimientos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin full access seguimientos"
  ON seguimientos FOR ALL USING (true);
