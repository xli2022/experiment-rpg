import * as THREE from 'three';
import { signTexture } from './sign-texture.js';
import { createTerrainMaterials } from './terrain-materials.js';
import { buildingSign, createBuildingSignMaterial } from './building-signs.js';
import { createInfrastructureIndex, geometryVolume, infrastructureIntersections, roadSolidRecipes, supportSolidRecipe } from './infrastructure-clearance.js';
import { buildingDesign, buildingVolumes, buildingVolumeColliders, buildingDetails, buildingEntrances } from './building-design.js';
import { cachedInteriorPlan } from './interior-plan.js';
import { entranceSteps, interiorContext, interiorSpatial } from './interior-physics.js';
import { createFacadeMaterial, facadeUV, interiorClipUniforms, patchInteriorClip } from './building-materials.js';
import { DISTRICT_ARCHITECTURE, sampleArchitecture, buildingUseAtHeight } from './district-architecture.js';
import { footprintShape } from './building-footprints.js';
import { segmentHitsBox } from '../core/geometry.js';
import { seededRandom, orientedBox, boxCoordinates } from '../core/physics.js';
import { SpatialGrid } from '../core/spatial-grid.js';
import { CHUNK_SIZE, WORLD_LIMIT } from './world-config.js';
import { createMasterPlan, districtAt, terrainHeight, TERRAIN_GRID, WATER_LEVEL, isWater, SHOWCASE } from './master-plan.js';
import { CITY_SCALE, atEastpoint } from './world-scale.js';
import { wayfindingSigns } from './wayfinding.js';
import { pocketVegetation, treeParts, shrubParts, treeCollider } from './vegetation.js';

const BLOCK_SIZE = 192, CACHE_LIMIT = 160;
const center = segment => ({ x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2, z: (segment.a.z + segment.b.z) / 2 });
const inBounds = (p, minX, minZ, maxX, maxZ) => p.x >= minX && p.x < maxX && p.z >= minZ && p.z < maxZ;
const inCell = (p, cell) => inBounds(p, cell.x, cell.z, cell.x + CHUNK_SIZE, cell.z + CHUNK_SIZE);
const boundsOverlap = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const hash = text => { let value = 2166136261; for (const c of text) value = Math.imul(value ^ c.charCodeAt(0), 16777619); return value >>> 0; };
const colors = { concrete: 0x657780, dark: 0x263745, rail: 0x77939c, cyan: 0x74d8d5, amber: 0xe4b276, pink: 0xcd8fb1 };

function districtStyle(district) {
  const id = district.id.toLowerCase();
  if (id.includes('citadel')) return { types: ['office', 'office', 'civic'], tint: 0x7e9fab, accent: colors.cyan, density: .93 };
  if (id.includes('core')) return { types: ['office', 'apartment', 'market'], tint: 0x9099ab, accent: colors.pink, density: .92 };
  if (id.includes('stack')) return { types: ['apartment', 'apartment', 'market'], tint: 0x80a69b, accent: 0x9bdec6, density: .95 };
  if (id.includes('ember')) return { types: ['terrace', 'apartment', 'civic'], tint: 0xba9383, accent: colors.amber, density: .85 };
  if (id.includes('shadow')) return { types: ['market', 'apartment', 'terrace'], tint: 0x93869e, accent: 0xcf95df, density: .96 };
  if (id.includes('cut')) return { types: ['market', 'terrace', 'warehouse'], tint: 0xa78c7c, accent: 0xe49c75, density: .88 };
  if (id.includes('port') || id.includes('delta')) return { types: ['warehouse', 'warehouse', 'factory'], tint: 0x7f969f, accent: 0xe4b475, density: .58, freight: true };
  if (id.includes('foundry') || id.includes('ridge')) return { types: ['factory', 'warehouse', 'apartment'], tint: 0x8a9492, accent: 0xd4a17c, density: .75, freight: true };
  if (id.includes('east')) return { types: ['apartment', 'office', 'market'], tint: 0x8ca5a6, accent: colors.cyan, density: .91 };
  if (id.includes('south')) return { types: ['apartment', 'terrace', 'civic'], tint: 0xa5ad91, accent: 0xcecc90, density: .8 };
  return { types: ['terrace', 'apartment', 'market'], tint: 0x989fb1, accent: colors.pink, density: .86 };
}

function roadFrame(segment) {
  const dx = segment.b.x - segment.a.x, dz = segment.b.z - segment.a.z, dy = segment.b.y - segment.a.y;
  const flatLength = Math.hypot(dx, dz), p = center(segment);
  return { ...p, flatLength, length: Math.hypot(flatLength, dy), yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, flatLength), nx: dz / flatLength, nz: -dx / flatLength };
}

function localPoint(p, x, z) {
  const c = Math.cos(p.yaw ?? 0), s = Math.sin(p.yaw ?? 0);
  return { x: p.x + x * c + z * s, z: p.z - x * s + z * c };
}

function groundTop(p) {
  const corners = [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]].map(([x, z]) => {
    const point = localPoint(p, x * p.w, z * p.d); return terrainHeight(point.x, point.z);
  });
  return { min: Math.min(...corners), max: Math.max(...corners) };
}

// Broad-phase AABBs select nearby lots; this separating-axis check retains
// useful frontage along diagonal roads without letting rotated lots overlap.
function lotsOverlap(a, b) {
  if (!boundsOverlap(a, b)) return false;
  const ac = Math.cos(a.yaw ?? 0), as = Math.sin(a.yaw ?? 0), bc = Math.cos(b.yaw ?? 0), bs = Math.sin(b.yaw ?? 0);
  return [[ac, -as], [as, ac], [bc, -bs], [bs, bc]].every(([x, z]) => {
    const gap = Math.abs((a.x - b.x) * x + (a.z - b.z) * z);
    const radiusA = Math.abs(ac * x - as * z) * a.w / 2 + Math.abs(as * x + ac * z) * a.d / 2;
    const radiusB = Math.abs(bc * x - bs * z) * b.w / 2 + Math.abs(bs * x + bc * z) * b.d / 2;
    return gap < radiusA + radiusB;
  });
}

