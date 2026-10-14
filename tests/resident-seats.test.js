import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { cachedInteriorPlan, floorOccupants, levelY } from '../src/world/interior-plan.js';
import { interiorContext, interiorSpatial, toWorld } from '../src/world/interior-physics.js';
import { SpatialGrid } from '../src/core/spatial-grid.js';
import { orientedBox } from '../src/core/physics.js';
import { createOccupants } from '../src/traffic/occupants.js';
import { createResidentNavigation } from '../src/traffic/resident-navigation.js';
import { previewResidentAction, queueResidentLift } from '../src/traffic/resident-actions.js';
import { crowdAsset } from './helpers/street-grid.js';
import { findPath, walk } from './helpers/interior-walk.js';

const metropolis = new VerticalMetropolis();
const plans = metropolis.area(0, 0, 420, 420).flatMap(b => b.buildings).map(cachedInteriorPlan).filter(Boolean);
const choices = plans.flatMap(plan => [0, 1].filter(level => level < plan.levels).flatMap(level => floorOccupants(plan, level)
  .filter(spot => spot.pose === 'sit').map(spot => ({ plan, level, spot }))));
const position = p => ({ x: p.x, y: p.y, z: p.z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function clearTarget(nav, start, length = 2.8) {
  for (let i = 0; i < 16; i++) {
    const goal = { x: start.x + Math.sin(i * Math.PI / 8) * length, y: start.y, z: start.z + Math.cos(i * Math.PI / 8) * length };
    let at = start;
    for (let j = 1; j <= 28 && at; j++) at = nav.sample(at, { x: start.x + (goal.x - start.x) * j / 28, y: start.y, z: start.z + (goal.z - start.z) * j / 28 });
    if (at) return at;
  }
  return null;
}

function fixture(kind, { lift = false } = {}) {
  for (const { plan, level, spot } of choices.filter(c => c.spot.kind === kind && (!lift || c.level === 1 && c.plan.core?.lift))) {
    const spatial = new SpatialGrid([], 48);
    let obstacles = [], extraPeople = [], floors = [{ plan, level }], occupants;
    const world = { masterPlan: { terrainHeight: () => plan.ground }, spatial, planNear: () => plan, terrainHeight: () => plan.ground,
      interiorContextAt: (x, y, z) => interiorContext(plan, x, y, z),
      spatialFor: context => {
        const base = context ? interiorSpatial(spatial, context) : spatial;
        return { ...base, near: (...args) => [...base.near(...args), ...obstacles] };
      }, interiors: { floors: () => floors },
    };
    const navigation = createResidentNavigation({ world, people: () => extraPeople });
    const player = { ...toWorld(plan, spot.x, spot.z), y: spot.y, yaw: 0, velocityY: 0, vx: 0, vz: 0, jumpPhase: '' };
    occupants = createOccupants({ scene: new THREE.Scene(), assets: { citizen: crowdAsset(['Idle', 'Walk', 'WalkFormal', 'Driving']) }, residentNavigation: navigation });
    const tick = (dt = 1 / 60) => occupants.update(dt, { player, floors });
    tick(0);
    const avatar = occupants.avatars.find(a => a.occupant?.id === spot.id);
    if (!avatar) { occupants.dispose(); continue; }
    const body = avatar.occupant, nav = navigation(body), seat = nav.seatExit(), goal = seat && clearTarget(nav, seat.path.at(-1));
    if (!seat || !goal) { occupants.dispose(); continue; }
    Object.assign(player, goal);
    const home = { ...position(body), yaw: body.yaw, activity: body.activity, collider: body.collider, rest: avatar.avatar.rest, life: avatar.life };
    return { plan, level, spot, body, avatar, nav, seat, home, player, world, occupants, tick,
      advance(seconds = 10) { for (let i = 0; i < seconds * 60; i++) tick(); },
      returnHome() {
        assert.equal(occupants.command(avatar, 'resume_routine', player).ok, true);
        player.x += 100; floors = [];
        for (let i = 0; i < 60 * 120 && body.residentAction; i++) tick();
      },
      obstacles(value) { obstacles = value; }, people(value) { extraPeople = value; }, floors(value) { floors = value; },
    };
  }
  throw new Error(`No ${kind} seat fixture with a clear exit${lift ? ' and lift' : ''}`);
}

function seatedAtHome(f) {
  assert.equal(f.body.residentAction, null);
  assert.equal(f.body.pose, 'sit');
  assert.deepEqual(position(f.body), position(f.home));
  assert.equal(f.body.yaw, f.home.yaw); assert.equal(f.body.activity, f.home.activity);
  assert.ok(f.body.collider === f.home.collider, 'restores the original seat collision shape');
  assert.equal(f.avatar.avatar.rest, f.home.rest); assert.equal(f.avatar.life, f.home.life);
}

test('desk, sofa and bench residents get up only after commit, follow, then sit in their original seat', () => {
  for (const kind of ['desk', 'sofa', 'bench']) {
    const f = fixture(kind);
    try {
      assert.equal(f.occupants.actionContext(f.avatar).canWalk, true);
      assert.equal(previewResidentAction(f.body, 'follow', f.player, f.nav).ok, true);
      assert.equal(f.body.pose, 'sit'); assert.equal(f.body.residentAction, undefined);
      assert.equal(f.avatar.avatar.rest, f.home.rest);
      assert.equal(f.occupants.command(f.avatar, 'follow', f.player).ok, true);
      f.tick(0); assert.equal(f.body.pose, 'sit', 'paused time cannot make someone stand');
      f.body.talking = { yaw: f.body.yaw }; f.advance(1);
      assert.equal(f.body.pose, 'sit', 'listening holds the seated pose');
      f.body.talking = null; f.advance(12);
      assert.equal(f.body.pose, 'stand'); assert.equal(f.avatar.avatar.rest, 'Idle');
      assert.ok(distance(f.body, f.home) > 1, `${kind}: actually walks away from the seat`);
      assert.ok(Math.abs(f.body.collider.minY - f.body.y) < 1e-6);
      assert.ok(Math.abs(f.body.collider.maxY - f.body.y - 1.8) < 1e-6, 'standing body is solid, including desk workers');
      assert.equal(f.occupants.command(f.avatar, 'wait', f.player).ok, true);
      const waiting = position(f.body); f.advance(1); assert.deepEqual(position(f.body), waiting);
      f.returnHome(); seatedAtHome(f);
    } finally { f.occupants.dispose(); }
  }
});

test('a blocked seat exit is rejected without changing the pose or original activity', () => {
  const f = fixture('desk');
  try {
    f.obstacles([orientedBox(f.home.x, f.home.z, 4, 4, 0, f.home.y + 2, f.home.y, { id: 'new-obstacle' })]);
    assert.equal(previewResidentAction(f.body, 'follow', f.player, f.nav).ok, false);
    assert.equal(f.occupants.command(f.avatar, 'follow', f.player).ok, false);
    f.advance(1);
    assert.equal(f.body.pose, 'sit'); assert.equal(f.body.residentAction, undefined);
    assert.equal(f.avatar.avatar.rest, f.home.rest); assert.deepEqual(position(f.body), position(f.home));
    f.obstacles([]);
    assert.equal(f.occupants.command(f.avatar, 'follow', f.player).ok, true);
  } finally { f.occupants.dispose(); }
});

test('sit down keeps a resident in their existing seat even when the exit is blocked', () => {
  for (const kind of ['desk', 'sofa', 'bench']) {
    const f = fixture(kind);
    try {
      f.obstacles([orientedBox(f.home.x, f.home.z, 4, 4, 0, f.home.y + 2, f.home.y, { id: 'new-obstacle' })]);
      assert.equal(previewResidentAction(f.body, 'sit_down', f.player, f.nav).ok, true);
      assert.equal(f.body.residentAction, undefined);
      assert.equal(f.occupants.command(f.avatar, 'sit_down', f.player).ok, true); f.advance(2);
      assert.equal(f.body.pose, 'sit'); assert.equal(f.body.residentAction.sitProgress, 0);
      assert.equal(f.occupants.actionContext(f.avatar).posture, 'seated');
      assert.equal(f.avatar.avatar.rest, f.home.rest); assert.deepEqual(position(f.body), position(f.home));
      assert.equal(f.body.collider, f.home.collider);
      assert.equal(f.occupants.command(f.avatar, 'resume_routine', f.player).ok, true); f.advance(1);
      seatedAtHome(f);
    } finally { f.occupants.dispose(); }
  }
});

test('a seated resident stands before dancing and can return to the original seat', () => {
  const f = fixture('sofa');
  try {
    assert.equal(previewResidentAction(f.body, 'dance', f.player, f.nav).ok, true);
    assert.equal(f.body.pose, 'sit');
    assert.equal(f.occupants.command(f.avatar, 'dance', f.player).ok, true);
    f.advance(6);
    assert.equal(f.body.pose, 'stand'); assert.equal(f.avatar.avatar.rest, 'Idle');
    assert.equal(f.body.residentAction.kind, 'dance'); assert.ok(f.body.residentAction.elapsed > 0);
    f.returnHome(); seatedAtHome(f);
  } finally { f.occupants.dispose(); }
});

test('get up leaves a seat, waits in place and preserves the original seat', () => {
  const f = fixture('sofa');
  try {
    assert.equal(f.occupants.command(f.avatar, 'get_up', f.player).ok, true); f.advance(5);
    assert.equal(f.body.pose, 'stand'); assert.equal(f.body.residentAction.kind, 'wait');
    const standing = position(f.body); f.advance(3);
    assert.deepEqual(position(f.body), standing);
    f.returnHome(); seatedAtHome(f);
  } finally { f.occupants.dispose(); }
});

test('returning to a seat waits for people and walls; its collision exception never applies elsewhere', () => {
  const f = fixture('sofa');
  try {
    assert.equal(f.nav.sampleSeat(f.home, { ...f.home, x: f.home.x + 3 }, f.seat), null);
    f.occupants.command(f.avatar, 'follow', f.player); f.advance(12);
    f.people([position(f.home)]);
    f.returnHome();
    assert.equal(f.body.pose, 'stand'); assert.equal(f.body.residentAction.kind, 'resume_routine');
    f.people([]);
    const middle = { x: (f.home.x + f.seat.path.at(-1).x) / 2, z: (f.home.z + f.seat.path.at(-1).z) / 2 };
    f.obstacles([orientedBox(middle.x, middle.z, .15, .15, 0, f.home.y + 2, f.home.y, { id: 'new-obstacle' })]);
    f.advance(3); assert.equal(f.body.pose, 'stand'); assert.ok(f.body.residentAction);
    f.obstacles([]); f.advance(5); seatedAtHome(f);
  } finally { f.occupants.dispose(); }
});

test('a seated follower takes the elevator and returns to the original seat on an unloaded floor', () => {
  const f = fixture('desk', { lift: true });
  try {
    f.occupants.command(f.avatar, 'follow', f.player); f.advance(12);
    const lift = f.plan.core.lift, center = { ...toWorld(f.plan, (lift.x0 + lift.x1) / 2, (lift.z0 + lift.z1) / 2), y: levelY(f.plan, f.level) };
    const path = findPath(f.world.spatialFor(f.world.interiorContextAt(f.player.x, f.player.y, f.player.z)), f.plan, f.player, center, center.y);
    assert.ok(path);
    for (const point of path) {
      const segment = walk(f.world, f.player, [point], 60);
      assert.equal(segment.falls, 0); assert.equal(segment.overlaps.length, 0);
      assert.ok(segment.trace.length < 720, 'the player reaches each waypoint');
      for (const step of segment.trace) { Object.assign(f.player, step); f.tick(); }
    }
    const from = position(f.player), to = { ...from, y: levelY(f.plan, 0) };
    assert.equal(queueResidentLift(f.body, from, to, f.nav), true);
    const goal = clearTarget(f.nav, to);
    assert.ok(goal); Object.assign(f.player, goal); f.floors([{ plan: f.plan, level: 0 }]);
    f.advance(45);
    assert.equal(f.body.y, to.y, JSON.stringify({ body: position(f.body), player: position(f.player), from, status: f.body.residentAction?.status, route: f.body.residentAction?.route.slice(0, 4) }));
    assert.equal(f.body.pose, 'stand'); assert.ok(f.avatar.occupant === f.body);
    assert.ok(Math.abs(f.body.collider.minY - to.y) < 1e-6);
    f.returnHome(); seatedAtHome(f);
  } finally { f.occupants.dispose(); }
});

test('interrupting a sit-down with follow preserves the same seat for a later return', () => {
  const f = fixture('bench');
  try {
    f.occupants.command(f.avatar, 'follow', f.player); f.advance(12);
    f.occupants.command(f.avatar, 'resume_routine', f.player); f.player.x += 100;
    for (let i = 0; i < 1800 && f.body.residentAction?.transition !== 'sit'; i++) f.tick();
    assert.equal(f.body.residentAction?.transition, 'sit'); f.advance(.15);
    Object.assign(f.player, clearTarget(f.nav, f.seat.path.at(-1)));
    assert.equal(f.occupants.command(f.avatar, 'follow', f.player).ok, true); f.advance(12);
    assert.equal(f.body.pose, 'stand'); assert.ok(distance(f.body, f.home) > 1);
    f.returnHome(); seatedAtHome(f);
  } finally { f.occupants.dispose(); }
});
