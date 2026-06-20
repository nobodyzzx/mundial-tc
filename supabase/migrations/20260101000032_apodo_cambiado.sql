-- Cambio de apodo de UNA SOLA VEZ por jugador (autogestión).
-- Para mantener el orden, cada jugador puede cambiar su apodo una vez y juega
-- con ese el resto del torneo. Esta bandera marca que ya gastó su cambio. El
-- réferi puede renombrar igual desde el panel (override): ese camino no la toca.
alter table public.profiles
  add column if not exists apodo_cambiado boolean not null default false;

comment on column public.profiles.apodo_cambiado is
  'El jugador ya usó su único cambio de apodo (autogestión en /perfil). El réferi puede renombrar desde el panel sin afectar esta bandera.';
