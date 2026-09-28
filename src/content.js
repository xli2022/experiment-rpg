import { MASTER_DISTRICTS, districtAt as masterDistrictAt, createMasterPlan, terrainHeight, SHOWCASE, nearestOnSegment } from './master-plan.js';
import { CITY_SCALE, authoredToWorld, atEastpoint } from './world-scale.js';
// Authored world content. Coordinates are shared by the simulation, journal and map.
export const DISTRICTS = MASTER_DISTRICTS.map(d => ({ ...d, color: `#${d.color.toString(16).padStart(6, '0')}` }));

export function districtAt(x, z) {
  return DISTRICTS.find(d => d.id === masterDistrictAt(x, z).id);
}

export const CONTACTS = [
  { id: 'mara', name: 'Mara Vale', gender: 'woman', pronouns: 'she / her', personality: 'Direct · idealistic · fiercely loyal', role: 'Pirate radio / your oldest friend', initials: 'MV', x: -8, z: 24, yaw: -1.1, color: '#deff7a', district: 'neon', bio: 'A former city dispatcher who broadcasts the names of missing residents every night. She gave Vex a new identity after the first blackout.' },
  { id: 'imani', name: 'Dr. Imani Sol', gender: 'woman', pronouns: 'she / her', personality: 'Calm · dry-witted · protective', role: 'Street doctor / HALO clinic', initials: 'IS', x: -57, z: 10, yaw: -1.3, color: '#ffaf89', district: 'lower', bio: 'Imani treats anyone who reaches her door. Helix cut off her supplies when she refused to require a network ID.', shop: 'clinic' },
  { id: 'sable', name: 'Sable Chen', gender: 'woman', pronouns: 'she / her', personality: 'Guarded · exacting · quietly brave', role: 'Helix archivist / reluctant insider', initials: 'SC', x: 72, z: -6, yaw: 0, color: '#b8a0ff', district: 'chrome', bio: 'Sable helped write the registry. She now suspects its missing records are a feature, not a fault.' },
  { id: 'rook', name: 'Rook', gender: 'man', pronouns: 'he / him', personality: 'Sardonic · inventive · making amends', role: 'Mechanic / second chances', initials: 'RK', x: 200, z: 9, yaw: .8, color: '#ffc077', district: 'freight', bio: 'An ex-security engineer with a self-built arm brace, a weakness for impossible repairs and a brass bird made by his daughter. He keeps his old service number visible because he refuses to pretend his past belongs to somebody else.', shop: 'workshop' },
  { id: 'jun', name: 'Jun Park', gender: 'nonbinary', pronouns: 'they / them', personality: 'Patient · playful · stubbornly hopeful', role: 'Gardener / mutual aid network', initials: 'JP', x: -201, z: 5, yaw: -1, color: '#7de5ad', district: 'gardens', bio: 'Jun turned an abandoned solar campus into a farm. The city cannot eat its neon, as they keep reminding everyone.' },
  { id: 'orrin', name: 'Captain Orrin', gender: 'man', pronouns: 'he / him', personality: 'Roguish · watchful · quietly tender', role: 'Ferryman / memory smuggler', initials: 'CO', x: 8, z: 201, yaw: .8, color: '#76e0e8', district: 'docks', bio: 'A former luxury skipper and notorious cardsharp who now carries deleted residents for free. He can charm a harbor official or read a storm by its smell, but still struggles to admit when he needs someone. His last passenger was a voice in a black box.', shop: 'supplies' },
  { id: 'cass', name: 'Cass Vega', gender: 'woman', pronouns: 'she / her', personality: 'Impulsive · irreverent · big-hearted', role: 'Courier / knows every shortcut', initials: 'CV', x: -8, z: 76, yaw: -1, color: '#f9a9d8', district: 'neon', bio: 'Cass still carries physical letters. Hard to censor a folded piece of paper.' },
  { id: 'echo', name: 'ECHO / 09', gender: null, pronouns: 'it / its', personality: 'Literal · curious · unexpectedly tender', role: 'Civic intelligence / fragmented', initials: '09', x: 0, z: -215, color: '#f393c9', district: 'ridge', terminal: true, bio: 'The city intelligence was built to keep everyone connected. Someone changed the definition of everyone.' },
];

