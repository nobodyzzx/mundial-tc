-- ============================================================
-- Polla Mundial 2026 — Puntos provisionales en vivo
-- ============================================================
-- 1. Escalar `prediction_points(...)` con TODA la lógica de puntuación
--    (extraída de calculate_match_points para ser fuente única de verdad).
-- 2. Refactor de `calculate_match_points` para que use la escalar.
-- 3. RPC read-only `provisional_match_points(match_id)` que aplica la escalar
--    al MARCADOR ACTUAL del partido (en vivo) — sin escribir nada.
--
-- El provisional NO aplica la regla de jornada-incompleta ni sanciones:
-- es "si terminara así", no el cálculo final.
-- ============================================================


-- ── 1. Escalar pura de puntos por pronóstico ─────────────────
-- Mismas reglas validadas en Python. IMMUTABLE: depende solo de sus argumentos.
CREATE OR REPLACE FUNCTION prediction_points(
    p_stage TEXT,
    p_uh INTEGER, p_ua INTEGER,                 -- pronóstico: marcador
    p_uhp INTEGER, p_uap INTEGER,               -- pronóstico: penales (nullable)
    p_uwp TEXT,                                 -- pronóstico: ganador penales (nullable)
    p_rh INTEGER, p_ra INTEGER,                 -- real: marcador
    p_rhp INTEGER, p_rap INTEGER,               -- real: penales (nullable)
    p_rwp TEXT                                  -- real: ganador penales (nullable)
) RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_points          INTEGER := 0;
    v_real_result     TEXT;
    v_pred_result     TEXT;
    v_exact_score     BOOLEAN;
    v_exact_pen_score BOOLEAN;
    v_correct_pen     BOOLEAN;
BEGIN
    IF p_rh IS NULL OR p_ra IS NULL OR p_uh IS NULL OR p_ua IS NULL THEN
        RETURN 0;
    END IF;

    -- Resultado real
    IF    p_rh > p_ra THEN v_real_result := 'home';
    ELSIF p_ra > p_rh THEN v_real_result := 'away';
    ELSE                   v_real_result := 'draw';
    END IF;

    -- Resultado pronosticado
    IF    p_uh > p_ua THEN v_pred_result := 'home';
    ELSIF p_ua > p_uh THEN v_pred_result := 'away';
    ELSE                   v_pred_result := 'draw';
    END IF;

    -- ── FASE DE GRUPOS ───────────────────────────────────────
    IF p_stage = 'group' THEN
        IF v_pred_result = v_real_result THEN
            v_points := 1;
            IF p_uh = p_rh AND p_ua = p_ra THEN
                v_points := 3;
            END IF;
        END IF;

    -- ── FASE ELIMINATORIA ────────────────────────────────────
    ELSE
        IF v_real_result <> 'draw' THEN
            IF v_pred_result = v_real_result THEN
                v_points := 1;
                IF p_uh = p_rh AND p_ua = p_ra THEN
                    v_points := 3;
                END IF;
            END IF;
        ELSE
            -- Empate → definición por penales
            IF v_pred_result <> 'draw' THEN
                v_points := 0;  -- No marcó empate → CERO (regla estricta)
            ELSE
                v_exact_score := (p_uh = p_rh AND p_ua = p_ra);

                v_exact_pen_score := (
                    p_rhp IS NOT NULL AND p_rap IS NOT NULL
                    AND p_uhp IS NOT NULL AND p_uap IS NOT NULL
                    AND p_uhp = p_rhp AND p_uap = p_rap
                );

                v_correct_pen := CASE
                    WHEN p_uhp IS NOT NULL AND p_uap IS NOT NULL THEN
                        (CASE
                            WHEN p_uhp > p_uap THEN 'home'
                            WHEN p_uap > p_uhp THEN 'away'
                            ELSE NULL
                         END) = p_rwp
                    ELSE
                        p_uwp = p_rwp
                END;

                IF     v_exact_score AND     v_exact_pen_score THEN v_points := 6;
                ELSIF  v_exact_score AND NOT v_exact_pen_score THEN v_points := 4;
                ELSIF NOT v_exact_score AND  v_correct_pen     THEN v_points := 2;
                ELSE                                                v_points := 1;
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN v_points;
END;
$$;


-- ── 2. Refactor de calculate_match_points para usar la escalar ──
-- Idéntico comportamiento; el cálculo por-pronóstico ahora delega en
-- prediction_points(). El resto (validación, jornada-incompleta, sanciones,
-- recálculo de totales y JSON de retorno) queda igual.
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
    v_result      JSONB;
BEGIN
    SELECT * INTO v_match
    FROM matches
    WHERE id = p_match_id AND is_finished = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Partido % no encontrado o no marcado como finalizado', p_match_id;
    END IF;

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

    -- Envío incompleto = 0 puntos (reglamento)
    IF v_match.jornada IS NOT NULL THEN
        UPDATE predictions p
        SET points_earned = 0
        WHERE p.match_id = p_match_id
          AND EXISTS (
              SELECT 1
              FROM matches m_other
              WHERE m_other.jornada = v_match.jornada
                AND m_other.id != p_match_id
                AND NOT EXISTS (
                    SELECT 1 FROM predictions p2
                    WHERE p2.user_id = p.user_id
                      AND p2.match_id = m_other.id
                )
          );
    END IF;

    -- Sanción ROJA de la jornada anula puntos
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
                FROM matches WHERE jornada = v_match.jornada
            )
            AND s.created_at <= (
                SELECT MAX(match_date) + INTERVAL '4 hours'
                FROM matches WHERE jornada = v_match.jornada
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


-- ── 3. RPC read-only de puntos provisionales ─────────────────
-- Aplica la escalar al marcador ACTUAL del partido. No escribe nada.
-- No aplica jornada-incompleta ni sanciones (es "si terminara así").
CREATE OR REPLACE FUNCTION provisional_match_points(p_match_id UUID)
RETURNS TABLE (
    user_id   UUID,
    username  TEXT,
    points    INTEGER,
    is_exact  BOOLEAN,
    is_result BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        pr.user_id,
        pf.username,
        prediction_points(
            m.stage,
            pr.user_home, pr.user_away,
            pr.user_home_pen, pr.user_away_pen, pr.user_winner_penalties,
            m.home_score, m.away_score,
            m.home_pen, m.away_pen, m.winner_penalties
        ) AS points,
        (pr.user_home = m.home_score AND pr.user_away = m.away_score) AS is_exact,
        (
            (pr.user_home > pr.user_away AND m.home_score > m.away_score)
            OR (pr.user_home < pr.user_away AND m.home_score < m.away_score)
            OR (pr.user_home = pr.user_away AND m.home_score = m.away_score)
        ) AS is_result
    FROM predictions pr
    JOIN matches m   ON m.id = pr.match_id
    JOIN profiles pf ON pf.id = pr.user_id
    WHERE pr.match_id = p_match_id
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION provisional_match_points(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provisional_match_points(UUID) TO authenticated;
