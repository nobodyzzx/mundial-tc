-- ── Fix: la sanción ROJA debe anular la jornada usando el DÍA Bolivia del
-- `created_at`, no una ventana [primer_partido−2h, último+4h] ─────────────────
--
-- Problema: la ventana anterior solo anulaba si la roja se creaba entre 2h antes
-- del primer partido y 4h después del último. Si el réferi pone la roja durante
-- el día pero ANTES de esa franja (p.ej. en la mañana, por spam en el grupo),
-- la sanción quedaba fuera de ventana y NO anulaba la jornada.
--
-- Fix: una roja/doble-roja creada en el día Bolivia D (frontera 03:00 BOT) anula
-- todos los partidos cuyo día de juego es D. Esto coincide con sanction.ts, que
-- usa boliviaDayStart(now) para anular en el momento de sancionar.
--
-- Solo cambia el bloque de la sanción roja respecto a 20260101000020; el resto
-- de calculate_match_points se mantiene idéntico.

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

    -- Sanción ROJA: anula la jornada si la roja se creó en el MISMO día Bolivia
    -- (frontera 03:00 BOT) que el día de juego del partido.
    UPDATE predictions p
    SET points_earned = 0
    WHERE p.match_id = p_match_id
      AND EXISTS (
          SELECT 1 FROM sanctions s
          WHERE s.user_id = p.user_id
            AND s.type IN ('red', 'double_red')
            AND s.active = TRUE
            AND date_trunc('day', (s.created_at AT TIME ZONE 'America/La_Paz') - INTERVAL '3 hours') = v_gameday
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