export function frontageBlocked(box, plan, gap = 4) {
  const localBox = { minX: -box.w / 2, maxX: box.w / 2, minZ: -box.d / 2, maxZ: box.d / 2 };
  const bounds = [box.minX - gap, box.minZ - gap, box.maxX + gap, box.maxZ + gap];
  for (const segment of plan.roadIndex.query(...bounds)) {
    if (segmentHitsBox(boxCoordinates(segment.a.x, segment.a.z, box), boxCoordinates(segment.b.x, segment.b.z, box), localBox, segment.width / 2 + gap)) return true;
  }
  // Concourse access needs its full horizontal corridor even below a deck.
  return plan.supportIndex.query(...bounds).length > 0;
}

function showcaseBuildings(plan, reserved) {
  const anchors = [
    [2510, 754, 25, 28, 104, 'office'], [2608, 752, 25, 28, 130, 'office'],
    [2652, 692, 27, 32, 145, 'office'], [2590, 651, 25, 28, 98, 'apartment'],
    [2492, 548, 30, 27, 156, 'office'], [2370, 696, 27, 32, 116, 'apartment'],
    [2368, 648, 26, 26, 82, 'office'], [2330, 746, 30, 30, 78, 'apartment'],
  ];
  return anchors.flatMap(([authoredX, authoredZ, w, d, h, type], i) => {
    const { x, z } = atEastpoint(authoredX, authoredZ);
    w *= CITY_SCALE; d *= CITY_SCALE;
    const district = districtAt(x, z), id = `eastpoint-anchor:${i}`;
    const { footprint } = sampleArchitecture(district.id, seededRandom(hash(`${id}:architecture`)));
    if (footprint !== 'rectangle') w = d = Math.min(w, d);
    const [low, high] = DISTRICT_ARCHITECTURE[district.id].heightRange;
    h = Math.max(low, Math.min(high, h));
    const box = orientedBox(x, z, w + 2, d + 2);
    if (plan.reserveBox(box, 2) || reserved.some(p => p.x > box.minX - 6 && p.x < box.maxX + 6 && p.z > box.minZ - 6 && p.z < box.maxZ + 6)) return [];
    const grades = groundTop({ x, z, w, d });
    return [{ id, x, z, y: grades.max + .12, ground: grades.min, w, d, h, footprint, yaw: 0, type, district: district.id, variation: .2 + (i % 4) * .2, tint: i % 2 ? 0x93a6a8 : 0x7f9ca9, accent: i % 2 ? colors.amber : colors.cyan, anchor: true }];
  });
}

function buildingBoxes(p) {
  return buildingVolumeColliders(p);
}

function elevated(segment) {
  const p = center(segment);
  return p.y - terrainHeight(p.x, p.z) > 3.5;
}

function blocksPassage(box, plan, ignored) {
  const surfaces = [...plan.roadIndex.query(box.minX - 3, box.minZ - 3, box.maxX + 3, box.maxZ + 3), ...plan.supportIndex.query(box.minX - 3, box.minZ - 3, box.maxX + 3, box.maxZ + 3)];
  return surfaces.some(s => {
    if (s === ignored || s.road && s.road === ignored) return false;
    // A pier below its own deck is valid; a post through a lower traffic lane is not.
    if (s.minY > box.maxY + .02 || s.maxY + 2 < box.minY) return false;
    return s.a ? segmentHitsBox(s.a, s.b, box, s.width / 2 + 2) :
      box.minX < s.maxX + 1 && box.maxX > s.minX - 1 && box.minZ < s.maxZ + 1 && box.maxZ > s.minZ - 1;
  });
}

function segmentFeatures(segment, plan) {
  const f = roadFrame(segment), result = [], road = segment.road ?? segment;
  if (!elevated(segment)) return result;
  const crossing = plan.roadIndex.query(f.x - 18, f.z - 18, f.x + 18, f.z + 18).some(s => {
    if (s.road === segment.road || s.id === segment.id) return false;
    const other = center(s), frame = roadFrame(s);
    return Math.abs(other.y - f.y) < 2 && Math.abs(Math.cos(frame.yaw - f.yaw)) < .9 && Math.hypot(other.x - f.x, other.z - f.z) < (s.width + segment.width) / 2 + 7;
  });
  if (!crossing) for (const side of [-1, 1]) {
    // Cars retain their full size in the compact map. Use the deck shoulder
    // for railings so their swept turns fit through the shorter ramp bends.
    const x = f.x + side * f.nx * (segment.width / 2 + 1.2), z = f.z + side * f.nz * (segment.width / 2 + 1.2);
    const rail = { kind: 'rail', ...orientedBox(x, z, .28, f.flatLength + .2, f.yaw, Math.max(segment.a.y, segment.b.y) + .98, Math.min(segment.a.y, segment.b.y) + .12, { walkable: false }), y: f.y + .52, pitch: f.pitch, length: f.length + .2 };
    if (blocksPassage(rail, plan, segment.road)) continue;
    // Curving ramp joins and merging highways can bring another stone
    // shoulder into the railing, even when the narrow driving lane is clear.
    // Test the actual tilted solids, including adjacent segments of this road.
    const volume = geometryVolume({ ...rail, h: .95, d: rail.length });
    const intersectsDeck = plan.roadIndex.query(volume.minX - 2, volume.minZ - 2, volume.maxX + 2, volume.maxZ + 2)
      .some(other => other !== segment && roadSolidRecipes(other).some(solid => volume.obb.intersectsOBB(geometryVolume(solid).obb)));
    if (!intersectsDeck) result.push(rail);
  }
  const order = segment.index ?? segment.segmentIndex ?? road.points?.indexOf(segment.a) ?? 0;
  if (order % 3 === 0 && !crossing) {
    const ground = terrainHeight(f.x, f.z), height = f.y - ground - 1.1;
    const pier = { kind: 'pier', ...orientedBox(f.x, f.z, 2.4, 2.1, f.yaw, ground + height, ground, { walkable: false }), y: ground + height / 2, h: height };
    if (height > 3 && !blocksPassage(pier, plan, segment.road)) result.push(pier);
  }
  return result;
}