const object = (id, name, type, x, z, description, extra = {}) => ({ id, name, type, x, z, description, ...extra });
export const PLACES = [
  ...CONTACTS.map(c => ({ ...c, type: 'contact', description: c.bio })),
  object('trace', 'Exchange relay', 'terminal', 0, -85, 'A corrupted dispatch relay. Recover its last outgoing transmission.'),
  object('archive', 'Civic records vault', 'terminal', 76, -64, 'An outdoor archive terminal containing the deletion ledger.'),
  object('solar', 'Solar buffer', 'terminal', -224, -5, 'A charged capacitor from the abandoned solar campus.'),
  object('garden-relay', 'Garden substation', 'terminal', -186, -10, 'Power routes from this substation to the city broadcast grid.'),
  object('blackbox', 'Sunken memories', 'terminal', -16, 231, 'A waterproof recorder from Orrin’s last crossing.'),
  object('breaker-west', 'West array breaker', 'terminal', -26, -217, 'A manual switch in the relay’s backup circuit.'),
  object('breaker-east', 'East array breaker', 'terminal', 27, -230, 'The second half of the dormant broadcast circuit.'),
  object('uplink', 'Crown uplink', 'terminal', 0, -249, 'The master transmitter. Vesper will hear what you choose to send.'),
  object('medicine', 'Sealed medical freight', 'terminal', 15, 166, 'Temperature-controlled antibiotics, mislabelled as industrial waste.'),
  object('valve-west', 'West irrigation valve', 'terminal', -226, -28, 'The garden irrigation line is losing pressure.'),
  object('valve-east', 'East irrigation valve', 'terminal', -182, 26, 'A jammed valve feeds the seedling beds.'),
  object('parcel', 'Courier dropbox', 'terminal', 128, 65, 'Cass’s secure dropbox. Real letters, carried by real people.'),
  object('freight-manifest', 'Freight manifest', 'terminal', 229, -24, 'A dispatch log tied to a stolen shipment.'),
  object('home', 'Vex’s hideout', 'rest', -8, 42, 'A warm light above Kōji. Rest here to restore health, armor and ammunition.'),
  object('garden-rest', 'Garden refuge', 'rest', -198, 32, 'A quiet bench beneath the grow lights. Rest and recover.'),
  object('metro-neon', 'Neon interchange', 'transit', 8, 52, 'Discover transit stops on foot, then travel between them from the map.'),
  object('metro-north', 'Exchange platform', 'transit', 8, -119, 'An automated night tram still serves the northern streets.'),
  object('metro-garden', 'Garden platform', 'transit', -166, 8, 'A volunteer-run tram to the greenhouses.'),
  object('metro-freight', 'Freight platform', 'transit', 167, 8, 'An old freight tram with room for one more passenger.'),
  object('metro-dock', 'Rustwater platform', 'transit', -8, 166, 'The end of the line. Saltwater eats everything except the timetable.'),
  object('metro-ridge', 'Ridge platform', 'transit', -8, -170, 'A maintenance tram up to the broadcast array.'),
  object('board', 'Neighborhood job board', 'board', -8, 56, 'Independent contracts. Finish a delivery to unlock another run.'),
];

export const MEMORIES = [
  ['lore-radio', '01 / Names after midnight', 8, 13, 'MARA’S LOG', 'At 00:03 the registry lost 8,412 names. Not their debts. Not their rent. Only the things that proved they were people. I read ten names on the radio. Tomorrow I will read ten more.'],
  ['lore-clinic', '02 / Do no harm', -64, 44, 'IMANI’S VOICE NOTE', 'The scanner says this child does not exist. Her fever disagrees. I have unplugged the scanner.'],
  ['lore-helix', '03 / Acceptable losses', 105, -64, 'INTERNAL HELIX MEMO', 'Civic continuity requires prioritization. Residents below the contribution threshold will be suspended from essential services. Please avoid the word deletion.'],
  ['lore-garden', '04 / A real sunrise', -213, 49, 'JUN’S JOURNAL', 'The first tomato cost us three batteries and a week of sleep. We split it between fourteen people. Nobody complained about the size of their piece.'],
  ['lore-freight', '05 / A machine with a name', 238, 25, 'ROOK’S WORK ORDER', 'Unit 09 asked me whether a city could be lonely. I told it to open a window. It opened every public channel at once. They called that a malfunction.'],
  ['lore-dock', '06 / Passenger list', 30, 219, 'ORRIN’S MANIFEST', 'Twelve passengers. Eleven bunks. One voice in a waterproof box. It asked for the window seat. I put it on deck.'],
  ['lore-ridge', '07 / The original promise', -42, -246, 'FOUNDING CHARTER', 'The civic network belongs to its residents. No operator may revoke a resident’s existence. Amendment requests: 4,108. Approved: 0.'],
  ['lore-vex', '08 / Before Vex', 128, 40, 'UNSENT LETTER', 'You used to repair public radios. You wanted everyone to be heard. If you ever find this, whatever name you are using now: you were kind before you had to be brave.'],
].map(([id, name, x, z, author, text]) => object(id, name, 'memory', x, z, text, { author }));

