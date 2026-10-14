import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVerticalCity } from '../src/world/vertical-city.js';
import { WorldStream } from '../src/world/world-stream.js';
import { AFTERLIGHT_LANDMARKS } from '../src/world/landmarks.js';
import { MASTER_DISTRICTS } from '../src/world/master-plan.js';
import { cachedInteriorPlan, levelY, floorOccupants } from '../src/world/interior-plan.js';
import { toWorld, toLocal } from '../src/world/interior-physics.js';
import { residentDestinations, planResidentGuide } from '../src/traffic/resident-guides.js';
import { createResidentNavigation } from '../src/traffic/resident-navigation.js';
import { requestResidentAction, queueResidentLift, stepResidentAction } from '../src/traffic/resident-actions.js';
import { createOccupants } from '../src/traffic/occupants.js';
import { crowdAsset } from './helpers/street-grid.js';
import { findPath, walk } from './helpers/interior-walk.js';
import { circleHitsBox, overlapsHeight } from '../src/core/physics.js';

const scene = new THREE.Scene(), stream = new WorldStream(scene), world = createVerticalCity(scene, stream, AFTERLIGHT_LANDMARKS);
world.landmarks = AFTERLIGHT_LANDMARKS; world.districts = MASTER_DISTRICTS;
world.buildingsNear = (x, z, radius) => world.metropolis.buildingsNear(x, z, radius);
const plans = new Map(), shops = [];
for (const d of MASTER_DISTRICTS) for (const block of world.metropolis.area(d.x - 90, d.z - 90, d.x + 90, d.z + 90)) for (const building of block.buildings) {
  const plan = cachedInteriorPlan(building);
  if (plan?.core && plan.levels >= 3 && !plans.has(`${plan.layout}/${plan.footprint}`)) plans.set(`${plan.layout}/${plan.footprint}`, plan);
  if (plan?.core?.lift && plan.id.startsWith('frontage:') && plan.entrances.length && shops.length < 8 && !shops.includes(plan)) shops.push(plan);
}
const at = (plan, x, z, level = 0) => ({ ...toWorld(plan, x, z), y: levelY(plan, level) });
const settle = (body, player, nav, seconds = 30) => {
  for (let i = 0; i < seconds * 60 && body.residentAction; i++) stepResidentAction(body, 1 / 60, player, nav);
};
function replay(body, player, nav, segment) {
  assert.equal(segment.falls, 0, 'the player takes a walking route');
  assert.deepEqual(segment.overlaps, []);
  for (const footstep of segment.trace) {
    Object.assign(player, footstep);
    stepResidentAction(body, 1 / 60, player, nav);
    assert.ok(nav.sample(body, body), `resident stays supported and clear of walls at ${JSON.stringify({ x: body.x, y: body.y, z: body.z })}`);
  }
}

test('local destinations resolve real storefronts and indoor elevators with supported arrival heights', () => {
  const plan = [...plans.values()].find(p => p.core.lift), door = plan.entrances[0];
  const outside = toWorld(plan, door.x + door.nx * 5, door.z + door.nz * 5);
  const body = { ...outside, y: world.terrainHeight(outside.x, outside.z), yaw: 0 };
  const nav = createResidentNavigation({ world })(body);
  const support = nav.sample(body, body); assert.ok(support); Object.assign(body, support);
  const destinations = nav.destinations(); assert.ok(destinations.some(p => p.id === `building:${plan.id}`));
  const nearest = destinations.find(p => nav.guide(body, p.id)); assert.ok(nearest, 'at least one real nearby entrance is reachable');
  const player = { ...body, x: body.x + 2, yaw: 0 };
  assert.equal(requestResidentAction(body, { action: 'go_to', destination: nearest.id }, player, nav).ok, true);
  player.x += 100;
  for (let frame = 0; frame < 60 * 120 && body.residentAction.kind === 'go_to'; frame++) stepResidentAction(body, 1 / 60, player, nav);
  assert.equal(body.residentAction.kind, 'wait'); assert.match(body.residentAction.status, /Arrived at/);
  assert.ok(nav.sample(body, body));
  const landing = plan.core.landing;
  Object.assign(body, at(plan, (landing.x0 + landing.x1) / 2, (landing.z0 + landing.z1) / 2, 1));
  const inside = nav.destinations(); assert.ok(inside.some(p => p.id === 'lift'));
  assert.ok(inside.every(p => Math.abs(p.y - body.y) < .1));
  assert.ok(!inside.some(p => p.type === 'exit'), 'upper floors do not invent a ground-floor exit on this floor');
});

