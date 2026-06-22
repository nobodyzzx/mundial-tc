/**
 * Verifica que isoFlags cubre las 48 selecciones del Mundial 2026 con las grafías
 * EXACTAS que manda ESPN (sacadas de la tabla `matches` en prod, partidos de grupo).
 * Uso: pnpm exec tsx scripts/check-isoflags.ts
 */
import { isoForTeam, spanishName, teamFlag } from '../src/lib/isoFlags';

// Grafías reales de ESPN (count=3 en matches = fase de grupos). 48 equipos.
const TEAMS = [
  'Algeria', 'Argentina', 'Australia', 'Austria', 'Belgium', 'Bosnia-Herzegovina',
  'Brazil', 'Canada', 'Cape Verde Islands', 'Colombia', 'Congo DR', 'Croatia',
  'Curaçao', 'Czechia', 'Ecuador', 'Egypt', 'England', 'France', 'Germany', 'Ghana',
  'Haiti', 'Iran', 'Iraq', 'Ivory Coast', 'Japan', 'Jordan', 'Mexico', 'Morocco',
  'Netherlands', 'New Zealand', 'Norway', 'Panama', 'Paraguay', 'Portugal', 'Qatar',
  'Saudi Arabia', 'Scotland', 'Senegal', 'South Africa', 'South Korea', 'Spain',
  'Sweden', 'Switzerland', 'Tunisia', 'Turkey', 'United States', 'Uruguay', 'Uzbekistan',
];

let missingIso = 0, missingFlag = 0, untranslated = 0;
for (const t of TEAMS) {
  const iso = isoForTeam(t);
  const flag = teamFlag(t);
  const es = spanishName(t);
  if (!iso) { console.log(`❌ SIN ISO: ${t}`); missingIso++; }
  if (!flag) { console.log(`❌ SIN BANDERA: ${t}`); missingFlag++; }
  if (es === t && !/^(Argentina|Australia|Austria|Colombia|Ecuador|Ghana|Panama|Paraguay|Portugal|Senegal|Spain|Uruguay)$/.test(t)) {
    // Heurística: nombres en inglés que NO se tradujeron (los ya correctos en ES se omiten).
    console.log(`⚠️  SIN TRADUCIR: ${t}`);
    untranslated++;
  }
}

console.log(`\n${TEAMS.length} equipos · sin ISO: ${missingIso} · sin bandera: ${missingFlag} · sin traducir: ${untranslated}`);
if (missingIso || missingFlag) {
  console.log('RESULTADO: ❌ FALTAN GRAFÍAS');
  process.exit(1);
}
console.log('RESULTADO: ✅ las 48 grafías de ESPN están cubiertas (bandera + ISO)');
