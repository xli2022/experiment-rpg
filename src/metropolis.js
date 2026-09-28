import { WORLD_LIMIT, METRO_BLOCK_SIZE, outerDistrictAt } from './world-config.js';
import { seededRandom } from './physics.js';
import { SpatialGrid } from './spatial-grid.js';
import { footprint, propFootprint, segmentHitsBox, typeMix } from './city-plan.js';
import { buildingColliders } from './architecture.js';
import { PUBLIC_SPACES, publicSpaceColliders } from './public-spaces.js';
import { REGIONAL_INNER_EDGE, streetPoint } from './roads.js';
export { streetPoint } from './roads.js';

const blockRandom = (bx, bz) => seededRandom(Math.imul(bx + 53, 73856093) ^ Math.imul(bz + 71, 19349663));
const parkBlock = (bx, bz, random = blockRandom(bx, bz)) => random() < (outerDistrictAt(bx * 192, bz * 192).id === 'cypress' ? .6 : .13);

function* areaBlocks(minX, minZ, maxX, maxZ) {
  // Covers the maximum street deformation plus a building's footprint at an edge.
  for (let x = Math.floor((minX - 115) / 192); x <= Math.floor((maxX + 115) / 192); x++) {
    for (let z = Math.floor((minZ - 85) / 192); z <= Math.floor((maxZ + 85) / 192); z++) {
      if (Math.abs(x * 192) > WORLD_LIMIT + 192 || Math.abs(z * 192) > WORLD_LIMIT + 192) continue;
      if (x >= -4 && x < 4 && z >= -4 && z < 4) continue;
      yield [x, z];
    }
  }
}

