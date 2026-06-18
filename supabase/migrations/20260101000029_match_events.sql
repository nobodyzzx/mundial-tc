-- ============================================================
-- Polla Mundial 2026 — match_events (eventos en vivo)
-- ============================================================
-- Tabla dedicada para los avisos en vivo Nivel 1 (arranque + gol).
-- Reemplaza el uso de `sync_logs` como almacén de idempotencia de
-- eventos: aquí cada fila ES un evento del partido, con goleador,
-- minuto y marcador, lo que además habilita un timeline en la app.
--
-- Idempotencia: índice único (match_id, type, home_score, away_score).
--   - kickoff → una sola fila por partido (0-0).
--   - goal    → una fila por marcador alcanzado (cada gol da un par
--               (h,a) único dentro del partido).
--
-- Migración ADITIVA. Aplicar en DataGrip contra Supabase.
-- ============================================================

CREATE TABLE IF NOT EXISTS match_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id    UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('kickoff', 'goal')),
  home_score  INTEGER NOT NULL DEFAULT 0 CHECK (home_score >= 0),
  away_score  INTEGER NOT NULL DEFAULT 0 CHECK (away_score >= 0),
  scorer      TEXT,
  minute      TEXT,
  penalty     BOOLEAN NOT NULL DEFAULT FALSE,
  own_goal    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotencia + consulta del timeline por partido.
CREATE UNIQUE INDEX IF NOT EXISTS match_events_unique
  ON match_events (match_id, type, home_score, away_score);

CREATE INDEX IF NOT EXISTS match_events_by_match
  ON match_events (match_id, created_at);

-- Solo el service-role (cron) escribe; lectura pública para un futuro
-- timeline en la app (no hay datos sensibles, igual que matches).
ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS match_events_read ON match_events;
CREATE POLICY match_events_read ON match_events
  FOR SELECT USING (true);
