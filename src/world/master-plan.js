import { SpatialGrid } from '../core/spatial-grid.js';
import * as authored from './authored-plan.js';
import { CITY_SCALE, authoredToWorld } from './world-scale.js';

export { nearestOnSegment } from './authored-plan.js';
const { nearestOnSegment } = authored;
export const MASTER_WORLD_LIMIT = authored.MASTER_WORLD_LIMIT * CITY_SCALE;
export const TERRAIN_GRID = authored.TERRAIN_GRID * CITY_SCALE;
export const WATER_LEVEL = authored.WATER_LEVEL * CITY_SCALE;
export const fromMap = (x, z) => scalePosition(authored.fromMap(x, z));
export const fromReference = (px, py) => scalePosition(authored.fromReference(px, py));
const scalePosition = p => ({ ...p, ...authoredToWorld(p.x, p.z) });
// Preserve physical road clearance and slab thickness while scaling the terrain
// and infrastructure elevation together, so ramps retain their original grade.
const surfaceY = y => (y - .07) * CITY_SCALE + .07;
const surfacePoint = p => ({ ...scalePosition(p), y: surfaceY(p.y) });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const MASTER_DISTRICTS = authored.MASTER_DISTRICTS.map(d => ({
  ...scalePosition(d), radiusX: d.radiusX * CITY_SCALE, radiusZ: d.radiusZ * CITY_SCALE,
}));
export const districts = MASTER_DISTRICTS;
export function districtAt(x, z) {
  return MASTER_DISTRICTS.find(d => d.id === authored.districtAt(x / CITY_SCALE, z / CITY_SCALE).id);
}
export const coastX = z => authored.coastX(z / CITY_SCALE) * CITY_SCALE;
export const isWater = (x, z) => x > coastX(z);
// Sampling the authored triangles at inverse coordinates gives precisely the
// same mesh at 32 m spacing, including the coastline and hillside gradients.
export const terrainHeight = (x, z) => authored.terrainHeight(x / CITY_SCALE, z / CITY_SCALE) * CITY_SCALE;
export const SHOWCASE = Object.freeze({
  ...scalePosition(authored.SHOWCASE),
  spawn: scalePosition(authored.SHOWCASE.spawn), car: scalePosition(authored.SHOWCASE.car),
  meeting: { ...scalePosition(authored.SHOWCASE.meeting), elevation: authored.SHOWCASE.meeting.elevation * CITY_SCALE },
  transit: scalePosition(authored.SHOWCASE.transit),
});

function segmentRecord(a, b, width, data = {}) {
  const pad = width / 2;
  return { ...data, a, b, width, minX: Math.min(a.x, b.x) - pad, maxX: Math.max(a.x, b.x) + pad,
    minZ: Math.min(a.z, b.z) - pad, maxZ: Math.max(a.z, b.z) + pad,
    minY: Math.min(a.y, b.y) - .65, maxY: Math.max(a.y, b.y), slabThickness: .65, supportOnly: true };
}

function jointOverlap(road, index) {
  const last = road.points.length - 1;
  if (index === last && road.closed) index = 0;
  if (!road.closed && (index === 0 || index === last)) return .14;
  const p = road.points[index], a = road.points[index === 0 ? last - 1 : index - 1], b = road.points[index + 1];
  const ax = p.x - a.x, az = p.z - a.z, bx = b.x - p.x, bz = b.z - p.z;
  const cosine = clamp((ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz)), -.999999, 1);
  return road.width / 2 * Math.sqrt((1 - cosine) / (1 + cosine)) + .14;
}

let cached;
export function createMasterPlan() {
  if (cached) return cached;
  // Transform the completed graph, rather than regenerating infill against a
  // smaller boundary: road IDs, sample vertices, joins and districts survive.
  const source = authored.createMasterPlan();
  const roads = source.roads.map(road => ({ ...road,
    width: Math.max(6, road.width * CITY_SCALE),
    level: typeof road.level === 'number' ? road.level * CITY_SCALE : road.level,
    points: road.points.map(surfacePoint),
  }));
  const roadIndex = new SpatialGrid([], 96 * CITY_SCALE), supportIndex = new SpatialGrid([], 96 * CITY_SCALE);
  const supports = source.supports.map(s => {
    if (s.a) return segmentRecord(surfacePoint(s.a), surfacePoint(s.b), s.width * CITY_SCALE,
      { id: s.id, name: s.name, kind: s.kind, pedestrian: s.pedestrian });
    const width = s.width * CITY_SCALE, depth = s.depth * CITY_SCALE, p = surfacePoint(s);
    return { ...p, width, depth, elevation: s.elevation * CITY_SCALE,
      minX: p.x - width / 2, maxX: p.x + width / 2, minZ: p.z - depth / 2, maxZ: p.z + depth / 2,
      minY: p.y - .65, maxY: p.y, slabThickness: .65 };
  });
  for (const support of supports) supportIndex.add(support);
  const interchanges = source.interchanges.map(surfacePoint);
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const segment = segmentRecord(road.points[i - 1], road.points[i], road.width, { id: `${road.id}:${i}`, road, kind: road.kind });
    const dx = segment.b.x - segment.a.x, dz = segment.b.z - segment.a.z, length = Math.hypot(dx, dz);
    const mx = (segment.a.x + segment.b.x) / 2, mz = (segment.a.z + segment.b.z) / 2;
    const half = road.width / 2, ground = terrainHeight(mx, mz), height = (segment.a.y + segment.b.y) / 2;
    const bank = clamp(1 - (height - ground - .07) / (2 * CITY_SCALE), 0, 1);
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
