-- ── Bitácora central del sistema ────────────────────────────────────────────
-- Un único log para todo lo relevante: mensajes de WhatsApp enviados, marcadores
-- cargados (sync/manual), ingresos manuales del réferi, accesos y rechazos.
-- Responde "¿qué pasó, a qué hora y quién?" en un solo lugar. Solo service role
-- (supabaseAdmin) escribe/lee; RLS activo sin políticas.

CREATE TABLE IF NOT EXISTS system_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    category   TEXT NOT NULL,          -- whatsapp | marcador | pronostico | acceso | sistema
    event      TEXT,                   -- slug del evento
    actor      TEXT,                   -- quién: username | 'sistema' | 'ESPN' | 'réferi'
    summary    TEXT NOT NULL,          -- texto legible
    detail     TEXT
);

ALTER TABLE system_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS system_log_created_idx  ON system_log (created_at DESC);
CREATE INDEX IF NOT EXISTS system_log_category_idx ON system_log (category);
