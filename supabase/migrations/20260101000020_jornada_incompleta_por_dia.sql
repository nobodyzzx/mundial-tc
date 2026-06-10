-- ── Fix: "jornada incompleta = 0 pts" debe agruparse por DÍA de juego, no por
-- el campo `jornada` ──────────────────────────────────────────────────────────
--
-- Problema: el campo `jornada` agrupa toda una RONDA de grupos ('Jornada 1' = 24
-- partidos en 7 días). La regla de scoring exigía pronosticar los 24 antes de que
-- el primer partido se calculara, lo cual es imposible (los días futuros están
-- bloqueados). Resultado: TODOS los pronósticos de grupos quedaban en 0 pts.
--
-- La UI, el cierre de jornada y el recordatorio ya tratan la jornada como el DÍA
-- Bolivia (que empieza a las 03:00 BOT, para que partidos de 00:00–02:59 cuenten
-- con la noche anterior — ver lib/jornada.ts boliviaDayStart). Esta función ahora
-- usa esa misma frontera.
--
-- Día de juego Bolivia de un partido:
--   date_trunc('day', (match_date AT TIME ZONE 'America/La_Paz') - interval '3 hours')

CREATE OR REPLACE FUNCTION calculate_match_points(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_match       matches%ROWTYPE;
    v_pred        predictions%ROWTYPE;
    v_points      INTEGER;
    v_real_result TEXT;
    v_processed   INTEGER := 0;
    v_gameday     TIMESTAMP;       -- día de juego Bolivia del partido (frontera 03:00 BOT)
    v_result      JSONB;
BEGIN
    SELECT * INTO v_match
    FROM matches
    WHERE id = p_match_id AND is_finished = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Partido % no encontrado o no marcado como finalizado', p_match_id;
    END IF;

    v_gameday := date_trunc('day', (v_match.match_date AT TIME ZONE 'America/La_Paz') - INTERVAL '3 hours');

    IF    v_match.home_score > v_match.away_score THEN v_real_result := 'home';
    ELSIF v_match.away_score > v_match.home_score THEN v_real_result := 'away';
    ELSE                                               v_real_result := 'draw';
    END IF;

    IF v_match.stage = 'knockout'
       AND v_real_result = 'draw'
       AND v_match.winner_penalties IS NULL THEN
        RAISE EXCEPTION 'Partido knockout terminó en empate pero falta winner_penalties';
    END IF;

    FOR v_pred IN
        SELECT * FROM predictions WHERE match_id = p_match_id
    LOOP
        v_points := prediction_points(
            v_match.stage,
            v_pred.user_home, v_pred.user_away,
            v_pred.user_home_pen, v_pred.user_away_pen, v_pred.user_winner_penalties,
            v_match.home_score, v_match.away_score,
            v_match.home_pen, v_match.away_pen, v_match.winner_penalties
        );

        UPDATE predictions
        SET points_earned = v_points
        WHERE id = v_pred.id;

        v_processed := v_processed + 1;
    END LOOP;

    -- Envío incompleto = 0 puntos: si el jugador no pronosticó TODOS los partidos
    -- del mismo DÍA de juego Bolivia, sus puntos de este partido se anulan.
    UPDATE predictions p
    SET points_earned = 0
    WHERE p.match_id = p_match_id
      AND EXISTS (
          SELECT 1
          FROM matches m_other
          WHERE date_trunc('day', (m_other.match_date AT TIME ZONE 'America/La_Paz') - INTERVAL '3 hours') = v_gameday
            AND m_other.id != p_match_id
            AND NOT EXISTS (
                SELECT 1 FROM predictions p2
                WHERE p2.user_id = p.user_id
                  AND p2.match_id = m_other.id
            )
      );

    -- Sanción ROJA del día anula puntos (ventana = partidos del mismo día de juego)
    UPDATE predictions p
    SET points_earned = 0
    WHERE p.match_id = p_match_id
      AND EXISTS (
          SELECT 1 FROM sanctions s
          WHERE s.user_id = p.user_id
            AND s.type IN ('red', 'double_red')
            AND s.active = TRUE
            AND s.created_at >= (
                SELECT MIN(match_date) - INTERVAL '2 hours'
                FROM matches
                WHERE date_trunc('day', (match_date AT TIME ZONE 'America/La_Paz') - INTERVAL '3 hours') = v_gameday
            )
            AND s.created_at <= (
                SELECT MAX(match_date) + INTERVAL '4 hours'
                FROM matches
                WHERE date_trunc('day', (match_date AT TIME ZONE 'America/La_Paz') - INTERVAL '3 hours') = v_gameday
            )
      );

    -- Recalcular puntos_totales
    UPDATE profiles
    SET puntos_totales = (
        SELECT COALESCE(SUM(pr.points_earned), 0)
        FROM predictions pr
        WHERE pr.user_id = profiles.id
          AND pr.points_earned IS NOT NULL
    )
    WHERE id IN (
        SELECT DISTINCT user_id FROM predictions WHERE match_id = p_match_id
    );

    SELECT jsonb_build_object(
        'match_id',    p_match_id,
        'home_team',   v_match.home_team,
        'away_team',   v_match.away_team,
        'real_result', v_real_result,
        'stage',       v_match.stage,
        'processed',   v_processed,
        'predictions', (
            SELECT jsonb_agg(jsonb_build_object(
                'user_id',    pr.user_id,
                'username',   pf.username,
                'prediction', pr.user_home || '-' || pr.user_away,
                'pen_score',  pr.user_home_pen || '-' || pr.user_away_pen,
                'points',     pr.points_earned
            ) ORDER BY pr.points_earned DESC NULLS LAST)
            FROM predictions pr
            JOIN profiles pf ON pf.id = pr.user_id
            WHERE pr.match_id = p_match_id
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;
