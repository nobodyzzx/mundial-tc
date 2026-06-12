-- ── Marca de pronóstico ingresado por el réferi ─────────────────────────────
-- Distingue los pronósticos que cargó/editó el réferi desde /admin/ingresar
-- (vía manual-prediction) de los que ingresó el propio jugador. Sirve de rastro
-- de auditoría para excepciones (ej. acreditar a un jugador que pronosticó por
-- fuera del cierre). Los pronósticos normales quedan en FALSE por defecto.

ALTER TABLE predictions
    ADD COLUMN IF NOT EXISTS ingresado_por_referi BOOLEAN NOT NULL DEFAULT FALSE;
