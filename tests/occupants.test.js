import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { MASTER_DISTRICTS as DISTRICTS } from '../src/world/master-plan.js';
import { interiorPlan, floorPlan, floorOccupants, templateSpots, levelY } from '../src/world/interior-plan.js';
import { pointInConvex } from '../src/world/building-footprints.js';
import { floorColliders, toWorld } from '../src/world/interior-physics.js';
import { createOccupants, OCCUPANTS } from '../src/traffic/occupants.js';
import { moveWithCollisions } from '../src/core/physics.js';
import { crowdAsset, visitorAsset } from './helpers/street-grid.js';

const metropolis = new VerticalMetropolis();
const blueprints = [...new Map(DISTRICTS.flatMap(d => metropolis.area(d.x - 70, d.z - 70, d.x + 70, d.z + 70))
  .flatMap(block => block.buildings).map(p => [p.id, p])).values()];
const plans = blueprints.map(p => ({ p, plan: interiorPlan(p) })).filter(e => e.plan).filter((_, i) => i % 4 === 0);
const corners = b => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => ({
  x: b.x + i * b.w / 2 * Math.cos(b.yaw) + k * b.d / 2 * Math.sin(b.yaw), z: b.z - i * b.w / 2 * Math.sin(b.yaw) + k * b.d / 2 * Math.cos(b.yaw) }));

// Whether two rotated rectangles overlap, by separating axes.
function overlap(a, b) {
  const ca = corners(a), cb = corners(b);
  return [a, b].every(r => [[Math.cos(r.yaw), -Math.sin(r.yaw)], [Math.sin(r.yaw), Math.cos(r.yaw)]].every(([ax, az]) => {
    const p = ca.map(c => c.x * ax + c.z * az), q = cb.map(c => c.x * ax + c.z * az);
    return Math.max(...p) > Math.min(...q) + 1e-6 && Math.max(...q) > Math.min(...p) + 1e-6;
  }));
}

test('people inside have a place of their own: in the room, clear of the furniture, seated only where there is a seat', () => {
  const kinds = new Set();
  for (const { plan } of plans) for (const t of plan.templates) {
    const zones = new Map(t.zones.map(z => [z.id, z])), spots = templateSpots(plan, t);
    assert.equal(templateSpots(plan, t), spots, 'made once per layout');
    for (const s of spots) {
      kinds.add(s.kind);
      assert.ok(corners(s.body).every(c => pointInConvex(zones.get(s.zone).polygon, c.x, c.z, 0)), `${plan.id} ${s.kind}: inside its room`);
      // Only the piece they sit at or face may touch them.
      for (const f of t.furniture.filter(f => f.zone === s.zone && f.id !== s.piece)) assert.ok(!overlap(s.body, f), `${plan.id} ${s.kind} stands in a ${f.item}`);
      if (s.pose === 'sit') assert.ok(['sofa', 'bench', 'desk'].includes(s.kind), `${plan.id}: nobody sits on air (${s.kind})`);
    }
  }
  for (const kind of ['sofa', 'desk', 'counter', 'clerk', 'shelf', 'lift']) assert.ok(kinds.has(kind), `someone ${kind}`);
});

test('who is in is the same on every visit: someone home only while a flat is lit, at most two to a flat', () => {
  let people = 0, homes = 0;
  for (const { p, plan } of plans) for (const level of new Set([0, 1, plan.levels - 1])) {
    if (level >= plan.levels) continue;
    const list = floorOccupants(plan, level), rooms = new Map(floorPlan(plan, level).rooms.map(r => [r.id, r]));
    assert.deepEqual(floorOccupants(interiorPlan(structuredClone(p)), level), list, `${plan.id} level ${level}`);
    const perUnit = new Map();
    for (const o of list) {
      people++;
      assert.ok(rooms.get(o.room)?.lit, `${o.id}: in a dark room`);
      assert.equal(o.y, levelY(plan, level));
      if (o.unit) { homes++; perUnit.set(o.unit, (perUnit.get(o.unit) ?? 0) + 1); }
    }
    for (const [unit, n] of perUnit) assert.ok(n <= 2, `${unit}: ${n} people`);
    // Someone working at a desk has a chair, solid like the rest of the furniture.
    const chairs = new Set(floorColliders(plan, level).filter(b => b.furniture === 'chair').map(b => b.id.split(':chair:')[1]));
    for (const o of list) if (o.chair) assert.ok(chairs.has(o.spot), `${o.id}: a chair`);
    assert.equal(chairs.size, list.filter(o => o.chair).length, 'no empty chairs added');
  }
  assert.ok(people > 300 && homes > 100, `${people} people, ${homes} at home`);
});

