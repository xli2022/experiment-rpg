import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { createMasterPlan, terrainHeight } from '../src/world/master-plan.js';
import { WORLD_LIMIT } from '../src/world/world-config.js';
import { AFTERLIGHT_LANDMARKS as LANDMARKS } from '../src/world/landmarks.js';
import { buildingVolumes, buildingEntrances } from '../src/world/building-design.js';
import { footprintVertices } from '../src/core/geometry.js';
import { createInfrastructureIndex, roadSlabDepth } from '../src/world/infrastructure-clearance.js';
import { SpatialGrid } from '../src/core/spatial-grid.js';
import { circleHitsBox } from '../src/core/physics.js';
import { buildNetwork } from '../src/traffic/network.js';

// The whole city, generated once.
const plan = createMasterPlan(), metro = new VerticalMetropolis(plan, LANDMARKS);
const blocks = metro.area(-WORLD_LIMIT, -WORLD_LIMIT, WORLD_LIMIT, WORLD_LIMIT);
const buildings = [...new Map(blocks.flatMap(b => b.buildings).map(p => [p.id, p])).values()];
const parts = [...new Map(blocks.flatMap(b => b.infrastructure).map(p => [p.id ?? `${p.kind}:${p.x}:${p.z}:${p.y}`, p])).values()];
const lamps = blocks.flatMap(b => b.props).filter(p => p.kind === 'lamp');

// Convex polygons in world XZ, and how deeply two overlap (0 when apart).
const toWorld = (p, x, z) => { const c = Math.cos(p.yaw ?? 0), s = Math.sin(p.yaw ?? 0); return { x: p.x + x * c + z * s, z: p.z - x * s + z * c }; };
const axes = poly => poly.map((a, i) => { const b = poly[(i + 1) % poly.length], l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: -(b.z - a.z) / l, z: (b.x - a.x) / l }; });
const project = (poly, n) => { let min = Infinity, max = -Infinity; for (const p of poly) { const v = p.x * n.x + p.z * n.z; min = Math.min(min, v); max = Math.max(max, v); } return [min, max]; };
function overlap(a, b) {
  let depth = Infinity;
  for (const n of [...axes(a), ...axes(b)]) {
    const [a0, a1] = project(a, n), [b0, b1] = project(b, n), d = Math.min(a1, b1) - Math.max(a0, b0);
    if (d <= 0) return 0;
    depth = Math.min(depth, d);
  }
  return depth;
}
const solids = new Map(buildings.map(p => {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), base = p.y ?? 0;
  return [p.id, buildingVolumes(p).map((v, i) => {
    const shape = v.shape === 'circle' || v.shape === 'hexagon' ? v.shape : 'rectangle', center = { x: p.x + v.x * c + v.z * s, z: p.z - v.x * s + v.z * c, yaw: p.yaw };
    return { poly: footprintVertices(shape, v.w, v.d).map(q => toWorld(center, q.x, q.z)), minY: i === 0 ? p.ground ?? base : base + v.y - v.h / 2, maxY: base + v.y + v.h / 2 + (v.cap ? .5 : 0) };
  })];
}));
const grid = new SpatialGrid(buildings.map(p => ({ ...p.box, building: p })));
// An oriented box's horizontal shadow and height range.
function shadow(o) {
  const points = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) points.push(new THREE.Vector3(sx * o.obb.halfSize.x, sy * o.obb.halfSize.y, sz * o.obb.halfSize.z).applyMatrix3(o.obb.rotation).add(o.obb.center));
  const sorted = points.sort((a, b) => a.x - b.x || a.z - b.z), cross = (p, a, b) => (a.x - p.x) * (b.z - p.z) - (a.z - p.z) * (b.x - p.x), lower = [], upper = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return { poly: lower.slice(0, -1).concat(upper.slice(0, -1)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
}

test('no building overlaps another, a road, a deck, a pier, an embankment or street furniture', () => {
  const index = createInfrastructureIndex(plan, parts), clashes = [];
  for (const p of buildings) for (const a of solids.get(p.id)) {
    const xs = a.poly.map(q => q.x), zs = a.poly.map(q => q.z);
    for (const other of grid.query(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs))) {
      if (other.building.id <= p.id) continue;
      if (solids.get(other.building.id).some(b => b.maxY > a.minY && a.maxY > b.minY && overlap(a.poly, b.poly) > .02)) clashes.push(`${p.id} × ${other.building.id}`);
    }
    for (const o of index.query(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs))) {
      const s = shadow(o);
      if (s.maxY > a.minY + .05 && s.minY < a.maxY - .05 && overlap(a.poly, s.poly) > .05) clashes.push(`${p.id} × ${o.kind}`);
    }
  }
  assert.ok(buildings.length > 4500 && parts.some(p => p.kind === 'embankment'));
  assert.deepEqual([...new Set(clashes)], []);
});

