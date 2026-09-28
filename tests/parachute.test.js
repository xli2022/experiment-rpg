import test from 'node:test';
import assert from 'node:assert/strict';
import { beginJump, JUMP, PARACHUTE, resetFall, stepJump } from '../src/jump.js';
import { findClimbFace, startClimb, dropClimb } from '../src/climbing.js';
import { orientedBox } from '../src/physics.js';

const rates = [30, 60, 120];
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);
const runner = (y = 100) => ({ x: 0, z: 0, y, groundY: y, velocityY: 0, jumpPhase: '', jumpTime: 0 });

function untilOpen(player, fps, groundY = 0) {
  for (let frame = 0; frame < fps * 6; frame++) {
    const y = player.y, velocity = player.velocityY;
    stepJump(player, 1 / fps, groundY);
    if (velocity < 0) assert.ok(player.y >= y + velocity / fps - .5 * JUMP.gravity / fps ** 2 - 1e-7, 'opening must not teleport the player downward');
    if (player.parachute) return (frame + 1) / fps - player.parachute.elapsed;
  }
  assert.fail('long descent never deployed its parachute');
}

test('ordinary jumps retain their exact authored arc and short drops never deploy', () => {
  for (const fps of rates) {
    const p = runner(20);
    assert.ok(beginJump(p));
    for (let frame = 1; frame < fps * .9; frame++) {
      stepJump(p, 1 / fps, 20);
      const air = Math.max(0, frame / fps - JUMP.takeoff);
      close(p.y, 20 + JUMP.velocity * air - .5 * JUMP.gravity * air * air);
      assert.equal(p.parachute, null);
    }
    const drop = runner(20);
    for (let frame = 0; frame < fps * 3; frame++) {
      stepJump(drop, 1 / fps, 9);
      assert.equal(drop.parachute, null, 'an 11 m fall stays a normal fall');
    }
    assert.equal(drop.y, 9); assert.equal(drop.jumpPhase, '');
  }
});

test('walking off a high roof opens at a 12 m drop and eases continuously to a stable descent', () => {
  const positions = [];
  for (const fps of rates) {
    const p = runner(100), crossing = Math.sqrt(2 * PARACHUTE.deployDistance / JUMP.gravity);
    close(untilOpen(p, fps), crossing);
    close(p.fallPeakY, 100);
    assert.ok(p.y <= 100 - PARACHUTE.deployDistance);
    assert.ok(p.parachute.openness >= 0 && p.parachute.openness < .03, 'the canopy begins inflating instead of snapping open');
    let elapsed = crossing + p.parachute.elapsed, lastVelocity = p.velocityY, lastOpenness = p.parachute.openness;
    while (elapsed < 3 - 1e-7) {
      stepJump(p, 1 / fps, 0); elapsed += 1 / fps;
      assert.ok(p.velocityY >= lastVelocity - 1e-7, 'inflation slows the descent smoothly');
      assert.ok(p.parachute.openness >= lastOpenness && p.parachute.openness <= 1);
      lastVelocity = p.velocityY; lastOpenness = p.parachute.openness;
    }
    close(p.velocityY, -PARACHUTE.descentSpeed); assert.equal(p.parachute.openness, 1);
    positions.push(p.y);
    for (let frame = 0; frame < fps * 22; frame++) stepJump(p, 1 / fps, 0);
    assert.equal(p.y, 0); assert.equal(p.velocityY, 0); assert.equal(p.jumpPhase, '');
    assert.equal(p.parachute, null); assert.equal(p.fallPeakY, null);
  }
  assert.ok(Math.max(...positions) - Math.min(...positions) < 1e-7, 'inflation and gliding are independent of frame rate');
});

