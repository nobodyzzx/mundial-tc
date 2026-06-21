/**
 * Respaldos de la BD de PRODUCCIÓN (plan free de Supabase = sin backups nativos).
 * La app genera un dump SQL de los DATOS de la polla y lo envía a un webhook de
 * n8n, que lo guarda en un repo privado de GitHub. Dos momentos por día de juego:
 *   - 'pre': al cerrarse los pronósticos (cutoff 2h antes del primer partido) —
 *            snapshot de TODOS los pronósticos antes de cualquier resultado.
 *   - 'fin': cuando el último partido del día queda finalizado — snapshot con
 *            resultados, puntos y sanciones ya calculados.
 *
 * Retención de 1 semana SIN lógica de borrado: el archivo se nombra por día de la
 * semana (backups/<dia>-<motivo>.sql), así la semana siguiente se sobrescribe y el
 * repo siempre conserva los últimos 7 días.
 *
 * NOTA: respalda DATOS de la polla (no el esquema auth ni logs operativos). Para
 * restaurar, los usuarios de auth deben existir (recuperación dentro del mismo
 * proyecto). Protege contra borrados/corrupción de datos, no pérdida total del
 * proyecto. Best-effort: nunca rompe el sync que lo invoca.
 */
import { supabaseAdmin } from './supabase';
import { boliviaDayKey } from './jornada';

const WEBHOOK = import.meta.env.N8N_BACKUP_WEBHOOK_URL;
const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

// Tablas de ESTADO de la polla a respaldar (en orden de dependencia de FKs).
const TABLES = [
  'settings', 'profiles', 'matches', 'predictions',
  'sanctions', 'announcements', 'match_events', 'pending_predictions',
];

function sqlVal(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`; // jsonb
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function dumpTable(table: string): Promise<string> {
  // .range hasta 99999 evita el truncado por defecto (~1000 filas) de PostgREST:
  // los pronósticos pueden superar 1000 al avanzar el torneo.
  const { data } = await supabaseAdmin.from(table).select('*').range(0, 99999);
  if (!data?.length) return `-- ${table}: 0 filas\n`;
  const cols = Object.keys(data[0]);
  const rows = data.map(
    (r) => `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${cols.map((c) => sqlVal(r[c])).join(', ')}) ON CONFLICT DO NOTHING;`,
  );
  return `-- ${table}: ${data.length} filas\n${rows.join('\n')}\n`;
}

export async function buildDump(reason: string): Promise<string> {
  const head = [
    '-- Polla Mundial 2026 — Respaldo PROD (datos)',
    `-- ${new Date().toISOString()} · motivo: ${reason}`,
    '',
  ];
  const body: string[] = [];
  for (const t of TABLES) body.push(await dumpTable(t));
  return head.concat(body).join('\n');
}

async function yaRespaldado(key: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('sync_logs').select('id').eq('source', 'backup').eq('endpoint', key).limit(1);
  return !!data?.length;
}

/** Genera el dump y lo manda al webhook de n8n. Deduplicado por (motivo, día). */
export async function sendBackup(reason: 'pre' | 'fin', gameDayMs: number): Promise<void> {
  if (!WEBHOOK) return;
  try {
    const dayKey = boliviaDayKey(gameDayMs);
    const dedup = `${reason}:${dayKey}`;
    if (await yaRespaldado(dedup)) return;

    const dump = await buildDump(reason);
    const path = `backups/${DIAS[new Date(dayKey).getUTCDay()]}-${reason}.sql`;
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, reason, content: dump }),
    });
    // Sella el dedupe solo si se envió bien (si falla, reintenta en la próxima corrida).
    if (res.ok) {
      await supabaseAdmin.from('sync_logs').insert({
        source: 'backup', endpoint: dedup, response_status: 200, matches_updated: 0, error: null,
      });
    }
  } catch { /* el respaldo nunca debe romper el sync */ }
}

/**
 * Revisa si toca respaldar (se llama en cada corrida de sync). Recorre los días de
 * juego y dispara 'pre' (cutoff pasó y aún no empieza) y 'fin' (todo finalizado
 * hace <12h). El dedupe asegura una sola copia por motivo y día.
 */
export async function runBackupChecks(): Promise<void> {
  if (!WEBHOOK) return;
  try {
    const { data: ms } = await supabaseAdmin.from('matches').select('match_date, is_finished');
    if (!ms?.length) return;
    const now = Date.now();
    const days = new Map<number, { first: number; last: number; unfinished: number }>();
    for (const m of ms) {
      const t = new Date(m.match_date).getTime();
      const k = boliviaDayKey(t);
      const d = days.get(k) ?? { first: Infinity, last: -Infinity, unfinished: 0 };
      d.first = Math.min(d.first, t);
      d.last = Math.max(d.last, t);
      if (!m.is_finished) d.unfinished++;
      days.set(k, d);
    }
    for (const [k, d] of days) {
      const cutoff = d.first - 2 * 3600 * 1000;
      if (now >= cutoff && now < d.first) await sendBackup('pre', k);
      if (d.unfinished === 0 && now - d.last < 12 * 3600 * 1000) await sendBackup('fin', k);
    }
  } catch { /* best-effort */ }
}
