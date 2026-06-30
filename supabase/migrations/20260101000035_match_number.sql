-- Número de partido FIFA (73-104) explícito para cada llave de eliminatoria.
--
-- El resolver de bracket (lib/bracket.ts → resolveKnockoutCodes) traducía los códigos
-- de avance "W##"/"L##" derivando el número del ORDEN CRONOLÓGICO de las llaves. Eso es
-- incorrecto: FIFA no numera por hora de inicio —dentro de un mismo día el orden de
-- pateo no coincide con el número (p.ej. 29 jun: Brasil/Japón=M76 patea antes que
-- P.Bajos/Marruecos=M75)—, así que W74/W75/W76 quedaban permutados y metían al rival
-- equivocado en octavos (Paraguay en vez de Marruecos contra Canadá).
--
-- Ahora el número es un dato explícito y el resolver lo usa tal cual.
-- Backfill por proyecto (los external_id difieren entre PRUEBA y PROD): se mapea cada
-- external_id de ESPN a su número FIFA verificando los códigos de grupo (1F·2C·…) contra
-- el bracket oficial sembrado en seed-bracket-codes.ts. En PROD ya se aplicó a mano.
alter table public.matches add column if not exists match_number int;
comment on column public.matches.match_number is
  'Número de partido FIFA (73-104) de la llave; fuente de verdad para resolver W##/L##. NULL en fase de grupos.';