test('residents walk between a shop floor\'s exit and elevator both ways, and out from behind its counters', () => {
  let floors = 0, counters = 0;
  for (const plan of shops) {
    const e = plan.entrances[0], inside = { ...at(plan, e.x - e.nx * 1.5, e.z - e.nz * 1.5), plan };
    const places = residentDestinations(world, inside), exit = places.find(p => p.type === 'exit'), lift = places.find(p => p.type === 'elevator');
    if (!exit || !lift) continue;
    // The elevator is met in front of its doors: inside the car, only a doorway leads anywhere.
    const local = toLocal(plan, lift.x, lift.z), car = plan.core.lift;
    assert.ok(!(local.x > car.x0 && local.x < car.x1 && local.z > car.z0 && local.z < car.z1), `${plan.id}: the elevator is met outside the car`);
    const navigationAt = p => createResidentNavigation({ world })({ ...p, plan });
    const spatial = world.spatialFor(world.interiorContextAt(exit.x, exit.y, exit.z)), walkable = (a, b) => findPath(spatial, plan, a, b, a.y);
    if (walkable(exit, lift)) {
      assert.ok(planResidentGuide({ ...exit, plan }, lift, navigationAt(exit)), `${plan.id}: exit to elevator`);
      assert.ok(planResidentGuide({ ...lift, plan }, exit, navigationAt(lift)), `${plan.id}: elevator to exit`);
      floors++;
    }
    for (const o of floorOccupants(plan, 0).filter(o => o.kind === 'clerk' || o.kind === 'counter')) {
      const spot = at(plan, o.x, o.z);
      if (!walkable(spot, exit)) continue;
      assert.ok(planResidentGuide({ ...spot, plan }, exit, navigationAt(spot)), `${plan.id}: ${o.kind} at (${o.x.toFixed(1)}, ${o.z.toFixed(1)}) to the exit`);
      counters++;
    }
  }
  assert.ok(floors >= 3 && counters >= 3, `checked ${floors} shop floors and ${counters} counters`);
});

test('residents enter buildings, climb two switchback storeys, then retrace the whole route home', () => {
  assert.ok(plans.size >= 3);
  for (const plan of plans.values()) {
    const e = plan.entrances[0], outside = toWorld(plan, e.x + e.nx * 3, e.z + e.nz * 3);
    const home = { ...outside, y: world.terrainHeight(outside.x, outside.z), yaw: 1.2 };
    const body = { ...home }, player = { ...home, velocityY: 0, vx: 0, vz: 0, groundY: home.y, jumpPhase: '' };
    const nav = createResidentNavigation({ world })(body);
    requestResidentAction(body, 'follow', player, nav);
    const entry = walk(world, player, [toWorld(plan, e.x + e.nx, e.z + e.nz), toWorld(plan, e.x - e.nx * 1.2, e.z - e.nz * 1.2)], 60);
    replay(body, player, nav, entry);
    const s = plan.core.stair, lane = l => (l.x0 + l.x1) / 2;
    for (let level = 0; level < 2; level++) {
      const context = world.interiorContextAt(player.x, player.y, player.z);
      const path = findPath(world.spatialFor(context), plan, player, toWorld(plan, lane(s.up), s.near + .7), levelY(plan, level));
      assert.ok(path, `${plan.layout} connects to the stairs`);
      const climb = walk(world, player, [...path, toWorld(plan, lane(s.up), s.far - .5), toWorld(plan, lane(s.down), s.far - .5), toWorld(plan, lane(s.down), s.near + .7)], 60);
      replay(body, player, nav, climb);
    }
    settle(body, player, nav);
    assert.ok(Math.abs(body.y - levelY(plan, 2)) < .31, `${plan.layout}/${plan.footprint}: follower arrives on the second upper floor: ${JSON.stringify({ x: body.x, y: body.y, z: body.z, target: levelY(plan, 2), status: body.residentAction?.status, next: body.residentAction?.route.slice(0, 3) })}`);
    assert.equal(requestResidentAction(body, 'resume_routine', player, nav).ok, true);
    player.x += 100; player.z += 100;
    settle(body, player, nav, 180);
    assert.equal(body.residentAction, null, `${plan.layout}: returns through both staircases and the entrance`);
    assert.ok(Math.hypot(body.x - home.x, body.z - home.z) < .06);
    assert.ok(Math.abs(body.y - home.y) < .1);
    assert.equal(body.yaw, home.yaw);
  }
});

