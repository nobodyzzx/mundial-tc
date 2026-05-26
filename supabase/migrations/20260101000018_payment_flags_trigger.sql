-- Blindaje del sistema de pagos: monto_pagado es la fuente ÚNICA de verdad.
-- pago_70 y pago_50 dejan de escribirse a mano y se derivan SIEMPRE del monto,
-- vía trigger BEFORE INSERT/UPDATE. Así es imposible que vuelvan a desincronizarse
-- (ej. flag marcado sin monto, o monto cargado sin flag).
--
-- Reglas (ver src/lib/payments.ts):
--   pago_70 := monto_pagado >= 70   (depósito mínimo para entrar al pozo)
--   pago_50 := monto_pagado >= 120  (pago completo)

create or replace function sync_payment_flags()
returns trigger
language plpgsql
as $$
begin
  new.pago_70 := coalesce(new.monto_pagado, 0) >= 70;
  new.pago_50 := coalesce(new.monto_pagado, 0) >= 120;
  return new;
end;
$$;

-- Dispara en cualquier insert/update: aunque algún código intente escribir un flag
-- directamente, el trigger lo sobreescribe con el valor derivado del monto.
drop trigger if exists trg_sync_payment_flags on profiles;
create trigger trg_sync_payment_flags
  before insert or update on profiles
  for each row
  execute function sync_payment_flags();

-- Backfill: recomputa los flags de todas las filas según su monto_pagado actual.
update profiles
   set pago_70 = coalesce(monto_pagado, 0) >= 70,
       pago_50 = coalesce(monto_pagado, 0) >= 120;
