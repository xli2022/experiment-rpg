import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_OBJECTS, CONTACTS, MEMORIES, DISTRICTS, QUESTS, placeById } from '../src/modes/story/content.js';
import { createMasterPlan, terrainHeight, SHOWCASE } from '../src/world/master-plan.js';
import { CITY_SCALE, authoredToWorld, atEastpoint } from '../src/world/world-scale.js';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { Campaign, SAVE_KEY, WORLD_REVISION, readSave, writeSave } from '../src/modes/story/campaign.js';
import { circleHitsBox, overlapsHeight, supportHeight, surfaceHeightAt, moveWithCollisions, stepVehicle, orientedBox, rayBoxDistance } from '../src/core/physics.js';
import { createLaneRoute, sampleTrafficRoute } from '../src/traffic/traffic.js';
import { beginJump, stepJump } from '../src/engine/player/jump.js';
import { findClimbFace, startClimb, stepClimb } from '../src/engine/player/climbing.js';

const plan = createMasterPlan(), metropolis = new VerticalMetropolis(plan, WORLD_OBJECTS);
const near = (x, z, radius = 3) => metropolis.collidersIn(x - radius, z - radius, x + radius, z + radius)
  .concat(plan.roadIndex.near(x, z, radius).map(s => ({ ...s, supportOnly: true })), plan.supportIndex.near(x, z, radius));
const floor = (x, z, ceiling) => supportHeight(x, z, near(x, z), ceiling, terrainHeight(x, z));
const obstructed = (x, y, z, radius = .5) => near(x, z, radius + 1).some(b => !b.supportOnly && overlapsHeight(b, y, 1.8) && circleHitsBox(x, z, radius, b));

test('all story objects stand on real terrain or decks with a collision-free interaction approach', () => {
  assert.equal(new Set(WORLD_OBJECTS.map(p => p.id)).size, WORLD_OBJECTS.length);
  for (const object of WORLD_OBJECTS) {
    assert.ok(Number.isFinite(object.y), `${object.id} has no elevation`);
    assert.ok(Math.abs(floor(object.x, object.z, object.y + .03) - object.y) < .031, `${object.id} floats above its support`);
    assert.equal(obstructed(object.x, object.y, object.z), false, `${object.id} intersects city scenery`);
    const approach = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
      let y = object.y;
      for (let distance = .5; distance <= 3; distance += .5) {
        const x = object.x + dx * distance, z = object.z + dz * distance;
        const next = floor(x, z, y + .35);
        if (Math.abs(next - y) > .35 || obstructed(x, next, z)) return false;
        y = next;
      }
      return true;
    });
    assert.ok(approach, `${object.id} has no walkable interaction approach`);
  }
});

test('tram arrivals and refuge respawns use clear positions on their intended floor', () => {
  for (const object of WORLD_OBJECTS.filter(p => p.type === 'transit' || p.type === 'rest')) {
    const offset = object.type === 'transit' ? { x: 0, z: 2 } : object.arrivalOffset ?? { x: 0, z: -2 };
    const x = object.x + offset.x, z = object.z + offset.z;
    const y = floor(x, z, object.y + .6);
    assert.ok(Math.abs(y - object.y) < .6, `${object.id} arrives on another floor`);
    assert.equal(obstructed(x, y, z), false, `${object.id} arrival is obstructed`);
    const actor = { x, y, z };
    assert.equal(moveWithCollisions(actor, object.x - x, object.z - z, .43, near(x, z, Math.hypot(offset.x, offset.z) + 1)), false, `${object.id} arrival cannot reach its platform`);
  }
});

test('the thirteen-district story layout keeps eight distinct memory destinations and valid quest references', () => {
  const ids = new Set(DISTRICTS.map(d => d.id));
  assert.equal(ids.size, 13);
  for (const object of [...WORLD_OBJECTS, ...CONTACTS]) assert.ok(ids.has(object.district), `${object.id} retains an obsolete district`);
  assert.equal(MEMORIES.length, 8); assert.equal(new Set(MEMORIES.map(p => p.district)).size, 8);
  for (const contact of CONTACTS) {
    const marker = placeById(contact.id);
    assert.deepEqual([contact.x, contact.y, contact.z, contact.district], [marker.x, marker.y, marker.z, marker.district]);
  }
  for (const quest of QUESTS) for (const step of quest.steps) {
    if (['talk', 'interact'].includes(step.type)) assert.ok(placeById(step.target), `${quest.id} points at missing ${step.target}`);
  }
  assert.equal(QUESTS.find(q => q.id === 'survey').steps[0].count, 13);
  assert.ok(placeById('mara').y - terrainHeight(placeById('mara').x, placeById('mara').z) > 7 * CITY_SCALE);
  assert.ok(placeById('trace').x > SHOWCASE.x, 'The opening objective crosses Eastpoint skybridge');
  assert.equal(placeById('mara').approach.id, 'eastpoint-west-walk-ramp');
  assert.equal(placeById('trace').approach.id, 'eastpoint-east-walk-ramp');
});

