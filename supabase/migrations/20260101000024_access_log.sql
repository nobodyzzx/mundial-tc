-- ── Log de accesos: entradas (login) y salidas (logout) del sistema ─────────
-- Registra cada inicio y cierre de sesión con usuario, método y hora. Sirve de
-- auditoría de actividad (ej. "¿desde cuándo no entra este jugador?"). Solo
-- escribe/lee el service role (supabaseAdmin); RLS activo sin políticas.

CREATE TABLE IF NOT EXISTS access_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    username   TEXT,
    event      TEXT NOT NULL,          -- 'login' | 'logout'
    method     TEXT,                   -- 'password' | 'magic' | 'recovery' | null
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS access_log_created_idx ON access_log (created_at DESC);
CREATE INDEX IF NOT EXISTS access_log_user_idx    ON access_log (user_id);
