-- ============================================================
-- Polla Mundial 2026 — Bloqueo por partido del mismo día
-- ============================================================
-- Amplía el bloqueo: si ya hubo cualquier partido de HOY
-- (aunque haya terminado), los partidos restantes del mismo día
-- permanecen bloqueados hasta que el último del día termine.
-- ============================================================

DROP POLICY IF EXISTS "predictions_insert" ON predictions;

CREATE POLICY "predictions_insert" ON predictions FOR INSERT WITH CHECK (
    user_id = auth.uid()
    -- Bloqueo: no puede predecir si faltan menos de 2 horas
    AND (SELECT match_date FROM matches WHERE id = match_id) > NOW() + INTERVAL '2 hours'
    -- Bloqueo: partido no finalizado
    AND NOT (SELECT is_finished FROM matches WHERE id = match_id)
    -- Bloqueo: si ya hubo algún partido del mismo día (terminado o en curso)
    -- O si hay algún partido en curso de cualquier día anterior
    AND NOT EXISTS (
        SELECT 1 FROM matches started
        WHERE started.match_date <= NOW()
        AND (
            -- Mismo día en hora Bolivia (UTC-4)
            date_trunc('day', started.match_date AT TIME ZONE 'America/La_Paz') =
            date_trunc('day', (SELECT m.match_date FROM matches m WHERE m.id = match_id) AT TIME ZONE 'America/La_Paz')
            OR
            -- Partido en curso de cualquier día
            started.is_finished = FALSE
        )
    )
);
