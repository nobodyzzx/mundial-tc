-- ============================================================================
-- Tablón de anuncios
-- El réferi publica un mensaje que se muestra dentro de la app (tablón) y,
-- opcionalmente, se envía al grupo de WhatsApp. Las inserciones van por el
-- servidor con service role (bypassa RLS); los usuarios solo leen.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.announcements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body             TEXT NOT NULL,
  author_name      TEXT NOT NULL,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_to_whatsapp BOOLEAN NOT NULL DEFAULT false,
  wa_detail        TEXT
);

CREATE INDEX IF NOT EXISTS announcements_created_at_idx
  ON public.announcements (created_at DESC);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado puede leer el tablón.
DROP POLICY IF EXISTS announcements_select_authenticated ON public.announcements;
CREATE POLICY announcements_select_authenticated
  ON public.announcements FOR SELECT
  TO authenticated
  USING (true);

-- Sin policy de INSERT/UPDATE/DELETE: solo el servidor (service role) escribe.
