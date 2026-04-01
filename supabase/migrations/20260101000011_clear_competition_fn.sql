-- ============================================================
-- Polla Mundial 2026 — Función para limpiar la competición
-- SECURITY DEFINER bypasea la RULE no_delete_predictions
-- (igual que calculate_match_points para no_update_predictions)
-- ============================================================

CREATE OR REPLACE FUNCTION clear_competition()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Predictions: la RULE bloquea DELETE normal, SECURITY DEFINER lo bypasea
  DELETE FROM predictions;
  DELETE FROM sanctions;
  DELETE FROM matches;
  UPDATE profiles
    SET puntos_totales = 0,
        expulsado      = FALSE,
        pago_70        = FALSE,
        pago_50        = FALSE;
END;
$$;
