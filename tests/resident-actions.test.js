import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { requestResidentAction, previewResidentAction, stepResidentAction, residentActionContext } from '../src/traffic/resident-actions.js';
import { createTraffic } from '../src/traffic/index.js';
import { createOccupants } from '../src/traffic/occupants.js';
import { createResidentNavigation } from '../src/traffic/resident-navigation.js';
import { DECISION_FORMAT, decisionFormat, decisionMessages, parseDecision, planSummary, preliminaryDecision, readRequest } from '../src/engine/residents/decisions.js';
import { residentPlan, describePlan } from '../src/traffic/resident-plans.js';
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

test('exact commands skip the model, trips without a place ask which, and everything else is the model\'s', () => {
  const one = (action, extra = {}) => ({ steps: [{ action, ...extra }], repeat: false });
  for (const [line, action] of [['Follow me.', 'follow'], ['Could you please come with me?', 'follow'], ['Wait here.', 'wait'], ["Don't follow me.", 'wait'],
    ['Stay seated.', 'wait'], ['Dance!', 'dance'], ['Take a seat, please.', 'sit_down'], ['Stop sitting down.', 'get_up'], ['Carry on.', 'resume_routine']]) assert.deepEqual(preliminaryDecision(line), one(action), line);
  assert.deepEqual(preliminaryDecision('Guide me somewhere.'), one('guide', { destination: '' }));
  assert.deepEqual(preliminaryDecision('Go somewhere, please.'), one('go_to', { destination: '' }));
  for (const line of ['Come here.', 'Wave at me!', 'Lie down.', 'What happens if I say follow me?', 'Tell me a story about waving.', 'Guide me to the station.', 'Follow me until we reach the station.']) assert.equal(preliminaryDecision(line), null, line);
});

test('the game reads parts, durations, conditions and repeats itself, so chained exact commands need no model', () => {
  assert.deepEqual(preliminaryDecision('Wait here for 10 seconds, then follow me.'), { steps: [{ action: 'wait', seconds: 10 }, { action: 'follow' }], repeat: false });
  assert.deepEqual(preliminaryDecision('Sit down for two minutes, and then get up.'), { steps: [{ action: 'sit_down', seconds: 120 }, { action: 'get_up' }], repeat: false });
  assert.deepEqual(preliminaryDecision('Dance until I leave.'), { steps: [{ action: 'dance', until: 'player_leaves' }], repeat: false });
  assert.deepEqual(preliminaryDecision("Please wait here till I'm back."), { steps: [{ action: 'wait', until: 'player_returns' }], repeat: false });
  assert.deepEqual(preliminaryDecision('Dance for 45 seconds.'), { steps: [{ action: 'dance', seconds: 30 }], repeat: false }, 'the nearest duration on offer');
  assert.deepEqual(preliminaryDecision('Stop following me and wait.'), { steps: [{ action: 'wait' }], repeat: false }, 'the same step twice is one');
  const trip = readRequest('Go to the station and wait there until I come back.');
  assert.deepEqual(trip.parts.map(({ text, action, until }) => [text, action, until]), [['Go to the station', null, ''], ['wait there until I come back', 'wait', 'player_returns']]);
  assert.equal(JSON.parse(decisionFormat({}, trip).schema).properties.steps.minItems, 2, 'the model writes exactly one step per part');
  assert.match(decisionMessages('Go to the station and wait there until I come back.', {}, trip)[0].content, /2 parts.*1\) "Go to the station"; 2\) "wait there until I come back"/);
  // The model names the trip; the game keeps the second part's command and condition.
  assert.deepEqual(parseDecision('{"steps":[{"action":"go_to","destination":"station"},{"action":"dance","until":"player_leaves","seconds":30}]}', trip),
    { steps: [{ action: 'go_to', destination: 'station' }, { action: 'wait', until: 'player_returns' }], repeat: false });
  const patrol = readRequest('Walk back and forth between the station and the bar.');
  assert.equal(patrol.repeat, true); assert.equal(patrol.parts.length, 1);
  assert.deepEqual(parseDecision('{"steps":[{"action":"go_to","destination":"station"},{"action":"go_to","destination":"bar"},{"action":"go_to","destination":"station"},{"action":"go_to","destination":"bar"}]}', patrol),
    { steps: [{ action: 'go_to', destination: 'station' }, { action: 'go_to', destination: 'bar' }], repeat: true }, 'a pattern written out twice is one repeating pass');
  assert.equal(readRequest('Back and forth: follow me.').repeat, true);
  assert.equal(readRequest('Keep me company.').repeat, false);
  assert.deepEqual(readRequest('Go to the station, wait until I come back, then carry on.').parts.map(p => p.action), [null, 'wait', 'resume_routine'], 'a comma before another activity starts a part');
});

