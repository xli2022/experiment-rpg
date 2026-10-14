import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { requestResidentAction, previewResidentAction, stepResidentAction, residentActionContext } from '../src/traffic/resident-actions.js';
import { createTraffic } from '../src/traffic/index.js';
import { createOccupants } from '../src/traffic/occupants.js';
import { createResidentNavigation } from '../src/traffic/resident-navigation.js';
import { DECISION_FORMAT, decisionFormat, decisionMessages, parseDecision, preliminaryDecision } from '../src/engine/residents/decisions.js';
import { ResidentConversation } from '../src/engine/residents/conversation.js';
import { ResidentModel } from '../src/engine/residents/model.js';
import { planResidentGuide, residentDestinations } from '../src/traffic/resident-guides.js';
import { residentPersona, walkerResident, occupantResident } from '../src/engine/residents/persona.js';
import { gridPlan, crowdAsset } from './helpers/street-grid.js';
import { orientedBox, circleHitsBox } from '../src/core/physics.js';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { interiorPlan, floorOccupants } from '../src/world/interior-plan.js';
import { toWorld, interiorContext, interiorSpatial } from '../src/world/interior-physics.js';
import { SpatialGrid } from '../src/core/spatial-grid.js';

const person = () => ({ x: 0, y: 0, z: 0, yaw: 0, speed: 0 });
const player = () => ({ x: 0, y: 0, z: -2, yaw: 0 });
const navigation = (boxes = []) => ({ mobile: true, area: 'outside', sample: (from, p) => boxes.some(b => circleHitsBox(p.x, p.z, .32, b)) ? null : { ...p, y: 0 } });
const advance = (body, at, nav, seconds = 2) => { for (let i = 0; i < seconds * 60; i++) stepResidentAction(body, 1 / 60, at, nav); };

test('request checks exclude removed commands and ask for an unspecified destination without capturing discussion', () => {
  for (const line of ['Come here.', 'Could you please face me?', 'Wave at me!', 'Please cheer for me.', 'Lie down.', 'Could you lay down?', 'Lie on the ground.', 'Stretch out here.']) assert.deepEqual(preliminaryDecision(line), { action: 'none' });
  assert.deepEqual(preliminaryDecision('Guide me somewhere.'), { action: 'guide', destination: '' });
  assert.deepEqual(preliminaryDecision('Go somewhere, please.'), { action: 'go_to', destination: '' });
  for (const line of ['Come with me.', 'What happens if I say come here?', 'Tell me a story about waving.', 'Come here and dance.', 'Guide me to the station.']) assert.equal(preliminaryDecision(line), null);
});

test('sit down and get up preserve position, stay put, and stand before other activities', () => {
  const body = person(), at = player(), nav = navigation();
  assert.equal(previewResidentAction(body, 'sit_down', at, nav).ok, true);
  assert.equal(body.residentAction, undefined);
  requestResidentAction(body, 'sit_down', at, nav);
  stepResidentAction(body, 0, at, nav); assert.equal(body.residentAction.sitProgress, 0);
  advance(body, at, nav, .3); assert.ok(body.residentAction.sitProgress > 0 && body.residentAction.sitProgress < 1);
  requestResidentAction(body, 'wait', at, nav); advance(body, at, nav);
  assert.equal(body.residentAction.sitProgress, 1, 'waiting finishes sitting down instead of holding a half pose');
  assert.equal(residentActionContext(body, nav).posture, 'seated');
  assert.equal(requestResidentAction(body, 'sit_down', { ...at, z: -.8 }, nav).ok, true, 'already seated residents can remain seated');
  body.talking = { yaw: 0 }; advance(body, at, nav); assert.equal(body.residentAction.sitProgress, 1);
  body.talking = null;
  requestResidentAction(body, 'get_up', at, nav); advance(body, at, nav);
  assert.equal(body.residentAction.kind, 'wait'); assert.equal(body.residentAction.sitProgress, 0);
  assert.equal(residentActionContext(body, nav).posture, 'standing');
  assert.deepEqual([body.x, body.y, body.z], [0, 0, 0]);
  requestResidentAction(body, 'sit_down', at, nav); advance(body, at, nav);
  requestResidentAction(body, 'follow', at, nav); at.z = -5;
  advance(body, at, nav, .6); assert.equal(body.z, 0, 'never slides along the floor while getting up');
  advance(body, at, nav, 6); assert.ok(body.z < -3); assert.equal(body.residentAction.sitProgress, 0);
});

