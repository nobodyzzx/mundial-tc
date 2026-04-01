import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { betaNow } from '@/lib/betaTime';
import { getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const now = betaNow(); // usa el tiempo simulado en beta (jun 2026), real en producción
  const d = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();

  // ══════════════════════════════════════════════════════════
  //  DISEÑO TEMPORAL — producción beta:
  //
  //  J1 (−72h): terminada con resultados
  //  J2 (−48h): terminada con resultados
  //  J3 (+6h):  ABIERTA para pronósticos (>2h)
  //  R16 (+72h): abierta para pronósticos
  //  Cuartos/Semi/Final: futuro lejano, abiertos
  // ══════════════════════════════════════════════════════════

  const rows = [
    // ════ GRUPO A ═══════════════════════════════════════════
    { home_team:'Argentina',      away_team:'Bolivia',        match_date:d(-72),   stage:'group',   group_name:'A', round:null,         jornada:'Jornada 1', home_score:3,    away_score:0,    is_finished:true  },
    { home_team:'Mexico',         away_team:'Polonia',        match_date:d(-71.5), stage:'group',   group_name:'A', round:null,         jornada:'Jornada 1', home_score:1,    away_score:1,    is_finished:true  },
    { home_team:'Argentina',      away_team:'Mexico',         match_date:d(-48),   stage:'group',   group_name:'A', round:null,         jornada:'Jornada 2', home_score:2,    away_score:1,    is_finished:true  },
    { home_team:'Bolivia',        away_team:'Polonia',        match_date:d(-47.5), stage:'group',   group_name:'A', round:null,         jornada:'Jornada 2', home_score:0,    away_score:2,    is_finished:true  },
    { home_team:'Argentina',      away_team:'Polonia',        match_date:d(6),     stage:'group',   group_name:'A', round:null,         jornada:'Jornada 3', home_score:null, away_score:null, is_finished:false },
    { home_team:'Bolivia',        away_team:'Mexico',         match_date:d(6.5),   stage:'group',   group_name:'A', round:null,         jornada:'Jornada 3', home_score:null, away_score:null, is_finished:false },

    // ════ GRUPO B ═══════════════════════════════════════════
    { home_team:'Brasil',         away_team:'Peru',           match_date:d(-71),   stage:'group',   group_name:'B', round:null,         jornada:'Jornada 1', home_score:2,    away_score:0,    is_finished:true  },
    { home_team:'Colombia',       away_team:'Uruguay',        match_date:d(-70.5), stage:'group',   group_name:'B', round:null,         jornada:'Jornada 1', home_score:1,    away_score:1,    is_finished:true  },
    { home_team:'Brasil',         away_team:'Colombia',       match_date:d(-47),   stage:'group',   group_name:'B', round:null,         jornada:'Jornada 2', home_score:1,    away_score:1,    is_finished:true  },
    { home_team:'Uruguay',        away_team:'Peru',           match_date:d(-46.5), stage:'group',   group_name:'B', round:null,         jornada:'Jornada 2', home_score:2,    away_score:0,    is_finished:true  },
    { home_team:'Brasil',         away_team:'Uruguay',        match_date:d(7),     stage:'group',   group_name:'B', round:null,         jornada:'Jornada 3', home_score:null, away_score:null, is_finished:false },
    { home_team:'Colombia',       away_team:'Peru',           match_date:d(7.5),   stage:'group',   group_name:'B', round:null,         jornada:'Jornada 3', home_score:null, away_score:null, is_finished:false },

    // ════ GRUPO C ═══════════════════════════════════════════
    { home_team:'Francia',        away_team:'Portugal',       match_date:d(-70),   stage:'group',   group_name:'C', round:null,         jornada:'Jornada 1', home_score:2,    away_score:0,    is_finished:true  },
    { home_team:'Alemania',       away_team:'Espana',         match_date:d(-69.5), stage:'group',   group_name:'C', round:null,         jornada:'Jornada 1', home_score:1,    away_score:1,    is_finished:true  },
    { home_team:'Francia',        away_team:'Alemania',       match_date:d(-46),   stage:'group',   group_name:'C', round:null,         jornada:'Jornada 2', home_score:1,    away_score:1,    is_finished:true  },
    { home_team:'Espana',         away_team:'Portugal',       match_date:d(-45.5), stage:'group',   group_name:'C', round:null,         jornada:'Jornada 2', home_score:2,    away_score:0,    is_finished:true  },
    { home_team:'Francia',        away_team:'Espana',         match_date:d(8),     stage:'group',   group_name:'C', round:null,         jornada:'Jornada 3', home_score:null, away_score:null, is_finished:false },
    { home_team:'Alemania',       away_team:'Portugal',       match_date:d(8.5),   stage:'group',   group_name:'C', round:null,         jornada:'Jornada 3', home_score:null, away_score:null, is_finished:false },

    // ════ GRUPO D ═══════════════════════════════════════════
    { home_team:'Inglaterra',     away_team:'Iran',           match_date:d(-69),   stage:'group',   group_name:'D', round:null,         jornada:'Jornada 1', home_score:2,    away_score:0,    is_finished:true  },
    { home_team:'Estados Unidos', away_team:'Marruecos',      match_date:d(-68.5), stage:'group',   group_name:'D', round:null,         jornada:'Jornada 1', home_score:1,    away_score:1,    is_finished:true  },
    { home_team:'Inglaterra',     away_team:'Estados Unidos', match_date:d(-45),   stage:'group',   group_name:'D', round:null,         jornada:'Jornada 2', home_score:1,    away_score:1,    is_finished:true  },
    { home_team:'Iran',           away_team:'Marruecos',      match_date:d(-44.5), stage:'group',   group_name:'D', round:null,         jornada:'Jornada 2', home_score:0,    away_score:2,    is_finished:true  },
    { home_team:'Inglaterra',     away_team:'Marruecos',      match_date:d(9),     stage:'group',   group_name:'D', round:null,         jornada:'Jornada 3', home_score:null, away_score:null, is_finished:false },
    { home_team:'Estados Unidos', away_team:'Iran',           match_date:d(9.5),   stage:'group',   group_name:'D', round:null,         jornada:'Jornada 3', home_score:null, away_score:null, is_finished:false },

    // ════ OCTAVOS — ABIERTO para pronósticos (+72h) ══════════
    { home_team:'TBD',            away_team:'TBD',            match_date:d(72),    stage:'knockout', group_name:null, round:'R16',       jornada:'R16',        home_score:null, away_score:null, is_finished:false },
    { home_team:'TBD',            away_team:'TBD',            match_date:d(73),    stage:'knockout', group_name:null, round:'R16',       jornada:'R16',        home_score:null, away_score:null, is_finished:false },

    // ════ CUARTOS — ABIERTO para pronósticos (+120h) ═════════
    { home_team:'TBD',            away_team:'TBD',            match_date:d(120),   stage:'knockout', group_name:null, round:'Cuartos',   jornada:'Cuartos',    home_score:null, away_score:null, is_finished:false },
    { home_team:'TBD',            away_team:'TBD',            match_date:d(121),   stage:'knockout', group_name:null, round:'Cuartos',   jornada:'Cuartos',    home_score:null, away_score:null, is_finished:false },

    // ════ SEMIFINAL / TERCER PUESTO / FINAL ══════════════════
    { home_team:'TBD',            away_team:'TBD',            match_date:d(168),   stage:'knockout', group_name:null, round:'Semifinal', jornada:'Semifinal',  home_score:null, away_score:null, is_finished:false },
    { home_team:'TBD',            away_team:'TBD',            match_date:d(169),   stage:'knockout', group_name:null, round:'Semifinal', jornada:'Semifinal',  home_score:null, away_score:null, is_finished:false },
    { home_team:'TBD',            away_team:'TBD',            match_date:d(216),   stage:'knockout', group_name:null, round:'Tercer Puesto', jornada:'Tercer Puesto', home_score:null, away_score:null, is_finished:false },
    { home_team:'TBD',            away_team:'TBD',            match_date:d(218),   stage:'knockout', group_name:null, round:'Final',     jornada:'Final',      home_score:null, away_score:null, is_finished:false },
  ];

  const { error } = await supabaseAdmin.from('matches').insert(rows);
  if (error) {
    return redirect(`/admin?err=${encodeURIComponent('Error: ' + error.message)}`);
  }

  return redirect(`/admin?msg=${encodeURIComponent('Fixture cargado · J1-J2 terminadas · J3 abierta (+6h) · R16-Final abiertos')}`);
};
