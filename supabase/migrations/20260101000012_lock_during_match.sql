-- ============================================================
-- Polla Mundial 2026 — Bloqueo durante partidos en curso
-- ============================================================
-- Si hay algún partido que ya empezó pero no terminó,
-- se bloquean los pronósticos de TODOS los partidos futuros.
-- Evita que alguien vea el resultado de hoy y ajuste mañana.
-- ============================================================

-- Reemplazar la policy de insert con la nueva condición
DROP POLICY IF EXISTS "predictions_insert" ON predictions;

CREATE POLICY "predictions_insert" ON predictions FOR INSERT WITH CHECK (
    user_id = auth.uid()
    -- Bloqueo: no puede predecir si faltan menos de 2 horas
    AND (SELECT match_date FROM matches WHERE id = match_id) > NOW() + INTERVAL '2 hours'
    -- Bloqueo: partido no finalizado
    AND NOT (SELECT is_finished FROM matches WHERE id = match_id)
    -- Bloqueo: no puede predecir si hay algún partido en curso
    AND NOT EXISTS (
        SELECT 1 FROM matches
        WHERE is_finished = FALSE
        AND match_date <= NOW()
    )
);