test('sitting down checks a compact footprint, level floor, people and commit-time obstacles', () => {
  const at = player();
  for (const nav of [
    navigation([orientedBox(0, .7, 1, .1, 0, 2, 0)]),
    { ...navigation(), sample: (from, p) => ({ ...p, y: p.z > .3 ? -.2 : 0 }) },
    { ...navigation(), sample: (from, p) => Math.abs(p.x - .4) < .1 && p.z > .3 ? null : { ...p } },
  ]) {
    const body = person(); assert.equal(requestResidentAction(body, 'sit_down', at, nav).ok, false);
    assert.equal(body.residentAction, undefined);
  }
  assert.equal(requestResidentAction(person(), 'sit_down', { ...at, z: -.9 }, navigation()).ok, false);
  const compact = person(), nearby = { ...at, z: -1.3 }, wallBehind = navigation([orientedBox(0, .95, 1, .1, 0, 2, 0)]);
  assert.equal(requestResidentAction(compact, 'sit_down', nearby, wallBehind).ok, true, 'sitting fits where the previous lying pose could not');
  advance(compact, nearby, wallBehind); assert.equal(compact.residentAction.sitProgress, 1);
  const body = person(); requestResidentAction(body, 'sit_down', at, navigation());
  advance(body, at, navigation([orientedBox(0, .7, 1, .1, 0, 2, 0)]));
  assert.equal(body.residentAction.sitProgress, 0); assert.match(body.residentAction.status, /space/);
});

test('dance starts only on commit, pauses during chat, and stops on a new request', () => {
  const body = person(), at = player(), nav = navigation(), home = { ...body };
  assert.equal(previewResidentAction(body, 'dance', at, nav).ok, true);
  assert.deepEqual(body, home);
  assert.equal(requestResidentAction(body, 'dance', at, nav).ok, true);
  stepResidentAction(body, 0, at, nav); assert.equal(body.residentAction.elapsed, 0);
  body.talking = { yaw: 0 }; advance(body, at, nav); assert.equal(body.residentAction.elapsed, 0);
  body.talking = null; advance(body, at, nav, 20);
  assert.equal(body.residentAction.kind, 'dance'); assert.ok(body.residentAction.elapsed > 19);
  assert.deepEqual([body.x, body.y, body.z], [0, 0, 0], 'dance stays on the same floor spot');
  requestResidentAction(body, 'wait', at, nav); advance(body, at, nav);
  assert.equal(body.residentAction.kind, 'wait');
  requestResidentAction(body, 'resume_routine', at, nav); advance(body, at, nav);
  assert.equal(body.residentAction, null);
});

test('guides use known destinations, lead around walls, wait for the player and can return home', () => {
  const body = person(), at = player(), wall = orientedBox(0, -5, 5, .2, 0, 3, 0), nav = navigation([wall]);
  const destination = { id: 'shop', name: 'KŌJI', type: 'ramen bar', x: 0, y: 0, z: -14 };
  nav.destinations = () => [destination];
  nav.guide = start => ({ destination, route: planResidentGuide(start, destination, nav) });
  const request = { action: 'guide', destination: 'shop' };
  assert.equal(requestResidentAction(body, { ...request, destination: 'invented' }, at, nav).ok, false);
  assert.equal(previewResidentAction(body, request, at, nav).ok, true); assert.equal(body.residentAction, undefined);
  assert.equal(requestResidentAction(body, request, at, nav).ok, true);
  at.z = 20; advance(body, at, nav);
  assert.equal(body.z, 0); assert.match(body.residentAction.status, /catch up/);
  for (let frame = 0; frame < 1800 && body.residentAction.kind === 'guide'; frame++) {
    // Follow the guide without standing in their path.
    at.x = body.x; at.y = body.y; at.z = body.z + 2;
    stepResidentAction(body, 1 / 60, at, nav);
    assert.equal(circleHitsBox(body.x, body.z, .32, wall), false);
  }
  assert.equal(body.residentAction.kind, 'wait'); assert.match(body.residentAction.status, /Arrived at KŌJI/);
  assert.ok(Math.hypot(body.x - destination.x, body.z - destination.z) < .4);
  requestResidentAction(body, 'resume_routine', at, nav); at.x = 30; advance(body, at, nav, 30);
  assert.equal(body.residentAction, null); assert.ok(Math.hypot(body.x, body.z) < .06);
});

test('guide routes reject blocked goals, floor jumps and searches outside their bounded neighborhood', () => {
  const start = person(), goal = { x: 6, y: 0, z: 0 };
  assert.equal(planResidentGuide(start, goal, navigation([orientedBox(6, 0, 4, 4, 0, 3, 0)]), { budget: 200 }), null);
  assert.equal(planResidentGuide(start, { ...goal, y: 4 }, navigation()), null);
  assert.equal(planResidentGuide(start, { ...goal, x: 300 }, navigation()), null);
  assert.equal(planResidentGuide(start, goal, { ...navigation(), sample: () => null }, { budget: 100 }), null);
  const world = { masterPlan: { terrainHeight: () => 0 }, landmarks: [
    { id: 'near', station: true, x: 10, y: 0, z: 0 }, { id: 'far', station: true, x: 500, y: 0, z: 0 },
  ] };
  assert.deepEqual(residentDestinations(world, start).map(p => p.id), ['station:near']);
});

