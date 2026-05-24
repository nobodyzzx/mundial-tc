-- ============================================================
-- Polla Mundial 2026 — F0: Schema para datos en vivo
-- ============================================================
-- Agrega columnas a `matches` para soportar polling de partidos
-- en vivo desde football-data.org, y crea `sync_logs` para
-- auditoría/debug de las llamadas a la API.
--
-- Migración ADITIVA: cero impacto en código actual.
-- El cron y el admin existentes siguen funcionando exactamente igual
-- gracias al trigger que mantiene `status` ↔ `is_finished` sincronizados.
--
-- Aplicar en DataGrip contra Supabase.
-- ============================================================


-- ── 1. Columnas nuevas en `matches` ─────────────────────────

-- Estado real del partido según football-data.org.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS status TEXT
  CHECK (status IS NULL OR status IN (
    'SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'FINISHED',
    'SUSPENDED', 'POSTPONED', 'CANCELLED', 'AWARDED'
  ));

-- Minuto actual del partido (1..130 para tiempo extra). NULL si no está en juego.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS minute INTEGER
  CHECK (minute IS NULL OR (minute >= 0 AND minute <= 130));

-- Marcadores al medio tiempo. NULL hasta el descanso.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_home_ht INTEGER
  CHECK (score_home_ht IS NULL OR score_home_ht >= 0);

ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_away_ht INTEGER
  CHECK (score_away_ht IS NULL OR score_away_ht >= 0);

-- Última vez que el cron tocó este partido (debug + monitoreo).
ALTER TABLE matches ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Bandera: el réferi cargó manualmente este resultado. El cron NO debe pisarlo.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS manually_edited_by_referee BOOLEAN NOT NULL DEFAULT FALSE;


-- ── 2. Backfill: poblar `status` para los 104 partidos existentes ──

UPDATE matches SET status = 'FINISHED'
  WHERE is_finished = TRUE AND status IS NULL;

UPDATE matches SET status = 'SCHEDULED'
  WHERE is_finished = FALSE AND status IS NULL;


-- ── 3. Trigger: mantener `status` ↔ `is_finished` sincronizados ──
-- Todo el código actual (RLS, dashboard, cálculo de puntos) lee `is_finished`.
-- Cuando el cron live escriba `status='FINISHED'`, el trigger marca `is_finished=TRUE`.
-- Cuando el admin marque `is_finished=TRUE` manualmente, el trigger setea `status='FINISHED'`.

CREATE OR REPLACE FUNCTION sync_status_is_finished()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'FINISHED' THEN
    NEW.is_finished := TRUE;
  ELSIF NEW.is_finished = TRUE AND (NEW.status IS NULL OR NEW.status <> 'FINISHED') THEN
    NEW.status := 'FINISHED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_status_is_finished ON matches;

CREATE TRIGGER trg_sync_status_is_finished
  BEFORE INSERT OR UPDATE OF status, is_finished ON matches
  FOR EACH ROW
  EXECUTE FUNCTION sync_status_is_finished();


-- ── 4. Tabla `sync_logs` (auditoría de llamadas a la API de fútbol) ──

CREATE TABLE IF NOT EXISTS sync_logs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source           TEXT NOT NULL,          -- 'cron-live', 'cron-fixtures', 'admin-sync-scores'
    endpoint         TEXT NOT NULL,          -- ej: '/competitions/WC/matches?status=LIVE'
    response_status  INTEGER,                -- 200, 429, 502...
    matches_updated  INTEGER DEFAULT 0,
    duration_ms      INTEGER,
    error            TEXT,                   -- mensaje si falló; NULL si OK
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: solo el réferi lee. La escritura va por service-role (bypassea RLS).
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_logs_select_referi" ON sync_logs;

CREATE POLICY "sync_logs_select_referi" ON sync_logs FOR SELECT
  USING ((SELECT es_referi FROM profiles WHERE id = auth.uid()));


-- ── 5. Índices ───────────────────────────────────────────────

-- Cron live: encontrar partidos próximos/en juego en una sola query.
CREATE INDEX IF NOT EXISTS idx_matches_status_date
  ON matches(status, match_date);

-- Debug: últimos logs primero.
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at
  ON sync_logs(created_at DESC);

-- Filtrar logs por fuente cuando hay varios crones.
CREATE INDEX IF NOT EXISTS idx_sync_logs_source
  ON sync_logs(source, created_at DESC);
