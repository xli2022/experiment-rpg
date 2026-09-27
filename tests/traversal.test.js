import test from 'node:test';
import assert from 'node:assert/strict';
import { orientedBox, circleHitsBox, moveWithCollisions, rayBoxDistance, supportHeight, overlapsHeight } from '../src/physics.js';
import { findClimbFace, startClimb, stepClimb, dropClimb, CLIMB } from '../src/climbing.js';
import { beginJump, stepJump } from '../src/jump.js';
import { footVelocity, MOVEMENT } from '../src/locomotion.js';
import { buildingColliders, buildingStructure } from '../src/architecture.js';
import { BUILDING_TYPES } from '../src/city-plan.js';
import { writeSave, readSave, Campaign } from '../src/campaign.js';
import { PUBLIC_SPACES, publicSpaceParts, publicSpaceColliders } from '../src/public-spaces.js';

test('driving through the empty corner of a rotated building no longer hits its broad-phase square', () => {
  const wall = orientedBox(0, 0, 20, 20, Math.PI / 4, 30);
  const car = { x: 12, z: 12 };
  assert.equal(circleHitsBox(car.x, car.z, 1.6, wall), false);
  assert.equal(moveWithCollisions(car, 7, -2, 1.6, [wall]), false);
  assert.ok(Math.abs(car.x - 19) < 1e-8 && Math.abs(car.z - 10) < 1e-8);
  assert.equal(rayBoxDistance({ x: 12, y: 2, z: 12 }, { x: 1, y: 0, z: 0 }, wall), Infinity);
  const towardWall = { x: 20, z: 0 };
  assert.equal(moveWithCollisions(towardWall, -35, 0, 1.6, [wall]), true);
  assert.ok(towardWall.x > 14, 'Actual facade still stops a fast vehicle');
});

test('roof equipment and bridges only collide at their rendered height', () => {
  const overhead = orientedBox(0, 0, 14, 4, .3, 13, 10);
  const car = { x: 0, z: 10 };
  assert.equal(moveWithCollisions(car, 0, -20, 1.6, [overhead]), false);
  const runner = { x: 0, y: 10, z: 10 };
  assert.equal(moveWithCollisions(runner, 0, -20, .43, [overhead]), true);
  assert.equal(supportHeight(0, 0, [overhead], 13), 13);
  assert.equal(supportHeight(0, 0, [overhead], 9), 0);
});

test('movement accelerates promptly, stops promptly and stays consistent at 30–120 FPS', () => {
  const distances = [];
  for (const fps of [30, 60, 120]) {
    const p = { vx: 0, vz: 0 }; let distance = 0;
    for (let i = 0; i < fps * 2; i++) distance -= footVelocity(p, { x: 0, y: 1 }, 0, 1 / fps).z;
    assert.ok(distance > 11 && distance < 11.7); distances.push(distance);
    assert.ok(Math.abs(p.vz + MOVEMENT.jog) < .01);
    for (let i = 0; i < Math.ceil(fps * .25); i++) footVelocity(p, { x: 0, y: 0 }, 0, 1 / fps);
    assert.equal(p.vz, 0);
    for (let i = 0; i < fps; i++) footVelocity(p, { x: 0, y: 1 }, 0, 1 / fps, { sprint: true });
    assert.ok(Math.abs(p.vz + 10.8) < .01);
  }
  assert.ok(Math.max(...distances) - Math.min(...distances) < .1);
});

function playerAtWall(yaw = 0, roof = 8) {
  const wall = orientedBox(10, -8, 12, 14, yaw, roof, 0, { id: 'wall', climbable: true });
  const p = { x: 10 + Math.sin(yaw) * 7.6, z: -8 + Math.cos(yaw) * 7.6, y: 0, yaw, vx: 0, vz: 0, groundY: 0, jumpPhase: '' };
  return { wall, p };
}

test('rotated walls support grabbing, sideways movement and mantling at every frame rate', () => {
  for (const yaw of [0, .7, Math.PI, -1.4]) for (const fps of [30, 60, 120]) {
    const { p, wall } = playerAtWall(yaw), face = findClimbFace(p, [wall], yaw, true);
    assert.ok(face); assert.ok(startClimb(p, face, [wall]));
    stepClimb(p, { x: 1, y: 0 }, .2, [wall]); assert.ok(Math.abs(p.climb.u - CLIMB.sideways * .2) < 1e-8);
    let elapsed = 0;
    while (p.climb && elapsed < 5) { stepClimb(p, { x: 0, y: 1 }, 1 / fps, [wall]); elapsed += 1 / fps; }
    assert.equal(p.climb, null); assert.equal(p.y, 8); assert.equal(p.groundY, 8);
    assert.equal(supportHeight(p.x, p.z, [wall], p.y), 8);
    assert.equal(moveWithCollisions(p, -.2, -.2, .43, [wall]), false, 'Walking on a roof must not hit its wall');
    assert.ok(elapsed > 2.5 && elapsed < 2.85);
  }
});