test('plans parse into steps, drop none steps, and keep a place only where a step uses one', () => {
  const step = (action, destination = '', until = '', seconds = 0) => ({ action, destination, until, seconds });
  const parse = (steps, repeat = false) => parseDecision(JSON.stringify({ steps, repeat }));
  assert.deepEqual(parse([step('go_to', 'shop'), step('wait', 'shop', 'player_returns'), step('none'), step('resume_routine')]),
    { steps: [{ action: 'go_to', destination: 'shop' }, { action: 'wait', until: 'player_returns' }, { action: 'resume_routine' }], repeat: false });
  assert.deepEqual(parse([step('follow', 'shop')]), { steps: [{ action: 'follow' }], repeat: false }, 'a small model\'s stray place is ignored');
  assert.deepEqual(parse([step('follow', 'shop', 'place')]), { steps: [{ action: 'follow', destination: 'shop', until: 'place' }], repeat: false });
  assert.deepEqual(parse([step('dance', '', 'place', 30)], true), { steps: [{ action: 'dance', seconds: 30 }], repeat: true });
  assert.deepEqual(parse([step('none')], true), { steps: [], repeat: false }, 'no request');
  for (const bad of [[], Array(5).fill(step('wait')), [step('wait', '', 'later')], [step('wait', '', '', 7)], [{ ...step('wait'), reply: 'Sure.' }], [step('wave')]]) assert.equal(parse(bad), null);
  assert.deepEqual(parseDecision('{"steps":[{"action":"wait"}]}'), { steps: [{ action: 'wait' }], repeat: false }, 'a step names only what was asked for');
  assert.equal(parseDecision('{"steps":[{"action":"go_to"}]}'), null, 'a trip always names its place, even if empty');
  const schema = JSON.parse(decisionFormat({ destinations: [{ id: 'shop', name: 'KŌJI', type: 'ramen bar', distance: 15 }] }).schema);
  assert.deepEqual(schema.properties.steps.items.properties.destination.enum, ['', 'shop']);
  assert.equal(schema.properties.steps.maxItems, 4);
  assert.equal(planSummary({ steps: [{ action: 'go_to' }, { action: 'go_to' }], repeat: true }), 'go_to, go_to (repeating)');
});