function supportFeatures(support, plan, reserved) {
  const result = [];
  if (support.a) {
    const f = roadFrame(support);
    const count = Math.ceil(f.flatLength / 7);
    for (let i = 0; i < count; i++) for (const side of [-1, 1]) {
      const t = (i + .5) / count, x = support.a.x + (support.b.x - support.a.x) * t, z = support.a.z + (support.b.z - support.a.z) * t, y = support.a.y + (support.b.y - support.a.y) * t;
      const halfRise = Math.abs(support.b.y - support.a.y) / count / 2;
      const rail = { kind: 'rail', ...orientedBox(x + side * f.nx * (support.width / 2 - .1), z + side * f.nz * (support.width / 2 - .1), .16, f.flatLength / count, f.yaw,
        y + halfRise + 1, y - halfRise, { walkable: false }), y: y + .52, pitch: f.pitch, length: f.length / count };
      if (!blocksPassage(rail, plan, support)) result.push(rail);
    }
    return result;
  }
  const connected = (x, z) => plan.supports.some(other => {
    if (other === support) return false;
    if (!other.a) return Math.abs(other.y - support.y) < .5 && x > other.minX - .8 && x < other.maxX + .8 && z > other.minZ - .8 && z < other.maxZ + .8;
    return [other.a, other.b].some(p => Math.abs(p.y - support.y) < .5 && Math.hypot(x - p.x, z - p.z) < other.width / 2 + 1.5);
  });
  for (const edge of ['x', 'z']) for (const side of [-1, 1]) {
    const length = edge === 'x' ? support.width : support.depth, count = Math.ceil(length / 5);
    for (let i = 0; i < count; i++) {
      const along = -length / 2 + (i + .5) * length / count;
      const x = support.x + (edge === 'x' ? along : side * (support.width / 2 - .13));
      const z = support.z + (edge === 'z' ? along : side * (support.depth / 2 - .13));
      if (connected(x, z)) continue;
      const rail = { kind: 'rail', ...orientedBox(x, z, .16, length / count + .05, edge === 'x' ? Math.PI / 2 : 0, support.y + 1, support.y, { walkable: false }), y: support.y + .52, pitch: 0, length: length / count + .05 };
      if (!blocksPassage(rail, plan, support)) result.push(rail);
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = support.x + sx * (support.width / 2 - 1.6), z = support.z + sz * (support.depth / 2 - 1.6);
    if (plan.onRoad(x, z, 1.4)) continue;
    const floor = terrainHeight(x, z), h = support.y - floor - .65;
    const pier = { kind: 'pier', ...orientedBox(x, z, .8, .8, 0, floor + h, floor, { walkable: false }), y: floor + h / 2, h };
    if (h > 1 && !blocksPassage(pier, plan, support)) result.push(pier);
  }
  if (support.width > 30 && support.depth > 25) for (const side of [-1, 1]) {
    const x = support.x + side * support.width * .3, z = support.z - support.depth * .2;
    if (reserved.some(p => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    result.push({ kind: 'planter', ...orientedBox(x, z, 3.4, 7, 0, support.y + .7, support.y, { walkable: false }), y: support.y + .35 });
  }
  return result;
}

function streetLife(plan, reserved) {
  const result = [];
  for (const [authoredX, authoredZ, kind] of [[2514, 650, 'kiosk'], [2514, 696, 'kiosk'], [2448, 650, 'planter'], [2448, 696, 'planter'], [2460, 720, 'planter'], [2532, 749, 'planter']]) {
    const { x, z } = atEastpoint(authoredX, authoredZ);
    const floor = terrainHeight(x, z), w = kind === 'kiosk' ? 4 : 3.4, d = kind === 'kiosk' ? 9 : 7, h = kind === 'kiosk' ? 3.2 : .7;
    if (plan.onRoad(x, z, Math.hypot(w, d) / 2 + 1) || reserved.some(p => Math.abs(p.y - floor) < 4 && Math.hypot(p.x - x, p.z - z) < 9)) continue;
    result.push({ kind, ...orientedBox(x, z, w, d, 0, floor + h, floor, { walkable: false }), y: floor + h / 2, floor });
  }
  return result;
}

function streetlightFits(p, infrastructure) {
  // The foot mounts into its own pavement. Everything above that small
  // attachment must clear the actual slabs, shoulders, piers and railings.
  const parts = [
    { ...p, y: p.y + 4.36, w: .18, h: 8.48, d: .18 },
    { ...p, y: p.y + 8.4, w: .32, h: .24, d: 2.1 },
  ];
  return parts.every(part => infrastructureIntersections(part, infrastructure, .02).length === 0);
}

/** Deterministic nearby blueprints; rendering and collision share these parts. */
export class VerticalMetropolis {
  constructor(plan = createMasterPlan(), reserved = []) {
    this.plan = plan; this.reserved = reserved; this.blocks = new Map(); this.generated = 0;
    this.roads = plan.roads; this.roadIndex = plan.roadIndex;
    this.supportParts = plan.supports.flatMap(s => supportFeatures(s, plan, reserved)).concat(streetLife(plan, reserved));
    const segments = new Set([...plan.roadIndex.cells.values()].flat());
    this.infrastructureIndex = createInfrastructureIndex(plan, this.supportParts.concat([...segments].flatMap(segment => segmentFeatures(segment, plan))));
    this.anchors = showcaseBuildings(plan, reserved);
    this.frontages = new Map();
    for (const road of plan.roads) {
      if (road.class === 'expressway' || road.kind === 'ramp') continue;
      const distances = [0], stations = new Map([[road.points[0], 0]]);
      for (let i = 1; i < road.points.length; i++) {
        distances.push(distances[i - 1] + Math.hypot(road.points[i].x - road.points[i - 1].x, road.points[i].z - road.points[i - 1].z));
        stations.set(road.points[i], distances[i]);
      }
      // Compress the original frontage rhythm with the map, including widths
      // and setbacks. Heights and human-scale architectural details stay tall.
      this.frontages.set(road, { distances, stations, length: distances.at(-1), spacing: (48 + hash(road.id) % 13) * CITY_SCALE });
    }
  }
  frontageCandidates(minX, minZ, maxX, maxZ) {
    const candidates = new Map();
    for (const segment of this.roadIndex.query(minX - 70, minZ - 70, maxX + 70, maxZ + 70)) {
      const road = segment.road, route = this.frontages.get(road);
      if (!route) continue;
      const first = Math.max(0, Math.floor((route.stations.get(segment.a) - 35 * CITY_SCALE) / route.spacing));
      const last = Math.ceil((route.stations.get(segment.b) - 20 * CITY_SCALE) / route.spacing);
      for (let slot = first; slot <= last; slot++) for (const side of [-1, 1]) {
        const id = `frontage:${road.id}:${side}:${slot}`;
        if (candidates.has(id)) continue;
        // Null also marks rejected stations, so neighboring road segments do
        // not repeatedly evaluate the same deterministic lot.
        candidates.set(id, null);
        const random = seededRandom(hash(id)), range = (a, b) => a + random() * (b - a);
        const distance = (27 + range(-4, 4)) * CITY_SCALE + slot * route.spacing;
        if (distance > route.length - 24 * CITY_SCALE) continue;
        let lo = 1, hi = route.distances.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (route.distances[mid] < distance) lo = mid + 1; else hi = mid; }
        const a = road.points[lo - 1], b = road.points[lo], length = route.distances[lo] - route.distances[lo - 1];
        if (length < .01) continue;
        const t = (distance - route.distances[lo - 1]) / length;
        const street = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t };
        if (Math.abs(street.y - terrainHeight(street.x, street.z)) > 1.1) continue;
        const style = districtStyle(districtAt(street.x, street.z)), variation = random();
        if (variation > style.density) continue;
        const useChoice = random();
        const w = range(style.freight ? 31 : 26, Math.min(style.freight ? 45 : 49, route.spacing / CITY_SCALE - 8)) * CITY_SCALE;
        let d = range(style.freight ? 31 : 24, style.freight ? 44 : 39) * CITY_SCALE;
        const streetArchitecture = sampleArchitecture(districtAt(street.x, street.z).id, seededRandom(hash(`${id}:architecture`)));
        // Reserve enough depth for the full frontage diameter. Inscribing a
        // circle in the old shallow rectangle needlessly widens rooftop gaps.
        if (streetArchitecture.footprint !== 'rectangle') d = Math.max(d, w);
        const setback = range(style.freight ? 10 : 6.5, style.freight ? 15 : 10) * CITY_SCALE;
        const nx = (b.z - a.z) / length, nz = -(b.x - a.x) / length, offset = road.width / 2 + setback + d / 2;
        const x = street.x + side * nx * offset, z = street.z + side * nz * offset, yaw = Math.atan2(-side * nx, -side * nz);
        if (!inBounds({ x, z }, minX, minZ, maxX, maxZ)) continue;
        // Resolve architecture at the actual lot center, including lots across
        // a district boundary from their street and authored landmark towers.
        const district = districtAt(x, z), buildingStyle = districtStyle(district);
        const architecture = sampleArchitecture(district.id, seededRandom(hash(`${id}:architecture`)));
        const type = buildingUseAtHeight(buildingStyle.types[Math.floor(useChoice * buildingStyle.types.length)], architecture.h);
        const p = { id, x, z, w, d, ...architecture, yaw, type, district: district.id, variation, tint: buildingStyle.tint, accent: buildingStyle.accent,
          street: { ...street, roadId: road.id, width: road.width }, setback, priority: hash(`${id}:priority`) };
        if (p.footprint !== 'rectangle') {
          p.w = p.d = Math.min(w, d);
          p.setback += (d - p.d) / 2;
        }
        const footprint = orientedBox(x, z, w + 2, d + 2, yaw);
        // Rear yards and side passages belong to their building's lot. Include
        // them in overlap rejection, not in the solid collision footprint.
        const yard = localPoint(p, 0, -1.5), lot = orientedBox(yard.x, yard.z, w + 4, d + 8, yaw);
        if (Math.max(Math.abs(lot.minX), Math.abs(lot.maxX), Math.abs(lot.minZ), Math.abs(lot.maxZ)) >= WORLD_LIMIT - 28) continue;
        const grades = groundTop(p);
        if (grades.max - grades.min > 2.4 * CITY_SCALE || grades.min <= WATER_LEVEL + CITY_SCALE) continue;
        const corners = [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]].map(([sx, sz]) => localPoint(lot, sx * lot.w, sz * lot.d));
        if (corners.some(point => isWater(point.x, point.z))) continue;
        if (frontageBlocked(footprint, this.plan, 2) || this.anchors.some(anchor => lotsOverlap(lot, orientedBox(anchor.x, anchor.z, anchor.w + 4, anchor.d + 4, anchor.yaw)))) continue;
        if (this.reserved.some(point => point.x > lot.minX - 7 && point.x < lot.maxX + 7 && point.z > lot.minZ - 7 && point.z < lot.maxZ + 7)) continue;
        p.y = grades.max + .12; p.ground = grades.min; p.lot = lot;
        candidates.set(id, p);
      }
    }
    return [...candidates.values()].filter(Boolean);
  }
  block(bx, bz) {
    const key = `${bx},${bz}`;
    if (this.blocks.has(key)) { const block = this.blocks.get(key); this.blocks.delete(key); this.blocks.set(key, block); return block; }
    const buildings = [], trees = [], shrubs = [], props = [], features = [], colliders = [], infrastructure = [];
    const minX = bx * BLOCK_SIZE, minZ = bz * BLOCK_SIZE, maxX = minX + BLOCK_SIZE, maxZ = minZ + BLOCK_SIZE;
    for (const p of this.anchors) {
      if (!inBounds(p, bx * BLOCK_SIZE, bz * BLOCK_SIZE, (bx + 1) * BLOCK_SIZE, (bz + 1) * BLOCK_SIZE)) continue;
      const physical = buildingBoxes(p); p.box = physical[0]; p.sign = buildingSign(p, this.plan); buildings.push(p); colliders.push(...physical);
      p.steps = entranceSteps(p, buildingEntrances(p), terrainHeight); colliders.push(...p.steps);
    }
    // Each block considers a halo wider than two maximum lot radii. A stable
    // priority comparison against every overlapping candidate produces the
    // same owner regardless of generation order or cache eviction.
    const candidates = this.frontageCandidates(minX - 90, minZ - 90, maxX + 90, maxZ + 90), lots = new SpatialGrid();
    for (const p of candidates) lots.add({ ...p.lot, candidate: p });
    for (const p of candidates) {
      if (!inBounds(p, minX, minZ, maxX, maxZ)) continue;
      if (lots.query(p.lot.minX, p.lot.minZ, p.lot.maxX, p.lot.maxZ).some(other => other.candidate !== p &&
        (other.candidate.priority < p.priority || other.candidate.priority === p.priority && other.candidate.id < p.id) && lotsOverlap(p.lot, other))) continue;
      const physical = buildingBoxes(p);
      p.box = physical[0]; p.sign = buildingSign(p, this.plan); buildings.push(p); colliders.push(...physical);
      p.steps = entranceSteps(p, buildingEntrances(p), terrainHeight); colliders.push(...p.steps);
      const yard = localPoint(p, 0, -p.d / 2 - 2.5), freight = districtStyle(districtAt(p.x, p.z)).freight;
      const yardBox = orientedBox(yard.x, yard.z, 7, 3.6, p.yaw);
      if (p.variation > .35 && !frontageBlocked(yardBox, this.plan, 3) && !isWater(yard.x, yard.z)) {
        const y = terrainHeight(yard.x, yard.z);
        if (freight) {
          props.push({ ...yard, y, kind: 'cargo', yaw: p.yaw, tint: p.variation > .5 ? 0x879388 : 0x926f61 });
          colliders.push(orientedBox(yard.x, yard.z, 6.2, 2.5, p.yaw, y + 2.5, y));
        } else {
          const tree = { ...yard, id: `yard:${p.id}`, y, size: .8 + p.variation * .4, type: p.variation < .52 ? 'cypress' : 'broadleaf', source: 'yard' };
          trees.push(tree); colliders.push(treeCollider(tree));
        }
      }
    }
    // Street furniture uses the same sampled centerline as traffic and roads.
    const supported = this.supportParts.filter(p => inBounds(p, minX, minZ, maxX, maxZ));
    infrastructure.push(...supported); colliders.push(...supported);
    for (const s of this.roadIndex.query(minX - 32, minZ - 32, maxX + 32, maxZ + 32)) {
      const f = roadFrame(s);
      if (!inBounds(f, minX, minZ, maxX, maxZ)) continue;
      const parts = segmentFeatures(s, this.plan); infrastructure.push(...parts); colliders.push(...parts);
      const order = s.index ?? s.segmentIndex ?? s.road?.points?.indexOf(s.a) ?? 0;
      if (order % 3 === 1 && f.flatLength > 5) {
        const high = elevated(s), side = order % 2 ? 1 : -1, offset = s.width / 2 + (high ? .65 : 2.6);
        const x = f.x + side * f.nx * offset, z = f.z + side * f.nz * offset;
        let y = terrainHeight(x, z);
        if (high) {
          // The bridge's stone shoulder extends only 1.7 m beyond the lane.
          // Ground the upright pole on its actual pitched/banked top plane,
          // leaving the outer railing at 1.2 m clear of the lamp.
          const normal = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(f.pitch, f.yaw, -Math.atan(s.crossSlope ?? 0), 'YXZ'));
          y = f.y - .55 - .12 + (.55 - normal.x * (x - f.x) - normal.z * (z - f.z)) / normal.y;
        }
        const lamp = { x, z, y, kind: 'lamp', yaw: f.yaw, tint: districtStyle(districtAt(x, z)).accent };
        if (!isWater(x, z) && streetlightFits(lamp, this.infrastructureIndex)) props.push(lamp);
      }
    }
    const planting = pocketVegetation({ minX, minZ, maxX, maxZ, plan: this.plan, lots, anchors: this.anchors,
      reserved: this.reserved, infrastructure: this.infrastructureIndex });
    trees.push(...planting.trees); shrubs.push(...planting.shrubs); features.push(...planting.beds);
    colliders.push(...planting.trees.map(treeCollider));
    const block = { bx, bz, buildings, trees, shrubs, props, features, colliders, infrastructure, park: false };
    this.blocks.set(key, block); this.generated++;
    while (this.blocks.size > CACHE_LIMIT) this.blocks.delete(this.blocks.keys().next().value);
    return block;
  }
  area(minX, minZ, maxX, maxZ) {
    const blocks = [];
    for (let x = Math.floor((minX - 42) / BLOCK_SIZE); x <= Math.floor((maxX + 42) / BLOCK_SIZE); x++) for (let z = Math.floor((minZ - 42) / BLOCK_SIZE); z <= Math.floor((maxZ + 42) / BLOCK_SIZE); z++) {
      if (Math.abs(x * BLOCK_SIZE) < WORLD_LIMIT + BLOCK_SIZE && Math.abs(z * BLOCK_SIZE) < WORLD_LIMIT + BLOCK_SIZE) blocks.push(this.block(x, z));
    }
    return blocks;
  }
  buildingsNear(x, z, radius = 1) {
    return this.area(x - radius, z - radius, x + radius, z + radius).flatMap(block => block.buildings.filter(p =>
      p.box.minX - radius <= x && p.box.maxX + radius >= x && p.box.minZ - radius <= z && p.box.maxZ + radius >= z));
  }
  collidersIn(minX, minZ, maxX, maxZ) {
    const box = { minX, minZ, maxX, maxZ };
    return this.area(minX, minZ, maxX, maxZ).flatMap(block => block.colliders.filter(p => boundsOverlap(p, box)));
  }
}