test('go to walks independently, waits at the destination, and stops for a new obstacle', () => {
  const body = person(), at = player(), nav = navigation(), destination = { id: 'station', name: 'Local station', x: 8, y: 0, z: 0 };
  nav.destinations = () => [destination];
  nav.guide = start => ({ destination, route: planResidentGuide(start, destination, nav) });
  assert.equal(requestResidentAction(body, { action: 'go_to', destination: 'station' }, at, nav).ok, true);
  at.x = -100; advance(body, at, nav, 12);
  assert.equal(body.residentAction.kind, 'wait'); assert.match(body.residentAction.status, /Arrived at Local station/);
  assert.ok(Math.abs(body.x - 8) < .35, 'does not wait for the player to follow');
  const blocked = person();
  assert.equal(requestResidentAction(blocked, { action: 'go_to', destination: 'station' }, player(), nav).ok, true);
  const wall = orientedBox(4, 0, .2, 10, 0, 3, 0);
  advance(blocked, at, { ...nav, ...navigation([wall]) }, 12);
  assert.ok(blocked.x < 3.7); assert.match(blocked.residentAction.status, /blocked/);
});

test('destination decisions bind IDs and reject coordinates, missing destinations and dropped actions', () => {
  const context = { destinations: [{ id: 'shop', name: 'KŌJI', type: 'ramen bar', distance: 15 }] };
  assert.deepEqual(JSON.parse(decisionFormat(context).schema).properties.destination.enum, ['', 'shop']);
  for (const action of ['guide', 'go_to']) {
    assert.deepEqual(parseDecision(JSON.stringify({ action, destination: 'shop' })), { action, destination: 'shop' });
    assert.equal(parseDecision(JSON.stringify({ action })), null);
    assert.equal(parseDecision(JSON.stringify({ action, destination: { x: 0, z: 0 } })), null);
    assert.equal(parseDecision(JSON.stringify({ action, destination: 'shop', x: 5 })), null);
  }
  for (const action of ['wave', 'cheer', 'come_here', 'face_me', 'lie_down']) assert.equal(parseDecision(JSON.stringify({ action })), null);
  assert.deepEqual(parseDecision('{"action":"sit_down","destination":""}'), { action: 'sit_down' });
  assert.deepEqual(parseDecision('{"action":"dance"}'), { action: 'dance' });
});

test('follow, wait, move aside and resume are physical, interruptible behaviors', () => {
  const body = person(), at = player(), nav = navigation();
  assert.equal(requestResidentAction(body, 'follow', at, nav).ok, true);
  at.z = -8; advance(body, at, nav, 5);
  assert.ok(Math.abs(body.z - (-8 + 1.65)) < .1, 'walks after the player and leaves personal space');
  assert.equal(requestResidentAction(body, 'wait', at, nav).ok, true);
  const waiting = { x: body.x, z: body.z };
  at.z = -18; advance(body, at, nav, 10);
  assert.deepEqual({ x: body.x, z: body.z }, waiting, 'wait means stay until another request');
  at.z = body.z - 1.5;
  assert.equal(requestResidentAction(body, 'move_aside', at, nav).ok, true);
  const before = { x: body.x, z: body.z };
  advance(body, at, nav, 3);
  assert.ok(Math.abs(body.x - before.x) > .7, 'steps sideways');
  assert.equal(body.residentAction.kind, 'wait');
  at.x = body.x; at.z = body.z - 1.5;
  assert.equal(requestResidentAction(body, 'resume_routine', at, nav).ok, true);
  at.x = 20; advance(body, at, nav, 15);
  assert.equal(body.residentAction, null, 'returns all the way to the original routine');
  assert.ok(Math.hypot(body.x, body.z) < .06);
});

test('requests respect solid obstacles, unsupported ground, scope, and distance', () => {
  const body = person(), at = player(), wall = orientedBox(0, -4, 10, .1, 0, 3, 0), nav = navigation([wall]);
  requestResidentAction(body, 'follow', at, nav); at.z = -8;
  advance(body, at, nav, 5);
  assert.ok(body.z > -3.7, 'never tunnels through the thin wall');
  assert.match(body.residentAction.status, /blocked/);
  const ledge = { ...navigation(), sample: (from, p) => ({ ...p, y: p.z < -3 ? -8 : 0 }) };
  const b = person(); requestResidentAction(b, 'follow', player(), ledge); advance(b, at, ledge, 5);
  assert.ok(b.z >= -3 && b.y === 0, 'does not walk off a ledge');
  const trapped = navigation([orientedBox(0, 0, 3, 3, 0, 3, 0)]);
  assert.equal(requestResidentAction(person(), 'move_aside', player(), trapped).ok, false);
  assert.equal(requestResidentAction(person(), 'follow', player(), { ...navigation(), mobile: false }).ok, false);
  assert.equal(requestResidentAction(person(), 'wait', { ...at, z: -30 }, nav).ok, false);
  assert.equal(requestResidentAction(person(), 'wait', player(), { ...nav, crossing: true }).ok, false);
  assert.equal(requestResidentAction(person(), 'teleport', player(), nav).ok, false);
});