test('climbing requires a solid nearby facade, and a blocked ledge requires moving sideways', () => {
  const { p, wall } = playerAtWall();
  assert.equal(findClimbFace(p, [{ ...wall, climbable: false }]), null);
  assert.equal(findClimbFace({ ...p, z: p.z + 2 }, [wall]), null);
  assert.equal(findClimbFace(p, [wall], Math.PI, true), null);
  const obstruction = orientedBox(10, -1.9, 4, 2, 0, 11, 8, { id: 'obstruction' });
  assert.ok(startClimb(p, findClimbFace(p, [wall]), [wall, obstruction]));
  for (let i = 0; i < 180; i++) stepClimb(p, { x: 0, y: 1 }, 1 / 60, [wall, obstruction]);
  assert.ok(p.climb.blocked); assert.equal(p.climb.mode, 'climb'); assert.ok(p.y < wall.maxY);
  for (let i = 0; i < 90; i++) stepClimb(p, { x: 1, y: 0 }, 1 / 60, [wall, obstruction]);
  for (let i = 0; i < 180 && p.climb; i++) stepClimb(p, { x: 0, y: 1 }, 1 / 60, [wall, obstruction]);
  assert.equal(p.climb, null); assert.equal(p.y, 8);
});

test('release, jump away, roof jumps and walking off roofs land on the correct floor', () => {
  for (const push of [false, true]) {
    const { p, wall } = playerAtWall(); startClimb(p, findClimbFace(p, [wall]), [wall]);
    stepClimb(p, { x: 0, y: 1 }, .8, [wall]); const height = p.y;
    assert.ok(dropClimb(p, push)); assert.equal(p.climb, null);
    assert.equal(p.velocityY > 0, push);
    for (let i = 0; i < 240; i++) stepJump(p, 1 / 60, 0);
    assert.equal(p.y, 0); assert.equal(p.jumpPhase, ''); assert.ok(height > 2);
  }
  for (const fps of [30, 120]) {
    const p = { y: 25, groundY: 25, jumpPhase: '', velocityY: 0 };
    assert.ok(beginJump(p)); let peak = 0;
    for (let i = 0; i < fps * 3; i++) { stepJump(p, 1 / fps, 25); peak = Math.max(peak, p.y); }
    assert.ok(peak > 26); assert.equal(p.y, 25); assert.equal(p.jumpPhase, '');
    stepJump(p, 1 / fps, 7); assert.equal(p.jumpPhase, 'fall');
    for (let i = 0; i < fps * 3; i++) stepJump(p, 1 / fps, 7);
    assert.equal(p.y, 7);
  }
});

test('cancelling a mantle always releases outside the wall, including rotated facades', () => {
  for (const yaw of [0, .7, -1.4]) for (const progress of [.3, .45, .55, .8]) for (const push of [false, true]) {
    const { p, wall } = playerAtWall(yaw);
    startClimb(p, findClimbFace(p, [wall]), [wall]);
    while (p.climb.mode !== 'mantle') stepClimb(p, { x: 0, y: 1 }, 1 / 60, [wall]);
    const { nx, nz } = p.climb;
    stepClimb(p, { x: 0, y: 0 }, progress * CLIMB.mantleTime, [wall]);
    assert.ok(dropClimb(p, push));
    assert.equal(circleHitsBox(p.x, p.z, .43, wall), false, `Release at ${progress} on yaw ${yaw}`);
    for (let i = 0; i < 180; i++) stepJump(p, 1 / 60, supportHeight(p.x, p.z, [wall], p.y + .25));
    assert.equal(p.y, 0);
    assert.equal(moveWithCollisions(p, nx * .1, nz * .1, .43, [wall]), false, 'Walking away remains possible');
  }
});

test('jumping onto a raised surface starts landing recovery at a valid time', () => {
  for (const fps of [30, 60, 120]) {
    const p = { y: 0, groundY: 0, jumpPhase: '' };
    beginJump(p);
    for (let i = 0; i < fps * 2; i++) {
      stepJump(p, 1 / fps, p.y >= .8 ? .8 : 0);
      if (p.jumpPhase === 'land') break;
    }
    assert.equal(p.y, .8); assert.equal(p.jumpPhase, 'land');
    assert.ok(p.jumpTime >= 0 && p.jumpTime <= 1 / fps + .001, `Landing time ${p.jumpTime} at ${fps} FPS`);
  }
});

test('all building families have climbable walls, walkable roofs and matching rooftop equipment', () => {
  for (const type of BUILDING_TYPES) {
    const building = { id: type, type, x: 12, z: -20, yaw: .6, w: 20, d: 18, h: 16, variation: .4 };
    const boxes = buildingColliders(building), parts = buildingStructure(building).filter(p => p.rooftop);
    assert.ok(boxes[0].climbable); assert.equal(boxes[0].maxY, 16.5);
    assert.equal(boxes.length, parts.length + 1);
    for (const [i, p] of parts.entries()) {
      const b = boxes[i + 1];
      assert.equal(b.minY, p.y - p.h / 2); assert.equal(b.maxY, p.y + p.h / 2);
      assert.equal(b.w, p.w); assert.equal(b.d, p.d); assert.equal(overlapsHeight(b, 0), false);
    }
  }
});

test('public spaces keep their paths open and physical props match visible structural pieces', () => {
  for (const type of PUBLIC_SPACES) {
    const pieces = publicSpaceParts(type).filter(p => p.solid), boxes = publicSpaceColliders({ type, x: 0, z: 0 });
    assert.equal(boxes.length, pieces.length);
    for (const [i, box] of boxes.entries()) {
      assert.equal(box.w, pieces[i].w); assert.equal(box.d, pieces[i].d);
    }
    assert.equal(boxes.some(b => circleHitsBox(0, 17, 1.6, b)), false, 'Approach stays clear');
  }
});

test('rooftop saves retain elevation and old street-level saves remain compatible', () => {
  const data = new Map(), storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  for (const position of [{ x: 40, z: 70, y: 65.5 }, { x: 40, z: 70 }]) {
    writeSave(storage, new Campaign().data, position); assert.deepEqual(readSave(storage).position, position);
  }
});