test('open-ended steps that are not last get an end, and plans are described step by step', () => {
  const plan = residentPlan({ steps: [{ action: 'wait' }, { action: 'follow' }, { action: 'dance' }, { action: 'resume_routine' }] });
  assert.deepEqual(plan.steps.map(({ until, seconds }) => ({ until, seconds })), [{ until: 'player_returns', seconds: 0 }, { until: 'player_stops', seconds: 0 }, { until: '', seconds: 30 }, { until: '', seconds: 0 }]);
  assert.equal(describePlan(plan), 'Sure. I will wait here until you come back, follow you until you stop, dance for 30 seconds, then get back to what I was doing.');
  assert.deepEqual(residentPlan({ steps: [{ action: 'dance' }], repeat: true }).steps[0].seconds, 30, 'a repeated step always ends');
  assert.equal(residentPlan({ steps: [{ action: 'teleport' }] }), null);
  assert.equal(residentPlan('dance').steps[0].seconds, 0, 'a last step may stay open-ended');
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
  assert.deepEqual(JSON.parse(decisionFormat(context).schema).properties.steps.items.properties.destination.enum, ['', 'shop']);
  const one = step => ({ steps: [step], repeat: false });
  for (const action of ['guide', 'go_to']) {
    assert.deepEqual(parseDecision(JSON.stringify({ action, destination: 'shop' })), one({ action, destination: 'shop' }));
    assert.equal(parseDecision(JSON.stringify({ action })), null);
    assert.equal(parseDecision(JSON.stringify({ action, destination: { x: 0, z: 0 } })), null);
    assert.equal(parseDecision(JSON.stringify({ action, destination: 'shop', x: 5 })), null);
  }
  for (const action of ['wave', 'move_aside', 'teleport']) assert.equal(parseDecision(JSON.stringify({ action })), null, 'not an action residents have');
  assert.deepEqual(parseDecision('{"action":"sit_down","destination":""}'), one({ action: 'sit_down' }));
  assert.deepEqual(parseDecision('{"action":"dance"}'), one({ action: 'dance' }));
});

test('follow, wait and resume are physical, interruptible behaviors', () => {
  const body = person(), at = player(), nav = navigation();
  assert.equal(requestResidentAction(body, 'follow', at, nav).ok, true);
  at.z = -8; advance(body, at, nav, 5);
  assert.ok(Math.abs(body.z - (-8 + 1.65)) < .1, 'walks after the player and leaves personal space');
  assert.equal(requestResidentAction(body, 'wait', at, nav).ok, true);
  const waiting = { x: body.x, z: body.z };
  at.z = -18; advance(body, at, nav, 10);
  assert.deepEqual({ x: body.x, z: body.z }, waiting, 'wait means stay until another request');
  at.x = body.x; at.z = body.z - 1.5;
  assert.equal(requestResidentAction(body, 'resume_routine', at, nav).ok, true);
  at.x = 20; advance(body, at, nav, 15);
  assert.equal(body.residentAction, null, 'returns all the way to the original routine');
  assert.ok(Math.hypot(body.x, body.z) < .06);
});

// Open ground with a station to the east and a ramen bar to the west.
function placesNearby() {
  const nav = navigation(), station = { id: 'station', name: 'Local station', type: 'tram station', x: 8, y: 0, z: 0 }, bar = { id: 'bar', name: 'KŌJI', type: 'ramen bar', x: -8, y: 0, z: 0 };
  let closed = null;
  nav.destinations = () => [station, bar];
  nav.guide = (start, place) => {
    const destination = typeof place === 'object' ? place : [station, bar].find(p => p.id === place);
    return destination && destination.id !== closed ? { destination, route: planResidentGuide(start, destination, nav) } : null;
  };
  return { nav, station, bar, close: id => { closed = id; } };
}

test('a plan runs its steps in order: go there, wait until the player comes back, then go home', () => {
  const { nav } = placesNearby(), body = person(), at = player();
  const plan = { steps: [{ action: 'go_to', destination: 'station' }, { action: 'wait', until: 'player_returns' }, { action: 'resume_routine' }], repeat: false };
  assert.equal(requestResidentAction(body, plan, at, nav).reply, 'Sure. I will go to Local station, wait there until you come back, then get back to what I was doing.');
  Object.assign(at, { x: -20, z: 10 }); advance(body, at, nav, 10);
  assert.equal(body.residentAction.kind, 'wait'); assert.ok(Math.abs(body.x - 8) < .4, 'arrived, then waits there');
  advance(body, at, nav, 20); assert.equal(body.residentAction.kind, 'wait', 'waits for as long as the player is away');
  Object.assign(at, { x: 8, z: 2.5 }); advance(body, at, nav, .2);
  assert.equal(body.residentAction.kind, 'resume_routine', 'goes home once the player is back');
  Object.assign(at, { x: 30, z: 30 }); advance(body, at, nav, 15);
  assert.equal(body.residentAction, null); assert.ok(Math.hypot(body.x, body.z) < .06);
});