/** One triangulated terrain surface, sampled identically by walking physics. */
export function createVerticalGroundGeometry() {
  const span = Math.ceil((WORLD_LIMIT + 128 * CITY_SCALE) / TERRAIN_GRID) * TERRAIN_GRID, count = span * 2 / TERRAIN_GRID;
  const positions = [], vertexColors = [], uv = [], indices = [], color = new THREE.Color();
  for (let z = 0; z <= count; z++) for (let x = 0; x <= count; x++) {
    const px = -span + x * TERRAIN_GRID, pz = -span + z * TERRAIN_GRID;
    positions.push(px, terrainHeight(px, pz) - .035, pz); uv.push(px / 8, pz / 8);
    const district = districtAt(px, pz), style = districtStyle(district);
    color.setHex(style.freight ? 0x4f5555 : district.id.includes('shadow') ? 0x48414e : district.id.includes('south') ? 0x48554c : 0x4d5c61);
    vertexColors.push(color.r, color.g, color.b);
  }
  for (let z = 0; z < count; z++) for (let x = 0; x < count; x++) {
    const a = z * (count + 1) + x, b = a + 1, c = a + count + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
}

function industrialWallMaterial() {
  const width = 256, height = 128, data = new Uint8Array(width * height * 4);
  // One shared 8 x 6 metre tile: two structural bays with panel joints,
  // clerestory glazing and louvres. Even the shortest warehouse gets a full bay.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const bayX = x % 128, panelY = y % 64;
    const shade = 178 + (Math.floor(x / 32) * 3 + Math.floor(y / 32) * 5) % 11;
    let rgb = [shade, shade + 3, shade + 4];
    if (x % 32 < 2) rgb = [154, 161, 163];
    if (bayX < 4 || panelY < 2) rgb = [111, 125, 132];
    if (bayX >= 13 && bayX < 115 && y >= 89 && y < 117) {
      const frame = bayX < 17 || bayX >= 111 || y < 92 || y >= 114 || (bayX - 13) % 26 < 3;
      rgb = frame ? [93, 110, 118] : [123, 154, 161];
    }
    if (bayX >= 82 && bayX < 111 && y >= 30 && y < 47) rgb = y % 4 < 2 ? [90, 105, 112] : [141, 150, 151];
    data.set([...rgb, 255], (y * width + x) * 4);
  }
  const atlas = new THREE.DataTexture(data, width, height);
  atlas.name = 'industrial-wall-panels'; atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.wrapS = atlas.wrapT = THREE.RepeatWrapping;
  atlas.magFilter = THREE.LinearFilter; atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.generateMipmaps = true; atlas.anisotropy = 4; atlas.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: atlas, roughness: .96, metalness: .02 });
  material.onBeforeCompile = shader => { shader.vertexShader = `attribute vec2 facadeSpan;\n${shader.vertexShader}`.replace('#include <uv_vertex>', `#include <uv_vertex>
    #ifdef USE_INSTANCING
      float wallWidth = dot(facadeSpan, vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz)));
      vMapUv *= vec2(wallWidth / 8.0, length(instanceMatrix[1].xyz) / 6.0);
    #endif`); };
  material.customProgramCacheKey = () => 'industrial-wall-metres-v2';
  return material;
}