test('followers take the recorded way round a corner and can return round it', () => {
  const body = person(), at = player(), nav = navigation([orientedBox(0, -4, 4, .2, 0, 3, 0)]);
  requestResidentAction(body, 'follow', at, nav);
  // The player walks round the east end of a wall.
  for (const destination of [{ x: 3, z: -2 }, { x: 3, z: -6 }, { x: 0, z: -7 }]) {
    const from = { ...at };
    for (let i = 1; i <= 180; i++) {
      Object.assign(at, { x: from.x + (destination.x - from.x) * i / 180, z: from.z + (destination.z - from.z) * i / 180 });
      stepResidentAction(body, 1 / 60, at, nav);
      assert.ok(!circleHitsBox(body.x, body.z, .32, orientedBox(0, -4, 4, .2, 0, 3, 0)));
    }
  }
  advance(body, at, nav, 3);
  assert.ok(body.z < -5, 'follows around the wall');
  at.x = body.x; at.z = body.z - 1.5;
  requestResidentAction(body, 'resume_routine', at, nav); at.x = 15;
  advance(body, at, nav, 20);
  assert.equal(body.residentAction, null);
});

test('followers walk round one another and round people standing in the way instead of waiting for good', () => {
  // The real navigation, in which nobody steps closer to anyone within 0.7 m.
  const crowd = (followers, bystanders = []) => {
    const bodies = followers.map(([x, z]) => ({ ...person(), x, z })), still = bystanders.map(([x, z]) => ({ ...person(), x, z }));
    const nav = createResidentNavigation({ world: { masterPlan: { terrainHeight: () => 0 }, spatial: { near: () => [] } }, people: () => [...bodies, ...still] });
    const at = player();
    let closest = Infinity;
    for (const body of bodies) assert.equal(requestResidentAction(body, 'follow', at, nav(body)).ok, true);
    const tick = () => {
      for (const body of bodies) stepResidentAction(body, 1 / 60, at, nav(body));
      for (const body of bodies) for (const other of [...bodies, ...still]) if (other !== body) closest = Math.min(closest, Math.hypot(body.x - other.x, body.z - other.z));
    };
    return {
      bodies, get closest() { return closest; },
      walkTo(x, z) {
        const from = { ...at }, frames = Math.ceil(Math.hypot(x - from.x, z - from.z) / 1.6 * 60);
        for (let i = 1; i <= frames; i++) { at.x = from.x + (x - from.x) * i / frames; at.z = from.z + (z - from.z) * i / frames; tick(); }
      },
      wait(seconds) { for (let i = 0; i < seconds * 60; i++) tick(); },
      within: reach => bodies.every(b => Math.hypot(b.x - at.x, b.z - at.z) < reach),
    };
  };
  // Side by side, both make for the same footsteps and would each be the one stepping closer.
  const pair = crowd([[-.375, 0], [.375, 0]]);
  pair.walkTo(0, -14); pair.wait(6);
  assert.ok(pair.within(3), 'neither waits for the other');
  pair.walkTo(0, -4); pair.walkTo(0, 10); pair.wait(6);
  assert.ok(pair.within(3), 'they part when the player walks back between them');
  // The player walks through a bystander, then through a couple chatting too close together to pass between.
  const past = crowd([[0, 0], [.75, .4]], [[.3, -6], [-.2, -10], [.5, -10.2]]);
  past.walkTo(0, -16); past.wait(6);
  assert.ok(past.within(3), 'they go round people the player walked through');
  // A group following round bends settles once the player stops, rather than circling for a gap.
  const group = crowd([[-.8, 0], [0, 0], [.8, 0], [0, 1]]);
  group.walkTo(3, -6); group.walkTo(-3, -12); group.walkTo(3, -18); group.wait(8);
  assert.ok(group.within(4));
  const settled = group.bodies.map(b => [b.x, b.z]); group.wait(3);
  assert.deepEqual(group.bodies.map(b => [b.x, b.z]), settled, 'no circling once the player stops');
  for (const c of [pair, past, group]) assert.ok(c.closest > .69, 'nobody walks into anyone');
});

test('followers jog to keep up with a jogging player and walk again once they catch up', () => {
  const body = person(), at = player(), nav = navigation();
  assert.equal(requestResidentAction(body, 'follow', at, nav).ok, true);
  // Six seconds of the player's jog (5.8 m/s) would leave a walking follower 18 m behind.
  let farthest = 0;
  for (let i = 0; i < 6 * 60; i++) { at.z -= 5.8 / 60; stepResidentAction(body, 1 / 60, at, nav); farthest = Math.max(farthest, Math.hypot(body.x - at.x, body.z - at.z)); }
  assert.ok(farthest < 7, `keeps within a few metres (${farthest.toFixed(1)} m)`);
  assert.equal(body.residentAction.jog, true);
  for (let i = 0; i < 4 * 60; i++) { at.z -= 2.4 / 60; stepResidentAction(body, 1 / 60, at, nav); }
  assert.equal(body.residentAction.jog, false, 'walks beside a walking player');
  advance(body, at, nav, 3);
  assert.ok(Math.abs(Math.hypot(body.x - at.x, body.z - at.z) - 1.65) < .1, 'stops at the usual distance');
});

