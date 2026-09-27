import { seededRandom, orientedBox } from './physics.js';
import { WORLD_LIMIT, OUTER_DISTRICTS, outerDistrictAt } from './world-config.js';
import { SpatialGrid } from './spatial-grid.js';
import { buildingColliders } from './architecture.js';

export const BUILDING_TYPES = ['terrace', 'apartment', 'office', 'warehouse', 'factory', 'civic', 'greenhouse', 'market'];
export const typeMix = {
  sunset: ['terrace', 'terrace', 'apartment', 'market'], cypress: ['greenhouse', 'civic', 'terrace'],
  signal: ['apartment', 'office', 'apartment', 'terrace'], civic: ['civic', 'office', 'apartment'],
  foundry: ['factory', 'warehouse', 'warehouse', 'office'], southbank: ['apartment', 'office', 'market'],
  promenade: ['market', 'civic', 'apartment', 'warehouse'], lantern: ['terrace', 'terrace', 'market', 'apartment'],
};

// Sample smooth, authored routes. The same centerlines drive roads, placement and the map.
export function sampleRoad(control, closed = false, spacing = 6) {
  const points = [], count = control.length, segments = closed ? count : count - 1;
  const at = i => control[closed ? (i + count) % count : Math.max(0, Math.min(count - 1, i))];
  for (let i = 0; i < segments; i++) {
    const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
    const steps = Math.max(2, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / spacing));
    for (let j = 0; j < steps; j++) {
      const t = j / steps, t2 = t * t, t3 = t2 * t;
      const p = axis => .5 * (2 * b[axis] + (-a[axis] + c[axis]) * t + (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * t2 + (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * t3);
      points.push({ x: p(0), z: p(1) });
    }
  }
  const last = closed ? control[0] : control.at(-1); points.push({ x: last[0], z: last[1] });
  return points;
}

export function footprint(x, z, w, d, yaw = 0, h = 1) {
  return orientedBox(x, z, w, d, yaw, h);
}

export function propFootprint(x, z, type, yaw = 0) {
  return footprint(x, z, type === 'bench' ? 2.5 : type === 'planter' ? 1.1 : type === 'lamp' ? .15 : .65,
    type === 'planter' ? 1.1 : type === 'lamp' ? .15 : type === 'bench' ? .75 : .65, yaw, type === 'lamp' ? 7 : type === 'kiosk' ? 2.2 : 1.3);
}

export function segmentHitsBox(a, b, box, pad) {
  let near = 0, far = 1;
  for (const [axis, min, max] of [['x', box.minX - pad, box.maxX + pad], ['z', box.minZ - pad, box.maxZ + pad]]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-8) { if (a[axis] < min || a[axis] > max) return false; }
    else {
      let first = (min - a[axis]) / delta, last = (max - a[axis]) / delta;
      if (first > last) [first, last] = [last, first];
      near = Math.max(near, first); far = Math.min(far, last);
      if (near > far) return false;
    }
  }
  return true;
}

