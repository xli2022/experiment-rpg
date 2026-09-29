import { SpatialGrid } from './spatial-grid.js';
import { addNeighborhoodStreets } from './neighborhood-plan.js';
import { DISTRICT_ARCHITECTURE } from './district-architecture.js';

// Generate the complete street graph in the original 11 km authoring frame.
// master-plan.js transforms the completed graph into compact runtime units.
// The planning image uses kilometres from its north-west corner; north is -Z.
export const MASTER_WORLD_LIMIT = 5500;
export const TERRAIN_GRID = 64;
export const WATER_LEVEL = -1;
export const fromMap = (x, z) => ({ x: (x - 5.5) * 1000, z: (z - 5.5) * 1000 });
export const fromReference = (px, py) => ({ x: (px - 45) / 952 * 11000 - 5500, z: (py - 135) / 980 * 11000 - 5500 });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => (t = clamp(t, 0, 1), t * t * (3 - 2 * t));

export const MASTER_DISTRICTS = [
  ['core', 'Afterlight Core', 458, 553, 1050, 1050, 0xb98cac, .88, 'Dense neon canyons, stacked shopfronts and the old transit loop.'],
  ['citadel', 'Citadel', 673, 466, 1000, 1150, 0x739db1, .76, 'Corporate towers and elevated public concourses.'],
  ['east-reach', 'East Reach', 870, 592, 800, 950, 0x68aea9, .65, 'Commercial terraces overlooking Blackwater Bay.'],
  ['void-port', 'Void Port', 839, 335, 800, 1350, 0x7d8b95, .48, 'Freight yards, cranes and long waterfront warehouses.'],
  ['stacks', 'The Stacks', 484, 242, 1200, 900, 0x789b79, .88, 'Tall residential slabs linked by community terraces.'],
  ['north-ridge', 'North Ridge', 196, 209, 1500, 700, 0x897589, .58, 'Old industrial streets on the high northern escarpment.'],
  ['ember-heights', 'Ember Heights', 156, 410, 900, 1400, 0xb09574, .66, 'Stepped homes and commercial streets climbing the western hills.'],
  ['west-end', 'West End', 118, 585, 850, 1050, 0x928caf, .68, 'Mixed workshops, apartments and local market streets.'],
  ['shadowmarket', 'Shadowmarket', 168, 786, 1150, 950, 0x81658d, .85, 'Crowded low-city passages below the arterial viaducts.'],
  ['cut', 'The Cut', 163, 950, 1300, 900, 0xaa7869, .76, 'Informal hillside workshops and close-packed housing.'],
  ['southward', 'Southward', 425, 915, 1000, 1150, 0x8f9b71, .68, 'Residential courtyards and long, green neighborhood streets.'],
  ['foundry', 'Foundry', 682, 891, 1000, 1200, 0x7e9298, .54, 'Working factories, heat towers and freight service roads.'],
  ['silver-delta', 'Silver Delta', 881, 927, 900, 1100, 0x9a918b, .50, 'Coastal distribution halls and the southern expressway interchange.'],
].map(([id, name, px, py, radiusX, radiusZ, color, density, description]) => ({
  id, name, ...fromReference(px, py), mapX: (px - 45) / 952 * 11, mapZ: (py - 135) / 980 * 11, radiusX, radiusZ, color,
  baseColor: color, ...DISTRICT_ARCHITECTURE[id], density, description,
}));
export const districts = MASTER_DISTRICTS;

export function districtAt(x, z) {
  let best = MASTER_DISTRICTS[0], score = Infinity;
  for (const d of MASTER_DISTRICTS) {
    const distance = ((x - d.x) / d.radiusX) ** 2 + ((z - d.z) / d.radiusZ) ** 2;
    if (distance < score) { best = d; score = distance; }
  }
  return best;
}

export function coastX(z) {
  return 4620 + 220 * Math.sin(z / 1000) - 260 * Math.exp(-(((z - 1400) / 700) ** 2));
}
export const isWater = (x, z) => x > coastX(z);