test('an indoor follower changes to its jog while catching up, and back to its walk', () => {
  const metropolis = new VerticalMetropolis();
  const plan = metropolis.area(0, 0, 400, 400).flatMap(b => b.buildings).map(interiorPlan).filter(Boolean).find(p => floorOccupants(p, 0).some(o => o.pose === 'stand'));
  const spot = floorOccupants(plan, 0).find(o => o.pose === 'stand'), pos = toWorld(plan, spot.x, spot.z);
  const at = { ...pos, y: spot.y, yaw: 0, z: pos.z - 1.5 };
  const nav = { ...navigation(), area: 'this floor', sample: (from, p) => ({ ...p, y: spot.y }) };
  const occupants = createOccupants({ scene: new THREE.Scene(), assets: { citizen: crowdAsset(['Idle', 'Walk', 'WalkFormal', 'Jog', 'Driving']) }, residentNavigation: () => nav });
  const floors = [{ plan, level: 0 }];
  occupants.update(0, { player: at, floors });
  const p = occupants.avatars.find(p => p.occupant?.id === spot.id), walk = p.avatar.gait;
  assert.equal(occupants.command(p, 'follow', at).ok, true);
  for (let i = 0; i < 2 * 60; i++) { at.z -= 5.8 / 60; occupants.update(1 / 60, { player: at, floors }); }
  assert.equal(p.avatar.gait, 'Jog');
  for (let i = 0; i < 4 * 60; i++) occupants.update(1 / 60, { player: at, floors });
  assert.equal(p.avatar.gait, walk);
  occupants.dispose();
});

test('paused time never moves a resident, and followers stop for cars and lost players', () => {
  const body = person(), at = player(), nav = navigation();
  requestResidentAction(body, 'follow', at, nav); at.z = -9;
  stepResidentAction(body, 0, at, nav); assert.equal(body.z, 0);
  advance(body, at, { ...nav, onFoot: false }, 3); assert.equal(body.z, 0);
  advance(body, { ...at, z: -100 }, nav, 3); assert.equal(body.z, 0);
  advance(body, { ...at, y: 4 }, nav, 3); assert.equal(body.z, 0);
  advance(body, at, nav, 4); assert.ok(body.z < -5);
});

test('street commands bind to a living resident, survive population recycling and release on a scene cut', () => {
  const traffic = createTraffic({ scene: new THREE.Scene(), world: { masterPlan: gridPlan(), spatial: null }, assets: { citizen: crowdAsset() } });
  const at = { x: 30, y: 0, z: 30, yaw: 0 };
  traffic.update(0, { player: at });
  const p = traffic.pedestrians.walkers.find(p => !p.group && !p.leader && p.edge.kind === 'sidewalk');
  const resident = walkerResident(p), approach = { x: p.x, y: p.y, z: p.z - 1.5, yaw: 0 };
  assert.equal(traffic.commandResident(resident.handle, 'wait', approach).ok, true);
  for (let i = 0; i < 30; i++) traffic.update(.1, { player: { ...at, x: 1000, z: 1000 }, range: 20 });
  assert.equal(p.residentAction.kind, 'wait', 'waiting residents are not recycled out of sight');
  assert.equal(traffic.commandResident({ ...resident.handle, life: p.life - 1 }, 'follow', approach).ok, false);
  assert.equal(traffic.commandResident(resident.handle, 'resume_routine', approach).ok, true);
  traffic.update(.1, { player: approach });
  assert.equal(p.residentAction, null); assert.equal(p.mode, 'walk');
  traffic.reset();
  assert.equal(traffic.commandResident(resident.handle, 'follow', approach).ok, false, 'stale decisions cannot address a reused avatar');
  traffic.dispose();
});