test('story positions use the compact city transform exactly once', () => {
  for (const [id, expected] of [
    ['mara', atEastpoint(2498, 680)], ['trace', atEastpoint(2615, 697)],
    ['sable', authoredToWorld(1265, -1050)], ['jun', authoredToWorld(-380, -3740)],
    ['metro-north', authoredToWorld(1134, -934)], ['metro-garden', authoredToWorld(-456, -3624)],
    ['home', SHOWCASE.spawn], ['metro-neon', SHOWCASE.transit],
  ]) {
    const actual = placeById(id);
    assert.deepEqual({ x: actual.x, z: actual.z }, { x: expected.x, z: expected.z }, id);
  }
});

test('new-world saves record the current map revision and older saves preserve campaign progress', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const campaign = new Campaign();
  Object.assign(campaign.data, { credits: 3470, salvage: 11, xp: 890, rest: 'garden-rest', tracked: 'paper-ghosts',
    collected: ['lore-radio', 'cache-3'], met: ['mara', 'rook'], transit: ['metro-neon', 'metro-district-citadel'] });
  campaign.data.quests['dead-air'] = { status: 'complete', step: 3, runs: 1 };
  campaign.data.quests['paper-ghosts'] = { status: 'active', step: 1, runs: 0 };
  const position = { x: placeById('mara').x, y: placeById('mara').y, z: placeById('mara').z + 2 };
  assert.equal(writeSave(storage, campaign.data, position), true);
  const current = readSave(storage), serialized = JSON.parse(values.get(SAVE_KEY));
  assert.equal(serialized.worldRevision, WORLD_REVISION); assert.equal(current.worldRevision, WORLD_REVISION);
  assert.deepEqual(current.position, position);
  delete serialized.worldRevision;
  serialized.position = { x: -2.5, y: 0, z: 30 };
  serialized.progress.discovered = ['neon', 'chrome'];
  storage.setItem(SAVE_KEY, JSON.stringify(serialized));
  const legacy = readSave(storage);
  assert.equal(legacy.loaded, true); assert.equal(legacy.worldRevision, 1);
  for (const key of ['credits', 'xp', 'salvage', 'rest', 'tracked', 'collected', 'met', 'transit', 'quests']) assert.deepEqual(legacy.progress[key], current.progress[key]);
  assert.ok(legacy.progress.discovered.every(id => DISTRICTS.some(d => d.id === id)));
  assert.ok(legacy.progress.discovered.includes(placeById('home').district));
  // A session saved in the preceding full-size layout must retain its campaign
  // even though main relocates that revision's stale coordinates to a refuge.
  serialized.worldRevision = WORLD_REVISION - 1;
  serialized.position = { x: 4000, y: 85, z: -4000 };
  storage.setItem(SAVE_KEY, JSON.stringify(serialized));
  const previousMap = readSave(storage);
  assert.equal(previousMap.worldRevision, WORLD_REVISION - 1);
  assert.equal(previousMap.position, null, 'The former city boundary is outside the compact world');
  assert.deepEqual(previousMap.progress, legacy.progress);
});

test('driving the actual Eastpoint ramp keeps connected floor support at 30, 60 and 120 FPS', () => {
  const road = plan.roads.find(r => r.id === 'eastpoint-ramp');
  assert.ok(road);
  for (const reverse of [false, true]) for (const fps of [30, 60, 120]) {
    const route = createLaneRoute(road.points, { width: road.width, closed: false, reverse });
    const start = sampleTrafficRoute(route, 0), car = { ...start, speed: 0, velocityY: 0 };
    car.y = floor(car.x, car.z, start.y + .75);
    let along = 0, elapsed = 0;
    while (along < route.length - 1e-6 && elapsed < 90) {
      const dt = 1 / fps, delta = stepVehicle(car, 1, 0, false, dt), travel = Math.hypot(delta.x, delta.z);
      along = Math.min(route.length, along + travel);
      const target = sampleTrafficRoute(route, along), previousY = car.y;
      const blocked = moveWithCollisions(car, target.x - car.x, target.z - car.z, 1.6, near(car.x, car.z, 6));
      assert.equal(blocked, false, `Ramp lane collision at ${fps} FPS / ${reverse} / ${along}`);
      const next = floor(car.x, car.z, car.y + .75);
      assert.ok(Math.abs(next - previousY) < .76, `Ramp floor jumps at ${fps} FPS / ${reverse} / ${along}`);
      assert.ok(Math.abs(next - target.y) < .3, `Lost ramp support at ${fps} FPS / ${reverse} / ${along}`);
      car.y = next; car.yaw = target.yaw; elapsed += dt;
    }
    assert.ok(along >= route.length - 1e-6);
    assert.ok(Math.abs(car.y - sampleTrafficRoute(route, route.length).y) < .3);
  }
});

