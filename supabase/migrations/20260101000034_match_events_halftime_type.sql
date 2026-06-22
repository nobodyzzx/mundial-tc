-- Amplía el CHECK de match_events.type para admitir el evento de entretiempo.
-- Antes: ('kickoff','goal'). Ahora suma 'halftime' (aviso de medio tiempo en vivo).
alter table public.match_events drop constraint if exists match_events_type_check;
alter table public.match_events add constraint match_events_type_check
  check (type = any (array['kickoff'::text, 'goal'::text, 'halftime'::text]));
