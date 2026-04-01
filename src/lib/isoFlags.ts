/** Mapa de nombres de selecciones → código ISO 3166-1 alpha-2 */
export const ISO_CODES: Record<string, string> = {
  // ── América ──
  'Mexico':'MX','México':'MX','Ecuador':'EC','Panama':'PA','Panamá':'PA','Canada':'CA','Canadá':'CA',
  'Jamaica':'JM','Argentina':'AR','Bolivia':'BO','Brasil':'BR',
  'Brazil':'BR','Uruguay':'UY','Colombia':'CO','Peru':'PE','Perú':'PE',
  'Paraguay':'PY','Haiti':'HT','Haití':'HT','Curazao':'CW','Curacao':'CW','Surinam':'SR',
  'Venezuela':'VE','Chile':'CL','Costa Rica':'CR','Honduras':'HN',
  'El Salvador':'SV','Guatemala':'GT','Trinidad and Tobago':'TT','Trinidad y Tobago':'TT',
  'Cuba':'CU','Nicaragua':'NI','Bermuda':'BM','Barbados':'BB',
  'United States':'US','Estados Unidos':'US',
  // ── Europa ──
  'Alemania':'DE','Germany':'DE','Francia':'FR','France':'FR',
  'España':'ES','Espana':'ES','Spain':'ES','Portugal':'PT','Croacia':'HR',
  'Croatia':'HR','Bélgica':'BE','Belgica':'BE','Belgium':'BE','Países Bajos':'NL','Paises Bajos':'NL',
  'Netherlands':'NL','Suiza':'CH','Switzerland':'CH','Austria':'AT',
  'Polonia':'PL','Poland':'PL','Dinamarca':'DK','Denmark':'DK',
  'Suecia':'SE','Sweden':'SE','Noruega':'NO','Norway':'NO',
  'Escocia':'GB-SCT','Scotland':'GB-SCT','Inglaterra':'GB-ENG','England':'GB-ENG',
  'Gales':'GB-WLS','Wales':'GB-WLS','Rep. de Irlanda':'IE','Ireland':'IE','Irlanda':'IE',
  'Italia':'IT','Italy':'IT','Ucrania':'UA','Ukraine':'UA',
  'Rumanía':'RO','Rumania':'RO','Romania':'RO','Eslovaquia':'SK','Slovakia':'SK',
  'Albania':'AL','Turquía':'TR','Turquia':'TR','Turkey':'TR','Kosovo':'XK',
  'Macedonia del Norte':'MK','North Macedonia':'MK',
  'Rep. Checa':'CZ','Czech Republic':'CZ','Czechia':'CZ','República Checa':'CZ',
  'Serbia':'RS','Hungría':'HU','Hungria':'HU','Hungary':'HU','Eslovenia':'SI','Slovenia':'SI',
  'Grecia':'GR','Greece':'GR','Finlandia':'FI','Finland':'FI',
  'Bosnia y Herzegovina':'BA','Bosnia and Herzegovina':'BA','Bosnia-Herzegovina':'BA','Bosnia':'BA','Georgia':'GE',
  'PSG':'FR','Paris Saint-Germain':'FR','Real Madrid':'ES',
  'Bayern Munich':'DE','Bayern':'DE','Barcelona':'ES','Atletico de Madrid':'ES',
  // ── África ──
  'Senegal':'SN','Marruecos':'MA','Morocco':'MA','Ghana':'GH',
  'Sudáfrica':'ZA','Sudafrica':'ZA','South Africa':'ZA','Argelia':'DZ','Algeria':'DZ',
  'Egipto':'EG','Egypt':'EG','Túnez':'TN','Tunez':'TN','Tunisia':'TN',
  'Nigeria':'NG','Camerún':'CM','Camerun':'CM','Cameroon':'CM','Costa de Marfil':'CI',
  'Ivory Coast':'CI',"Cote d'Ivoire":'CI','Cabo Verde':'CV','Cape Verde':'CV','Cape Verde Islands':'CV',
  'Congo DR':'CD','DR Congo':'CD','Mali':'ML','Burkina Faso':'BF',
  'Guinea':'GN','Zimbabwe':'ZW','Tanzania':'TZ','Zambia':'ZM',
  'Uganda':'UG','Kenya':'KE','Ethiopia':'ET','Etiopía':'ET','Rwanda':'RW',
  'Angola':'AO','Mozambique':'MZ','Namibia':'NA','Benin':'BJ','Benín':'BJ',
  // ── Asia ──
  'Japón':'JP','Japon':'JP','Japan':'JP','Corea del Sur':'KR','South Korea':'KR',
  'Australia':'AU','Irán':'IR','Iran':'IR','Arabia Saudita':'SA','Saudi Arabia':'SA',
  'Catar':'QA','Qatar':'QA','Jordania':'JO','Jordan':'JO',
  'Uzbekistán':'UZ','Uzbekistan':'UZ','Iraq':'IQ','Irak':'IQ','China':'CN','India':'IN',
  'Vietnam':'VN','Thailand':'TH','Tailandia':'TH','Indonesia':'ID','Philippines':'PH',
  'Filipinas':'PH','Bahrain':'BH','Baréin':'BH','Kuwait':'KW','Oman':'OM',
  'United Arab Emirates':'AE','Emiratos Árabes Unidos':'AE','Emiratos Arabes Unidos':'AE',
  // ── Oceanía ──
  'Nueva Zelanda':'NZ','New Zealand':'NZ','Nueva Caledonia':'NC','New Caledonia':'NC',
  'Fiji':'FJ','Papua New Guinea':'PG','Papúa Nueva Guinea':'PG',
};

