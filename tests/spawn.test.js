import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { findSpawnPosition } from '../src/core/spawn.js';
import { createVerticalCity } from '../src/world/vertical-city.js';
import { WorldStream } from '../src/world/world-stream.js';
import { WORLD_OBJECTS, placeById } from '../src/modes/story/content.js';
import { createMasterPlan, terrainHeight } from '../src/world/master-plan.js';
import { carCollider, circleHitsBox, overlapsHeight, supportHeight, moveWithCollisions, orientedBox } from '../src/core/physics.js';
import { WORLD_LIMIT } from '../src/world/world-config.js';

const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream, WORLD_OBJECTS);
after(() => stream.dispose());
const collidersAt = (x, z, radius = 3, extraCars = []) => city.spatial.near(x, z, radius).concat(extraCars.map(carCollider));
const floorAt = (x, z, ceiling) => supportHeight(x, z, city.spatial.near(x, z, 2), ceiling, terrainHeight(x, z));
const hits = (p, boxes, radius = .43) => boxes.some(b => !b.supportOnly && overlapsHeight(b, p.y) && circleHitsBox(p.x, p.z, radius, b));
function refugeArrival(id) {
  const refuge = placeById(id), offset = refuge.arrivalOffset ?? { x: 0, z: -2 };
  return { x: refuge.x + offset.x, y: refuge.y, z: refuge.z + offset.z };
}

function assertCanStep(position, obstacles = collidersAt) {
  for (const [dx, dz] of [[.4, 0], [-.4, 0], [0, .4], [0, -.4]]) {
    const actor = { ...position };
    assert.equal(moveWithCollisions(actor, dx, dz, .43, obstacles(actor.x, actor.z, 3)), false);
    assert.ok(Math.abs(Math.hypot(actor.x - position.x, actor.z - position.z) - .4) < 1e-8);
  }
}

test('refuge arrival detects and repairs a spawn inside a stopped traffic car', () => {
  const home = placeById('home'), old = { x: home.x, z: home.z - 2 };
  old.y = floorAt(old.x, old.z, home.y + .6);
  const car = { ...old, yaw: Math.PI };
  const occupied = (x, z, radius) => collidersAt(x, z, radius, [car]);
  const boxes = occupied(old.x, old.z);
  assert.equal(hits(old, boxes), true, 'A stopped traffic car must be included in arrival validation');
  for (const [dx, dz] of [[.1, 0], [-.1, 0], [0, .1], [0, -.1]]) {
    const actor = { ...old };
    assert.equal(moveWithCollisions(actor, dx, dz, .43, boxes), true);
    assert.deepEqual(actor, old, 'The old spawn cannot take its first step');
  }
  const safe = findSpawnPosition(old, occupied, floorAt);
  assert.ok(safe);
  assert.equal(hits(safe, occupied(safe.x, safe.z), .93), false);
  assertCanStep(safe, occupied);
});

test('home and elevated garden arrivals preserve their intended position and allow movement in every direction', () => {
  for (const id of ['home', 'garden-rest']) {
    const preferred = refugeArrival(id);
    const safe = findSpawnPosition(preferred, collidersAt, floorAt);
    assert.ok(safe, `${id} has a usable arrival`);
    assert.equal(safe.x, preferred.x); assert.equal(safe.z, preferred.z);
    assert.ok(Math.abs(safe.y - preferred.y) <= .6);
    assertCanStep(safe);
    if (id === 'garden-rest') {
      const deck = createMasterPlan().supports.find(s => s.id === 'stacks-garden');
      assert.equal(safe.y, deck.maxY, 'Garden arrival remains on its deck');
      assert.ok(safe.y - terrainHeight(safe.x, safe.z) > 3);
    }
  }
});

test('a car parked over an arrival selects a clear nearby position', () => {
  const preferred = refugeArrival('home');
  const car = { ...preferred, y: floorAt(preferred.x, preferred.z, preferred.y + .6), yaw: Math.PI / 4 };
  const occupied = (x, z, radius) => collidersAt(x, z, radius, [car]);
  const safe = findSpawnPosition(preferred, occupied, floorAt);
  assert.ok(safe);
  const distance = Math.hypot(safe.x - preferred.x, safe.z - preferred.z);
  assert.ok(distance > 0 && distance <= 8 + 1e-7);
  assert.equal(hits(safe, occupied(safe.x, safe.z), .93), false);
  assertCanStep(safe, occupied);
});

test('tram arrivals find a walkable position on the same floor when an acquired car occupies the platform', () => {
  for (const stop of WORLD_OBJECTS.filter(object => object.type === 'transit')) {
    const preferred = { x: stop.x, y: stop.y, z: stop.z + 2 };
    const acquiredCar = { ...preferred, y: floorAt(preferred.x, preferred.z, preferred.y + .6), yaw: Math.PI / 4, trafficId: 'arrival-blocker', damageHits: 3 };
    const occupied = (x, z, radius) => collidersAt(x, z, radius, [acquiredCar]);
    assert.equal(hits(acquiredCar, occupied(preferred.x, preferred.z)), true, `${stop.id}: old arrival overlaps the acquired car`);
    const safe = findSpawnPosition(preferred, occupied, floorAt);
    assert.ok(safe, `${stop.id}: a nearby arrival is available`);
    assert.ok(Math.hypot(safe.x - preferred.x, safe.z - preferred.z) > 0);
    assert.ok(Math.abs(safe.y - preferred.y) <= .6 + 1e-7, `${stop.id}: stays on the intended floor`);
    assert.equal(hits(safe, occupied(safe.x, safe.z), .93), false);
    assertCanStep(safe, occupied);
  }
});

test('fallback positions never drop an arrival from a deck to the ground', () => {
  const preferred = { x: 0, y: 10, z: 0 }, obstacle = orientedBox(0, 0, 3, 3, 0, 12, 10);
  const floor = (x, z) => Math.hypot(x, z) < 1.5 ? 10 : 0;
  assert.equal(findSpawnPosition(preferred, () => [obstacle], floor), null);
});

test('a fully blocked arrival returns null instead of placing the player inside scenery', () => {
  const wall = orientedBox(0, 0, 40, 40, 0, 20, 0);
  assert.equal(findSpawnPosition({ x: 0, y: 0, z: 0 }, () => [wall], () => 0), null);
});

test('arrival validation rejects invalid floors and keeps its clearance inside the world', () => {
  assert.equal(findSpawnPosition({ x: 0, y: 0, z: 0 }, () => [], () => NaN), null);
  const safe = findSpawnPosition({ x: WORLD_LIMIT - .2, y: 0, z: 0 }, () => [], () => 0, .43, WORLD_LIMIT);
  assert.ok(safe);
  assert.ok(Math.abs(safe.x) <= WORLD_LIMIT - .93 && Math.abs(safe.z) <= WORLD_LIMIT - .93);
});
