-- Envíos de pronóstico que fallaron en la BD DENTRO de la ventana de juego.
-- Guardan user_id + los marcadores (jsonb) para que el réferi los VALIDE
-- (inserte) desde el panel con un toque, sin reescribir los números. El username
-- no basta (los usuarios se renombran): por eso se persiste el user_id real.
create table if not exists public.pending_predictions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id),
  -- [{ match_id, user_home, user_away, user_home_pen, user_away_pen, user_winner_penalties }]
  entries     jsonb not null,
  reason      text,                       -- código/mensaje del error de BD
  created_at  timestamptz not null default now(),
  resolved    boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

comment on table public.pending_predictions is
  'Pronósticos que fallaron al guardar (BD caída) dentro de la ventana. El réferi los valida desde el panel; entries lleva los marcadores en jsonb.';

create index if not exists idx_pending_pred_unresolved
  on public.pending_predictions (resolved, created_at);

-- Solo el service-role (supabaseAdmin) la toca. RLS activo sin políticas bloquea
-- a anon/authenticated: ningún cliente puede leer pronósticos pendientes ajenos.
alter table public.pending_predictions enable row level security;