function scene(assets) {
  const stage = new THREE.Scene(), occupants = createOccupants({ scene: stage, assets });
  return { stage, occupants };
}

test('only the nearest people on standing floors are shown, and none outlast their floor', () => {
  const assets = { citizen: crowdAsset(['Idle', 'Walk', 'WalkFormal', 'Jog', 'Driving']), visitors: { 'robot-scout': visitorAsset(), 'alien-scout': visitorAsset() } };
  const { stage, occupants } = scene(assets);
  const { plan } = plans.find(e => e.plan.levels > 2 && floorOccupants(e.plan, 1).length >= 4);
  const floors = [0, 1, 2].map(level => ({ plan, level })), people = floorOccupants(plan, 1);
  const first = toWorld(plan, people[0].x, people[0].z), player = { x: first.x + .8, y: levelY(plan, 1), z: first.z };
  occupants.update(.016, { player, camera: null, floors, time: 0 });
  const snap = occupants.snapshot();
  assert.ok(snap.assigned > 0 && snap.assigned <= OCCUPANTS.high.count, `${snap.assigned} shown`);
  for (const person of occupants.avatars.filter(a => a.occupant)) {
    const o = person.occupant;
    assert.ok(stage.children.includes(person.root) && person.root.visible);
    assert.ok(Math.abs(person.root.position.x - o.x) < 1e-9 && Math.abs(person.root.position.y - o.y) < 1e-9 && Math.abs(person.root.position.z - o.z) < 1e-9, 'stands at their place');
    if (o.pose === 'sit') assert.equal(person.species, 'human', 'only humans sit');
  }
  // The one standing nearest is among them, and the floor the player is on comes first.
  assert.ok(snap.people.some(p => p.id === people[0].id));
  const sameFloor = snap.people.filter(p => Math.abs(p.y - player.y) < 1).length;
  assert.ok(sameFloor >= Math.min(people.length, snap.assigned) * .5, `${sameFloor} of ${snap.assigned} on the player's floor`);
  // The floor goes: so do its people.
  occupants.update(.016, { player, camera: null, floors: [], time: 1 });
  assert.equal(occupants.snapshot().assigned, 0);
  assert.ok(occupants.avatars.every(a => !a.root.parent && !a.root.visible));
  occupants.dispose();
});

test('the player walks round people standing inside rather than through them', () => {
  const assets = { citizen: crowdAsset(['Idle', 'Walk', 'WalkFormal', 'Jog', 'Driving']) };
  const { occupants } = scene(assets);
  const entry = plans.flatMap(({ plan }) => [0, 1].filter(l => l < plan.levels).map(level => ({ plan, level, o: floorOccupants(plan, level).find(o => o.pose === 'stand') }))).find(e => e.o);
  const { plan, level, o } = entry, at = toWorld(plan, o.x, o.z);
  occupants.update(.016, { player: { x: at.x, y: levelY(plan, level), z: at.z + 2 }, camera: null, floors: [{ plan, level }], time: 0 });
  const boxes = occupants.colliders(at.x, at.z, 3);
  assert.ok(boxes.some(b => b.id === `occupant:${o.id}`), 'their body is solid');
  // Walk straight at them from two metres out: the body stops short.
  const yaw = plan.origin.yaw + o.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), body = { x: at.x + fx * 2, z: at.z + fz * 2, y: levelY(plan, level) };
  for (let i = 0; i < 120; i++) moveWithCollisions(body, -fx * .03, -fz * .03, .43, boxes);
  assert.ok(Math.hypot(body.x - at.x, body.z - at.z) > .43, 'never inside them');
  occupants.dispose();
});