function rawTerrain(x, z) {
  const northWest = clamp((6400 - .68 * x - .75 * z) / 13500, 0, 1);
  const ridge = 29 * Math.exp(-(((x + 3100) / 1650) ** 2) - ((z + 4200) / 1300) ** 2);
  const ember = 26 * Math.exp(-(((x + 4000) / 1100) ** 2) - ((z + 1400) / 1700) ** 2);
  const land = 2 + 66 * northWest ** 1.6 + ridge + ember;
  // The quays sit above water; only the last 90 metres grade down to the bay.
  return mix(-7, land, smooth((coastX(z) - x + 24) / 90));
}

// Use the same 64 m triangles for simulation and rendering. This avoids cars
// floating above an analytic hillside between the ground mesh's vertices.
export function terrainHeight(x, z) {
  const gx = Math.floor(x / TERRAIN_GRID) * TERRAIN_GRID, gz = Math.floor(z / TERRAIN_GRID) * TERRAIN_GRID;
  const tx = (x - gx) / TERRAIN_GRID, tz = (z - gz) / TERRAIN_GRID;
  const a = rawTerrain(gx, gz), b = rawTerrain(gx + TERRAIN_GRID, gz);
  const c = rawTerrain(gx, gz + TERRAIN_GRID), d = rawTerrain(gx + TERRAIN_GRID, gz + TERRAIN_GRID);
  return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz
    : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}

const eastpoint = fromReference(762, 645);
const atEastpoint = (x, z) => ({ x: x + eastpoint.x - 2550, z: z + eastpoint.z - 600 });
export const SHOWCASE = Object.freeze({
  name: 'Eastpoint', ...eastpoint,
  spawn: atEastpoint(2468, 657), car: { ...atEastpoint(2468, 653), yaw: Math.PI },
  meeting: { ...atEastpoint(2498, 680), elevation: 8 }, transit: atEastpoint(2490, 640),
  cameraYaw: -2.3, cameraPitch: -.06,
});

const point = (x, z, elevation = 0) => ({ x, z, y: terrainHeight(x, z) + elevation + .07 });
const mapPoint = ([x, z, elevation = 0]) => ({ ...fromMap(x, z), elevation });

function catmull(a, b, c, d, t) {
  return .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}

function sampled(points, { closed = false, curved = true, spacing = 32, absoluteY = false } = {}) {
  const result = [], n = points.length;
  const at = i => points[closed ? (i + n) % n : clamp(i, 0, n - 1)];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
    const steps = Math.max(1, Math.ceil(Math.hypot(c.x - b.x, c.z - b.z) / spacing));
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const x = curved ? catmull(a.x, b.x, c.x, d.x, t) : mix(b.x, c.x, t);
      const z = curved ? catmull(a.z, b.z, c.z, d.z, t) : mix(b.z, c.z, t);
      const p = point(x, z, mix(b.elevation ?? 0, c.elevation ?? 0, smooth(t)));
      if (absoluteY && b.y !== undefined && c.y !== undefined) p.y = mix(b.y, c.y, t);
      result.push(p);
    }
  }
  result.push(closed ? { ...result[0] } : point(points.at(-1).x, points.at(-1).z, points.at(-1).elevation ?? 0));
  if (!closed && absoluteY && points.at(-1).y !== undefined) result.at(-1).y = points.at(-1).y;
  if (absoluteY) {
    // Grade follows travelled distance, not a curve's nonuniform parameter.
    // Otherwise a short Catmull endpoint can become an abrupt steep lip.
    const lengths = [0];
    for (let i = 1; i < result.length; i++) lengths.push(lengths.at(-1) + Math.hypot(result[i].x - result[i - 1].x, result[i].z - result[i - 1].z));
    const y0 = points[0].y, y1 = points.at(-1).y, total = lengths.at(-1);
    for (let i = 0; i < result.length; i++) result[i].y = mix(y0, y1, total ? lengths[i] / total : 0);
  }
  return result;
}

