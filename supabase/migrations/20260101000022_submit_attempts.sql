-- ── Registro de intentos de pronóstico RECHAZADOS ────────────────────────────
-- Cuando submit-jornada rechaza un envío (jornada cerrada, partido en juego,
-- expulsado, roja, datos inválidos, etc.) no quedaba ninguna huella en la BD:
-- el POST solo vivía en los logs de Vercel. Esta tabla guarda cada rechazo con
-- el usuario, el motivo, la hora y lo que intentó enviar (marcadores), para
-- resolver disputas del tipo "yo sí pronostiqué y no me lo tomó".
--
-- Solo escribe/lee el service role (supabaseAdmin). RLS activo sin políticas →
-- los clientes normales no acceden.

CREATE TABLE IF NOT EXISTS submit_attempts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    username    TEXT,
    reason      TEXT NOT NULL,          -- motivo del rechazo (slug corto)
    detail      TEXT,                   -- contexto: match ids + marcadores intentados
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE submit_attempts ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo el service role (bypass RLS) puede escribir/leer.

CREATE INDEX IF NOT EXISTS submit_attempts_created_idx ON submit_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS submit_attempts_user_idx    ON submit_attempts (user_id);
