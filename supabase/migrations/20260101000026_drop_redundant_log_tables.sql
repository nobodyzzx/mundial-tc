-- Consolidación de logs en la bitácora central system_log.
-- submit_attempts (intentos rechazados) y access_log (entradas/salidas) quedan
-- reemplazadas por system_log → se eliminan para no mantener logs duplicados.
DROP TABLE IF EXISTS submit_attempts;
DROP TABLE IF EXISTS access_log;