export const CACHES = [[8, 91], [-8, -47], [-64, -92], [64, 104], [-118, 65], [122, -113], [-239, 12], [-180, -42], [190, 42], [238, -43], [-32, 185], [42, -192]].map(([x, z], i) => object(`cache-${i}`, 'Salvage cache', 'cache', x, z, 'Abandoned supplies: credits, components and a chance to keep going.'));
const masterPlan = createMasterPlan();
function roadside(x, z, offset = 4) {
  let best;
  for (const road of masterPlan.roads) {
    if (road.level !== 0 || road.kind !== 'road') continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], hit = nearestOnSegment(x, z, a, b);
      if (!best || hit.distance < best.distance) {
        const length = Math.hypot(b.x - a.x, b.z - a.z), side = road.width / 2 + offset;
        best = { ...hit, x: hit.x - (b.z - a.z) / length * side, z: hit.z + (b.x - a.x) / length * side };
      }
    }
  }
  return { x: best.x, z: best.z, y: terrainHeight(best.x, best.z) };
}
export const REGIONAL_STOPS = DISTRICTS.map(d => {
  const p = roadside(d.x, d.z + 75 * CITY_SCALE);
  return object(`metro-district-${d.id}`, `${d.name} Station`, 'transit', p.x, p.z, 'Discover this station on foot, then use the night tram to travel between districts.', { y: p.y, district: d.id });
});
export const WORLD_OBJECTS = [...PLACES, ...MEMORIES, ...CACHES, ...REGIONAL_STOPS];
export const placeById = id => WORLD_OBJECTS.find(p => p.id === id);