test('timed steps end on time, and a last step with an end leaves the resident waiting', () => {
  const body = person(), at = player(), nav = navigation();
  assert.equal(requestResidentAction(body, { steps: [{ action: 'dance', seconds: 10 }, { action: 'sit_down' }], repeat: false }, at, nav).reply, 'Sure. I will dance for 10 seconds, then sit down.');
  advance(body, at, nav, 9.5); assert.equal(body.residentAction.kind, 'dance');
  advance(body, at, nav, 3); assert.equal(body.residentAction.kind, 'sit_down'); assert.equal(body.residentAction.sitProgress, 1);
  assert.equal(body.residentAction.plan, null, 'sitting down was the last step; they stay seated');
  const dancer = person();
  requestResidentAction(dancer, { steps: [{ action: 'dance', until: 'player_leaves' }], repeat: false }, at, nav);
  advance(dancer, at, nav, 5); assert.equal(dancer.residentAction.kind, 'dance', 'dances while the player is near');
  advance(dancer, { ...at, z: -12 }, nav, .1);
  assert.equal(dancer.residentAction.kind, 'wait'); assert.equal(dancer.residentAction.status, 'Waiting here');
});

test('following ends on reaching a place, or once the player has walked off and stopped', () => {
  const { nav } = placesNearby(), body = person(), at = player();
  nav.destinations = () => [{ id: 'kiosk', name: 'Kiosk', type: 'kiosk', x: 0, y: 0, z: -12 }];
  assert.equal(requestResidentAction(body, { steps: [{ action: 'follow', destination: 'kiosk', until: 'place' }], repeat: false }, at, nav).reply, 'Sure. I will follow you until we reach Kiosk.');
  for (let i = 0; i < 9 * 60; i++) { at.z = Math.max(-20, at.z - 2.4 / 60); stepResidentAction(body, 1 / 60, at, nav); }
  assert.equal(body.residentAction.kind, 'wait'); assert.ok(body.z < -7.5 && body.z > -9, `stops within reach of the place (${body.z.toFixed(2)})`);
  const follower = person(), walker = player();
  requestResidentAction(follower, { steps: [{ action: 'follow', until: 'player_stops' }], repeat: false }, walker, navigation());
  advance(follower, walker, navigation(), 4); assert.equal(follower.residentAction.kind, 'follow', 'standing still before walking off does not count');
  for (let i = 0; i < 3 * 60; i++) { walker.z -= 2.4 / 60; stepResidentAction(follower, 1 / 60, walker, navigation()); }
  advance(follower, walker, navigation(), 2); assert.equal(follower.residentAction.kind, 'follow');
  advance(follower, walker, navigation(), 2); assert.equal(follower.residentAction.kind, 'wait', 'the player stopped for three seconds');
});

test('patrols repeat until a new request, keep the way home short, and never loop in zero time', () => {
  const { nav } = placesNearby(), body = person(), at = player();
  const patrol = { steps: [{ action: 'go_to', destination: 'station' }, { action: 'go_to', destination: 'bar' }], repeat: true };
  assert.equal(requestResidentAction(body, patrol, at, nav).reply, 'Sure. I will go to Local station, then go to KŌJI, and keep doing that until you ask me to stop.');
  Object.assign(at, { x: 0, z: 40 });
  const visits = [];
  for (let i = 0; i < 60 * 60; i++) {
    stepResidentAction(body, 1 / 60, at, nav);
    const id = body.residentAction.destination?.id;
    if (id && id !== visits.at(-1)) visits.push(id);
  }
  assert.deepEqual(visits.slice(0, 5), ['station', 'bar', 'station', 'bar', 'station']);
  assert.ok(body.residentAction.trail.length < 60, `the way home stays a simple path (${body.residentAction.trail.length} footsteps)`);
  Object.assign(at, { x: body.x, z: body.z - 1.5 });
  assert.equal(requestResidentAction(body, 'resume_routine', at, nav).ok, true);
  at.z = 40; advance(body, at, nav, 15);
  assert.equal(body.residentAction, null, 'a new request replaces the patrol, and the way home still works');
  const stander = person();
  requestResidentAction(stander, { steps: [{ action: 'get_up' }], repeat: true }, player(), navigation());
  advance(stander, player(), navigation(), .1);
  assert.equal(stander.residentAction.plan, null, 'a pass that takes no time stops the loop');
});

