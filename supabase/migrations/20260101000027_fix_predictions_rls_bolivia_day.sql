-- Fix: la política RLS de INSERT en predictions usaba la frontera de MEDIANOCHE
-- BOT para "día anterior sin terminar" y "mismo día ya iniciado", mientras que la
-- app (lib/jornada.ts boliviaDayStart) y el scoring usan las 03:00 BOT.
--
-- Síntoma: no se podía pronosticar un partido de 00:00-02:59 BOT (ej. Australia
-- vs Turquía 00:00) porque la RLS lo consideraba del día siguiente y lo bloqueaba
-- por "día anterior sin terminar". Como el envío de la jornada inserta todos los
-- partidos juntos, fallaba TODO el envío → no se guardaba nada.
--
-- Se alinea la RLS a la frontera 03:00 BOT (- interval '3 hours'), igual que el
-- resto de la app.

DROP POLICY IF EXISTS predictions_insert ON predictions;
CREATE POLICY predictions_insert ON predictions
FOR INSERT TO public
WITH CHECK (
  (user_id = auth.uid())
  AND ((SELECT m.match_date FROM matches m WHERE m.id = predictions.match_id) > (now() + interval '2 hours'))
  AND (NOT (SELECT m.is_finished FROM matches m WHERE m.id = predictions.match_id))
  AND (
    ((SELECT m.status FROM matches m WHERE m.id = predictions.match_id) IS NULL)
    OR ((SELECT m.status FROM matches m WHERE m.id = predictions.match_id) <> ALL (ARRAY['IN_PLAY','PAUSED','FINISHED']))
  )
  AND (NOT EXISTS (
    SELECT 1 FROM matches prev
    WHERE prev.is_finished = false
      AND date_trunc('day', (prev.match_date AT TIME ZONE 'America/La_Paz') - interval '3 hours')
        < date_trunc('day', ((SELECT m.match_date FROM matches m WHERE m.id = predictions.match_id) AT TIME ZONE 'America/La_Paz') - interval '3 hours')
  ))
  AND (NOT EXISTS (
    SELECT 1 FROM matches same_day
    WHERE same_day.match_date <= now()
      AND date_trunc('day', (same_day.match_date AT TIME ZONE 'America/La_Paz') - interval '3 hours')
        = date_trunc('day', ((SELECT m.match_date FROM matches m WHERE m.id = predictions.match_id) AT TIME ZONE 'America/La_Paz') - interval '3 hours')
  ))
);
