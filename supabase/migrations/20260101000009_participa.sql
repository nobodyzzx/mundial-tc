-- ============================================================
-- Polla Mundial 2026 — Columna participa en profiles
-- ============================================================
-- Indica si el usuario participa activamente en la polla.
-- TRUE  → jugador activo (aparece en tabla, resultados, etc.)
-- FALSE → réferi o excluido administrativamente
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS participa BOOLEAN NOT NULL DEFAULT TRUE;

-- Réferis no participan en la polla
UPDATE profiles SET participa = FALSE WHERE es_referi = TRUE;
