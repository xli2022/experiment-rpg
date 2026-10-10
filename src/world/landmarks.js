import { MASTER_DISTRICTS, districtAt, createMasterPlan, terrainHeight, SHOWCASE, nearestOnSegment } from './master-plan.js';
import { CITY_SCALE, authoredToWorld, atEastpoint } from './world-scale.js';

// Named public sites of the Afterlight city: platforms, kiosks, refuges,
// terminals and plazas. The world always keeps them clear of buildings and
// trees, so the city layout is identical whichever game mode is running.
// Modes attach their own meaning to these IDs (story contacts, stations...).
const plan = createMasterPlan();

// A point on the nearest ground-level street, `offset` metres past its curb.
export function roadside(x, z, offset = 4) {
  let best;
  for (const road of plan.roads) {
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

const deck = id => plan.supports.find(s => s.id === id);
// Layout coordinates stay in the authored plan; only these helpers convert them.
const onDeck = (id, x, z) => ({ ...(id.startsWith('eastpoint-') ? atEastpoint(x, z) : authoredToWorld(x, z)), y: deck(id).maxY });
const ground = (x, z) => ({ x, z, y: terrainHeight(x, z) });
const authoredGround = (x, z) => { const p = authoredToWorld(x, z); return ground(p.x, p.z); };
const eastpointGround = (x, z) => { const p = atEastpoint(x, z); return ground(p.x, p.z); };
const inDistrict = (id, dx = 0, dz = 0) => {
  const d = MASTER_DISTRICTS.find(d => d.id === id);
  return roadside(d.x + dx * CITY_SCALE, d.z + dz * CITY_SCALE, 6);
};

const sites = {
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
// Twelve street-side caches round the districts; every district has a station.
for (let i = 0; i < 12; i++) sites[`cache-${i}`] = inDistrict(MASTER_DISTRICTS[i % MASTER_DISTRICTS.length].id, 160, -160);
for (const d of MASTER_DISTRICTS) sites[`metro-district-${d.id}`] = { ...roadside(d.x, d.z + 75 * CITY_SCALE), district: d.id, station: true };
for (const id of ['metro-neon', 'metro-north', 'metro-garden', 'metro-freight', 'metro-dock', 'metro-ridge']) sites[id].station = true;

// Raised sites are reached by the nearest signed pedestrian ramp.
function approachFor(p) {
  if (p.y < terrainHeight(p.x, p.z) + 3) return null;
  const rampId = p.district === 'stacks' ? 'stacks-garden-access' : p.district === 'citadel' ? 'citadel-concourse-access'
    : p.x > SHOWCASE.x + 40 * CITY_SCALE ? 'eastpoint-east-walk-ramp' : 'eastpoint-west-walk-ramp';
  return plan.supports.find(s => s.id === rampId) ?? null;
}

export const AFTERLIGHT_LANDMARKS = Object.freeze(Object.entries(sites).map(([id, p]) => {
  const site = { id, ...p, district: p.district ?? districtAt(p.x, p.z).id };
  const approach = approachFor(site);
  if (approach) site.approach = approach;
  return Object.freeze(site);
}));
const byId = new Map(AFTERLIGHT_LANDMARKS.map(p => [p.id, p]));
export const landmarkById = id => byId.get(id) ?? null;