export function nearestOnSegment(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 ? clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1) : 0;
  const px = mix(a.x, b.x, t), pz = mix(a.z, b.z, t);
  return { x: px, z: pz, y: mix(a.y, b.y, t), t, distance: Math.hypot(x - px, z - pz) };
}

function segmentRecord(a, b, width, data = {}) {
  const pad = width / 2;
  return { ...data, a, b, width, minX: Math.min(a.x, b.x) - pad, maxX: Math.max(a.x, b.x) + pad,
    minZ: Math.min(a.z, b.z) - pad, maxZ: Math.max(a.z, b.z) + pad,
    minY: Math.min(a.y, b.y) - .65, maxY: Math.max(a.y, b.y), slabThickness: .65, supportOnly: true };
}

function closestRoadPoint(x, z, roads, predicate = () => true) {
  let best = null;
  for (const road of roads) {
    if (!predicate(road)) continue;
    for (let i = 1; i < road.points.length; i++) {
      const hit = nearestOnSegment(x, z, road.points[i - 1], road.points[i]);
      if (!best || hit.distance < best.distance) best = { ...hit, road };
    }
  }
  return best;
}

function mergeLanding(ramp, trunk) {
  // A ramp must reach the trunk's elevation at its outside edge, not only at
  // the centerline. This short landing prevents cars meeting a vertical slab
  // lip or snapping upward as soon as their support query touches the bridge.
  const distances = [0];
  for (let i = 1; i < ramp.points.length; i++) distances.push(distances.at(-1) + Math.hypot(ramp.points[i].x - ramp.points[i - 1].x, ramp.points[i].z - ramp.points[i - 1].z));
  let entry = ramp.points.length - 1;
  while (entry > 1) {
    const p = ramp.points[entry], hit = closestRoadPoint(p.x, p.z, [trunk]);
    if (hit.distance > trunk.width / 2 + 2) break;
    entry--;
  }
  const landing = ramp.points[entry], landingY = closestRoadPoint(landing.x, landing.z, [trunk]).y, startY = ramp.points[0].y;
  for (let i = 0; i <= entry; i++) ramp.points[i].y = mix(startY, landingY, distances[i] / distances[entry]);
  for (let i = entry + 1; i < ramp.points.length; i++) {
    const p = ramp.points[i];
    p.y = closestRoadPoint(p.x, p.z, [trunk]).y;
  }
}

function jointOverlap(road, index) {
  const last = road.points.length - 1;
  if (index === last && road.closed) index = 0;
  if (!road.closed && (index === 0 || index === last)) return .14;
  const p = road.points[index], a = road.points[index === 0 ? last - 1 : index - 1], b = road.points[index + 1];
  const ax = p.x - a.x, az = p.z - a.z, bx = b.x - p.x, bz = b.z - p.z;
  const lengths = Math.hypot(ax, az) * Math.hypot(bx, bz);
  const cosine = clamp((ax * bx + az * bz) / lengths, -.999999, 1);
  // Miter the rectangular road slabs far enough to cover the outside corner.
  // A fixed visual overlap leaves lane-sized holes on elevated curves.
  return road.width / 2 * Math.sqrt((1 - cosine) / (1 + cosine)) + .14;
}