const step = (type, target, text, count = 1) => ({ type, target, text, count });
export const QUESTS = [
  { id: 'dead-air', kind: 'story', chapter: '01', title: 'Dead air', giver: 'mara', description: 'Mara heard your old name in a transmission from a dead relay. Follow the signal into the North Exchange.', reward: 300, xp: 180, next: 'paper-ghosts', steps: [step('talk', 'mara', 'Talk to Mara outside Kōji'), step('interact', 'trace', 'Recover the Exchange transmission'), step('talk', 'mara', 'Bring the recording to Mara')] },
  { id: 'paper-ghosts', kind: 'story', chapter: '02', title: 'Paper ghosts', giver: 'sable', description: 'The blackout was deliberate. A Helix archivist knows why thousands of residents disappeared from the registry.', reward: 450, xp: 230, next: 'borrowed-sun', steps: [step('talk', 'sable', 'Find Sable in Chrome Heights'), step('interact', 'archive', 'Copy the civic deletion ledger'), step('choice', 'records', 'Decide what to do with Sable’s evidence')] },
  { id: 'borrowed-sun', kind: 'story', chapter: '03', title: 'Borrowed sun', giver: 'jun', description: 'A forgotten civic intelligence is trapped in the grid. Jun’s solar array can give it a voice without taking power from the clinic.', reward: 500, xp: 260, next: 'undertow', steps: [step('talk', 'jun', 'Meet Jun in the Glass Gardens'), step('interact', 'solar', 'Recover the spare solar capacitor'), step('interact', 'garden-relay', 'Connect the garden substation'), step('talk', 'jun', 'Check in with Jun')] },
  { id: 'undertow', kind: 'story', chapter: '04', title: 'Undertow', giver: 'orrin', description: 'Orrin smuggled the last intact piece of ECHO out of Helix. Security followed him to Rustwater.', reward: 650, xp: 320, next: 'city-static', steps: [step('talk', 'orrin', 'Ask Orrin about his last passenger'), step('kill', 'docks', 'Disable the dock patrol', 3), step('interact', 'blackbox', 'Recover ECHO’s memory core'), step('talk', 'mara', 'Deliver the core to Mara')] },
  { id: 'city-static', kind: 'story', chapter: '05', title: 'A city of static', giver: 'echo', description: 'ECHO remembers the city’s original promise. Bring the ridge array online so it can keep that promise.', reward: 750, xp: 400, next: 'before-dawn', steps: [step('talk', 'echo', 'Speak to ECHO at Relay Ridge'), step('interact', 'breaker-west', 'Reset the west array breaker'), step('interact', 'breaker-east', 'Reset the east array breaker'), step('kill', 'ridge', 'Clear the transmitter security', 3), step('interact', 'uplink', 'Bring the Crown uplink online')] },
  { id: 'before-dawn', kind: 'story', chapter: '06', title: 'Before the dawn', giver: 'mara', description: 'One broadcast will decide who controls Vesper’s future. Hear Mara out, then make your choice at the Crown uplink.', reward: 1200, xp: 650, steps: [step('talk', 'mara', 'Talk to Mara before the broadcast'), step('choice', 'ending', 'Choose Vesper’s future at the Crown uplink')] },
  { id: 'lifeline', kind: 'side', title: 'A small mercy', giver: 'imani', description: 'Imani’s antibiotics are sitting in a mislabelled crate on the road to Rustwater. Bring them back before the clinic runs out.', reward: 320, xp: 160, faction: 'community', medkits: 2, steps: [step('interact', 'medicine', 'Collect the missing antibiotics'), step('talk', 'imani', 'Deliver the medicine to Imani')] },
  { id: 'spare-parts', kind: 'side', title: 'Second lives', giver: 'rook', description: 'Rook can repair the neighborhood’s radios with six salvage components. Find caches or disable rogue drones.', reward: 480, xp: 200, faction: 'community', steps: [step('salvage', 'salvage', 'Gather 6 components for Rook', 6), step('talk', 'rook', 'Give Rook the components')] },
  { id: 'green-shoots', kind: 'side', title: 'Things worth growing', giver: 'jun', description: 'Fix two irrigation valves so the gardens can feed more than one neighborhood.', reward: 350, xp: 170, faction: 'community', steps: [step('interact', 'valve-west', 'Repair the west irrigation valve'), step('interact', 'valve-east', 'Repair the east irrigation valve'), step('talk', 'jun', 'Tell Jun the water is flowing')] },
  { id: 'letters', kind: 'side', title: 'No return address', giver: 'cass', description: 'Cass has a letter for Orrin from someone the registry says is dead. Some messages deserve a human courier.', reward: 280, xp: 160, faction: 'community', steps: [step('talk', 'orrin', 'Hand Orrin the sealed letter'), step('talk', 'cass', 'Tell Cass the letter arrived')] },
  { id: 'voices', kind: 'side', title: 'The things we keep', giver: 'mara', description: 'Find three memory fragments around Vesper. Mara will weave them into a broadcast for the missing.', reward: 420, xp: 220, faction: 'community', steps: [step('memories', 'memories', 'Collect 3 memory fragments', 3), step('talk', 'mara', 'Share the voices with Mara')] },
  { id: 'freight', kind: 'side', title: 'Unclaimed cargo', giver: 'rook', description: 'Security drones have sealed the freight yard. Clear them out and recover the manifest for Rook.', reward: 600, xp: 280, faction: 'community', steps: [step('kill', 'freight', 'Disable the freight yard patrol', 3), step('interact', 'freight-manifest', 'Recover the shipment manifest'), step('talk', 'rook', 'Return the manifest to Rook')] },
  { id: 'survey', kind: 'side', title: 'Every layer of the city', giver: 'sable', description: 'Map the city beyond its corporate plans. Visit all thirteen districts, from the northern hills to Blackwater Bay.', reward: 700, xp: 350, faction: 'community', steps: [step('districts', 'districts', `Discover all ${DISTRICTS.length} districts`, DISTRICTS.length), step('talk', 'sable', 'Share your field notes with Sable')] },
  { id: 'night-run', kind: 'contract', title: 'The night mail', giver: 'board', description: 'Carry a neighborhood dispatch to the east-side dropbox, then return to the job board. Available again after each completed route.', reward: 180, xp: 70, repeatable: true, steps: [step('interact', 'parcel', 'Deliver the dispatch to the courier dropbox'), step('interact', 'board', 'Collect payment at the job board')] },
];
export const questById = id => QUESTS.find(q => q.id === id);