test('a later step that cannot start leaves the resident waiting where they are', () => {
  const { nav, close } = placesNearby(), body = person(), at = player();
  requestResidentAction(body, { steps: [{ action: 'go_to', destination: 'station' }, { action: 'go_to', destination: 'bar' }], repeat: false }, at, nav);
  close('bar'); at.z = 40; advance(body, at, nav, 10);
  assert.equal(body.residentAction.kind, 'wait'); assert.equal(body.residentAction.plan, null);
  assert.match(body.residentAction.status, /cannot find a clear walking route/);
  assert.ok(Math.abs(body.x - 8) < .4);
});

test('steps pause while the resident listens, and a new request replaces the rest of a plan', () => {
  const body = person(), at = player(), nav = navigation();
  requestResidentAction(body, { steps: [{ action: 'dance', seconds: 10 }, { action: 'follow' }], repeat: false }, at, nav);
  advance(body, at, nav, 6); body.talking = { yaw: 0 }; advance(body, at, nav, 10);
  body.talking = null; advance(body, at, nav, 3); assert.equal(body.residentAction.kind, 'dance', 'talking time does not count');
  advance(body, at, nav, 1.5); assert.equal(body.residentAction.kind, 'follow');
  const other = person();
  requestResidentAction(other, { steps: [{ action: 'dance', seconds: 10 }, { action: 'follow' }], repeat: false }, at, nav);
  advance(other, at, nav, 2); requestResidentAction(other, 'wait', at, nav); advance(other, at, nav, 20);
  assert.equal(other.residentAction.kind, 'wait'); assert.equal(other.residentAction.plan.steps.length, 1);
});

test('footsteps that close a loop are cut from the way home', () => {
  const body = person(), at = player(), nav = navigation();
  requestResidentAction(body, 'follow', at, nav);
  // The player walks a 6 m square and back to where the follower started.
  for (const [x, z] of [[0, -8], [6, -8], [6, -2], [0, -2], [0, -8]]) {
    const from = { ...at };
    for (let i = 1; i <= 150; i++) { at.x = from.x + (x - from.x) * i / 150; at.z = from.z + (z - from.z) * i / 150; stepResidentAction(body, 1 / 60, at, nav); }
  }
  advance(body, at, nav, 3);
  const trail = body.residentAction.trail;
  assert.ok(trail.length < 45, `the loop round the square is dropped (${trail.length} footsteps)`);
  assert.ok(trail.every((p, i) => !i || Math.hypot(p.x - trail[i - 1].x, p.z - trail[i - 1].z) < .5), 'what remains is still a continuous path');
});

