import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { requestResidentAction, previewResidentAction, stepResidentAction } from '../src/traffic/resident-actions.js';
import { createTraffic } from '../src/traffic/index.js';
import { createOccupants } from '../src/traffic/occupants.js';
import { DECISION_FORMAT, decisionMessages, parseDecision } from '../src/engine/residents/decisions.js';
import { ResidentConversation } from '../src/engine/residents/conversation.js';
import { ResidentModel } from '../src/engine/residents/model.js';
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

test('indoor movement updates the solid body and pinned residents survive a floor unloading', () => {
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
  const before = { x: o.x, collider: o.collider.x };
  assert.equal(occupants.command(p, 'move_aside', at).ok, true);
  for (let i = 0; i < 180; i++) occupants.update(1 / 60, { player: at, floors });
  assert.ok(Math.abs(o.x - before.x) > .7);
  assert.ok(Math.abs(o.x - before.x - (o.collider.x - before.collider)) < 1e-6, 'collision box moves with the actor');
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
    assert.deepEqual(options.responseFormat, DECISION_FORMAT);
    options.onText('{"action":"follow"');
    return '{"action":"follow"}';
  });
  await h.conversation.open(persona, h.actions);
  assert.deepEqual(h.calls, [], 'no action starts while talking');
  assert.equal(h.conversation.snapshot().pendingAction, 'follow');
  assert.equal(h.conversation.finish().ok, true);
  assert.deepEqual(h.calls, ['follow']);
  h.conversation.finish(); assert.deepEqual(h.calls, ['follow'], 'finishing twice cannot repeat the action');
  assert.deepEqual(h.spoken, ['I will follow you.']);
  assert.ok(h.shown.every(({ text }) => !text.includes('"action"')), 'JSON is never displayed or spoken');
  const rejected = conversationHarness(async () => '{"action":"move_aside"}', () => ({ ok: false, reply: 'There is no room here.' }));
  assert.equal(await rejected.conversation.open(persona, rejected.actions), 'There is no room here.');
  assert.equal(rejected.conversation.snapshot().lastAction.ok, false);
});

test('late, interrupted, malformed, no-action and failed generations never change the simulation', async () => {
  let finish;
  const h = conversationHarness(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.conversation.open(persona, h.actions);
  h.conversation.close(); finish('{"action":"follow"}');
  assert.equal(await pending, null); assert.deepEqual(h.calls, []);
  for (const response of ['{"action":"follow"', '{"action":"none"}', new Error('Device lost')]) {
    const next = conversationHarness(async (messages, options) => { if (response instanceof Error) throw response; return options.responseFormat ? response : "Evening."; });
    await next.conversation.open(persona, next.actions); assert.deepEqual(next.calls, []);
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
  await h.conversation.open(persona, h.actions);
  action = 'wait'; await h.conversation.say('Wait here instead.');
  action = 'none'; await h.conversation.say('Thanks.');
  assert.equal(h.conversation.snapshot().pendingAction, 'wait');
  assert.deepEqual(h.calls, []);
  h.conversation.finish(); assert.deepEqual(h.calls, ['wait']);
  action = 'follow'; await h.conversation.open(persona, h.actions);
  h.conversation.close(); h.conversation.finish();
  assert.deepEqual(h.calls, ['wait'], 'reset cancels the queued action');
});

test('finishing revalidates a queued request against the world and cancels in-flight JSON', async () => {
  let release;
  const h = conversationHarness(async () => '{"action":"follow"}');
  await h.conversation.open(persona, h.actions);
  h.actions.execute = () => ({ ok: false, reply: 'That resident has moved on.' });
  assert.equal(h.conversation.finish().ok, false);
  h.conversation.model.generate = () => new Promise(resolve => { release = resolve; });
  const pending = h.conversation.open(persona, h.actions);
  h.conversation.finish(); release('{"action":"wait"}');
  assert.equal(await pending, null); assert.deepEqual(h.calls, []);
});
