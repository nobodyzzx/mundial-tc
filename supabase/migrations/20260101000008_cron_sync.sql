-- ============================================================
-- Cron automático de sync de resultados via pg_cron + pg_net
--
-- PREREQUISITOS:
--   1. La app debe estar deployada con URL pública (ej. Vercel)
--   2. Reemplazar APP_URL y CRON_SECRET con los valores reales
--   3. Ejecutar DESPUÉS de deployar la app
--
-- Para verificar que corrió: SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
-- Para cancelar:            SELECT cron.unschedule('polla-sync-scores');
-- ============================================================

-- Habilitar extensiones (ya disponibles en Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Eliminar job anterior si existe
SELECT cron.unschedule('polla-sync-scores') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'polla-sync-scores'
);

-- Crear el cron job:
-- Corre cada 5 minutos en ventana de partidos del Mundial 2026.
-- Partidos en Bolivia: 12:00 - 00:00 (más tarde con tiempos extra hasta ~01:30).
-- 16:00-23:59 UTC = 12:00-19:59 Bolivia
-- 00:00-05:59 UTC = 20:00-01:59 Bolivia (partidos nocturnos + buffer)
SELECT cron.schedule(
  'polla-sync-scores',
  '*/5 16-23,0-5 * * *',
  $$
  SELECT net.http_get(
    url     := 'https://TU-APP.vercel.app/api/cron/sync?secret=polla2026secret',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