export function createCityPlan(reserved = []) {
  const random = seededRandom(219831), range = (a, b) => a + random() * (b - a), pick = a => a[Math.floor(random() * a.length)];
  const roads = [], buildings = [], trees = [], props = [], colliders = [];
  const occupied = new SpatialGrid(), roadGrid = new SpatialGrid();
  const road = (name, control, width = 14, closed = false) => {
    const points = sampleRoad(control, closed);
    roads.push({ name, points, width });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], pad = width / 2 + 3;
      roadGrid.add({ minX: Math.min(a.x, b.x) - pad, maxX: Math.max(a.x, b.x) + pad, minZ: Math.min(a.z, b.z) - pad, maxZ: Math.max(a.z, b.z) + pad, a, b, pad });
    }
  };
  road('Bay Circuit', [[-700, 0], [-480, -560], [0, -650], [510, -550], [710, -20], [580, 540], [0, 700], [-540, 570]], 18, true);
  road('Neighborhood Way', [[-380, 20], [-320, -300], [-65, -355], [305, -320], [360, -30], [310, 345], [65, 390], [-340, 325]], 14, true);
  road('Garden Crescent', [[-550, 35], [-435, -420], [-30, -500], [440, -440], [545, -20], [440, 440], [30, 535], [-440, 445]], 12, true);
  road('Sunset Avenue', [[-270, 0], [-360, 0], [-490, 65], [-700, 0]], 18);
  road('Foundry Avenue', [[210, 0], [226, 22], [256, 22], [280, 0], [350, 0], [465, -70], [710, -20]], 18);
  road('Signal Avenue', [[0, -230], [26, -250], [26, -283], [0, -330], [-70, -425], [0, -650]], 18);
  road('Waterfront Drive', [[0, 270], [0, 325], [100, 470], [0, 700]], 18);
  for (const side of [-1, 1]) {
    road('Regional North–South Link', [[0, side * 700], [0, side * 768], [0, side * 816]], 18);
    road('Regional East–West Link', [[side * 710, 0], [side * 768, 0], [side * 816, 0]], 18);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    road(`${sx < 0 ? 'West' : 'East'} ${sz < 0 ? 'North' : 'South'} Connector`, [[sx * 192, sz * 270], [sx * 215, sz * 320], [sx * 325, sz * 400], [sx * 490, sz * 560]], 14);
    road('Local Crescent', [[sx * 270, sz * 128], [sx * 330, sz * 155], [sx * 440, sz * 260], [sx * 610, sz * 300]], 11);
    road('Park Lane', [[sx * 200, sz * 485], [sx * 220, sz * 570], [sx * 320, sz * 660]], 10);
  }
  const onRoad = (box, clearance = 0) => roadGrid.query(box.minX - clearance, box.minZ - clearance, box.maxX + clearance, box.maxZ + clearance)
    .some(s => segmentHitsBox(s.a, s.b, box, s.pad + clearance));
  const clear = (box, gap = 2) => Math.max(Math.abs(box.minX), Math.abs(box.maxX), Math.abs(box.minZ), Math.abs(box.maxZ)) < WORLD_LIMIT - 28 &&
    !occupied.query(box.minX - gap, box.minZ - gap, box.maxX + gap, box.maxZ + gap).length && !onRoad(box) &&
    !reserved.some(p => p.x > box.minX - 9 && p.x < box.maxX + 9 && p.z > box.minZ - 9 && p.z < box.maxZ + 9);
  const addBuilding = (x, z, yaw) => {
    if (Math.max(Math.abs(x), Math.abs(z)) < 305) return;
    const district = outerDistrictAt(x, z), type = pick(typeMix[district.id]);
    if (district.id === 'cypress' && random() < .7) return;
    const w = type === 'terrace' ? range(9, 13) : type === 'factory' || type === 'warehouse' ? range(24, 35) : range(17, 25);
    const d = type === 'terrace' ? range(13, 18) : range(17, 27);
    const h = ({ terrace: range(9, 15), apartment: range(24, 48), office: range(34, 76), warehouse: range(7, 12), factory: range(12, 18), civic: range(12, 21), greenhouse: range(5, 8), market: range(6, 10) })[type];
    const box = footprint(x, z, w + 2, d + 2, yaw, h + 5);
    if (!clear(box)) return;
    occupied.add(box);
    const building = { id: `inner:${buildings.length}`, type, district: district.id, x, z, w, d, h, yaw, variation: random() };
    const physical = buildingColliders(building); building.box = physical[0];
    buildings.push(building); colliders.push(...physical);
  };
  // Frontages follow the roads instead of imposing a second rectangular grid.
  for (const r of roads) {
    let walked = 0;
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], p = r.points[i], length = Math.hypot(p.x - a.x, p.z - a.z);
      walked += length; if (walked < 25) continue; walked = 0;
      const tx = (p.x - a.x) / length, tz = (p.z - a.z) / length, yaw = Math.atan2(-tz, tx);
      for (const side of [-1, 1]) {
        const offset = r.width / 2 + 27;
        addBuilding(p.x - tz * side * offset, p.z + tx * side * offset, yaw + (side > 0 ? Math.PI : 0));
      }
    }
  }
  // A few infill blocks leave space for parks, gardens and pedestrian shortcuts.
  for (let x = -755; x <= 755; x += 43) for (let z = -755; z <= 755; z += 43) {
    if (random() < .45) addBuilding(x + range(-12, 12), z + range(-12, 12), range(-.3, .3));
  }
  for (let x = -790; x <= 790; x += 19) for (let z = -790; z <= 790; z += 19) {
    const px = x + range(-7, 7), pz = z + range(-7, 7);
    if (Math.max(Math.abs(px), Math.abs(pz)) < 300) continue;
    const district = outerDistrictAt(px, pz), chance = district.id === 'cypress' ? .86 : district.id === 'foundry' ? .12 : .43;
    if (random() > chance) continue;
    const radius = district.id === 'cypress' ? 3.4 : 2.4, box = footprint(px, pz, radius * 2, radius * 2);
    if (!clear(box, 1)) continue;
    const size = range(.8, 1.4), type = district.id === 'promenade' ? 'palm' : random() < .45 ? 'cypress' : 'broadleaf';
    trees.push({ x: px, z: pz, size, type }); occupied.add(box);
    colliders.push(footprint(px, pz, .65 * size, .65 * size, 0, 5 * size));
  }
  for (const r of roads) {
    for (let i = 4; i < r.points.length - 1; i += 5) {
      const p = r.points[i], q = r.points[i + 1], length = Math.hypot(q.x - p.x, q.z - p.z), side = i % 2 ? 1 : -1;
      const x = p.x - (q.z - p.z) / length * (r.width / 2 + 3.5) * side;
      const z = p.z + (q.x - p.x) / length * (r.width / 2 + 3.5) * side;
      if (Math.max(Math.abs(x), Math.abs(z)) < 290 || occupied.near(x, z, 2).length || reserved.some(p => Math.hypot(p.x - x, p.z - z) < 5)) continue;
      const type = ['lamp', 'bench', 'planter', 'lamp', 'kiosk', 'bin'][i % 6];
      const yaw = Math.atan2(-(q.z - p.z), q.x - p.x);
      const box = propFootprint(x, z, type, yaw);
      if (roadGrid.near(x, z, 6).some(s => segmentHitsBox(s.a, s.b, box, s.pad - 3 + 1.6))) continue;
      props.push({ x, z, yaw, type });
      // Keep lamp posts and furniture outside the driveable lane.
      colliders.push(box);
    }
  }
  return { roads, buildings, trees, props, colliders, districts: OUTER_DISTRICTS, onRoad };
}