/** Traducción de nombres en inglés al español para display */
const ES_NAMES: Record<string, string> = {
  // América
  'Mexico':'México','Canada':'Canadá','United States':'Estados Unidos',
  'Haiti':'Haití','Panama':'Panamá','Peru':'Perú','Trinidad and Tobago':'Trinidad y Tobago',
  // Europa
  'Germany':'Alemania','France':'Francia','Spain':'España','Croatia':'Croacia',
  'Belgium':'Bélgica','Netherlands':'Países Bajos','Switzerland':'Suiza',
  'Poland':'Polonia','Denmark':'Dinamarca','Sweden':'Suecia','Norway':'Noruega',
  'Scotland':'Escocia','England':'Inglaterra','Wales':'Gales','Ireland':'Irlanda',
  'Italy':'Italia','Ukraine':'Ucrania','Romania':'Rumanía','Slovakia':'Eslovaquia',
  'Turkey':'Turquía','North Macedonia':'Macedonia del Norte',
  'Czech Republic':'Rep. Checa','Czechia':'Rep. Checa',
  'Hungary':'Hungría','Slovenia':'Eslovenia','Greece':'Grecia','Finland':'Finlandia',
  'Bosnia and Herzegovina':'Bosnia y Herzegovina','Bosnia-Herzegovina':'Bosnia y Herzegovina',
  'Albania':'Albania','Serbia':'Serbia','Georgia':'Georgia','Austria':'Austria',
  // África
  'South Africa':'Sudáfrica','Morocco':'Marruecos','Algeria':'Argelia',
  'Egypt':'Egipto','Tunisia':'Túnez','Cameroon':'Camerún',
  'Ivory Coast':'Costa de Marfil',"Cote d'Ivoire":'Costa de Marfil',
  'Cape Verde':'Cabo Verde','DR Congo':'Congo DR',
  // Asia
  'Japan':'Japón','South Korea':'Corea del Sur','Iran':'Irán',
  'Saudi Arabia':'Arabia Saudita','Qatar':'Catar','Jordan':'Jordania',
  'Uzbekistan':'Uzbekistán','Iraq':'Irak','Thailand':'Tailandia',
  'Philippines':'Filipinas','Bahrain':'Baréin',
  'United Arab Emirates':'Emiratos Árabes Unidos',
  // Oceanía
  'New Zealand':'Nueva Zelanda','New Caledonia':'Nueva Caledonia',
  'Papua New Guinea':'Papúa Nueva Guinea',
};

/** Devuelve el nombre en español (o el original si no hay traducción) */
export function spanishName(name: string): string {
  return ES_NAMES[name] ?? name;
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Devuelve el código ISO para un nombre de selección (o '' si no se encuentra) */
export function isoForTeam(name: string): string {
  return ISO_CODES[name] ?? ISO_CODES[norm(name)] ?? '';
}

/** Devuelve el emoji de bandera para un código ISO (funciona en servidor y cliente) */
export function flagEmoji(iso: string): string {
  if (!iso) return '';
  const code = iso.includes('-') ? iso.split('-')[0] : iso;
  const base = 0x1F1E6 - 65;
  return String.fromCodePoint(code.charCodeAt(0) + base, code.charCodeAt(1) + base);
}

/** Bandera a partir del nombre del equipo */
export function teamFlag(name: string): string {
  return flagEmoji(isoForTeam(name));
}
