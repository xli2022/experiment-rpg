import test from 'node:test';
import assert from 'node:assert/strict';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { MASTER_DISTRICTS as DISTRICTS } from '../src/world/master-plan.js';
import { terrainHeight } from '../src/world/master-plan.js';
import { buildingDesign, buildingDetails, buildingEntrances, buildingVolumes } from '../src/world/building-design.js';
import { interiorPlan, floorPlan, buildingUnits, levelY, INTERIOR, sharedSegments } from '../src/world/interior-plan.js';
import { polygonArea, pointInConvex, polygonFaces, clipConvex, insetConvex } from '../src/world/building-footprints.js';
import { buildFloor, leafPose } from '../src/world/interiors.js';

const metropolis = new VerticalMetropolis();
const blueprints = [...new Map(DISTRICTS.flatMap(d => metropolis.area(d.x - 70, d.z - 70, d.x + 70, d.z + 70))
  .flatMap(block => block.buildings).map(p => [p.id, p])).values()];
const plans = blueprints.map(p => ({ p, plan: interiorPlan(p) })).filter(e => e.plan);
const isConvex = poly => polygonFaces(poly).every(f => poly.every(q => (q.x - f.x) * f.nx + (q.z - f.z) * f.nz <= 1e-6));

test('convex helpers clip, inset and contain counter-clockwise footprints', () => {
  const square = [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }];
  assert.equal(polygonArea(square), 4);
  assert.equal(polygonArea(clipConvex(square, 1, 0, 0)), 2);
  assert.deepEqual(clipConvex(square, 1, 0, -2), []);
  assert.ok(Math.abs(polygonArea(insetConvex(square, .25)) - 2.25) < 1e-9);
  assert.ok(pointInConvex(square, .9, .9) && !pointInConvex(square, .9, .9, .2));
});

test('every district, footprint and use produces an enterable interior', () => {
  assert.ok(blueprints.length > 150, 'samples a broad range of real city blueprints');
  assert.equal(plans.length, blueprints.filter(p => buildingVolumes(p)[0].h >= INTERIOR.minHeight).length);
  const kinds = new Set(plans.map(({ plan }) => `${plan.footprint}/${plan.layout}`));
  for (const footprint of ['rectangle', 'circle', 'hexagon']) assert.ok([...kinds].some(k => k.startsWith(footprint)), footprint);
  for (const layout of ['pinwheel', 'side-core', 'hall']) assert.ok([...kinds].some(k => k.endsWith(layout)), layout);
});

test('plans are deterministic and floors follow the facade storey grid', () => {
  for (const { p, plan } of plans.slice(0, 60)) {
    assert.deepEqual(interiorPlan(structuredClone(p)), plan);
    const base = buildingVolumes(p)[0];
    assert.equal(plan.floor0, p.y + INTERIOR.floorOffset);
    assert.ok(Math.abs(plan.top - (p.y + base.h)) < 1e-9);
    if (plan.layout !== 'hall' && plan.layout !== 'single') assert.equal(plan.levels, Math.max(1, Math.floor((base.h - .1) / INTERIOR.storey)));
    assert.ok(levelY(plan, plan.levels - 1) + 2.4 < plan.top, 'the top storey keeps standing headroom');
  }
});

test('zones are convex, stay inside the walls and tile each floor', () => {
  for (const { plan } of plans) for (const t of plan.templates) {
    let area = 0;
    for (const zone of t.zones) {
      assert.ok(isConvex(zone.polygon), `${plan.id} ${zone.id} is convex`);
      assert.ok(zone.polygon.every(q => pointInConvex(plan.inner, q.x, q.z, -1e-4)), `${plan.id} ${zone.id} inside`);
      area += polygonArea(zone.polygon);
    }
    assert.ok(Math.abs(area - polygonArea(plan.inner)) < polygonArea(plan.inner) * .002, `${plan.id} zones tile the floor`);
  }
});

// Rooms connect through doors, open plans and the stair's open near edge.
function reachable(plan, t) {
  const rooms = new Map(t.rooms.map(r => [r.id, r])), zoneRoom = new Map(t.zones.map(z => [z.id, z.room])), links = new Map(t.rooms.map(r => [r.id, new Set()]));
  const link = (a, b) => { links.get(a).add(b); links.get(b).add(a); };
  for (const d of t.doors) link(...d.rooms);
  const walled = new Set(t.walls.flatMap(w => [w.zones.join('|'), [...w.zones].reverse().join('|')]));
  for (const a of t.zones) for (const b of t.zones) if (a !== b && sharedSegments(a.polygon, b.polygon).length && !walled.has(`${a.id}|${b.id}`)) link(a.room, b.room);
  const start = t.level === 0 ? t.perimeter.filter(s => s.openings.some(o => o.entrance)).map(s => zoneRoom.get(s.zone)) : [t.rooms.find(r => r.kind === 'landing')?.id];
  const seen = new Set(start.filter(Boolean)), queue = [...seen];
  while (queue.length) for (const next of links.get(queue.shift())) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return [...rooms.values()].filter(r => !['void', 'shaft'].includes(r.kind) && !seen.has(r.id));
}