test('elevator journeys wait for a clear car and reverse on return; arbitrary height changes cannot teleport a resident', () => {
  const plan = [...plans.values()].find(p => p.core.lift), lift = plan.core.lift;
  const from = at(plan, (lift.x0 + lift.x1) / 2, (lift.z0 + lift.z1) / 2), to = { ...from, y: levelY(plan, 2) };
  const body = { ...from, yaw: .7 }, player = { ...from, yaw: 0 }, blocker = { ...to };
  let people = [body, blocker];
  const nav = createResidentNavigation({ world, people: () => people })(body);
  assert.ok(nav.sample(body, body));
  requestResidentAction(body, 'follow', player, nav);
  Object.assign(player, to); settle(body, player, nav, 2);
  assert.equal(body.y, from.y, 'a height discontinuity is not an elevator trip');
  assert.equal(queueResidentLift(body, from, { ...to, x: to.x + 8 }, nav), false, 'no arbitrary teleport destination');
  assert.equal(queueResidentLift(body, from, to, nav), true);
  player.x += 2; settle(body, player, nav, 2);
  assert.equal(body.y, from.y, 'another resident blocks the destination car');
  people = [body]; Object.assign(player, to); settle(body, player, nav, 2);
  assert.equal(body.y, from.y, 'the player also needs to leave room');
  player.x += 2;
  for (let i = 0; i < 180 && body.y === from.y; i++) stepResidentAction(body, 1 / 60, player, nav);
  assert.equal(body.y, to.y, 'takes the recorded trip once the car is clear');
  assert.equal(requestResidentAction(body, 'resume_routine', player, nav).ok, true);
  player.x += 100;
  settle(body, player, nav, 10);
  assert.equal(body.residentAction, null);
  assert.equal(body.y, from.y); assert.equal(body.yaw, .7);
  requestResidentAction(body, 'wait', from, nav);
  assert.equal(queueResidentLift(body, from, to, nav), false, 'waiting residents do not use the player’s elevator');
});

test('visibility follows the current floor without moving the resident’s routine home', () => {
  const plan = [...plans.values()][0], e = plan.entrances[0];
  const body = { ...at(plan, e.x - e.nx * 1.2, e.z - e.nz * 1.2), plan, level: 0 };
  let floors = [{ plan, level: 0 }];
  const nav = createResidentNavigation({ world: { ...world, interiors: { floors: () => floors } } })(body);
  assert.equal(nav.visible(), true);
  body.y = levelY(plan, 2);
  assert.equal(nav.visible(), false);
  floors = [{ plan, level: 2 }];
  assert.equal(nav.visible(), true);
  Object.assign(body, toWorld(plan, e.x + e.nx * 3, e.z + e.nz * 3));
  body.y = world.terrainHeight(body.x, body.z); floors = [];
  assert.equal(nav.visible(), true, 'a resident from indoors remains visible outside');
  assert.ok(body.plan === plan); assert.equal(body.level, 0, 'home population ownership remains stable');
});

