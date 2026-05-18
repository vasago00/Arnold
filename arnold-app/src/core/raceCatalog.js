// ─── Race Catalog ────────────────────────────────────────────────────────────
// Phase 4r.calendar.1
//
// Curated list of major international races. Used by the Calendar tab's
// race picker so users can quick-add well-known events without typing.
//
// Each race:
//   id          — stable slug
//   name        — display
//   city        — host city
//   country     — host country (ISO 3166-1 alpha-2 or full name)
//   region      — Americas | Europe | Africa | Asia | Oceania
//   distanceMi  — race distance in miles (13.1 = half, 26.2 = full, etc.)
//   typicalMonth — calendar month it usually runs (1-12). Year-of-event
//                  is filled in when the user adds it.
//   wmm         — true for World Marathon Majors
//   url         — official event site (optional)
//   tags        — extra filters (e.g. ['major', 'wmm', 'trail'])
//
// This is a starter set covering ~80 globally-recognized races. Easily
// extensible — add an entry and it shows up in the picker. International
// coverage prioritized: every continent represented, every major
// running culture's flagship race included.

export const RACE_CATALOG = [
  // ── World Marathon Majors ──
  { id: 'boston-marathon',   name: 'Boston Marathon',    city: 'Boston',    country: 'USA',  region: 'Americas', distanceMi: 26.2, typicalMonth: 4,  wmm: true,  url: 'https://www.baa.org' },
  { id: 'london-marathon',   name: 'London Marathon',    city: 'London',    country: 'UK',   region: 'Europe',   distanceMi: 26.2, typicalMonth: 4,  wmm: true,  url: 'https://www.tcslondonmarathon.com' },
  { id: 'berlin-marathon',   name: 'Berlin Marathon',    city: 'Berlin',    country: 'Germany', region: 'Europe', distanceMi: 26.2, typicalMonth: 9,  wmm: true,  url: 'https://www.bmw-berlin-marathon.com' },
  { id: 'chicago-marathon',  name: 'Chicago Marathon',   city: 'Chicago',   country: 'USA',  region: 'Americas', distanceMi: 26.2, typicalMonth: 10, wmm: true,  url: 'https://www.chicagomarathon.com' },
  { id: 'nyc-marathon',      name: 'New York City Marathon', city: 'New York', country: 'USA', region: 'Americas', distanceMi: 26.2, typicalMonth: 11, wmm: true,  url: 'https://www.nyrr.org/tcsnycmarathon', tags: ['nyrr', 'wmm'] },
  { id: 'tokyo-marathon',    name: 'Tokyo Marathon',     city: 'Tokyo',     country: 'Japan', region: 'Asia',    distanceMi: 26.2, typicalMonth: 3,  wmm: true,  url: 'https://www.marathon.tokyo' },

  // ── Major US road races ──
  { id: 'la-marathon',           name: 'Los Angeles Marathon',     city: 'Los Angeles',   country: 'USA', region: 'Americas', distanceMi: 26.2, typicalMonth: 3 },
  { id: 'houston-marathon',      name: 'Houston Marathon',          city: 'Houston',       country: 'USA', region: 'Americas', distanceMi: 26.2, typicalMonth: 1 },
  { id: 'twin-cities-marathon',  name: 'Twin Cities Marathon',      city: 'Minneapolis',   country: 'USA', region: 'Americas', distanceMi: 26.2, typicalMonth: 10 },
  { id: 'marine-corps-marathon', name: 'Marine Corps Marathon',     city: 'Washington DC', country: 'USA', region: 'Americas', distanceMi: 26.2, typicalMonth: 10 },
  { id: 'philadelphia-marathon', name: 'Philadelphia Marathon',     city: 'Philadelphia',  country: 'USA', region: 'Americas', distanceMi: 26.2, typicalMonth: 11 },
  { id: 'big-sur-marathon',      name: 'Big Sur International Marathon', city: 'Big Sur',  country: 'USA', region: 'Americas', distanceMi: 26.2, typicalMonth: 4 },
  { id: 'san-francisco-marathon', name: 'San Francisco Marathon',   city: 'San Francisco', country: 'USA', region: 'Americas', distanceMi: 26.2, typicalMonth: 7 },
  { id: 'rocknroll-las-vegas',   name: 'Rock n Roll Las Vegas',     city: 'Las Vegas',     country: 'USA', region: 'Americas', distanceMi: 26.2, typicalMonth: 11 },

  // ── Major European marathons ──
  { id: 'paris-marathon',     name: 'Paris Marathon',     city: 'Paris',    country: 'France',      region: 'Europe', distanceMi: 26.2, typicalMonth: 4 },
  { id: 'amsterdam-marathon', name: 'Amsterdam Marathon', city: 'Amsterdam', country: 'Netherlands', region: 'Europe', distanceMi: 26.2, typicalMonth: 10 },
  { id: 'rotterdam-marathon', name: 'Rotterdam Marathon', city: 'Rotterdam', country: 'Netherlands', region: 'Europe', distanceMi: 26.2, typicalMonth: 4 },
  { id: 'valencia-marathon',  name: 'Valencia Marathon',  city: 'Valencia', country: 'Spain',       region: 'Europe', distanceMi: 26.2, typicalMonth: 12 },
  { id: 'madrid-marathon',    name: 'Madrid Marathon',    city: 'Madrid',   country: 'Spain',       region: 'Europe', distanceMi: 26.2, typicalMonth: 4 },
  { id: 'barcelona-marathon', name: 'Barcelona Marathon', city: 'Barcelona', country: 'Spain',      region: 'Europe', distanceMi: 26.2, typicalMonth: 3 },
  { id: 'frankfurt-marathon', name: 'Frankfurt Marathon', city: 'Frankfurt', country: 'Germany',    region: 'Europe', distanceMi: 26.2, typicalMonth: 10 },
  { id: 'munich-marathon',    name: 'Munich Marathon',    city: 'Munich',   country: 'Germany',     region: 'Europe', distanceMi: 26.2, typicalMonth: 10 },
  { id: 'rome-marathon',      name: 'Rome Marathon',      city: 'Rome',     country: 'Italy',       region: 'Europe', distanceMi: 26.2, typicalMonth: 3 },
  { id: 'milan-marathon',     name: 'Milano Marathon',    city: 'Milan',    country: 'Italy',       region: 'Europe', distanceMi: 26.2, typicalMonth: 4 },
  { id: 'florence-marathon',  name: 'Florence Marathon',  city: 'Florence', country: 'Italy',       region: 'Europe', distanceMi: 26.2, typicalMonth: 11 },
  { id: 'athens-marathon',    name: 'Athens Marathon (Authentic)', city: 'Athens', country: 'Greece', region: 'Europe', distanceMi: 26.2, typicalMonth: 11 },
  { id: 'copenhagen-marathon', name: 'Copenhagen Marathon', city: 'Copenhagen', country: 'Denmark', region: 'Europe', distanceMi: 26.2, typicalMonth: 5 },
  { id: 'stockholm-marathon', name: 'Stockholm Marathon', city: 'Stockholm', country: 'Sweden',    region: 'Europe', distanceMi: 26.2, typicalMonth: 6 },
  { id: 'helsinki-marathon',  name: 'Helsinki City Marathon', city: 'Helsinki', country: 'Finland', region: 'Europe', distanceMi: 26.2, typicalMonth: 8 },
  { id: 'reykjavik-marathon', name: 'Reykjavík Marathon', city: 'Reykjavík', country: 'Iceland',   region: 'Europe', distanceMi: 26.2, typicalMonth: 8 },
  { id: 'edinburgh-marathon', name: 'Edinburgh Marathon', city: 'Edinburgh', country: 'UK',        region: 'Europe', distanceMi: 26.2, typicalMonth: 5 },
  { id: 'dublin-marathon',    name: 'Dublin Marathon',    city: 'Dublin',   country: 'Ireland',    region: 'Europe', distanceMi: 26.2, typicalMonth: 10 },

  // ── Major Asian marathons ──
  { id: 'osaka-marathon',     name: 'Osaka Marathon',     city: 'Osaka',     country: 'Japan',     region: 'Asia',    distanceMi: 26.2, typicalMonth: 2 },
  { id: 'nagoya-womens',      name: "Nagoya Women's Marathon", city: 'Nagoya', country: 'Japan', region: 'Asia', distanceMi: 26.2, typicalMonth: 3 },
  { id: 'fukuoka-marathon',   name: 'Fukuoka International Marathon', city: 'Fukuoka', country: 'Japan', region: 'Asia', distanceMi: 26.2, typicalMonth: 12 },
  { id: 'seoul-marathon',     name: 'Seoul Marathon',     city: 'Seoul',     country: 'South Korea', region: 'Asia',  distanceMi: 26.2, typicalMonth: 3 },
  { id: 'singapore-marathon', name: 'Standard Chartered Singapore Marathon', city: 'Singapore', country: 'Singapore', region: 'Asia', distanceMi: 26.2, typicalMonth: 12 },
  { id: 'hong-kong-marathon', name: 'Hong Kong Marathon', city: 'Hong Kong', country: 'Hong Kong', region: 'Asia',    distanceMi: 26.2, typicalMonth: 1 },
  { id: 'bangkok-marathon',   name: 'Bangkok Marathon',   city: 'Bangkok',   country: 'Thailand',  region: 'Asia',    distanceMi: 26.2, typicalMonth: 11 },
  { id: 'shanghai-marathon',  name: 'Shanghai Marathon',  city: 'Shanghai',  country: 'China',     region: 'Asia',    distanceMi: 26.2, typicalMonth: 11 },
  { id: 'beijing-marathon',   name: 'Beijing Marathon',   city: 'Beijing',   country: 'China',     region: 'Asia',    distanceMi: 26.2, typicalMonth: 10 },
  { id: 'mumbai-marathon',    name: 'Tata Mumbai Marathon', city: 'Mumbai',  country: 'India',     region: 'Asia',    distanceMi: 26.2, typicalMonth: 1 },

  // ── Americas (non-US) ──
  { id: 'toronto-marathon',   name: 'Toronto Waterfront Marathon', city: 'Toronto', country: 'Canada', region: 'Americas', distanceMi: 26.2, typicalMonth: 10 },
  { id: 'vancouver-marathon', name: 'BMO Vancouver Marathon', city: 'Vancouver', country: 'Canada', region: 'Americas', distanceMi: 26.2, typicalMonth: 5 },
  { id: 'montreal-marathon',  name: 'Montréal Marathon',  city: 'Montreal',  country: 'Canada',   region: 'Americas', distanceMi: 26.2, typicalMonth: 9 },
  { id: 'mexico-city-marathon', name: 'Mexico City Marathon', city: 'Mexico City', country: 'Mexico', region: 'Americas', distanceMi: 26.2, typicalMonth: 8 },
  { id: 'sao-paulo-marathon', name: 'São Paulo Marathon', city: 'São Paulo', country: 'Brazil',   region: 'Americas', distanceMi: 26.2, typicalMonth: 4 },
  { id: 'rio-marathon',       name: 'Rio Marathon',       city: 'Rio de Janeiro', country: 'Brazil', region: 'Americas', distanceMi: 26.2, typicalMonth: 6 },
  { id: 'buenos-aires-marathon', name: 'Buenos Aires Marathon', city: 'Buenos Aires', country: 'Argentina', region: 'Americas', distanceMi: 26.2, typicalMonth: 9 },
  { id: 'santiago-marathon',  name: 'Santiago Marathon',  city: 'Santiago',  country: 'Chile',    region: 'Americas', distanceMi: 26.2, typicalMonth: 4 },

  // ── Africa ──
  { id: 'cape-town-marathon', name: 'Cape Town Marathon', city: 'Cape Town', country: 'South Africa', region: 'Africa', distanceMi: 26.2, typicalMonth: 10 },
  { id: 'comrades-ultra',     name: 'Comrades Marathon',  city: 'Durban',    country: 'South Africa', region: 'Africa', distanceMi: 56.2, typicalMonth: 6, tags: ['ultra'] },
  { id: 'casablanca-marathon', name: 'Casablanca Marathon', city: 'Casablanca', country: 'Morocco', region: 'Africa', distanceMi: 26.2, typicalMonth: 10 },
  { id: 'cairo-marathon',     name: 'Cairo Marathon',     city: 'Cairo',     country: 'Egypt',    region: 'Africa',   distanceMi: 26.2, typicalMonth: 2 },
  { id: 'two-oceans-ultra',   name: 'Two Oceans Marathon', city: 'Cape Town', country: 'South Africa', region: 'Africa', distanceMi: 35.4, typicalMonth: 4, tags: ['ultra'] },

  // ── Oceania ──
  { id: 'sydney-marathon',    name: 'Sydney Marathon',    city: 'Sydney',    country: 'Australia', region: 'Oceania', distanceMi: 26.2, typicalMonth: 9 },
  { id: 'melbourne-marathon', name: 'Melbourne Marathon', city: 'Melbourne', country: 'Australia', region: 'Oceania', distanceMi: 26.2, typicalMonth: 10 },
  { id: 'gold-coast-marathon', name: 'Gold Coast Marathon', city: 'Gold Coast', country: 'Australia', region: 'Oceania', distanceMi: 26.2, typicalMonth: 7 },
  { id: 'auckland-marathon',  name: 'Auckland Marathon',  city: 'Auckland',  country: 'New Zealand', region: 'Oceania', distanceMi: 26.2, typicalMonth: 10 },

  // ── Half marathons ──
  { id: 'rbc-brooklyn-half',  name: 'RBC Brooklyn Half',  city: 'Brooklyn',  country: 'USA',      region: 'Americas', distanceMi: 13.1, typicalMonth: 5, tags: ['nyrr'] },
  { id: 'united-nyc-half',    name: 'United Airlines NYC Half', city: 'New York', country: 'USA', region: 'Americas', distanceMi: 13.1, typicalMonth: 3, tags: ['nyrr'] },
  { id: 'philly-half',        name: 'Philadelphia Half Marathon', city: 'Philadelphia', country: 'USA', region: 'Americas', distanceMi: 13.1, typicalMonth: 9 },
  { id: 'rocknroll-vegas-half', name: 'Rock n Roll Vegas Half', city: 'Las Vegas', country: 'USA', region: 'Americas', distanceMi: 13.1, typicalMonth: 11 },
  { id: 'great-north-run',    name: 'Great North Run',    city: 'Newcastle', country: 'UK',       region: 'Europe',   distanceMi: 13.1, typicalMonth: 9 },
  { id: 'royal-parks-half',   name: 'Royal Parks Half',   city: 'London',    country: 'UK',       region: 'Europe',   distanceMi: 13.1, typicalMonth: 10 },
  { id: 'lisbon-half',        name: 'EDP Lisbon Half',    city: 'Lisbon',    country: 'Portugal', region: 'Europe',   distanceMi: 13.1, typicalMonth: 3 },
  { id: 'copenhagen-half',    name: 'Copenhagen Half',    city: 'Copenhagen', country: 'Denmark', region: 'Europe',   distanceMi: 13.1, typicalMonth: 9 },
  { id: 'valencia-half',      name: 'Valencia Half Marathon', city: 'Valencia', country: 'Spain', region: 'Europe',   distanceMi: 13.1, typicalMonth: 10 },
  { id: 'sydney-half',        name: 'Sydney Half Marathon', city: 'Sydney',  country: 'Australia', region: 'Oceania', distanceMi: 13.1, typicalMonth: 5 },

  // ── Trail / Ultra ──
  { id: 'utmb',               name: 'Ultra-Trail du Mont-Blanc', city: 'Chamonix', country: 'France', region: 'Europe', distanceMi: 106.0, typicalMonth: 8, tags: ['ultra', 'trail'] },
  { id: 'western-states-100', name: 'Western States 100', city: 'Auburn',    country: 'USA',      region: 'Americas', distanceMi: 100.0, typicalMonth: 6, tags: ['ultra', 'trail'] },
  { id: 'jfk-50',             name: 'JFK 50 Mile',        city: 'Boonsboro', country: 'USA',      region: 'Americas', distanceMi: 50.0,  typicalMonth: 11, tags: ['ultra', 'trail'] },
  { id: 'lake-sonoma-50',     name: 'Lake Sonoma 50',     city: 'Healdsburg', country: 'USA',     region: 'Americas', distanceMi: 50.0,  typicalMonth: 4, tags: ['ultra', 'trail'] },
  { id: 'leadville-100',      name: 'Leadville Trail 100', city: 'Leadville', country: 'USA',    region: 'Americas', distanceMi: 100.0, typicalMonth: 8, tags: ['ultra', 'trail'] },
  { id: 'badwater-135',       name: 'Badwater 135',       city: 'Death Valley', country: 'USA',  region: 'Americas', distanceMi: 135.0, typicalMonth: 7, tags: ['ultra'] },

  // ── 10K / Notable shorter races ──
  { id: 'bolder-boulder',     name: 'BolderBoulder 10K',  city: 'Boulder',   country: 'USA',      region: 'Americas', distanceMi: 6.21, typicalMonth: 5 },
  { id: 'peachtree-10k',      name: 'AJC Peachtree Road Race', city: 'Atlanta', country: 'USA',   region: 'Americas', distanceMi: 6.21, typicalMonth: 7 },
  { id: 'broad-street-10mi',  name: 'Broad Street Run',   city: 'Philadelphia', country: 'USA',  region: 'Americas', distanceMi: 10.0, typicalMonth: 5 },
  { id: 'great-manchester-10k', name: 'Great Manchester Run', city: 'Manchester', country: 'UK', region: 'Europe',   distanceMi: 6.21, typicalMonth: 5 },
  { id: 'bay-to-breakers',    name: 'Bay to Breakers 12K', city: 'San Francisco', country: 'USA', region: 'Americas', distanceMi: 7.46, typicalMonth: 5 },

  // ── HYROX ──
  { id: 'hyrox-nyc',          name: 'HYROX New York',     city: 'New York',  country: 'USA',      region: 'Americas', distanceMi: 4.97, typicalMonth: 3, tags: ['hyrox'] },
  { id: 'hyrox-london',       name: 'HYROX London',       city: 'London',    country: 'UK',       region: 'Europe',   distanceMi: 4.97, typicalMonth: 11, tags: ['hyrox'] },
  { id: 'hyrox-world-champs', name: 'HYROX World Championships', city: 'Various', country: 'Various', region: 'Europe', distanceMi: 4.97, typicalMonth: 6, tags: ['hyrox'] },

  // ── New York Road Runners (NYRR) series ──
  // Major NYRR-organized races throughout the year. NYRR points qualify
  // runners for the NYC Marathon via the 9+1 program, so members
  // typically target several per year. Distances span 1-mile track to
  // half marathon, with most races in Central Park or one of the
  // boroughs. typicalMonth is the calendar month the event normally
  // falls in (exact-month filter, see filterCatalog).
  { id: 'nyrr-midnight-run',           name: 'NYRR Midnight Run',                         city: 'New York', country: 'USA', region: 'Americas', distanceMi: 4.0,  typicalMonth: 1,  tags: ['nyrr'] },
  { id: 'nyrr-fred-lebow-half',        name: 'NYRR Fred Lebow Manhattan Half',            city: 'New York', country: 'USA', region: 'Americas', distanceMi: 13.1, typicalMonth: 1,  tags: ['nyrr'] },
  { id: 'nyrr-gridiron-4m',            name: 'NYRR Gridiron 4M',                          city: 'New York', country: 'USA', region: 'Americas', distanceMi: 4.0,  typicalMonth: 2,  tags: ['nyrr'] },
  { id: 'nyrr-washington-heights-5k',  name: 'NYRR Washington Heights Salsa, Blues & Shamrocks 5K', city: 'New York', country: 'USA', region: 'Americas', distanceMi: 3.11, typicalMonth: 3,  tags: ['nyrr'] },
  { id: 'nyrr-rising-new-york-road-runners', name: 'NYRR Spring 4M',                      city: 'New York', country: 'USA', region: 'Americas', distanceMi: 4.0,  typicalMonth: 4,  tags: ['nyrr'] },
  { id: 'nyrr-japan-day-4m',           name: 'NYRR Japan Day 4M',                         city: 'New York', country: 'USA', region: 'Americas', distanceMi: 4.0,  typicalMonth: 5,  tags: ['nyrr'] },
  { id: 'nyrr-global-running-day-5k',  name: 'NYRR Global Running Day 5K',                city: 'New York', country: 'USA', region: 'Americas', distanceMi: 3.11, typicalMonth: 6,  tags: ['nyrr'] },
  { id: 'nyrr-mini-10k',               name: 'NYRR Mini 10K',                             city: 'New York', country: 'USA', region: 'Americas', distanceMi: 6.21, typicalMonth: 6,  tags: ['nyrr'] },
  { id: 'nyrr-queens-10k',             name: 'NYRR Queens 10K',                           city: 'New York', country: 'USA', region: 'Americas', distanceMi: 6.21, typicalMonth: 6,  tags: ['nyrr'] },
  { id: 'nyrr-front-runners-pride-5m', name: 'NYRR Front Runners NY LGBT Pride 5M',       city: 'New York', country: 'USA', region: 'Americas', distanceMi: 5.0,  typicalMonth: 6,  tags: ['nyrr'] },
  { id: 'nyrr-achilles-hope-possibility-4m', name: 'NYRR Achilles Hope & Possibility 4M', city: 'New York', country: 'USA', region: 'Americas', distanceMi: 4.0,  typicalMonth: 6,  tags: ['nyrr', 'charity'] },
  { id: 'nyrr-team-championships',     name: 'NYRR Team Championships 5M',                city: 'New York', country: 'USA', region: 'Americas', distanceMi: 5.0,  typicalMonth: 7,  tags: ['nyrr'] },
  // 9/11 commemorative 4-miler is held in July (around the 11th), not in
  // September — it predates the Tunnel-to-Towers September 5K and is run
  // by NYRR/local clubs as an early-summer memorial. User-corrected.
  { id: 'nyrr-911-memorial-4m',        name: 'NYRR 9/11 Memorial 4M',                     city: 'New York', country: 'USA', region: 'Americas', distanceMi: 4.0,  typicalMonth: 7,  tags: ['nyrr', 'memorial'] },
  { id: 'nyrr-harlem-5k',              name: 'NYRR Percy Sutton Harlem 5K',               city: 'New York', country: 'USA', region: 'Americas', distanceMi: 3.11, typicalMonth: 8,  tags: ['nyrr'] },
  { id: 'nyrr-marathon-tuneup-18m',    name: 'NYC Marathon Tune-Up 18M',                  city: 'New York', country: 'USA', region: 'Americas', distanceMi: 18.0, typicalMonth: 8,  tags: ['nyrr'] },
  { id: 'nyrr-5th-ave-mile',           name: 'New Balance 5th Avenue Mile',               city: 'New York', country: 'USA', region: 'Americas', distanceMi: 1.0,  typicalMonth: 9,  tags: ['nyrr'] },
  { id: 'nyrr-bronx-10m',              name: 'NYRR Bronx 10 Mile',                        city: 'New York', country: 'USA', region: 'Americas', distanceMi: 10.0, typicalMonth: 9,  tags: ['nyrr'] },
  { id: 'nyrr-staten-island-half',     name: 'NYRR Staten Island Half',                   city: 'New York', country: 'USA', region: 'Americas', distanceMi: 13.1, typicalMonth: 10, tags: ['nyrr'] },
  { id: 'nyrr-poland-spring-marathon-kickoff', name: 'NYRR Poland Spring Marathon Kickoff 5M', city: 'New York', country: 'USA', region: 'Americas', distanceMi: 5.0,  typicalMonth: 10, tags: ['nyrr'] },
  { id: 'nyrr-dash-to-the-finish-5k',  name: 'NYRR Dash to the Finish 5K',                city: 'New York', country: 'USA', region: 'Americas', distanceMi: 3.11, typicalMonth: 11, tags: ['nyrr'] },
  { id: 'nyrr-race-to-deliver-4m',     name: 'NYRR Race to Deliver 4M',                   city: 'New York', country: 'USA', region: 'Americas', distanceMi: 4.0,  typicalMonth: 11, tags: ['nyrr'] },
  { id: 'nyrr-ted-corbitt-15k',        name: 'NYRR Ted Corbitt 15K',                      city: 'New York', country: 'USA', region: 'Americas', distanceMi: 9.32, typicalMonth: 12, tags: ['nyrr'] },
  { id: 'nyrr-joe-kleinerman-10k',     name: 'NYRR Joe Kleinerman 10K',                   city: 'New York', country: 'USA', region: 'Americas', distanceMi: 6.21, typicalMonth: 12, tags: ['nyrr'] },
];