test('walking downhill on the actual pedestrian access ramp keeps a stable grounded gait at all frame rates', () => {
  const ramp = plan.supports.find(s => s.id === 'eastpoint-west-walk-ramp');
  const length = Math.hypot(ramp.b.x - ramp.a.x, ramp.b.z - ramp.a.z);
  for (const fps of [30, 60, 120]) {
    const player = { ...ramp.b, groundY: ramp.b.y, jumpPhase: '', velocityY: 0 };
    let along = length;
    while (along > 0) {
      along = Math.max(0, along - 10.8 / fps);
      player.x = ramp.a.x + (ramp.b.x - ramp.a.x) * along / length;
      player.z = ramp.a.z + (ramp.b.z - ramp.a.z) * along / length;
      const ground = surfaceHeightAt(player.x, player.z, ramp);
      stepJump(player, 1 / fps, ground);
      assert.equal(player.jumpPhase, '', `Downhill running entered a fall at ${fps} FPS`);
      assert.equal(player.y, ground);
    }
  }
  const jumping = { y: 1, groundY: 1, jumpPhase: '', velocityY: 0 };
  assert.equal(beginJump(jumping), true);
  stepJump(jumping, .1, .8);
  assert.equal(jumping.y, 1, 'A started jump must not snap down to a nearby lower floor');
  const falling = { y: 1, groundY: 1, jumpPhase: '', velocityY: 0 };
  stepJump(falling, 1 / 60, 0);
  assert.equal(falling.jumpPhase, 'fall', 'A true ledge still starts a fall');
});

test('climbing ignores empty ramp bounds but stops when the head reaches the actual slab underside', () => {
  const wall = orientedBox(0, 0, 10, 10, 0, 20, 0, { id: 'tower', climbable: true });
  const ramp = { id: 'overhead-ramp', a: { x: -10, y: 0, z: 6 }, b: { x: 10, y: 12, z: 6 }, width: 4,
    minX: -10, maxX: 10, minZ: 4, maxZ: 8, minY: -.6, maxY: 12, slabThickness: .6, supportOnly: true };
  const player = { x: 0, y: 0, z: 5.6, yaw: 0, vx: 0, vz: 0, jumpPhase: '' };
  assert.equal(startClimb(player, findClimbFace(player, [wall, ramp]), [wall, ramp]), true);
  stepClimb(player, { x: 0, y: 1 }, .9, [wall, ramp]);
  assert.ok(player.y > 3); assert.equal(player.climb.blocked, false);
  stepClimb(player, { x: 0, y: 1 }, .15, [wall, ramp]);
  stepClimb(player, { x: 0, y: 1 }, .2, [wall, ramp]);
  assert.equal(player.climb.blocked, true); assert.ok(player.y < 4);
});

test('crossfall agrees between walking support and ray intersections on both sides of a road', () => {
  const road = { a: { x: 0, y: 5, z: 0 }, b: { x: 0, y: 15, z: 100 }, width: 20, crossSlope: .02,
    minX: -10, maxX: 10, minZ: 0, maxZ: 100, minY: 4.2, maxY: 15.2, supportOnly: true, slabThickness: .6 };
  for (const x of [-8, 8]) {
    const y = 10 - x * .02;
    assert.equal(surfaceHeightAt(x, 50, road), y);
    assert.equal(supportHeight(x, 50, [road], y + .1, 0), y);
    assert.ok(Math.abs(rayBoxDistance({ x, y: 20, z: 50 }, { x: 0, y: -1, z: 0 }, road) - (20 - y)) < 1e-8);
    assert.ok(Math.abs(rayBoxDistance({ x, y: 0, z: 50 }, { x: 0, y: 1, z: 0 }, road) - (y - .6)) < 1e-8);
  }
});
