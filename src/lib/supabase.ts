import { createClient } from '@supabase/supabase-js';

const ANON_AUTH = {
  flowType: 'implicit' as const,
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false,
};

/**
 * Cliente anon POR PETICIÓN. Úsalo siempre que vayas a hacer `setSession()` con
 * los tokens del usuario en SSR/API: cada request necesita su propia instancia
 * porque la sesión es estado MUTABLE del cliente. Compartir un singleton entre
 * peticiones concurrentes (Vercel reusa instancias calientes) provoca que un
 * `setSession` pise al de otro usuario → RLS rechaza el insert (42501) o las
 * lecturas filtradas por `auth.uid()` devuelven 0 filas.
 */
export function createRequestClient() {
  return createClient(
    import.meta.env.SUPABASE_URL,
    import.meta.env.SUPABASE_ANON_KEY,
    { auth: ANON_AUTH },
  );
}

/**
 * Cliente anon compartido. SOLO para lecturas de datos públicos que NO dependen
 * de la sesión del usuario (no llames a `setSession()` sobre este). Para flujos
 * autenticados usa `createRequestClient()`.
 */
export const supabase = createClient(
  import.meta.env.SUPABASE_URL,
  import.meta.env.SUPABASE_ANON_KEY,
  { auth: ANON_AUTH }
);

// Cliente admin (usa service role — bypasa RLS, solo para SSR/API routes)
export const supabaseAdmin = createClient(
  import.meta.env.SUPABASE_URL,
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY
);

// Tipos de la DB
export type Profile = {
  id: string;
  username: string;
  pago_70: boolean;
  pago_50: boolean;
  es_referi: boolean;
  expulsado: boolean;
  puntos_totales: number;
  created_at: string;
};

export type Match = {
  id: string;
  home_team: string;
  away_team: string;
  match_date: string;
  stage: 'group' | 'knockout';
  group_name: string | null;
  round: string | null;
  jornada: string | null;
  home_score: number | null;
  away_score: number | null;
  home_pen: number | null;
  away_pen: number | null;
  winner_penalties: 'home' | 'away' | null;
  is_finished: boolean;
};

export type Prediction = {
  id: string;
  user_id: string;
  match_id: string;
  user_home: number;
  user_away: number;
  user_home_pen: number | null;
  user_away_pen: number | null;
  user_winner_penalties: 'home' | 'away' | null;
  points_earned: number | null;
  created_at: string;
};

export type Sanction = {
  id: string;
  user_id: string;
  match_id: string | null;
  type: 'yellow' | 'red' | 'double_red';
  reason: string | null;
  active: boolean;
  created_by: string;
  created_at: string;
};
