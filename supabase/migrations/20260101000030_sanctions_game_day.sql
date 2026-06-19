-- Día de juego (frontera 03:00 BOT) al que corresponde la tarjeta.
-- Permite sancionar un día anterior: la anulación de puntos (roja/doble) apunta
-- a este día y el historial muestra el día real de la infracción, no el de
-- creación. Nullable: las tarjetas viejas no lo tienen (la UI cae a created_at).
alter table public.sanctions add column if not exists game_day timestamptz;

comment on column public.sanctions.game_day is
  'Inicio del día de juego (03:00 BOT) al que se imputa la tarjeta. NULL en tarjetas previas a esta columna; la UI usa created_at como respaldo.';