test('a chained request queues as one plan and starts after Bye', async () => {
  const { nav } = placesNearby(), body = person(), at = player();
  const decision = { steps: [{ action: 'go_to', destination: 'station', until: '', seconds: 0 }, { action: 'wait', destination: '', until: 'player_returns', seconds: 0 }], repeat: false };
  const h = conversationHarness(async () => JSON.stringify(decision));
  h.actions.context = () => residentActionContext(body, nav);
  h.actions.prepare = plan => previewResidentAction(body, plan, at, nav);
  h.actions.execute = plan => requestResidentAction(body, plan, at, nav);
  h.conversation.open(persona, h.actions);
  assert.equal(await h.conversation.say('Go to the station and wait there until I come back.'), 'Sure. I will go to Local station, then wait there until you come back.');
  assert.equal(h.conversation.snapshot().pendingAction, 'go_to, wait'); assert.equal(body.residentAction, undefined);
  assert.equal(h.conversation.finish().ok, true); assert.equal(body.residentAction.kind, 'go_to');
  assert.deepEqual(residentActionContext(body, nav).next, ['wait'], 'the model can see what is queued next');
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
  assert.equal(requestResidentAction(person(), 'sit_down', player(), trapped).ok, false);
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
  const place = { id: 'lift', name: 'Elevator', type: 'elevator', x: pos.x + 2, y: spot.y, z: pos.z };
  const nav = { ...navigation(), area: 'this floor', sample: (from, p) => ({ ...p, y: spot.y }), destinations: () => [place], guide: start => ({ destination: place, route: [{ ...start }, place] }) };
  const occupants = createOccupants({ scene: new THREE.Scene(), assets: { citizen: crowdAsset(['Idle', 'Walk', 'WalkFormal', 'Driving']) }, residentNavigation: () => nav });
  const floors = [{ plan, level: 0 }];
  occupants.update(0, { player: at, floors });
  const p = occupants.avatars.find(p => p.occupant?.id === spot.id), o = p.occupant;
  const before = { x: o.x };
  assert.equal(occupants.command(p, { action: 'go_to', destination: 'lift' }, at).ok, true);
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
    // Walk to the floor's own exit or elevator, found by the production adapter.
    const place = traffic.residentContext(handle).destinations[0];
    if (!place) continue;
    const result = traffic.commandResident(handle, { action: 'go_to', destination: place.id }, at);
    if (!result.ok) continue;
    for (let i = 0; i < 240; i++) traffic.occupants.update(1 / 60, { player: at, floors });
    assert.ok(Math.hypot(p.occupant.x - before.x, p.occupant.z - before.z) > .6, JSON.stringify(p.occupant.residentAction));
    assert.match(p.occupant.residentAction.kind, /go_to|wait/);
    assert.equal(traffic.commandResident({ ...handle, life: handle.life - 1 }, 'follow', at).ok, false);
    checked = true; break;
  }
  assert.ok(checked, 'at least one standing resident has space to move');
  traffic.dispose();
});

const persona = residentPersona(walkerResident({ id: 1, model: 'resident-1', mode: 'walk', species: 'human' }));
test('structured decisions reject malformed, extra and unknown actions', () => {
  const good = { action: 'follow' };
  assert.deepEqual(parseDecision(JSON.stringify(good)), { steps: [good], repeat: false });
  for (const raw of ['{"action":"follow"', '```json\n{}\n```', 'null', '[]', '{"action":"follow","reply":""}', '{"action":"eval","reply":"Done."}', '{"action":"follow","reply":"Sure.","target":"someone_else"}']) assert.equal(parseDecision(raw), null, raw);
  const messages = decisionMessages('Follow me.', { behavior: 'wait' });
  assert.match(messages[0].content, /questions about an action/);
  assert.equal(messages.at(-1).content, 'Follow me.');
  assert.deepEqual(parseDecision('<think>\n\n</think>\n{"action":"wait"}'), { steps: [{ action: 'wait' }], repeat: false });
  assert.equal(parseDecision('<think>unfinished {"action":"follow"}'), null);
});

function conversationHarness(generate, execute = () => ({ ok: true, reply: 'I will follow you.', status: 'Following you' })) {
  const shown = [], spoken = [], calls = [];
  const conversation = new ResidentConversation({ model: { supportsActions: true, generate, interrupt() {} },
    view: { show() {}, reply: (text, pending) => shown.push({ text, pending }) }, voice: { stop() {}, speak: text => spoken.push(text) } });
  const actions = { context: () => ({ behavior: 'routine', area: 'outside', canWalk: true }), prepare: execute, execute: action => { calls.push(action); return execute(action); } };
  return { conversation, actions, shown, spoken, calls };
}