function palette() {
  const materials = {
    facade: createFacadeMaterial(),
    industrial: industrialWallMaterial(),
    stone: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .96, metalness: .02 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x456875, emissive: 0x0e2530, emissiveIntensity: .3, roughness: .73, metalness: .12 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    road: new THREE.MeshStandardMaterial({ color: 0x263641, roughness: 1, metalness: 0 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xb7bcaf, roughness: 1, metalness: 0 }),
  };
  for (const [name, mat] of Object.entries(materials)) mat.name = `vertical-${name}`;
  return materials;
}

export function createVerticalCity(scene, stream, reservedWorldObjects = []) {
  const masterPlan = createMasterPlan(), metropolis = new VerticalMetropolis(masterPlan, reservedWorldObjects), mats = palette(), terrain = createTerrainMaterials({ vertexColors: true });
  const buildingSigns = createBuildingSignMaterial(), interiorClip = interiorClipUniforms();
  for (const material of [mats.facade, mats.industrial, mats.stone, mats.glass]) patchInteriorClip(material, interiorClip);
  terrain.grass.vertexColors = false;
  // Pedestrian structures reuse the existing paving map on their actual slab,
  // keeping texture scale stable without adding a second coplanar top surface.
  const pedestrianPaving = terrain.paving.clone(); pedestrianPaving.name = 'vertical-pedestrian-paving';
  pedestrianPaving.vertexColors = false; pedestrianPaving.color.setHex(0x64787b);
  pedestrianPaving.onBeforeCompile = terrain.paving.onBeforeCompile;
  pedestrianPaving.customProgramCacheKey = terrain.paving.customProgramCacheKey;
  const ground = new THREE.Mesh(createVerticalGroundGeometry(), terrain.paving); ground.name = 'Afterlight continuous terrain';
  ground.receiveShadow = true; ground.userData.resident = true; ground.matrixAutoUpdate = false; scene.add(ground);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_LIMIT * 2 + 500, WORLD_LIMIT * 2 + 500), new THREE.MeshStandardMaterial({ color: 0x123444, roughness: .88, metalness: .03 }));
  water.name = 'Blackwater Bay'; water.rotation.x = -Math.PI / 2; water.position.y = WATER_LEVEL; water.userData.resident = true; scene.add(water);
  const signs = [], cars = [], supportCache = new WeakMap();
  function supportCollider(s) {
    if (supportCache.has(s)) return supportCache.get(s);
    const box = s.a ? { ...s, supportOnly: true, walkable: true, slabThickness: .65, minY: s.minY ?? Math.min(s.a.y, s.b.y) - .65, maxY: s.maxY ?? Math.max(s.a.y, s.b.y) } :
      { ...s, x: s.x, z: s.z, w: s.width ?? s.w, d: s.depth ?? s.d, yaw: 0, supportOnly: true, walkable: true, minY: s.y - .65, maxY: s.y };
    supportCache.set(s, box); return box;
  }
  const spatial = {
    query(minX, minZ, maxX, maxZ) {
      const supports = masterPlan.supportIndex?.query(minX, minZ, maxX, maxZ) ?? [];
      return metropolis.collidersIn(minX, minZ, maxX, maxZ).concat(masterPlan.roadIndex.query(minX, minZ, maxX, maxZ).map(supportCollider), supports.map(supportCollider));
    },
    near(x, z, radius = 8) { return this.query(x - radius, z - radius, x + radius, z + radius); },
    along(origin, direction, distance) { const x = origin.x + direction.x * distance, z = origin.z + direction.z * distance; return this.query(Math.min(origin.x, x) - .5, Math.min(origin.z, z) - .5, Math.max(origin.x, x) + .5, Math.max(origin.z, z) + .5); },
  };
  function buildBuilding(p, add) {
    const design = buildingDesign(p), volumes = buildingVolumes(p, design);
    const tint = new THREE.Color(design.color).lerp(new THREE.Color(p.tint), .22).getHex();
    const part = (piece, detail = false) => {
      const point = localPoint(p, piece.x, piece.z);
      add(mats[piece.mat], point.x, p.y + piece.y, point.z, piece.w, piece.h, piece.d, p.yaw + (piece.yaw ?? 0),
        piece.tint ?? tint, detail, piece.shape ?? 'box', 0, 0, piece.mat === 'facade' ? facadeUV(design.surface, design.windowLighting) : null,
        piece.mat === 'facade' ? design.windowSeed : null);
    };
    part({ mat: 'stone', x: 0, z: 0, y: -(p.y - p.ground) / 2, w: p.w + 1.7,
      h: p.y - p.ground + .18, d: p.d + 1.7, tint: colors.concrete, shape: footprintShape(p.footprint) });
    for (const volume of volumes) {
      part(volume);
      if (volume.cap) part({ ...volume, mat: 'stone', y: volume.y + volume.h / 2 + .25, h: .5, tint: design.trim });
      if (volume.planter) part({ ...volume, shape: 'crown', y: volume.y + volume.h / 2 + .25,
        w: volume.w * .46, h: .32, d: volume.d * .46, tint: 0x799660 }, true);
    }
    for (const piece of buildingDetails(p, design, volumes)) part(piece, piece.detail);
    for (const s of p.steps ?? []) add(mats.stone, s.x, (s.minY + s.maxY) / 2, s.z, s.w, s.maxY - s.minY, s.d, s.yaw, 0x7d8a8c, false);
    const sign = p.sign;
    add(mats.stone, sign.x - Math.sin(sign.yaw) * .13, sign.y, sign.z - Math.cos(sign.yaw) * .13, sign.w + .24, sign.h + .2, .18, sign.yaw, colors.dark, false);
    add(buildingSigns, sign.x, sign.y, sign.z, sign.w, sign.h, 1, sign.yaw, undefined, false, 'plane', 0, 0, sign.uv);
  }
  function buildRoad(s, add) {
    const f = roadFrame(s); if (f.flatLength < .01) return;
    const roll = -Math.atan(s.crossSlope ?? 0);
    // Curved segments overlap far enough for the outside driving lane to stay
    // on the deck. Metadata specifies horizontal extension at each endpoint.
    for (const solid of roadSolidRecipes(s)) {
      const deck = solid.kind === 'road-deck';
      add(deck ? mats.stone : mats.road, solid.x, solid.y, solid.z, solid.w, solid.h, solid.d, solid.yaw, deck ? 0x667b82 : undefined, false, 'box', solid.pitch, solid.roll);
    }
    const crossings = masterPlan.roadIndex.query(f.x - 18, f.z - 18, f.x + 18, f.z + 18);
    const clearMark = p => !crossings.some(q => {
      if (q.road === s.road) return false;
      const qf = roadFrame(q); if (Math.abs(Math.cos(qf.yaw - f.yaw)) > .9 || Math.abs(qf.y - p.y) > 1.5) return false;
      const dx = q.b.x - q.a.x, dz = q.b.z - q.a.z, t = Math.max(0, Math.min(1, ((p.x - q.a.x) * dx + (p.z - q.a.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(p.x - q.a.x - dx * t, p.z - q.a.z - dz * t) < q.width / 2 + 2;
    });
    for (let distance = 3; distance < f.length - 2; distance += 10) {
      const t = distance / f.length, p = { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t, z: s.a.z + (s.b.z - s.a.z) * t };
      if (!clearMark(p)) continue;
      add(mats.paint, p.x, p.y + .035, p.z, .16, .012, 3.2, f.yaw, undefined, true, 'box', f.pitch, roll);
      if (s.width > 19) for (const side of [-1, 1]) {
        const offset = side * s.width * .25;
        add(mats.paint, p.x + f.nx * offset, p.y + .035 - (s.crossSlope ?? 0) * offset, p.z + f.nz * offset, .12, .012, 3.2, f.yaw, undefined, true, 'box', f.pitch, roll);
      }
    }
  }
  function buildSupport(s, add) {
    const slab = supportSolidRecipe(s);
    add(pedestrianPaving, slab.x, slab.y, slab.z, slab.w, slab.h, slab.d, slab.yaw ?? 0, undefined, false, 'box', slab.pitch ?? 0);
    if (s.kind === 'deck' || (!s.a && s.width && s.depth)) {
      add(mats.glow, s.x, s.y - .18, s.z + s.depth / 2 + .01, s.width * .9, .11, .08, colors.cyan, false);
    } else if (s.a && s.b) {
      const f = roadFrame(s);
      for (const side of [-1, 1]) add(mats.glow, f.x + side * f.nx * (s.width / 2 - .15), f.y + .025, f.z + side * f.nz * (s.width / 2 - .15), .09, .012, f.length, f.yaw, colors.cyan, false, 'box', f.pitch);
    }
  }
  stream.populate = cell => {
    const add = (mat, x, y, z, w, h, d, yaw = 0, tint, detail = false, shape = 'box', pitch = 0, roll = 0, uvRect = null, windowSeed = null) => stream.add(mat, x, y, z, w, h, d, yaw, tint, detail, shape, cell, pitch, roll, uvRect, windowSeed);
    for (const block of metropolis.area(cell.x, cell.z, cell.x + CHUNK_SIZE, cell.z + CHUNK_SIZE)) {
      for (const p of block.buildings) if (inCell(p, cell)) buildBuilding(p, add);
      for (const p of block.trees) if (inCell(p, cell)) for (const part of treeParts(p)) {
        add(mats.stone, part.x, part.y, part.z, part.w, part.h, part.d, 0, part.tint, part.detail, part.shape);
      }
      for (const p of block.shrubs) if (inCell(p, cell)) for (const part of shrubParts(p)) {
        add(mats.stone, part.x, part.y, part.z, part.w, part.h, part.d, 0, part.tint, part.detail, part.shape);
      }
      for (const p of block.features) if (inCell(p, cell)) {
        add(terrain.grass, p.x, p.y, p.z, p.w, p.h, p.d, 0, p.tint, false, p.shape, p.pitch, p.roll);
      }
      for (const p of block.props) if (inCell(p, cell)) {
        if (p.kind === 'lamp') {
          add(mats.stone, p.x, p.y + 4.3, p.z, .18, 8.6, .18, p.yaw, colors.dark, true);
          add(mats.stone, p.x, p.y + 8.4, p.z, .32, .24, 2.1, p.yaw, colors.dark, true);
          add(mats.glow, p.x, p.y + 8.26, p.z, .23, .1, 1.7, p.yaw, 0xbfe3d7, true);
        } else {
          add(mats.stone, p.x, p.y + 1.25, p.z, 6.2, 2.5, 2.5, p.yaw, p.tint, true);
          for (let i = -2; i <= 2; i++) {
            const rib = localPoint(p, i * 1.1, 1.26); add(mats.stone, rib.x, p.y + 1.25, rib.z, .06, 2.3, .04, p.yaw, colors.dark, true);
          }
        }
      }
      for (const p of block.infrastructure) if (inCell(p, cell)) {
        if (p.kind === 'pier') {
          add(mats.stone, p.x, p.y, p.z, p.w, p.h, p.d, p.yaw, 0x627984, false);
          if (p.w > 1) add(mats.stone, p.x, p.maxY + .1, p.z, 9, .6, 2.4, p.yaw, 0x627984, false);
        } else if (p.kind === 'planter') {
          add(mats.stone, p.x, p.y, p.z, p.w, .7, p.d, 0, 0x5d7378, false);
          add(mats.stone, p.x, p.maxY + .35, p.z, (p.w - .4) / 2, .425, (p.d - .4) / 2, 0, 0x567e67, false, 'crown');
          for (const side of [-1, 1]) add(mats.stone, p.x, p.maxY + .47, p.z + side * p.d * .27,
            (p.w - .5) * .42, .55, p.d * .16, 0, side > 0 ? 0x79955e : 0x63876d, true, 'crown');
        } else if (p.kind === 'kiosk') {
          add(mats.stone, p.x, p.y, p.z, p.w, 3.2, p.d, 0, 0x435e68, false);
          add(mats.stone, p.x - .5, p.maxY + .16, p.z, p.w + 2, .28, p.d + .6, 0, 0x9a8b83, false);
          add(mats.glass, p.x - p.w / 2 - .02, p.floor + 1.6, p.z, .06, 1.5, p.d * .72, 0, undefined, false);
        } else add(mats.stone, p.x, p.y, p.z, p.w, .95, p.length, p.yaw, 0x79939c, false, 'box', p.pitch);
      }
    }
    for (const s of masterPlan.roadIndex.query(cell.x - 48, cell.z - 48, cell.x + CHUNK_SIZE + 48, cell.z + CHUNK_SIZE + 48)) if (inCell(center(s), cell)) buildRoad(s, add);
    for (const s of masterPlan.supports ?? []) {
      const p = s.a ? center(s) : s;
      if (inCell(p, cell)) buildSupport(s, add);
    }
  };
  // Drivable cars are stopped NPC vehicles added during play, not designated
  // parked spawns. Their positions, collisions and map markers use this list.
  const labels = wayfindingSigns(metropolis.infrastructureIndex);
  if (typeof document !== 'undefined') {
    for (const p of labels) {
      const texture = signTexture(p.title, p.subtitle, '#8de1d7'), geometry = new THREE.PlaneGeometry(p.w, p.h), material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      for (const side of [-1, 1]) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `Wayfinding ${p.id}`;
        mesh.position.set(p.x + Math.sin(p.yaw) * side * .02, p.y, p.z + Math.cos(p.yaw) * side * .02);
        mesh.rotation.y = p.yaw + (side < 0 ? Math.PI : 0); scene.add(mesh); signs.push(mesh); stream.capture([mesh]);
      }
    }
  }
  const plan = { ...masterPlan, buildings: [], trees: [], features: [], props: [] };
  // Interiors: a building's context swaps its solid shell for walkable rooms.
  const interiorContextAt = (x, y, z) => {
    for (const p of metropolis.buildingsNear(x, z, 1)) {
      const context = interiorContext(cachedInteriorPlan(p), x, y, z);
      if (context) return context;
    }
    return null;
  };
  const planNear = (x, z) => metropolis.buildingsNear(x, z, 1).map(cachedInteriorPlan).find(Boolean) ?? null;
  return { ground, water, cars, signs, wayfinding: labels, colliders: [], buildings: [], mapInfo: [], mapRoads: masterPlan.roads, roadIndex: masterPlan.roadIndex, spatial, metropolis, plan, masterPlan,
    interiorContextAt, planNear, interiorClip, spatialFor: context => context ? interiorSpatial(spatial, context) : spatial,
    mapView: { x: SHOWCASE.x, z: SHOWCASE.z, span: 1200 * CITY_SCALE }, terrainHeight, surfaceHeight: (...args) => masterPlan.surfaceHeight(...args), reflection() {} };
}