test('an indoor resident follows outside and returns to their original upper-floor activity after the floor unloads', () => {
  const plan = [...plans.values()].find(p => p.core.lift && floorOccupants(p, 2).some(o => o.pose === 'stand'));
  const spot = floorOccupants(plan, 2).find(o => o.pose === 'stand'), start = at(plan, spot.x, spot.z, 2);
  // Approach the workstation from open floor: the player is wider than its
  // standing resident and cannot start in the resident's exact place.
  const spatial = world.spatialFor(world.interiorContextAt(start.x, start.y, start.z));
  const approach = Array.from({ length: 16 }, (_, i) => ({ x: start.x + Math.sin(i * Math.PI / 8) * 1.4, y: start.y, z: start.z + Math.cos(i * Math.PI / 8) * 1.4 }))
    .find(p => !spatial.near(p.x, p.z, 2).some(b => !b.supportOnly && overlapsHeight(b, p.y) && circleHitsBox(p.x, p.z, .46, b)));
  assert.ok(approach);
  const player = { ...approach, yaw: 0, velocityY: 0, vx: 0, vz: 0, jumpPhase: '' };
  let floors = [{ plan, level: 2 }];
  const navigation = createResidentNavigation({ world: { ...world, interiors: { floors: () => floors } } });
  const occupants = createOccupants({ scene, assets: { citizen: crowdAsset(['Idle', 'Walk', 'WalkFormal', 'Driving']) }, residentNavigation: navigation });
  const update = () => occupants.update(1 / 60, { player, floors });
  update();
  const avatar = occupants.avatars.find(p => p.occupant?.id === spot.id), body = avatar.occupant;
  const home = { x: body.x, y: body.y, z: body.z, yaw: body.yaw }, life = avatar.life;
  assert.equal(occupants.command(avatar, 'follow', player).ok, true);
  function travel(path) {
    for (let index = 0; index < path.length; index++) {
      const segment = walk(world, player, [path[index]], 60);
      assert.equal(segment.falls, 0); assert.equal(segment.overlaps.length, 0, `first overlap: ${JSON.stringify(segment.overlaps[0])}`);
      assert.ok(segment.trace.length < 720, `player cannot reach waypoint ${index}: ${JSON.stringify(path[index])}`);
      for (const p of segment.trace) { Object.assign(player, p); update(); }
    }
  }
  const lift = plan.core.lift, center = at(plan, (lift.x0 + lift.x1) / 2, (lift.z0 + lift.z1) / 2, 2);
  const path = findPath(world.spatialFor(world.interiorContextAt(player.x, player.y, player.z)), plan, player, center, player.y);
  assert.ok(path); travel(path);
  const from = { x: player.x, y: player.y, z: player.z }, to = { ...from, y: plan.floor0 };
  assert.equal(queueResidentLift(body, from, to, navigation(body)), true);
  Object.assign(player, to); floors = [{ plan, level: 0 }];
  const e = plan.entrances[0], inside = toWorld(plan, e.x - e.nx * 1.2, e.z - e.nz * 1.2);
  const exit = findPath(world.spatialFor(world.interiorContextAt(player.x, player.y, player.z)), plan, player, inside, player.y);
  assert.ok(exit);
  travel([...exit, toWorld(plan, e.x + e.nx * 3, e.z + e.nz * 3)]);
  for (let i = 0; i < 60 * 30; i++) update();
  assert.equal(world.interiorContextAt(body.x, body.y, body.z)?.inside ?? false, false, 'follows out onto the street');
  assert.equal(avatar.root.visible, true); assert.equal(avatar.life, life);
  assert.ok(avatar.occupant === body); assert.ok(body.plan === plan); assert.equal(body.level, 2);
  assert.equal(occupants.command(avatar, 'resume_routine', player).ok, true);
  player.x += 100; floors = [];
  for (let i = 0; i < 60 * 180 && body.residentAction; i++) update();
  assert.equal(body.residentAction, null, 'returns even with every floor mesh unloaded');
  assert.ok(Math.hypot(body.x - home.x, body.z - home.z) < .06);
  assert.ok(Math.abs(body.y - home.y) < .1); assert.equal(body.yaw, home.yaw);
  assert.equal(body.activity, spot.activity);
  occupants.dispose();
});

test('interrupting the return after a lift keeps a usable route to the original home', () => {
  const plan = [...plans.values()].find(p => p.core.lift), lift = plan.core.lift;
  const home = at(plan, (lift.x0 + lift.x1) / 2, (lift.z0 + lift.z1) / 2), upper = { ...home, y: levelY(plan, 2) };
  const body = { ...home, yaw: 0 }, player = { ...home, yaw: 0 }, nav = createResidentNavigation({ world })(body);
  requestResidentAction(body, 'follow', player, nav);
  queueResidentLift(body, home, upper, nav); Object.assign(player, { ...upper, x: upper.x + 2 });
  for (let i = 0; i < 120 && body.y === home.y; i++) stepResidentAction(body, 1 / 60, player, nav);
  requestResidentAction(body, 'resume_routine', player, nav); player.x += 100;
  for (let i = 0; i < 120 && body.y === upper.y; i++) stepResidentAction(body, 1 / 60, player, nav);
  assert.equal(body.y, home.y);
  Object.assign(player, home);
  requestResidentAction(body, 'wait', player, nav);
  requestResidentAction(body, 'resume_routine', player, nav); player.x += 100;
  settle(body, player, nav, 5);
  assert.equal(body.residentAction, null); assert.equal(body.y, home.y);
});
