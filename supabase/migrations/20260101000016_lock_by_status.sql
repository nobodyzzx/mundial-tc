-- ============================================================
-- Polla Mundial 2026 — F1: Bloqueo adicional por `status`
-- ============================================================
-- Suma una condición a la RLS de `predictions_insert`:
-- si el partido tiene status IN_PLAY / PAUSED / FINISHED,
-- el INSERT queda bloqueado, sin importar la hora.
--
-- Esto es DEFENSA EN PROFUNDIDAD:
--   • El bloqueo de jornada (2h antes del primer partido) sigue
--     siendo CANÓNICO — nunca se afloja.
--   • Esta condición solo SUMA restricciones contra el caso raro
--     "la API dice que ya empezó pero por reloj aún no era el corte"
--     (partido adelantado, error de fixture, etc.).
--
-- Nota: si `status IS NULL` por algún motivo, el bloqueo no se
-- aplica (NOT NULL es TRUE) y mandan las otras 4 condiciones.
-- Después del backfill de F0 ningún partido tiene status NULL.
-- ============================================================

DROP POLICY IF EXISTS "predictions_insert" ON predictions;

CREATE POLICY "predictions_insert" ON predictions FOR INSERT WITH CHECK (
    user_id = auth.uid()
    -- Bloqueo 1: faltan menos de 2 horas al kickoff
    AND (SELECT match_date FROM matches WHERE id = match_id) > NOW() + INTERVAL '2 hours'
    -- Bloqueo 2: partido ya marcado como terminado
    AND NOT (SELECT is_finished FROM matches WHERE id = match_id)
    -- Bloqueo 3: partido en curso/descanso/terminado según la API (NUEVO en F1)
    AND (
        (SELECT status FROM matches WHERE id = match_id) IS NULL
        OR (SELECT status FROM matches WHERE id = match_id) NOT IN ('IN_PLAY', 'PAUSED', 'FINISHED')
    )
    -- Bloqueo 4: existe algún partido sin terminar de un día anterior
    AND NOT EXISTS (
        SELECT 1 FROM matches prev
        WHERE prev.is_finished = FALSE
        AND date_trunc('day', prev.match_date AT TIME ZONE 'America/La_Paz') <
            date_trunc('day', (SELECT m.match_date FROM matches m WHERE m.id = match_id) AT TIME ZONE 'America/La_Paz')
    )
    -- Bloqueo 5: partido del mismo día ya iniciado por reloj
    AND NOT EXISTS (
        SELECT 1 FROM matches same_day
        WHERE same_day.match_date <= NOW()
        AND date_trunc('day', same_day.match_date AT TIME ZONE 'America/La_Paz') =
            date_trunc('day', (SELECT m.match_date FROM matches m WHERE m.id = match_id) AT TIME ZONE 'America/La_Paz')
    )
);