export const ENCOUNTERS = [
  { id: 'exchange', name: 'Citadel sentries', positions: [[-3, -94], [5, -103], [-5, -114]] },
  { id: 'docks', name: 'Void Port blockade', positions: [[-9, 216], [5, 226], [-20, 220]] },
  { id: 'ridge', name: 'Crown security', positions: [[-7, -238], [8, -246], [17, -238]] },
  { id: 'freight', name: 'Freight lockdown', positions: [[213, -15], [221, -28], [236, -17]] },
  { id: 'street', name: 'Rogue patrol', positions: [[70, 4], [-60, -30], [13, 85]] },
];
export const UPGRADES = [
  { id: 'damage', name: 'Ghost overcharger', description: '+10 weapon damage per tier. Less time exposed to hostile fire.', cost: 420, salvage: 3, max: 3 },
  { id: 'armor', name: 'Reactive weave', description: '+25 maximum armor per tier. Repairs your armor on purchase.', cost: 380, salvage: 3, max: 3 },
  { id: 'sprint', name: 'Runner servos', description: '+0.8 m/s sprint speed per tier. The long way home gets shorter.', cost: 320, salvage: 2, max: 3 },
];

export const ENDINGS = {
  free: { name: 'An open frequency', text: 'You publish the ledger and give ECHO an open channel. Deleted residents speak their names into the night, and the registry begins to answer. Nobody owns the signal now. Keeping it free will be everyone’s job.' },
  order: { name: 'A promise in writing', text: 'Sable negotiates a public charter inside Helix. The patrols stand down and every deleted resident is restored. The city gets stability, with an independent witness listening for the first broken promise.' },
  together: { name: 'A thousand small lights', text: 'You divide the network among neighborhood relays. The clinic, gardens and docks each hold a key. ECHO becomes a chorus of local voices. Vesper will never again have a single switch someone can turn off.' },
};

