-- Las RULES de PostgreSQL operan a nivel de query rewrite y bloquean UPDATEs
-- incluso dentro de funciones SECURITY DEFINER, a diferencia de RLS que sí es
-- bypasseable con SECURITY DEFINER. El comentario original en el esquema era incorrecto.
--
-- Efecto en producción: calculate_match_points() reportaba éxito pero todas las
-- predicciones quedaban con points_earned = NULL porque el UPDATE era silenciado.
--
-- La protección de escritura no necesita RULES: RLS ya está activo en la tabla y
-- no tiene políticas UPDATE/DELETE para usuarios autenticados → deniega por defecto.
-- Las funciones SECURITY DEFINER (calculate_match_points, clear_competition) pueden
-- escribir porque bypass RLS, no porque bypass RULES.

DROP RULE IF EXISTS no_update_predictions ON predictions;
DROP RULE IF EXISTS no_delete_predictions ON predictions;