test('indoor movement moves the resident and pinned residents survive a floor unloading', () => {
  const metropolis = new VerticalMetropolis();
  const plans = metropolis.area(0, 0, 400, 400).flatMap(b => b.buildings).map(interiorPlan).filter(Boolean);
  const plan = plans.find(p => floorOccupants(p, 0).some(o => o.pose === 'stand'));
  assert.ok(plan);
  const spot = floorOccupants(plan, 0).find(o => o.pose === 'stand'), pos = toWorld(plan, spot.x, spot.z);
  const at = { ...pos, y: spot.y, yaw: 0, z: pos.z - 1.5 };
  const nav = { ...navigation(), area: 'this floor', sample: (from, p) => ({ ...p, y: spot.y }) };
  const occupants = createOccupants({ scene: new THREE.Scene(), assets: { citizen: crowdAsset(['Idle', 'Walk', 'WalkFormal', 'Driving']) }, residentNavigation: () => nav });
  const floors = [{ plan, level: 0 }];
  occupants.update(0, { player: at, floors });
  const p = occupants.avatars.find(p => p.occupant?.id === spot.id), o = p.occupant;
  const before = { x: o.x };
  assert.equal(occupants.command(p, 'move_aside', at).ok, true);
  for (let i = 0; i < 180; i++) occupants.update(1 / 60, { player: at, floors });
  assert.ok(Math.abs(o.x - before.x) > .7);
  occupants.update(1, { player: at, floors: [] });
  assert.equal(p.occupant, o); assert.equal(p.root.visible, false, 'no resident floating on an unloaded floor');
  occupants.update(1, { player: at, floors });
  assert.equal(p.occupant, o); assert.equal(p.root.visible, true); assert.equal(o.residentAction.kind, 'wait');
  assert.equal(occupantResident(p).handle.life, p.life);
  occupants.reset(); assert.equal(p.occupant, null);
  occupants.dispose();
});

test('indoor commands use the real floor geometry and the production navigation adapter', () => {
  const metropolis = new VerticalMetropolis();
  const plans = metropolis.area(0, 0, 400, 400).flatMap(b => b.buildings).map(interiorPlan).filter(Boolean);
  const plan = plans.find(p => floorOccupants(p, 0).filter(o => o.pose === 'stand').length >= 3);
  assert.ok(plan);
  const spatial = Object.assign(new SpatialGrid([], 48), { attach: () => () => {} }), world = { masterPlan: gridPlan(), spatial,
    interiorContextAt: (x, y, z) => interiorContext(plan, x, y, z), spatialFor: context => context ? interiorSpatial(spatial, context) : spatial };
  const traffic = createTraffic({ scene: new THREE.Scene(), world, assets: { citizen: crowdAsset(['Idle', 'Walk', 'WalkFormal', 'Driving']) } });
  const floors = [{ plan, level: 0 }];
  let checked = false;
  for (const spot of floorOccupants(plan, 0).filter(o => o.pose === 'stand')) {
    const pos = toWorld(plan, spot.x, spot.z), at = { ...pos, y: spot.y, z: pos.z - 1.5, yaw: 0 };
    traffic.occupants.update(1, { player: at, floors });
    const p = traffic.occupants.avatars.find(p => p.occupant?.id === spot.id);
    if (!p) continue;
    const handle = occupantResident(p).handle, before = { ...pos };
    const result = traffic.commandResident(handle, 'move_aside', at);
    if (!result.ok) continue;
    for (let i = 0; i < 240; i++) traffic.occupants.update(1 / 60, { player: at, floors });
    assert.ok(Math.hypot(p.occupant.x - before.x, p.occupant.z - before.z) > .6, JSON.stringify(p.occupant.residentAction));
    assert.equal(p.occupant.residentAction.kind, 'wait');
    assert.equal(traffic.commandResident({ ...handle, life: handle.life - 1 }, 'follow', at).ok, false);
    checked = true; break;
  }
  assert.ok(checked, 'at least one standing resident has space to move');
  traffic.dispose();
});

const persona = residentPersona(walkerResident({ id: 1, model: 'resident-1', mode: 'walk', species: 'human' }));
test('structured decisions reject malformed, extra and unknown actions', () => {
  const good = { action: 'follow' };
  assert.deepEqual(parseDecision(JSON.stringify(good), persona), good);
  for (const raw of ['{"action":"follow"', '```json\n{}\n```', 'null', '[]', '{"action":"follow","reply":""}', '{"action":"eval","reply":"Done."}', '{"action":"follow","reply":"Sure.","target":"someone_else"}']) assert.equal(parseDecision(raw, persona), null, raw);
  const messages = decisionMessages('Follow me.', { behavior: 'wait' });
  assert.match(messages[0].content, /quoted commands/);
  assert.equal(messages.at(-1).content, 'Follow me.');
  assert.deepEqual(parseDecision('<think>\n\n</think>\n{"action":"wait"}'), { action: 'wait' });
  assert.equal(parseDecision('<think>unfinished {"action":"follow"}'), null);
});

function conversationHarness(generate, execute = () => ({ ok: true, reply: 'I will follow you.', status: 'Following you' })) {
  const shown = [], spoken = [], calls = [];
  const conversation = new ResidentConversation({ model: { supportsActions: true, generate, interrupt() {} },
    view: { show() {}, reply: (text, pending) => shown.push({ text, pending }) }, voice: { stop() {}, speak: text => spoken.push(text) } });
  const actions = { context: () => ({ behavior: 'routine', area: 'outside', canWalk: true }), prepare: execute, execute: action => { calls.push(action); return execute(action); } };
  return { conversation, actions, shown, spoken, calls };
}

