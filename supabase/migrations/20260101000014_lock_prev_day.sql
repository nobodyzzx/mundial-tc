-- ============================================================
-- Polla Mundial 2026 — Bloqueo por día anterior sin terminar
-- ============================================================
-- Si existe algún partido sin terminar (is_finished=FALSE) cuya
-- fecha es anterior al partido que se intenta pronosticar,
-- el INSERT queda bloqueado.
-- Esto asegura que no se puedan hacer pronósticos del día siguiente
-- hasta que todos los partidos del día actual hayan terminado.
-- ============================================================

DROP POLICY IF EXISTS "predictions_insert" ON predictions;

CREATE POLICY "predictions_insert" ON predictions FOR INSERT WITH CHECK (
    user_id = auth.uid()
    -- Bloqueo: no puede predecir si faltan menos de 2 horas
    AND (SELECT match_date FROM matches WHERE id = match_id) > NOW() + INTERVAL '2 hours'
    -- Bloqueo: partido ya finalizado
    AND NOT (SELECT is_finished FROM matches WHERE id = match_id)
    -- Bloqueo: existe algún partido sin terminar de un día anterior
    AND NOT EXISTS (
        SELECT 1 FROM matches prev
        WHERE prev.is_finished = FALSE
        AND date_trunc('day', prev.match_date AT TIME ZONE 'America/La_Paz') <
            date_trunc('day', (SELECT m.match_date FROM matches m WHERE m.id = match_id) AT TIME ZONE 'America/La_Paz')
    )
    -- Bloqueo: partido en curso del mismo día
    AND NOT EXISTS (
        SELECT 1 FROM matches same_day
        WHERE same_day.match_date <= NOW()
        AND date_trunc('day', same_day.match_date AT TIME ZONE 'America/La_Paz') =
            date_trunc('day', (SELECT m.match_date FROM matches m WHERE m.id = match_id) AT TIME ZONE 'America/La_Paz')
    )
);