export const REGION_OPTIONS = [
  { id: 'all',      label: 'All regions' },
  { id: 'Americas', label: 'Americas' },
  { id: 'Europe',   label: 'Europe' },
  { id: 'Asia',     label: 'Asia' },
  { id: 'Africa',   label: 'Africa' },
  { id: 'Oceania',  label: 'Oceania' },
];

export const DISTANCE_FILTERS = [
  { id: 'all',     label: 'Any distance', min: 0,   max: 999  },
  { id: 'short',   label: '5K – 15K',     min: 3.1, max: 9.5  },
  { id: 'half',    label: 'Half marathon', min: 13, max: 13.5 },
  { id: 'full',    label: 'Marathon',      min: 26, max: 27   },
  { id: 'ultra',   label: 'Ultra (>26.2mi)', min: 30, max: 200 },
];

// Filter helper: applies region + distance + free-text search + month.
// `month`: null|0 = show all; 1-12 = only races where typicalMonth matches
// (with a ±1 month tolerance since real race dates drift year-to-year).
export function filterCatalog({ region = 'all', distance = 'all', query = '', month = null } = {}) {
  const distFilter = DISTANCE_FILTERS.find(d => d.id === distance) || DISTANCE_FILTERS[0];
  const q = String(query || '').toLowerCase().trim();
  return RACE_CATALOG.filter(r => {
    if (region !== 'all' && r.region !== region) return false;
    if (r.distanceMi < distFilter.min || r.distanceMi > distFilter.max) return false;
    if (q && !`${r.name} ${r.city} ${r.country}`.toLowerCase().includes(q)) return false;
    if (month && r.typicalMonth) {
      // Phase 4r.calendar.16 — exact-month match by default. The
      // previous ±1 tolerance meant a single race showed up in three
      // adjacent months and the picker felt like it ignored the date
      // entirely. Strict match keeps each race in its true month.
      if (r.typicalMonth !== month) return false;
    }
    return true;
  });
}

// Pretty-print the typical month (numeric → "Apr").
const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthShort(n) { return MONTH_SHORT[n] || ''; }

// Build a default date for a catalog entry given the target year — picks
// the typical month, day 15 (mid-month placeholder). User can edit
// afterward to the exact event date.
export function defaultDateForRace(race, year) {
  const y = year || new Date().getFullYear();
  const m = String(race.typicalMonth || 1).padStart(2, '0');
  return `${y}-${m}-15`;
}

// Pretty distance label.
export function distanceLabel(race) {
  if (race.distanceMi >= 26 && race.distanceMi < 27) return 'Marathon';
  if (race.distanceMi >= 13 && race.distanceMi < 14) return 'Half';
  if (race.distanceMi >= 6.0 && race.distanceMi <= 6.4) return '10K';
  if (race.distanceMi >= 3.0 && race.distanceMi <= 3.2) return '5K';
  return `${race.distanceMi} mi`;
}