const followPlan = { steps: [{ action: 'follow' }], repeat: false };
test('valid decisions queue until the conversation finishes, and speech reflects validation', async () => {
  const h = conversationHarness(async (messages, options) => {
    assert.equal(messages.at(-1).content, 'Would you keep me company?');
    assert.deepEqual(options.responseFormat, DECISION_FORMAT);
    options.onText('{"action":"follow"');
    return '{"action":"follow"}';
  });
  h.conversation.open(persona, h.actions);
  assert.equal(h.conversation.snapshot().pendingAction, null, 'opening chat cannot queue an action');
  assert.deepEqual(h.spoken, [], 'residents wait for the player to speak');
  await h.conversation.say('Would you keep me company?');
  assert.deepEqual(h.calls, [], 'no action starts while talking');
  assert.equal(h.conversation.snapshot().pendingAction, 'follow');
  assert.equal(h.conversation.finish().ok, true);
  assert.deepEqual(h.calls, [followPlan]);
  h.conversation.finish(); assert.deepEqual(h.calls, [followPlan], 'finishing twice cannot repeat the action');
  assert.deepEqual(h.spoken, ['I will follow you.']);
  assert.ok(h.shown.every(({ text }) => !text.includes('"action"')), 'JSON is never displayed or spoken');
  const rejected = conversationHarness(async () => '{"action":"sit_down"}', () => ({ ok: false, reply: 'There is no room here.' }));
  rejected.conversation.open(persona, rejected.actions);
  assert.equal(await rejected.conversation.say('Could you sit over there?'), 'There is no room here.');
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
    const request = { steps: [{ action, destination: 'station' }], repeat: false }, checked = [];
    const h = conversationHarness(async (messages, options) => {
      assert.deepEqual(JSON.parse(options.responseFormat.schema).properties.steps.items.properties.destination.enum, ['', 'station']);
      return JSON.stringify({ action, destination: 'station' });
    }, command => { checked.push(command); return { ok: true, reply: 'Sure.', status: 'Going to the station' }; });
    h.actions.context = () => ({ destinations: [{ id: 'station', name: 'Station', type: 'station', distance: 20 }] });
    h.conversation.open(persona, h.actions); await h.conversation.say('To the station, please.');
    assert.deepEqual(h.calls, []); assert.equal(h.conversation.snapshot().pendingAction, action);
    assert.deepEqual(checked, [request]);
    h.conversation.finish(); assert.deepEqual(h.calls, [request]); assert.deepEqual(checked, [request, request]);
  }
});

test('missing destinations cannot replace a queued activity, and any other request reaches the model', async () => {
  const formats = [], dance = { steps: [{ action: 'dance' }], repeat: false };
  const h = conversationHarness(async (messages, options) => {
    formats.push(!!options.responseFormat);
    return options.responseFormat ? '{"action":"dance","destination":""}' : 'Evening.';
  }, command => PLACE_TRIP(command) && !command.steps[0].destination ? { ok: false, reply: 'Which place?' } : { ok: true, reply: 'Sure.' });
  h.conversation.open(persona, h.actions);
  await h.conversation.say('Dance.'); assert.deepEqual(formats, [], 'an exact command needs no model');
  await h.conversation.say('Come here.'); assert.deepEqual(formats, [true], 'nothing is blocked: the model decides');
  assert.equal(await h.conversation.say('Guide me somewhere.'), 'Which place?');
  assert.equal(h.conversation.snapshot().pendingAction, 'dance');
  assert.deepEqual(h.calls, []); h.conversation.finish(); assert.deepEqual(h.calls, [dance]);
});
const PLACE_TRIP = command => ['guide', 'go_to'].includes(command.steps?.[0]?.action);