test('valid decisions queue until the conversation finishes, and speech reflects validation', async () => {
  const h = conversationHarness(async (messages, options) => {
    assert.equal(messages.at(-1).content, 'Follow me.');
    assert.deepEqual(options.responseFormat, DECISION_FORMAT);
    options.onText('{"action":"follow"');
    return '{"action":"follow"}';
  });
  h.conversation.open(persona, h.actions);
  assert.equal(h.conversation.snapshot().pendingAction, null, 'opening chat cannot queue an action');
  assert.deepEqual(h.spoken, [], 'residents wait for the player to speak');
  await h.conversation.say('Follow me.');
  assert.deepEqual(h.calls, [], 'no action starts while talking');
  assert.equal(h.conversation.snapshot().pendingAction, 'follow');
  assert.equal(h.conversation.finish().ok, true);
  assert.deepEqual(h.calls, ['follow']);
  h.conversation.finish(); assert.deepEqual(h.calls, ['follow'], 'finishing twice cannot repeat the action');
  assert.deepEqual(h.spoken, ['I will follow you.']);
  assert.ok(h.shown.every(({ text }) => !text.includes('"action"')), 'JSON is never displayed or spoken');
  const rejected = conversationHarness(async () => '{"action":"move_aside"}', () => ({ ok: false, reply: 'There is no room here.' }));
  rejected.conversation.open(persona, rejected.actions);
  assert.equal(await rejected.conversation.say('Please move aside.'), 'There is no room here.');
  assert.equal(rejected.conversation.snapshot().lastAction.ok, false);
});

test('sit down queues through dialogue, starts after Bye, and get up restores standing', async () => {
  const body = person(), at = player(), nav = navigation();
  const h = conversationHarness(async messages => JSON.stringify({ action: messages.at(-1).content === 'Sit down.' ? 'sit_down' : 'get_up', destination: '' }));
  h.actions.context = () => residentActionContext(body, nav);
  h.actions.prepare = action => previewResidentAction(body, action, at, nav);
  h.actions.execute = action => requestResidentAction(body, action, at, nav);
  h.conversation.open(persona, h.actions);
  assert.equal(await h.conversation.say('Sit down.'), 'All right. I will sit down here.');
  assert.equal(h.conversation.snapshot().pendingAction, 'sit_down');
  assert.equal(body.residentAction, undefined);
  assert.equal(h.conversation.finish().ok, true); advance(body, at, nav);
  assert.equal(body.residentAction.sitProgress, 1);
  h.conversation.open(persona, h.actions);
  await h.conversation.say('Get up.');
  assert.equal(body.residentAction.sitProgress, 1);
  assert.equal(h.conversation.finish().ok, true); advance(body, at, nav);
  assert.equal(residentActionContext(body, nav).posture, 'standing');
});

test('destination arguments survive conversation queuing and are revalidated on finish', async () => {
  for (const action of ['guide', 'go_to']) {
    const request = { action, destination: 'station' }, checked = [];
    const h = conversationHarness(async (messages, options) => {
      assert.deepEqual(JSON.parse(options.responseFormat.schema).properties.destination.enum, ['', 'station']);
      return JSON.stringify(request);
    }, command => { checked.push(command); return { ok: true, reply: 'Sure.', status: 'Going to the station' }; });
    h.actions.context = () => ({ destinations: [{ id: 'station', name: 'Station', type: 'station', distance: 20 }] });
    h.conversation.open(persona, h.actions); await h.conversation.say('To the station, please.');
    assert.deepEqual(h.calls, []); assert.deepEqual(h.conversation.snapshot().pendingAction, request);
    assert.deepEqual(checked, [request]);
    h.conversation.finish(); assert.deepEqual(h.calls, [request]); assert.deepEqual(checked, [request, request]);
  }
});

test('removed commands and missing destinations cannot replace a queued activity', async () => {
  const formats = [];
  const h = conversationHarness(async (messages, options) => {
    formats.push(!!options.responseFormat);
    return options.responseFormat ? '{"action":"dance","destination":""}' : 'Evening.';
  }, command => typeof command === 'object' && !command.destination ? { ok: false, reply: 'Which place?' } : { ok: true, reply: 'Sure.' });
  h.conversation.open(persona, h.actions);
  await h.conversation.say('Dance.'); await h.conversation.say('Come here.');
  assert.deepEqual(formats, [true, false], 'removed requests become dialogue without asking the model to select an activity');
  assert.equal(await h.conversation.say('Guide me somewhere.'), 'Which place?');
  assert.equal(h.conversation.snapshot().pendingAction, 'dance');
  assert.deepEqual(h.calls, []); h.conversation.finish(); assert.deepEqual(h.calls, ['dance']);
});