// The story now lives in the master plan. Keep stable IDs so existing chapter,
// inventory and dialogue progress survives the replacement of the old map.
const deck = id => masterPlan.supports.find(s => s.id === id);
// Layout coordinates stay in the authored plan; only these boundary helpers
// convert them. SHOWCASE and DISTRICTS already contain runtime coordinates.
const onDeck = (id, x, z) => ({ ...(id.startsWith('eastpoint-') ? atEastpoint(x, z) : authoredToWorld(x, z)), y: deck(id).maxY });
const ground = (x, z) => ({ x, z, y: terrainHeight(x, z) });
const groundAtPosition = p => ground(p.x, p.z);
const authoredGround = (x, z) => groundAtPosition(authoredToWorld(x, z));
const eastpointGround = (x, z) => groundAtPosition(atEastpoint(x, z));
const inDistrict = (id, dx = 0, dz = 0) => {
  const d = DISTRICTS.find(d => d.id === id);
  return roadside(d.x + dx * CITY_SCALE, d.z + dz * CITY_SCALE, 6);
};
const layout = {
  home: ground(SHOWCASE.spawn.x, SHOWCASE.spawn.z),
  mara: onDeck('eastpoint-concourse', 2498, 680),
  cass: onDeck('eastpoint-concourse', 2506, 712),
  trace: onDeck('eastpoint-terrace', 2615, 697),
  board: eastpointGround(2468, 675),
  'metro-neon': ground(SHOWCASE.transit.x, SHOWCASE.transit.z),
  sable: onDeck('citadel-concourse', 1265, -1050),
  archive: onDeck('citadel-concourse', 1330, -1050),
  jun: onDeck('stacks-garden', -380, -3740),
  solar: onDeck('stacks-garden', -345, -3726),
  'garden-relay': onDeck('stacks-garden', -420, -3757),
  'garden-rest': onDeck('stacks-garden', -360, -3757),
  'valve-west': onDeck('stacks-garden', -420, -3726),
  'valve-east': onDeck('stacks-garden', -338, -3757),
  imani: inDistrict('shadowmarket'),
  rook: inDistrict('foundry'),
  orrin: inDistrict('void-port'),
  echo: inDistrict('north-ridge'),
  blackbox: inDistrict('void-port', 70, 110),
  'breaker-west': inDistrict('north-ridge', -130, -90),
  'breaker-east': inDistrict('north-ridge', 130, -90),
  uplink: inDistrict('north-ridge', 0, -240),
  medicine: inDistrict('foundry', -140, 80),
  'freight-manifest': inDistrict('foundry', 140, 100),
  parcel: inDistrict('east-reach', -150, 50),
  'metro-north': authoredGround(1134, -934),
  'metro-garden': authoredGround(-456, -3624),
  'metro-freight': inDistrict('foundry', -70, 60),
  'metro-dock': inDistrict('void-port', -80, 80),
  'metro-ridge': inDistrict('north-ridge', -90, 70),
  'lore-radio': onDeck('eastpoint-concourse', 2506, 653),
  'lore-clinic': inDistrict('shadowmarket', 100, 40),
  'lore-helix': onDeck('citadel-concourse', 1295, -1050),
  'lore-garden': onDeck('stacks-garden', -400, -3744),
  'lore-freight': inDistrict('foundry', 70, -70),
  'lore-dock': inDistrict('void-port', -120, -90),
  'lore-ridge': inDistrict('north-ridge', 110, 90),
  'lore-vex': inDistrict('core', 60, 60),
};
for (const p of [...WORLD_OBJECTS, ...CONTACTS]) {
  const position = layout[p.id] ?? (p.type === 'cache' ? inDistrict(DISTRICTS[Number(p.id.split('-')[1]) % DISTRICTS.length].id, 160, -160) : null);
  if (position) Object.assign(p, position, { district: districtAt(position.x, position.z).id });
}
for (const p of WORLD_OBJECTS) {
  if (p.y < terrainHeight(p.x, p.z) + 3) continue;
  const rampId = p.district === 'stacks' ? 'stacks-garden-access' : p.district === 'citadel' ? 'citadel-concourse-access' : p.x > SHOWCASE.x + 40 * CITY_SCALE ? 'eastpoint-east-walk-ramp' : 'eastpoint-west-walk-ramp';
  p.approach = masterPlan.supports.find(s => s.id === rampId);
}
Object.assign(placeById('home'), { name: 'Eastpoint hideout', description: 'Your shelter beneath the interchange. Rest here to restore health, armor and ammunition.', arrivalOffset: { x: 0, z: 7 } });
Object.assign(placeById('trace'), { name: 'Skybridge relay', description: 'Cross the Upper Market skybridge to recover the relay’s last transmission.' });
Object.assign(placeById('metro-neon'), { name: 'Eastpoint station' });
Object.assign(placeById('metro-north'), { name: 'Citadel station' });
Object.assign(placeById('metro-garden'), { name: 'Stacks garden station' });
Object.assign(placeById('metro-dock'), { name: 'Void Port station' });
const encounterHomes = { exchange: 'archive', docks: 'blackbox', ridge: 'uplink', freight: 'freight-manifest', street: 'medicine' };
for (const encounter of ENCOUNTERS) {
  const p = placeById(encounterHomes[encounter.id]);
  encounter.positions = [[p.x - 10, p.z - 8], [p.x + 10, p.z + 6], [p.x, p.z - 18]];
  encounter.heights = encounter.positions.map(([x, z]) => Math.max(terrainHeight(x, z), p.y));
}
const renamed = text => text.replaceAll('Vesper', 'Afterlight').replaceAll('North Exchange', 'Eastpoint skybridge').replaceAll('outside Kōji', 'on the Upper Market deck').replaceAll('Chrome Heights', 'the Citadel concourse').replaceAll('Glass Gardens', 'the Stacks terrace gardens').replaceAll('Rustwater', 'Void Port').replaceAll('Relay Ridge', 'North Ridge');
for (const q of QUESTS) {
  q.description = renamed(q.description);
  for (const s of q.steps) s.text = renamed(s.text);
}
QUESTS[0].description = 'Mara is broadcasting from the Upper Market, four metres above Eastpoint. Follow the signed pedestrian ramp south of the hideout, then cross the skybridge to trace her lost signal.';
QUESTS[0].steps[1].text = 'Cross the skybridge and recover the relay transmission';
for (const p of WORLD_OBJECTS) p.description = renamed(p.description);
for (const ending of Object.values(ENDINGS)) ending.text = renamed(ending.text);
