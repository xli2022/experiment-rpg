import test from 'node:test';
import assert from 'node:assert/strict';
import * as authored from '../src/world/authored-plan.js';
import * as runtime from '../src/world/master-plan.js';
import { CITY_SCALE, authoredToWorld, atEastpoint } from '../src/world/world-scale.js';
import { WORLD_LIMIT } from '../src/world/world-config.js';
import { AFTERLIGHT_LANDMARKS as LANDMARKS } from '../src/world/landmarks.js';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { rayBoxDistance } from '../src/core/physics.js';

const source = authored.createMasterPlan(), plan = runtime.createMasterPlan();
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`);

test('the compact map preserves every authored road, ordered sample and grade', () => {
  assert.equal(CITY_SCALE, .5);
  assert.equal(WORLD_LIMIT, 2750);
  assert.equal(runtime.MASTER_WORLD_LIMIT, WORLD_LIMIT);
  assert.equal(source.roads.length, 661, 'retain the complete authored infill graph');
  assert.equal(plan.roadIndex.size, 22988, 'retain all sampled street segments');
  assert.deepEqual(plan.roads.map(r => r.id), source.roads.map(r => r.id));
  for (const [i, road] of plan.roads.entries()) {
    const original = source.roads[i];
    for (const key of ['name', 'class', 'kind', 'closed', 'district', 'bridge', 'reference']) assert.deepEqual(road[key], original[key]);
    assert.notEqual(road.points, original.points, 'runtime edits must not mutate authored geometry');
    assert.equal(road.points.length, original.points.length);
    assert.equal(road.width, Math.max(6, original.width * CITY_SCALE), 'roads still fit human-scale vehicles');
    for (const [j, point] of road.points.entries()) {
      const p = original.points[j];
      assert.deepEqual({ x: point.x, z: point.z }, authoredToWorld(p.x, p.z));
      close(point.y - .07, (p.y - .07) * CITY_SCALE);
      if (j) {
        const before = original.points[j - 1], previous = road.points[j - 1];
        close((point.y - previous.y) / Math.hypot(point.x - previous.x, point.z - previous.z),
          (p.y - before.y) / Math.hypot(p.x - before.x, p.z - before.z));
      }
    }
  }
});

// A road pair is connected where centerlines cross at matching elevations or
// an endpoint meets the other centerline. Width changes cannot fake these joins.
function connections(city, scale) {
  const joins = new Set();
  for (const road of city.roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], dx = b.x - a.x, dz = b.z - a.z;
    for (const s of city.roadIndex.query(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z))) {
      if (road.id >= s.road.id) continue;
      const key = `${road.id}/${s.road.id}`;
      if (joins.has(key)) continue;
      const ex = s.b.x - s.a.x, ez = s.b.z - s.a.z, det = dx * ez - dz * ex;
      if (Math.abs(det) > 1e-6 * scale ** 2) {
        const cx = s.a.x - a.x, cz = s.a.z - a.z;
        const t = (cx * ez - cz * ex) / det, u = (cx * dz - cz * dx) / det;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1
          && Math.abs(a.y + (b.y - a.y) * t - s.a.y - (s.b.y - s.a.y) * u) < .05 * scale) joins.add(key);
      }
      for (const [p, q, r] of [[a, s.a, s.b], [b, s.a, s.b], [s.a, a, b], [s.b, a, b]]) {
        const hit = runtime.nearestOnSegment(p.x, p.z, q, r);
        if (hit.distance < .001 * scale && Math.abs(hit.y - p.y) < .05 * scale) joins.add(key);
      }
    }
  }
  return [...joins].sort();
}

test('compression preserves the actual street and ramp connection graph', () => {
  const original = connections(source, 1), compact = connections(plan, CITY_SCALE);
  assert.ok(original.length > 1000, 'compare junctions throughout the city');
  assert.deepEqual(compact, original);
  assert.deepEqual(plan.interchanges.map(({ id, road, ramp }) => ({ id, road, ramp })),
    source.interchanges.map(({ id, road, ramp }) => ({ id, road, ramp })));
});

test('terrain, coastline, district layout and Eastpoint anchors share the same transform', () => {
  assert.equal(runtime.TERRAIN_GRID, 32);
  assert.equal(runtime.WATER_LEVEL, authored.WATER_LEVEL * CITY_SCALE);
  for (let z = -5500; z <= 5500; z += 125) for (let x = -5500; x <= 5500; x += 125) {
    const p = authoredToWorld(x, z);
    close(runtime.terrainHeight(p.x, p.z), authored.terrainHeight(x, z) * CITY_SCALE);
    close(runtime.coastX(p.z), authored.coastX(z) * CITY_SCALE);
    assert.equal(runtime.isWater(p.x, p.z), authored.isWater(x, z));
    assert.equal(runtime.districtAt(p.x, p.z).id, authored.districtAt(x, z).id);
  }
  for (const [i, district] of runtime.MASTER_DISTRICTS.entries()) {
    const original = authored.MASTER_DISTRICTS[i];
    assert.equal(district.radiusX, original.radiusX * CITY_SCALE);
    assert.equal(district.radiusZ, original.radiusZ * CITY_SCALE);
    assert.deepEqual(district.heightRange, original.heightRange, 'preserve the varied building skyline');
  }
  assert.deepEqual(atEastpoint(2550, 600), { x: runtime.SHOWCASE.x, z: runtime.SHOWCASE.z });
  assert.deepEqual(atEastpoint(2468, 657), runtime.SHOWCASE.spawn);
  assert.deepEqual(atEastpoint(2498, 680), { x: runtime.SHOWCASE.meeting.x, z: runtime.SHOWCASE.meeting.z });
});

test('rebuilt spatial bounds contain road surface corners and deck supports', () => {
  const segments = new Set([...plan.roadIndex.cells.values()].flat());
  assert.equal(segments.size, plan.roadIndex.size);
  for (const s of segments) {
    assert.ok(plan.roads.includes(s.road), 'index must reference compact road metadata');
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, length = Math.hypot(dx, dz);
    for (const along of [-s.supportOverlap, length + s.supportOverlap]) for (const across of [-s.width / 2, s.width / 2]) {
      const x = s.a.x + dx / length * along - dz / length * across;
      const z = s.a.z + dz / length * along + dx / length * across;
      const y = s.a.y + (s.b.y - s.a.y) / length * along + s.crossSlope * across;
      assert.ok(x >= s.minX - 1e-8 && x <= s.maxX + 1e-8 && z >= s.minZ - 1e-8 && z <= s.maxZ + 1e-8, s.id);
      assert.ok(y >= s.minY - 1e-8 && y <= s.maxY + 1e-8, s.id);
      assert.ok(plan.roadIndex.near(x, z, .001).includes(s), `${s.id} missing from index`);
    }
  }
  assert.equal(plan.supports.length, source.supports.length);
  for (const [i, support] of plan.supports.entries()) {
    const original = source.supports[i];
    assert.equal(support.id, original.id);
    assert.equal(support.width, original.width * CITY_SCALE);
    for (const point of support.a ? [support.a, support.b] : [support]) {
      assert.ok(plan.supportIndex.near(point.x, point.z, .001).includes(support));
    }
  }
});

test('human-scale streetlights do not protrude through compact viaducts and pedestrian decks', () => {
  const metro = new VerticalMetropolis(plan, LANDMARKS);
  let lamps = 0, covered = 0;
  for (let bx = Math.floor(-WORLD_LIMIT / 192); bx <= Math.floor(WORLD_LIMIT / 192); bx++) {
    for (let bz = Math.floor(-WORLD_LIMIT / 192); bz <= Math.floor(WORLD_LIMIT / 192); bz++) {
      for (const lamp of metro.block(bx, bz).props.filter(prop => prop.kind === 'lamp')) {
        lamps++;
        const surfaces = [...plan.roadIndex.near(lamp.x, lamp.z, 2), ...plan.supportIndex.near(lamp.x, lamp.z, 2)];
        // The visible pole is 8.6 m tall. Cast through its center above the
        // mounting surface; an overhead road must not cut through that pole.
        const origin = { x: lamp.x, y: lamp.y + .3, z: lamp.z };
        for (const surface of surfaces) {
          const hit = rayBoxDistance(origin, { x: 0, y: 1, z: 0 }, surface, 20);
          if (hit !== Infinity) {
            covered++;
            assert.ok(hit > 8.3, `Lamp at ${lamp.x},${lamp.z} pierces ${surface.id} after ${hit.toFixed(2)}m`);
          }
        }
      }
    }
  }
  assert.ok(lamps > 7000, 'retain normal street lighting throughout the city');
  assert.ok(covered > 0, 'tall expressways still leave room for lamps underneath');
});