test('every room can be reached from the street door or the stair landing', () => {
  for (const { plan } of plans) for (const t of plan.templates) {
    assert.deepEqual(reachable(plan, t).map(r => r.kind), [], `${plan.id} level template ${t.level}`);
    if (t.level === 0) assert.ok(t.perimeter.some(s => s.openings.some(o => o.entrance)), `${plan.id} has a street door`);
    if (plan.core && t.level === 0) assert.ok(t.zones.some(z => z.kind === 'lobby' || z.kind === 'shop' || z.kind === 'office'));
  }
});

test('stairs serve every multi-storey building and tall ones have a lift', () => {
  for (const { plan } of plans) {
    if (plan.levels > 1) {
      const s = plan.core?.stair;
      assert.ok(s, `${plan.id} has stairs`);
      assert.ok(Math.abs(s.near - s.far - INTERIOR.stair.run) < 1e-9);
      assert.ok(pointInConvex(plan.inner, s.x0, s.z0, -1e-6) && pointInConvex(plan.inner, s.x1, s.z1, -1e-6));
    }
    if (plan.levels > INTERIOR.liftAbove) assert.ok(plan.core.lift, `${plan.id} has a lift`);
  }
});

test('open doors fold into their frames: none reaches past its wall, so no lift door covers the stair', () => {
  let lifts = 0;
  for (const { plan } of plans.filter(e => e.plan.levels > 1).filter((_, i) => i % 5 === 0)) {
    const { floor, doors } = buildFloor(plan, 1), walls = new Map(floor.template.walls.map(w => [w.id, w]));
    for (const leaf of doors.filter(d => d.wall)) {
      const wall = walls.get(leaf.wall), length = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z), open = leafPose(leaf, 1);
      assert.ok(open.width < leaf.w * .1, 'an open door clears its doorway');
      for (const k of [-1, 1]) {
        const x = open.x + leaf.ux * k * open.width / 2, z = open.z + leaf.uz * k * open.width / 2;
        const along = ((x - wall.a.x) * (wall.b.x - wall.a.x) + (z - wall.a.z) * (wall.b.z - wall.a.z)) / length;
        assert.ok(along > -1e-6 && along < length + 1e-6, `${plan.id}: an open ${leaf.kind} door reaches past its wall`);
      }
      if (leaf.kind === 'lift') lifts++;
    }
  }
  assert.ok(lifts > 20, 'buildings with lifts are covered');
});

test('street doors sit where the facade draws its entrances', () => {
  for (const { p, plan } of plans) {
    const parts = buildingDetails(p, buildingDesign(p));
    for (const e of buildingEntrances(p)) {
      assert.ok(e.width >= 1 && e.width <= 4 && e.height >= 2.4, `${plan.id} opening fits a person`);
      assert.ok(pointInConvex(plan.outline, e.x - e.nx * .01, e.z - e.nz * .01) && !pointInConvex(plan.outline, e.x + e.nx * .01, e.z + e.nz * .01), 'on the wall');
      const drawn = parts.some(part => ['glass', 'stone'].includes(part.mat) && part.y < 3 &&
        Math.hypot(part.x - e.x, part.z - e.z) < .4 + (part.yaw === undefined ? 0 : .2));
      assert.ok(drawn, `${plan.id} draws a door at ${e.id}`);
    }
  }
});

test('units have stable, unique identities for future residents', () => {
  const sample = plans.filter(({ plan }) => plan.levels > 3).slice(0, 12);
  assert.ok(sample.length > 5);
  for (const { p, plan } of sample) {
    const units = buildingUnits(p), ids = units.map(u => u.id);
    assert.equal(new Set(ids).size, ids.length, `${plan.id} unit IDs are unique`);
    assert.ok(ids.every(id => id.startsWith(`${p.id}/`)));
    assert.deepEqual(buildingUnits(structuredClone(p)), units);
    const floor = floorPlan(plan, 3);
    assert.ok(floor.rooms.every(r => typeof r.id === 'string' && r.id.startsWith(p.id)));
    assert.equal(new Set(floor.rooms.map(r => r.id)).size, floor.rooms.length);
  }
});

test('the ground floor sits above the terrain inside the footprint', () => {
  for (const { p, plan } of plans) {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    for (const q of plan.inner) {
      const x = p.x + q.x * c + q.z * s, z = p.z - q.x * s + q.z * c;
      assert.ok(terrainHeight(x, z) <= plan.floor0 + 1e-6, `${plan.id} floor clears the ground`);
    }
  }
});

test('furniture stays inside its room and clear of doorways', () => {
  for (const { plan } of plans.slice(0, 120)) for (const t of plan.templates) {
    const zones = new Map(t.zones.map(z => [z.id, z])), doors = t.doors.map(d => ({ x: d.x, z: d.z }));
    for (const f of t.furniture) {
      const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = f.x + i * f.w / 2 * c + j * f.d / 2 * s, z = f.z - i * f.w / 2 * s + j * f.d / 2 * c;
        assert.ok(pointInConvex(zones.get(f.zone).polygon, x, z, 0), `${plan.id} ${f.item} inside`);
      }
      for (const d of doors) {
        const dx = d.x - f.x, dz = d.z - f.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
        assert.ok(Math.hypot(Math.max(0, Math.abs(lx) - f.w / 2), Math.max(0, Math.abs(lz) - f.d / 2)) > INTERIOR.door.clearance - 1e-6, `${plan.id} ${f.item} clear of door`);
      }
    }
  }
});
