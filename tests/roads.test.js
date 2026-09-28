import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan } from '../src/city-plan.js';
import { Metropolis, streetPoint } from '../src/metropolis.js';
import { CORE_ROADS, REGIONAL_GATEWAY_ROADS, nearestRoadPoint } from '../src/roads.js';
import { SpatialGrid } from '../src/spatial-grid.js';
import { WORLD_OBJECTS } from '../src/content.js';
import { circleHitsBox, overlapsHeight } from '../src/physics.js';

const plan = createCityPlan(WORLD_OBJECTS), metro = new Metropolis(WORLD_OBJECTS);
const roads = [...CORE_ROADS, ...plan.roads, ...metro.roads];
const segments = new SpatialGrid([], 96);
for (const [id, road] of roads.entries()) for (let i = 1; i < road.points.length; i++) {
  const a = road.points[i - 1], b = road.points[i], pad = road.width / 2;
  segments.add({ a, b, id, road, minX: Math.min(a.x, b.x) - pad, maxX: Math.max(a.x, b.x) + pad, minZ: Math.min(a.z, b.z) - pad, maxZ: Math.max(a.z, b.z) + pad });
}
const pointDistance = (p, s) => nearestRoadPoint(p, [{ points: [s.a, s.b] }]).distance;

test('every open road ends on another drivable surface, including original street stubs and region boundaries', () => {
  for (const [id, road] of roads.entries()) {
    if (road.closed) continue;
    for (const p of [road.points[0], road.points.at(-1)]) {
      const joins = segments.near(p.x, p.z, 12).filter(s => s.id !== id);
      assert.ok(joins.some(s => pointDistance(p, s) < s.road.width / 2 - 1.6), `${road.name} has a loose end at ${p.x},${p.z}`);
    }
  }
});

test('the regional center cutout is honest in route metadata and every route segment is rendered', () => {
  for (const road of metro.roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i];
    const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
    assert.ok(Math.max(Math.abs(x), Math.abs(z)) >= 768, `Unbuilt route through center at ${x},${z}`);
    assert.ok(metro.roadIndex.near(x, z, 1).some(s => s.a === a && s.b === b));
  }
  // Previously an entire border avenue disappeared with the central cutout.
  for (let t = -768; t <= 768; t += 48) for (const side of [-1, 1]) for (const horizontal of [false, true]) {
    const p = horizontal ? streetPoint(t, side * 768) : streetPoint(side * 768, t);
    assert.ok(metro.roadIndex.near(p.x, p.z, 1).some(s => pointDistance(p, s) < .001));
  }
});

test('inner scenery reserves all regional gateway lanes before buildings and trees are generated', () => {
  const index = new SpatialGrid(plan.colliders);
  for (const road of REGIONAL_GATEWAY_ROADS) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    for (let t = 0; t <= length; t += 3) for (const offset of [-2.5, 0, 2.5]) {
      const x = a.x + dx * t / length + dz / length * offset, z = a.z + dz * t / length - dx / length * offset;
      assert.equal(index.near(x, z, 2).some(box => overlapsHeight(box) && circleHitsBox(x, z, 1.6, box)), false, `Gateway lane blocked at ${x},${z}`);
    }
  }
});

test('every street belongs to one connected road network', () => {
  const parent = roads.map((_, i) => i);
  const root = i => parent[i] === i ? i : (parent[i] = root(parent[i]));
  const crosses = (a, b, c, d) => {
    const orient = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
    return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
  };
  for (const [id, road] of roads.entries()) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], pad = road.width / 2;
    for (const s of segments.query(Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad)) {
      if (root(id) === root(s.id)) continue;
      const reach = pad + s.road.width / 2 - 3.2;
      if (crosses(a, b, s.a, s.b) || Math.min(pointDistance(a, s), pointDistance(b, s), pointDistance(s.a, { a, b }), pointDistance(s.b, { a, b })) < reach) parent[root(id)] = root(s.id);
    }
  }
  assert.equal(new Set(roads.map((_, i) => root(i))).size, 1);
});