test('late, interrupted, malformed, no-action and failed generations never change the simulation', async () => {
  let finish;
  const h = conversationHarness(() => new Promise(resolve => { finish = resolve; }));
  h.conversation.open(persona, h.actions);
  const pending = h.conversation.say('Would you keep me company?');
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

test('a companion waits while their friend talks, so the pair walk on together without a leap', () => {
  const traffic = createTraffic({ scene: new THREE.Scene(), world: { masterPlan: gridPlan(), spatial: null }, assets: { citizen: crowdAsset() } });
  const at = { x: 30, y: 0, z: 30, yaw: 0 };
  traffic.update(0, { player: at });
  const p = traffic.pedestrians.walkers.find(p => p.mode === 'follow' && p.edge.kind !== 'crossing'), leader = p.leader, handle = walkerResident(p).handle;
  Object.assign(at, { x: p.x + 1.5, z: p.z });
  assert.equal(traffic.talkToResident(handle, true), true);
  for (let i = 0; i < 30 * 60; i++) traffic.update(1 / 60, { player: at });
  assert.ok(Math.hypot(leader.x - p.x, leader.z - p.z) < 1.5, 'the companion waited');
  // A street over its budget keeps both of them, or the conversation would vanish.
  traffic.pedestrians.setQuality('high');
  traffic.pedestrians.update(1 / 60, { player: at, time: traffic.time, population: { pedestrians: 0, pedestrianSpacing: 7, district: 'core' } });
  assert.ok(leader.mode && leader.follower === p && p.leader === leader, 'the pair stays while they talk');
  traffic.pedestrians.setQuality('high');
  assert.equal(traffic.talkToResident(handle, false), true);
  let fastest = 0;
  for (let i = 0; i < 120; i++) {
    const before = { x: p.x, z: p.z };
    traffic.update(1 / 60, { player: at });
    fastest = Math.max(fastest, Math.hypot(p.x - before.x, p.z - before.z) * 60);
  }
  assert.ok(fastest < 3, `rejoined at ${fastest.toFixed(1)} m/s`);
  assert.ok(p.leader === leader, 'still walking together');
  traffic.dispose();
});

test('latest accepted action replaces the queue, small talk preserves it, and resets cancel it', async () => {
  let action = 'follow';
  const h = conversationHarness(async (messages, options) => options.responseFormat ? JSON.stringify({ action }) : 'Evening.');
  const wait = { steps: [{ action: 'wait' }], repeat: false };
  h.conversation.open(persona, h.actions);
  await h.conversation.say('Would you keep me company?');
  action = 'wait'; await h.conversation.say('Hang about here instead.');
  action = 'none'; await h.conversation.say('Thanks.');
  assert.equal(h.conversation.snapshot().pendingAction, 'wait');
  assert.deepEqual(h.calls, []);
  h.conversation.finish(); assert.deepEqual(h.calls, [wait]);
  action = 'follow'; h.conversation.open(persona, h.actions);
  await h.conversation.say('Would you keep me company?');
  h.conversation.close(); h.conversation.finish();
  assert.deepEqual(h.calls, [wait], 'reset cancels the queued action');
});

test('finishing revalidates a queued request against the world and cancels in-flight JSON', async () => {
  let release;
  const h = conversationHarness(async () => '{"action":"follow"}');
  h.conversation.open(persona, h.actions);
  await h.conversation.say('Would you keep me company?');
  h.actions.execute = () => ({ ok: false, reply: 'That resident has moved on.' });
  assert.equal(h.conversation.finish().ok, false);
  h.conversation.model.generate = () => new Promise(resolve => { release = resolve; });
  h.conversation.open(persona, h.actions);
  const pending = h.conversation.say('Hang about here instead.');
  h.conversation.finish(); release('{"action":"wait"}');
  assert.equal(await pending, null); assert.deepEqual(h.calls, []);
});