let cached;
export function createMasterPlan() {
  if (cached) return cached;
  const roads = [], roadIndex = new SpatialGrid([], 96), supports = [], supportIndex = new SpatialGrid([], 96);
  const addRoad = (id, name, controls, width, classification = 'local', options = {}) => {
    const road = { id, name, width, class: classification, kind: options.kind ?? 'road', level: options.level ?? 0,
      closed: !!options.closed, points: sampled(controls, { ...options, absoluteY: options.kind === 'ramp' || options.absoluteY }), district: options.district };
    roads.push(road);
    return road;
  };
  const arterial = (id, name, controls, width, classification, options = {}) =>
    addRoad(id, name, controls.map(mapPoint), width, classification, options);
  const referenceRoad = (id, name, controls, width, classification, options = {}) => {
    const road = addRoad(id, name, controls.map(([px, py, elevation = 0]) => ({ ...fromReference(px, py), elevation })), width, classification, options);
    road.reference = controls.map(([px, py]) => ({ px, py }));
    if (options.bridge) road.bridge = true;
    return road;
  };

  // These control points trace the supplied PNG in one shared coordinate frame.
  // Western traffic joins the Ring at Ridge Junction and uses its west flank;
  // there is no second main road shadowing the same corridor at West Spire.
  const ring = referenceRoad('ring', 'Afterlight Ring', [
    [306, 410, 12], [271, 490, 12], [263, 568, 12], [278, 627, 25], [302, 704, 18],
    [358, 745, 12], [456, 759, 0], [548, 756, 12], [600, 713, 18], [634, 640, 25],
    [620, 565, 25], [578, 507, 18], [548, 451, 12], [476, 417, 12], [395, 417, 12], [344, 432, 12],
  ], 26, 'primary', { closed: true, level: 'mixed' });
  const meridian = referenceRoad('meridian', 'Meridian Expressway', [
    [723, 135, 12], [715, 210, 12], [726, 252, 12], [754, 323, 18], [758, 445, 25],
    [760, 565, 25], [762, 645, 25], [754, 766, 12], [754, 925, 12], [762, 1044, 25], [758, 1115, 25],
  ], 30, 'expressway', { level: 'mixed', curved: false });
  const neon = referenceRoad('neon-spine', 'Neon Spine', [[45, 623], [278, 627], [445, 630], [634, 640], [762, 645], [880, 645], [997, 650]], 32, 'primary', { curved: false, level: 'mixed', bridge: true });
  const freight = referenceRoad('north-freightway', 'North Freightway', [[45, 230, 12], [98, 228, 12], [179, 266, 12], [260, 304, 12], [334, 311, 12], [453, 310, 12], [567, 310, 12], [607, 281, 12], [663, 239, 12], [715, 210, 12]], 26, 'expressway', { level: 12 });
  referenceRoad('north-gate-link', 'North Gate — Ridge Link', [[98, 228, 12], [148, 288, 12], [206, 350, 12], [260, 386, 12], [306, 410, 12]], 24, 'expressway', { level: 12 });
  const south = referenceRoad('south-bypass', 'South Bypass', [[45, 1080], [119, 1056], [218, 1042], [345, 1035, 12], [490, 1040, 12], [620, 1040, 12], [762, 1044, 12], [900, 1044, 12], [997, 1052, 12]], 30, 'expressway', { level: 'mixed', curved: false, bridge: true });
  referenceRoad('western-north', 'Western Arterial · North', [[75, 135], [98, 228]], 23, 'secondary', { curved: false });
  referenceRoad('western-arterial', 'Western Arterial · South', [[358, 745, 12], [292, 805], [252, 937], [218, 1042], [193, 1115]], 23, 'primary', { level: 'mixed', curved: false });

  // Blue secondary routes follow the reference's irregular neighborhood fabric.
  // They feed the main corridors instead of repeating a second rectangular grid.
  const avenueSpecs = [
    ['central-avenue', 'Core Avenue', [[456, 135], [459, 246], [474, 325], [474, 417], [472, 490], [466, 565], [445, 630], [455, 714], [455, 759], [456, 879], [456, 1017], [456, 1040], [456, 1115]], 20],
    ['citadel-avenue', 'Citadel Avenue', [[614, 135], [611, 236], [606, 315], [585, 379], [573, 466], [576, 531], [582, 593], [600, 640], [593, 719], [583, 777], [597, 865], [606, 961], [620, 1040], [618, 1115]], 20],
    ['bay-avenue', 'Bay Avenue', [[832, 135], [826, 252], [835, 385], [830, 493], [836, 590], [850, 645], [850, 757], [866, 832], [880, 905], [882, 981], [880, 1044], [880, 1115]], 20],
    ['ridge-boulevard', 'Ridge Boulevard', [[45, 170], [154, 154], [302, 169], [459, 180], [611, 193], [715, 180], [832, 180]], 19],
    ['ember-boulevard', 'Ember Boulevard', [[45, 477], [183, 492], [271, 490], [318, 503], [406, 493], [472, 490], [573, 466], [692, 466], [830, 493]], 20],
    ['low-city-boulevard', 'Low City Boulevard', [[45, 922], [163, 889], [292, 805], [399, 831], [493, 837], [583, 830], [696, 829], [866, 832]], 19],
  ];
  for (const [id, name, controls, width] of avenueSpecs) referenceRoad(id, name, controls, width, 'secondary', { curved: id === 'low-city-boulevard' });

  // The two eastbound corridors continue over Blackwater Bay as bridges.
  for (const road of [neon, south]) {
    const entry = fromReference(road === neon ? 880 : 900, road === neon ? 645 : 1044);
    const bridgeY = Math.max(terrainHeight(entry.x, entry.z) + 12, WATER_LEVEL + 12);
    for (const p of road.points) if (p.x > entry.x - 400) {
      const blend = smooth((p.x - entry.x + 400) / 400);
      p.y = mix(p.y, bridgeY, blend);
    }
  }

  // Exact surface-level frontage and elevated pedestrian space at the starting
  // interchange make all three layers legible as soon as play begins.
  const showcaseStreet = (id, name, controls) => addRoad(id, name, controls.map(([x, z]) => ({ ...atEastpoint(x, z), elevation: 0 })), 15, 'secondary', { curved: false });
  showcaseStreet('eastpoint-frontage', 'Eastpoint Frontage', [[2420, 150], [2420, 600], [2420, 1050]]);
  showcaseStreet('eastpoint-quay', 'Eastpoint Market Street', [[2420, 800], [2550, 800], [2800, 800], [3600, 800]]);
  showcaseStreet('eastpoint-north-link', 'Eastpoint North Link', [[2420, 150], [2950, 150], [3600, 150]]);
  showcaseStreet('eastpoint-south-link', 'Eastpoint South Link', [[2420, 1050], [2950, 1050], [3600, 1050]]);
  addNeighborhoodStreets({ districts: MASTER_DISTRICTS, roads, addRoad, coastX, terrainHeight, nearestOnSegment, showcase: SHOWCASE });

  const junctionSpecs = [
    ['ridge-junction', 'Ridge Junction', 306, 410, ring, 'ember-boulevard'],
    ['north-gate', 'North Gate', 98, 228, freight, 'western-north'],
    ['stacks-interchange', 'Stacks Interchange', 607, 281, freight, 'citadel-avenue'],
    ['harbor-crossing', 'Harbor Crossing', 715, 210, meridian, 'ridge-boulevard'],
    ['west-spine', 'West Spire', 278, 627, ring, 'neon-spine'],
    ['core-nexus', 'Core Nexus', 445, 630, neon, 'central-avenue'],
    ['eastpoint', 'Eastpoint', 762, 645, meridian, 'eastpoint-frontage'],
    ['horizon-hub', 'Horizon Hub', 634, 640, ring, 'neon-spine'],
    ['cut-junction', 'Cut Junction', 218, 1042, south, 'western-arterial'],
    ['delta-interchange', 'Delta Interchange', 762, 1044, meridian, 'south-bypass'],
  ];
  const interchanges = [];
  for (const [id, name, px, py, raised, feederId] of junctionSpecs) {
    const p = fromReference(px, py), upper = closestRoadPoint(p.x, p.z, [raised]);
    const feeder = roads.find(r => r.id === feederId);
    if (upper.y - terrainHeight(upper.x, upper.z) < .3) {
      interchanges.push({ id, name, number: interchanges.length + 1, x: upper.x, z: upper.z, y: upper.y, road: raised.id, ramp: null });
      continue;
    }
    let lower = closestRoadPoint(upper.x - 190, upper.z + 220, [feeder]);
    if (Math.hypot(lower.x - upper.x, lower.z - upper.z) < 180) {
      const approach = feeder.points.filter(p => Math.hypot(p.x - upper.x, p.z - upper.z) > 250).sort((a, b) => Math.hypot(a.x - upper.x, a.z - upper.z) - Math.hypot(b.x - upper.x, b.z - upper.z))[0];
      if (approach) lower = { ...approach, road: feeder };
    }
    const bend = id === 'eastpoint' ? { ...atEastpoint(2448, 728), y: (lower.y + upper.y) / 2 }
      : { x: (lower.x + upper.x) / 2 - 85, z: (lower.z + upper.z) / 2 + 75, y: (lower.y + upper.y) / 2 };
    const ramp = addRoad(`${id}-ramp`, `${name} Access`, [lower, bend, upper], 10, 'ramp', { curved: true, kind: 'ramp', level: 'mixed', spacing: 18 });
    mergeLanding(ramp, raised);
    interchanges.push({ id, name, number: interchanges.length + 1, x: upper.x, z: upper.z, y: upper.y, road: raised.id, ramp: ramp.id });
  }
  // Connect the two elevated trunk routes with a genuine grade-changing slipway.
  // Freightway and Meridian share the Harbor Crossing control point at +12 m.

  const addDeck = (id, name, x, z, width, depth, elevation) => {
    const y = terrainHeight(x, z) + elevation + .07;
    const deck = { id, name, kind: 'deck', x, z, y, width, depth, elevation, supportOnly: true,
      minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, minY: y - .65, maxY: y, slabThickness: .65 };
    supports.push(deck); supportIndex.add(deck); return deck;
  };
  const addWalkRamp = (id, name, a, b, width = 5) => {
    const ramp = segmentRecord(a, b, width, { id, name, kind: 'ramp', pedestrian: true });
    supports.push(ramp); supportIndex.add(ramp); return ramp;
  };
  const showcaseDeck = (id, name, x, z, width, depth, elevation, absoluteY) => {
    const p = atEastpoint(x, z);
    return addDeck(id, name, p.x, p.z, width, depth, absoluteY === undefined ? elevation : absoluteY - terrainHeight(p.x, p.z) - .07);
  };
  const showcasePoint = (x, z) => { const p = atEastpoint(x, z); return point(p.x, p.z); };
  const plaza = showcaseDeck('eastpoint-concourse', 'Eastpoint Upper Market', 2498, 680, 45, 96, 8);
  showcaseDeck('eastpoint-walkbridge', 'Eastpoint Skywalk', 2552, 697, 92, 7, 0, plaza.y);
  const terrace = showcaseDeck('eastpoint-terrace', 'Eastpoint Bay Terrace', 2615, 697, 36, 52, 0, plaza.y);
  addWalkRamp('eastpoint-west-walk-ramp', 'Market Access Ramp', showcasePoint(2466, 770), { x: atEastpoint(2482, 724).x, z: plaza.maxZ, y: plaza.y }, 6);
  addWalkRamp('eastpoint-east-walk-ramp', 'Bay Terrace Access Ramp', showcasePoint(2630, 787), { x: atEastpoint(2630, 720).x, z: terrace.maxZ, y: terrace.y }, 6);
  const citadelDeck = addDeck('citadel-concourse', 'Citadel Public Concourse', 1265, -1050, 180, 18, 12);
  addWalkRamp('citadel-concourse-access', 'Citadel Concourse Ramp', point(1140, -940), { x: 1180, z: citadelDeck.maxZ, y: citadelDeck.y }, 7);
  const stacksDeck = addDeck('stacks-garden', 'Stacks Community Terrace', -380, -3740, 110, 58, 8);
  addWalkRamp('stacks-garden-access', 'Community Terrace Ramp', point(-450, -3630), { x: -424, z: stacksDeck.maxZ, y: stacksDeck.y }, 6);

  for (const road of roads) if (road.kind === 'ramp') {
    for (const p of road.points) p.y = Math.max(p.y, terrainHeight(p.x, p.z) + .07);
  }
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const segment = segmentRecord(road.points[i - 1], road.points[i], road.width, { id: `${road.id}:${i}`, road, kind: road.kind });
    const dx = segment.b.x - segment.a.x, dz = segment.b.z - segment.a.z, length = Math.hypot(dx, dz);
    const mx = (segment.a.x + segment.b.x) / 2, mz = (segment.a.z + segment.b.z) / 2;
    const half = road.width / 2, ground = terrainHeight(mx, mz), height = (segment.a.y + segment.b.y) / 2;
    const bank = clamp(1 - (height - ground - .07) / 2, 0, 1);
    segment.crossSlope = bank * (terrainHeight(mx - dz / length * half, mz + dx / length * half)
      - terrainHeight(mx + dz / length * half, mz - dx / length * half)) / road.width;
    segment.supportOverlap = Math.max(jointOverlap(road, i - 1), jointOverlap(road, i));
    const extendX = Math.abs(dx) / length * segment.supportOverlap, extendZ = Math.abs(dz) / length * segment.supportOverlap;
    const extendY = Math.abs(segment.b.y - segment.a.y) / length * segment.supportOverlap;
    segment.minX -= extendX; segment.maxX += extendX;
    segment.minZ -= extendZ; segment.maxZ += extendZ;
    segment.minY -= Math.abs(segment.crossSlope) * half + extendY;
    segment.maxY += Math.abs(segment.crossSlope) * half + extendY;
    roadIndex.add(segment);
  }

  const onRoad = (x, z, radius = 0) => roadIndex.near(x, z, radius + 20).some(s => nearestOnSegment(x, z, s.a, s.b).distance < s.width / 2 + radius);
  const reserveBox = (box, gap = 4) => {
    const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
    const radius = Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 2 + gap;
    if (onRoad(cx, cz, radius)) return true;
    return supportIndex.query(box.minX - gap, box.minZ - gap, box.maxX + gap, box.maxZ + gap).length > 0;
  };
  const surfaceHeight = (x, z, ceiling = Infinity) => {
    let y = terrainHeight(x, z);
    for (const s of [...roadIndex.near(x, z, 1), ...supportIndex.near(x, z, 1)]) {
      let sy;
      if (s.a) {
        const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, length = Math.hypot(dx, dz);
        const along = ((x - s.a.x) * dx + (z - s.a.z) * dz) / length;
        const across = (-(x - s.a.x) * dz + (z - s.a.z) * dx) / length, overlap = s.supportOverlap ?? .12;
        if (along < -overlap || along > length + overlap || Math.abs(across) > s.width / 2) continue;
        sy = s.a.y + (s.b.y - s.a.y) * along / length + (s.crossSlope ?? 0) * across;
      }
      else { if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue; sy = s.y; }
      if (sy <= ceiling + .001 && sy > y) y = sy;
    }
    return y;
  };
  const nearestSurfacePoint = (x, z, maxDistance = Infinity) => {
    let nearest = null;
    const candidates = Number.isFinite(maxDistance) ? roadIndex.near(x, z, maxDistance) : roads.flatMap(road => road.points.slice(1).map((b, i) => ({ a: road.points[i], b, road })));
    for (const segment of candidates) {
      const hit = nearestOnSegment(x, z, segment.a, segment.b);
      if (hit.distance > maxDistance || (nearest && hit.distance >= nearest.distance)) continue;
      if (hit.y - terrainHeight(hit.x, hit.z) > .30) continue;
      nearest = { ...hit, road: segment.road, a: segment.a, b: segment.b };
    }
    return nearest;
  };
  cached = { roads, roadIndex, supports, supportIndex, interchanges, districts: MASTER_DISTRICTS, districtAt,
    terrainHeight, surfaceHeight, nearestSurfacePoint, onRoad, reserveBox, showcase: SHOWCASE, spawn: { ...SHOWCASE.spawn, y: terrainHeight(SHOWCASE.spawn.x, SHOWCASE.spawn.z) } };
  return cached;
}

export const surfaceHeight = (x, z, ceiling) => createMasterPlan().surfaceHeight(x, z, ceiling);
export const onRoad = (x, z, radius) => createMasterPlan().onRoad(x, z, radius);
export const nearestSurfacePoint = (x, z, maxDistance) => createMasterPlan().nearestSurfacePoint(x, z, maxDistance);
