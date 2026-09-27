import test from 'node:test';
import assert from 'node:assert/strict';
import { circleHitsBox, moveWithCollisions, findExitPosition, stepVehicle, rayBoxDistance, angleDelta, WORLD_LIMIT } from '../src/physics.js';

const wall = { minX: 2, maxX: 6, minZ: -10, maxZ: 10, maxY: 12 };

test('collision catches a high-speed vehicle before it crosses a wall', () => {
  const p = { x: 0, z: 0 };
  assert.equal(moveWithCollisions(p, 25, 0, .5, [wall]), true);
  assert.ok(p.x <= 1.5); assert.ok(!circleHitsBox(p.x, p.z, .5, wall));
});

test('diagonal movement slides along walls instead of sticking', () => {
  const p = { x: 1.4, z: 0 };
  moveWithCollisions(p, 1.5, 3, .5, [wall]);
  assert.ok(p.x <= 1.5); assert.ok(Math.abs(p.z - 3) < 1e-7);
});

test('movement respects the city boundary', () => {
  const p = { x: WORLD_LIMIT - 1, z: 0 };
  moveWithCollisions(p, 20, -20, 1, []);
  assert.equal(p.x, WORLD_LIMIT - 1); assert.ok(Math.abs(p.z + 20) < 1e-7);
});

test('vehicle exit tries the other door when one side is obstructed', () => {
  const car = { x: 0, z: 0, yaw: 0 };
  const p = findExitPosition(car, [{ minX: -5, maxX: -1, minZ: -5, maxZ: 5 }]);
  assert.ok(p.x > 0); assert.equal(p.z, 0);
});

test('vehicle refuses an exit when all sides are blocked', () => {
  assert.equal(findExitPosition({ x: 0, z: 0, yaw: 0 }, [{ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }]), null);
});

test('forward/reverse, steering and handbrake behave in both frame rates', () => {
  const simulate = step => {
    const car = { x: 0, z: 0, yaw: 0, speed: 0 };
    for (let t = 0; t < 3 - 1e-6; t += step) { const d = stepVehicle(car, 1, 0, false, step); car.z += d.z; }
    return car;
  };
  const a = simulate(1 / 30), b = simulate(1 / 120);
  assert.ok(a.speed > 35 && a.speed <= 42); assert.ok(a.z < -30);
  assert.ok(Math.abs(a.z - b.z) < 1.2);
  const before = a.speed; stepVehicle(a, 0, 1, true, .1); assert.ok(a.speed < before * .7); assert.ok(a.yaw < 0);
  const reverse = { speed: 0, yaw: 0 }; for (let i = 0; i < 120; i++) stepVehicle(reverse, -1, 0, false, 1 / 60);
  assert.ok(reverse.speed < 0 && reverse.speed >= -13);
});

test('gun rays cannot damage a target behind a wall', () => {
  assert.equal(rayBoxDistance({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, wall), 2);
  assert.equal(rayBoxDistance({ x: 0, y: 15, z: 0 }, { x: 1, y: 0, z: 0 }, wall), Infinity);
  assert.equal(rayBoxDistance({ x: 0, y: 2, z: 0 }, { x: -1, y: 0, z: 0 }, wall), Infinity);
  assert.equal(rayBoxDistance({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, wall, 1), Infinity);
});

test('camera takes the short turn across the angle wrap', () => {
  assert.ok(Math.abs(angleDelta(Math.PI - .1, -Math.PI + .1) - .2) < 1e-6);
});