export class Metropolis {
  constructor(reserved = []) {
    this.reserved = reserved; this.roads = []; this.roadIndex = new SpatialGrid([], 96); this.blocks = new Map(); this.generated = 0;
    // End on the outermost cross street, not in the unbuilt strip beyond it.
    // Aligned sampling includes every grid intersection exactly.
    const span = Math.floor((WORLD_LIMIT - 76) / METRO_BLOCK_SIZE) * METRO_BLOCK_SIZE;
    for (let s = -span; s <= span; s += METRO_BLOCK_SIZE) for (const horizontal of [false, true]) {
      const width = s % 768 === 0 ? 18 : 11;
      // The central district has its own street layout. Split metadata here too:
      // map/traffic paths must never bridge the deliberately unpainted center.
      // Preserve the +/-768 perimeter avenue to join every exposed grid stub.
      const ranges = Math.abs(s) < REGIONAL_INNER_EDGE ? [[-span, -REGIONAL_INNER_EDGE], [REGIONAL_INNER_EDGE, span]] : [[-span, span]];
      for (const [start, end] of ranges) {
        const points = [];
        for (let t = start; t <= end; t += 48) points.push(horizontal ? streetPoint(t, s) : streetPoint(s, t));
        const road = { name: width === 18 ? 'Regional avenue' : 'Neighborhood street', width, points };
        this.roads.push(road);
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i], pad = width / 2 + 3;
          this.roadIndex.add({ a, b, width, minX: Math.min(a.x, b.x) - pad, maxX: Math.max(a.x, b.x) + pad, minZ: Math.min(a.z, b.z) - pad, maxZ: Math.max(a.z, b.z) + pad });
        }
      }
    }
  }
  onRoad(box, clearance = 3) {
    return this.roadIndex.query(box.minX - clearance, box.minZ - clearance, box.maxX + clearance, box.maxZ + clearance)
      .some(s => segmentHitsBox(s.a, s.b, box, s.width / 2 + clearance));
  }
  block(bx, bz) {
    const key = `${bx},${bz}`;
    if (this.blocks.has(key)) { const block = this.blocks.get(key); this.blocks.delete(key); this.blocks.set(key, block); return block; }
    const random = blockRandom(bx, bz);
    const range = (a, b) => a + random() * (b - a), pick = a => a[Math.floor(random() * a.length)];
    const buildings = [], trees = [], props = [], features = [], colliders = [], occupied = new SpatialGrid();
    const district = outerDistrictAt(bx * 192, bz * 192);
    const park = parkBlock(bx, bz, random);
    const valid = box => Math.max(Math.abs(box.minX), Math.abs(box.minZ), Math.abs(box.maxX), Math.abs(box.maxZ)) < WORLD_LIMIT - 30 &&
      !(box.minX < 850 && box.maxX > -850 && box.minZ < 850 && box.maxZ > -850) && !this.onRoad(box) &&
      !occupied.query(box.minX - 3, box.minZ - 3, box.maxX + 3, box.maxZ + 3).length &&
      !this.reserved.some(p => p.x > box.minX - 10 && p.x < box.maxX + 10 && p.z > box.minZ - 10 && p.z < box.maxZ + 10);
    if (park || random() < .34) {
      const p = streetPoint(bx * 192 + 96, bz * 192 + 96), box = footprint(p.x, p.z, 44, 44);
      if (valid(box)) {
        const feature = { ...p, type: district.id === 'cypress' ? pick(['garden', 'court', 'sculpture']) : pick(PUBLIC_SPACES) };
        features.push(feature); occupied.add(box); colliders.push(...publicSpaceColliders(feature));
      }
    }
    for (let u = 33; u < 170; u += 42) for (let v = 33; v < 170; v += 42) {
      if (random() < (park ? .94 : .08)) continue;
      const p = streetPoint(bx * 192 + u + range(-3, 3), bz * 192 + v + range(-3, 3));
      const type = pick(typeMix[district.id]), yaw = Math.atan2(-.1 * Math.cos(p.x / 510), 1) + (random() < .5 ? 0 : Math.PI / 2);
      const w = type === 'terrace' ? range(13, 18) : range(22, 29), d = range(19, 28);
      const h = ({ terrace: range(10, 17), apartment: range(23, 48), office: range(37, 90), warehouse: range(7, 12), factory: range(12, 19), civic: range(14, 22), greenhouse: range(5, 8), market: range(6, 10) })[type];
      const box = footprint(p.x, p.z, w + 2, d + 2, yaw, h + 6);
      if (!valid(box)) continue;
      const building = { id: `${key}:${u}:${v}`, ...p, w, d, h, yaw, type, district: district.id, variation: random() };
      const physical = buildingColliders(building); building.box = physical[0];
      buildings.push(building); occupied.add(box); colliders.push(...physical);
    }
    for (let i = 0; i < (park ? 95 : 22); i++) {
      const p = streetPoint(bx * 192 + range(20, 172), bz * 192 + range(20, 172)), size = range(.75, 1.5);
      const box = footprint(p.x, p.z, 5 * size, 5 * size);
      if (!valid(box)) continue;
      const type = district.id === 'promenade' ? 'palm' : random() < .48 ? 'cypress' : 'broadleaf';
      trees.push({ ...p, size, type }); occupied.add(box); colliders.push(footprint(p.x, p.z, .65 * size, .65 * size, 0, 5 * size));
    }
    for (let i = 0; i < 6; i++) {
      const type = ['lamp', 'bench', 'planter', 'lamp', 'bin', 'kiosk'][i];
      const p = streetPoint(bx * 192 + 17, bz * 192 + 24 + i * 27), box = propFootprint(p.x, p.z, type, Math.PI / 2);
      if (!valid(box)) continue;
      props.push({ ...p, yaw: Math.PI / 2, type }); colliders.push(box);
    }
    const block = { bx, bz, buildings, trees, props, features, colliders, park };
    this.blocks.set(key, block); this.generated++;
    // Only blueprints near recently visited cells stay in RAM; regeneration is deterministic.
    while (this.blocks.size > 160) this.blocks.delete(this.blocks.keys().next().value);
    return block;
  }
  area(minX, minZ, maxX, maxZ) {
    return Array.from(areaBlocks(minX, minZ, maxX, maxZ), ([x, z]) => this.block(x, z));
  }
  hasParkInArea(minX, minZ, maxX, maxZ) {
    // Ground colors need only the first seeded choice, not every building/tree blueprint.
    for (const [x, z] of areaBlocks(minX, minZ, maxX, maxZ)) if (parkBlock(x, z)) return true;
    return false;
  }
  collidersIn(minX, minZ, maxX, maxZ) {
    return this.area(minX, minZ, maxX, maxZ).flatMap(b => b.colliders.filter(p => p.minX <= maxX && p.maxX >= minX && p.minZ <= maxZ && p.maxZ >= minZ));
  }
}