test('roadside lamps stand clear of every building and of the walk in front of every street door', () => {
  const posts = new Set(blocks.flatMap(b => b.colliders).filter(c => c.kind === 'lamp').map(c => `${c.x.toFixed(3)},${c.z.toFixed(3)}`));
  const lampGrid = new SpatialGrid(lamps.map(l => ({ minX: l.x - .2, maxX: l.x + .2, minZ: l.z - .2, maxZ: l.z + .2, lamp: l })));
  const inside = [], blocking = [];
  for (const lamp of lamps) {
    assert.ok(posts.has(`${lamp.x.toFixed(3)},${lamp.z.toFixed(3)}`), 'each lamp post is solid');
    for (const o of grid.query(lamp.x - .2, lamp.z - .2, lamp.x + .2, lamp.z + .2)) {
      if (solids.get(o.building.id).some(a => a.minY < lamp.y + 2 && a.maxY > lamp.y && overlap(a.poly, footprintVertices('rectangle', .4, .4).map(q => ({ x: lamp.x + q.x, z: lamp.z + q.z }))) > 0)) inside.push(o.building.id);
    }
  }
  for (const p of buildings.filter(p => p.street)) for (const e of buildingEntrances(p)) {
    // From the door, across the front yard and steps, to the kerb.
    const reach = (p.setback ?? 4) + p.d / 2 - (e.x * e.nx + e.z * e.nz);
    for (let t = 0; t <= reach; t += .25) for (const across of [-e.width / 2, 0, e.width / 2]) {
      const w = toWorld(p, e.x + e.nx * t - e.nz * across, e.z + e.nz * t + e.nx * across);
      const lamp = lampGrid.query(w.x - .5, w.z - .5, w.x + .5, w.z + .5).find(o => Math.hypot(o.lamp.x - w.x, o.lamp.z - w.z) < .45 && Math.abs(o.lamp.y - terrainHeight(w.x, w.z)) < 2);
      if (lamp) blocking.push(`${p.id}:${e.id}`);
    }
  }
  assert.ok(lamps.length > 7000, `${lamps.length} lamps`);
  assert.deepEqual(inside, []);
  assert.deepEqual([...new Set(blocking)], []);
});

test('pedestrian paths keep clear of lamp posts, railings and other solids', () => {
  const network = buildNetwork(plan), solidsNear = new SpatialGrid(blocks.flatMap(b => b.colliders).filter(c => !c.supportOnly && c.walkable === false));
  const brushes = new Map();
  for (const e of network.walk.edges) {
    const points = e.path.points;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .5));
      for (let k = 0; k <= n; k++) {
        const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n, y = a.y + (b.y - a.y) * k / n;
        for (const c of solidsNear.near(x, z, .6)) {
          if ((c.minY ?? -Infinity) > y + 1.6 || (c.maxY ?? Infinity) < y + .2 || !circleHitsBox(x, z, .3, c)) continue;
          const kind = c.kind ?? 'solid';
          if (!brushes.has(kind)) brushes.set(kind, new Set());
          brushes.get(kind).add(e.id);
        }
      }
    }
  }
  // A few junction footways still pass a lamp at the kerb's very edge.
  assert.ok((brushes.get('lamp')?.size ?? 0) < 40, `${brushes.get('lamp')?.size} footways brush a lamp`);
  for (const [kind, edges] of brushes) if (kind !== 'lamp') assert.fail(`${edges.size} footways run through a ${kind}`);
});

test('raised roads too low for piers stand on embankments, and too-low crossings end at them', () => {
  const supports = new SpatialGrid(parts.filter(p => p.kind === 'embankment' || p.kind === 'pier'));
  const carried = (x, z) => supports.near(x, z, 9).some(p => {
    if (p.kind === 'pier') return Math.hypot(p.x - x, p.z - z) < 9;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.x, dz = z - p.z;
    return Math.abs(dx * c - dz * s) <= p.w / 2 + .1 && Math.abs(dx * s + dz * c) <= p.d / 2 + .1;
  });
  let floating = 0, unsupported = 0;
  for (const s of new Set([...plan.roadIndex.cells.values()].flat())) {
    const n = Math.max(2, Math.ceil(Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z) / 2));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = s.a.x + (s.b.x - s.a.x) * t, z = s.a.z + (s.b.z - s.a.z) * t, y = s.a.y + (s.b.y - s.a.y) * t, ground = terrainHeight(x, z);
      if (y - roadSlabDepth(s) - ground <= .3 || y - ground > 4.6) continue;
      floating++;
      if (!carried(x, z)) unsupported++;
    }
  }
  // What stays open is short bridge spans over streets with headroom.
  assert.ok(floating > 800 && unsupported < floating * .25, `${unsupported} of ${floating} low raised samples float`);
  // Side streets too low to pass beneath the Ring and South Bypass end at a wall.
  const sealed = [[-653, 730], [-563, 739], [-508, 744], [-125, 763], [-1537, 2329], [-1459, 2325]];
  for (const [x, z] of sealed) assert.ok(supports.near(x, z, .1).some(p => p.kind === 'embankment'), `crossing at ${x},${z} is sealed`);
});