test('jumping and pushing off a wall measure deployment from their airborne peak', () => {
  for (const fps of rates) {
    const jump = runner(100); beginJump(jump);
    const expected = JUMP.takeoff + JUMP.velocity / JUMP.gravity + Math.sqrt(2 * PARACHUTE.deployDistance / JUMP.gravity);
    close(untilOpen(jump, fps), expected);
    close(jump.fallPeakY, 100 + JUMP.velocity ** 2 / (2 * JUMP.gravity));
    assert.equal(jump.jumpPhase, 'fall');
    const push = { ...runner(80), jumpPhase: 'fall', velocityY: 3.8 };
    close(untilOpen(push, fps), 3.8 / JUMP.gravity + Math.sqrt(2 * PARACHUTE.deployDistance / JUMP.gravity));
    close(push.fallPeakY, 80 + 3.8 ** 2 / (2 * JUMP.gravity));
  }
});

test('uneven frames preserve the jump-to-parachute transition and total descent', () => {
  const simulate = steps => {
    const p = runner(100); beginJump(p);
    let elapsed = 0, frame = 0;
    while (elapsed < 3 - 1e-10) {
      const dt = Math.min(steps[frame++ % steps.length], 3 - elapsed);
      stepJump(p, dt, 0); elapsed += dt;
      assert.ok(Number.isFinite(p.y) && Number.isFinite(p.velocityY));
    }
    assert.equal(p.parachute.openness, 1); assert.equal(p.jumpPhase, 'fall');
    return p;
  };
  const reference = simulate([1 / 120]);
  for (const steps of [[.016, .033, .008, .05], [.05, .005, .024, .012]]) {
    const p = simulate(steps);
    close(p.y, reference.y); close(p.velocityY, reference.velocityY); close(p.parachute.elapsed, reference.parachute.elapsed);
  }
});

test('landing on an intermediate roof closes the chute and starts a fresh short fall from that roof', () => {
  for (const fps of rates) {
    const p = runner(100);
    untilOpen(p, fps, 70);
    for (let frame = 0; frame < fps * 8 && p.jumpPhase !== 'land'; frame++) stepJump(p, 1 / fps, 70);
    assert.equal(p.y, 70); assert.equal(p.jumpPhase, 'land'); assert.equal(p.parachute, null); assert.equal(p.fallPeakY, null);
    // Step straight off before landing recovery finishes.
    stepJump(p, 1 / fps, 65);
    assert.equal(p.jumpPhase, 'fall');
    for (let frame = 0; frame < fps * 3; frame++) {
      stepJump(p, 1 / fps, 65);
      assert.equal(p.parachute, null, 'the previous roof fall must not inflate the canopy on a new 5 m drop');
    }
    assert.equal(p.y, 65); assert.equal(p.jumpPhase, '');
  }
});

test('grabbing a wall closes the canopy and releasing it starts a new deployment threshold', () => {
  for (const fps of rates) {
    const p = { ...runner(100), x: 10, z: -.4, yaw: 0 };
    untilOpen(p, fps);
    const wall = orientedBox(10, -8, 12, 14, 0, 130, 0, { id: 'high-wall', climbable: true });
    assert.ok(startClimb(p, findClimbFace(p, [wall]), [wall]));
    assert.equal(p.parachute, null); assert.equal(p.fallPeakY, null);
    const releaseY = p.y;
    assert.ok(dropClimb(p));
    close(untilOpen(p, fps), Math.sqrt(2 * PARACHUTE.deployDistance / JUMP.gravity));
    close(p.fallPeakY, releaseY);
  }
});

test('resetFall only clears fall tracking and beginning a new jump discards old canopy state', () => {
  const p = { ...runner(30), vx: 4, vz: -2, velocityY: -5, jumpPhase: 'fall', fallPeakY: 90,
    parachute: { elapsed: 3, openness: 1 }, parachuteStartVelocityY: -21 };
  resetFall(p);
  assert.equal(p.parachute, null); assert.equal(p.fallPeakY, null); assert.equal(p.parachuteStartVelocityY, 0);
  assert.equal(p.y, 30); assert.equal(p.velocityY, -5); assert.equal(p.jumpPhase, 'fall');
  assert.equal(p.vx, 4); assert.equal(p.vz, -2);
  Object.assign(p, { jumpPhase: 'land', jumpTime: .5, fallPeakY: 90, parachute: { elapsed: 3, openness: 1 } });
  assert.ok(beginJump(p));
  assert.equal(p.parachute, null); assert.equal(p.fallPeakY, null);
});
