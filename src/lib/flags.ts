// Mapa de nombres de selecciones → código ISO 3166-1 alpha-2
// Incluye nombres en español e inglés (football-data.org devuelve en inglés)
export const ISO_CODES: Record<string, string> = {
  // ── América ──
  'Mexico':'MX','Ecuador':'EC','Panama':'PA','Canada':'CA',
  'Jamaica':'JM','Argentina':'AR','Bolivia':'BO','Brasil':'BR',
  'Brazil':'BR','Uruguay':'UY','Colombia':'CO','Peru':'PE',
  'Paraguay':'PY','Haiti':'HT','Curazao':'CW','Curacao':'CW','Surinam':'SR',
  'Venezuela':'VE','Chile':'CL','Costa Rica':'CR','Honduras':'HN',
  'El Salvador':'SV','Guatemala':'GT','Trinidad and Tobago':'TT',
  'Cuba':'CU','Nicaragua':'NI','Bermuda':'BM','Barbados':'BB',
  'United States':'US','Estados Unidos':'US',
  // ── Europa ──
  'Alemania':'DE','Germany':'DE','Francia':'FR','France':'FR',
  'Espana':'ES','Spain':'ES','Portugal':'PT','Croacia':'HR',
  'Croatia':'HR','Belgica':'BE','Belgium':'BE','Paises Bajos':'NL',
  'Netherlands':'NL','Suiza':'CH','Switzerland':'CH','Austria':'AT',
  'Polonia':'PL','Poland':'PL','Dinamarca':'DK','Denmark':'DK',
  'Suecia':'SE','Sweden':'SE','Noruega':'NO','Norway':'NO',
  'Escocia':'GB-SCT','Scotland':'GB-SCT','Inglaterra':'GB-ENG','England':'GB-ENG',
  'Gales':'GB-WLS','Wales':'GB-WLS','Rep. de Irlanda':'IE','Ireland':'IE',
  'Italia':'IT','Italy':'IT','Ucrania':'UA','Ukraine':'UA',
  'Rumania':'RO','Romania':'RO','Eslovaquia':'SK','Slovakia':'SK',
  'Albania':'AL','Turquia':'TR','Turkey':'TR','Kosovo':'XK',
  'Macedonia del Norte':'MK','North Macedonia':'MK',
  'Rep. Checa':'CZ','Czech Republic':'CZ','Czechia':'CZ',
  'Serbia':'RS','Hungria':'HU','Hungary':'HU','Eslovenia':'SI','Slovenia':'SI',
  'Grecia':'GR','Greece':'GR','Finlandia':'FI','Finland':'FI',
  'Bosnia and Herzegovina':'BA','Bosnia-Herzegovina':'BA','Bosnia y Herzegovina':'BA','Bosnia':'BA','Georgia':'GE',
  // ── África ──
  'Senegal':'SN','Marruecos':'MA','Morocco':'MA','Ghana':'GH',
  'Sudafrica':'ZA','South Africa':'ZA','Argelia':'DZ','Algeria':'DZ',
  'Egipto':'EG','Egypt':'EG','Tunez':'TN','Tunisia':'TN',
  'Nigeria':'NG','Camerun':'CM','Cameroon':'CM','Costa de Marfil':'CI',
  'Ivory Coast':'CI',"Cote d'Ivoire":'CI','Cabo Verde':'CV','Cape Verde':'CV','Cape Verde Islands':'CV',
  'Congo DR':'CD','DR Congo':'CD','Mali':'ML','Burkina Faso':'BF',
  'Guinea':'GN','Zimbabwe':'ZW','Tanzania':'TZ','Zambia':'ZM',
  'Uganda':'UG','Kenya':'KE','Ethiopia':'ET','Rwanda':'RW',
  'Angola':'AO','Mozambique':'MZ','Namibia':'NA','Benin':'BJ',
  // ── Asia ──
  'Japon':'JP','Japan':'JP','Corea del Sur':'KR','South Korea':'KR',
  'Australia':'AU','Iran':'IR','Arabia Saudita':'SA','Saudi Arabia':'SA',
  'Catar':'QA','Qatar':'QA','Jordania':'JO','Jordan':'JO',
  'Uzbekistan':'UZ','Iraq':'IQ','China':'CN','India':'IN',
  'Vietnam':'VN','Thailand':'TH','Indonesia':'ID','Philippines':'PH',
  'Filipinas':'PH','Bahrain':'BH','Kuwait':'KW','Oman':'OM',
  'United Arab Emirates':'AE','Emiratos Arabes Unidos':'AE',
  // ── Oceanía ──
  'Nueva Zelanda':'NZ','New Zealand':'NZ','Nueva Caledonia':'NC','New Caledonia':'NC',
  'Fiji':'FJ','Papua New Guinea':'PG',
};

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Devuelve la URL del PNG de bandera para un nombre de selección, o null si no se reconoce. */
export function flagUrl(team: string, size: '16x12' | '20x15' | '24x18' | '32x24' = '24x18'): string | null {
  const code = ISO_CODES[team] ?? ISO_CODES[normalize(team)];
  if (!code) return null;
  return `https://flagcdn.com/${size}/${code.toLowerCase()}.png`;
}