test('late, interrupted, malformed, no-action and failed generations never change the simulation', async () => {
  let finish;
  const h = conversationHarness(() => new Promise(resolve => { finish = resolve; }));
  h.conversation.open(persona, h.actions);
  const pending = h.conversation.say('Follow me.');
  h.conversation.close(); finish('{"action":"follow"}');
  assert.equal(await pending, null); assert.deepEqual(h.calls, []);
  for (const response of ['{"action":"follow"', '{"action":"none"}', new Error('Device lost')]) {
    const next = conversationHarness(async (messages, options) => { if (response instanceof Error) throw response; return options.responseFormat ? response : "Evening."; });
    next.conversation.open(persona, next.actions);
    await next.conversation.say('Hello.'); assert.deepEqual(next.calls, []);
  }
});

test('the schema reaches the Qwen inference backend', async () => {
  const formats = [];
  const model = new ResidentModel({ gpu: { requestAdapter: async () => ({ info: {} }) }, backend: async () => ({
    async generate(messages, onText, format) { formats.push(format); onText('{"action":"wait"}'); }, async unload() {},
  }) });
  await model.setEnabled(true); assert.equal(model.supportsActions, true);
  await model.generate([], { responseFormat: DECISION_FORMAT }); assert.deepEqual(formats, [DECISION_FORMAT]);
  model.dispose();
});


test('preparing an action is pure, and an ongoing action holds while its resident listens', () => {
  const body = person(), at = player(), nav = navigation();
  assert.equal(previewResidentAction(body, 'follow', at, nav).ok, true);
  assert.equal(body.residentAction, undefined);
  requestResidentAction(body, 'follow', at, nav);
  const previous = JSON.stringify(body);
  assert.equal(previewResidentAction(body, 'resume_routine', at, nav).ok, true);
  assert.equal(JSON.stringify(body), previous);
  body.talking = { yaw: 0 }; at.z = -8;
  advance(body, at, nav, 5); assert.equal(body.z, 0);
  body.talking = null; advance(body, at, nav, 5); assert.ok(body.z < -5);
});

test('talking holds one resident while the city advances, and ending releases them', () => {
  const traffic = createTraffic({ scene: new THREE.Scene(), world: { masterPlan: gridPlan(), spatial: null }, assets: { citizen: crowdAsset() } });
  const at = { x: 30, y: 0, z: 30, yaw: 0 };
  traffic.update(0, { player: at });
  const p = traffic.pedestrians.walkers.find(p => !p.group && !p.leader && p.edge.kind === 'sidewalk');
  const handle = walkerResident(p).handle, start = { x: p.x, z: p.z }, clock = traffic.time;
  const others = traffic.pedestrians.walkers.filter(o => o !== p).map(o => ({ p: o, x: o.x, z: o.z }));
  assert.equal(traffic.talkToResident(handle, true), true);
  for (let i = 0; i < 120; i++) traffic.update(1 / 60, { player: at });
  assert.deepEqual({ x: p.x, z: p.z }, start);
  assert.ok(traffic.time > clock + 1);
  assert.ok(others.some(o => Math.hypot(o.p.x - o.x, o.p.z - o.z) > .5));
  assert.equal(traffic.talkToResident(handle, false), true);
  assert.equal(p.talking, null);
  traffic.reset(); assert.equal(traffic.residentPosition(handle), null);
  assert.equal(traffic.talkToResident(handle, true), false);
  traffic.dispose();
});

test('latest accepted action replaces the queue, small talk preserves it, and resets cancel it', async () => {
  let action = 'follow';
  const h = conversationHarness(async (messages, options) => options.responseFormat ? JSON.stringify({ action }) : 'Evening.');
  h.conversation.open(persona, h.actions);
  await h.conversation.say('Follow me.');
  action = 'wait'; await h.conversation.say('Wait here instead.');
  action = 'none'; await h.conversation.say('Thanks.');
  assert.equal(h.conversation.snapshot().pendingAction, 'wait');
  assert.deepEqual(h.calls, []);
  h.conversation.finish(); assert.deepEqual(h.calls, ['wait']);
  action = 'follow'; h.conversation.open(persona, h.actions);
  await h.conversation.say('Follow me.');
  h.conversation.close(); h.conversation.finish();
  assert.deepEqual(h.calls, ['wait'], 'reset cancels the queued action');
});

test('finishing revalidates a queued request against the world and cancels in-flight JSON', async () => {
  let release;
  const h = conversationHarness(async () => '{"action":"follow"}');
  h.conversation.open(persona, h.actions);
  await h.conversation.say('Follow me.');
  h.actions.execute = () => ({ ok: false, reply: 'That resident has moved on.' });
  assert.equal(h.conversation.finish().ok, false);
  h.conversation.model.generate = () => new Promise(resolve => { release = resolve; });
  h.conversation.open(persona, h.actions);
  const pending = h.conversation.say('Wait here.');
  h.conversation.finish(); release('{"action":"wait"}');
  assert.equal(await pending, null); assert.deepEqual(h.calls, []);
});
