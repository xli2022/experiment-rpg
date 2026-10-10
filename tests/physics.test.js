import test from 'node:test';
import assert from 'node:assert/strict';
import { circleHitsBox, moveWithCollisions, carCollider, findExitPosition, stepVehicle, rayBoxDistance, rayObstructionDistance, angleDelta } from '../src/core/physics.js';
import { WORLD_LIMIT } from '../src/world/world-config.js';

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
  moveWithCollisions(p, 20, -20, 1, [], WORLD_LIMIT);
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

test('exiting at every car angle leaves enough clearance to walk away', () => {
  for (let degrees = 0; degrees < 360; degrees++) {
    const car = { x: 17, z: -23, yaw: degrees * Math.PI / 180 };
    const box = carCollider(car), exit = findExitPosition(car, []);
    assert.ok(exit, `No exit at ${degrees} degrees`);
    assert.equal(circleHitsBox(exit.x, exit.z, .48, box), false, `Exit overlaps car at ${degrees} degrees`);
    const player = { ...exit }, distance = Math.hypot(exit.x - car.x, exit.z - car.z);
    const dx = (exit.x - car.x) / distance * .05, dz = (exit.z - car.z) / distance * .05;
    assert.equal(moveWithCollisions(player, dx, dz, .43, [box]), false);
    assert.ok(Math.hypot(player.x - exit.x, player.z - exit.z) > .049, `Stuck at ${degrees} degrees`);
  }
});

test('rotated vehicle exit avoids its own collider and neighboring cars', () => {
  const car = { x: 0, z: 0, yaw: Math.PI / 4 };
  const neighbor = carCollider({ x: 4, z: 4, yaw: 0 });
  const exit = findExitPosition(car, [neighbor]);
  assert.ok(exit);
  for (const box of [carCollider(car), neighbor]) assert.equal(circleHitsBox(exit.x, exit.z, .48, box), false);
  assert.ok(exit.x < 0 && exit.z > 0, 'The rotated left door is clear; its former square bounds must not block it');
});

test('vehicle exits keep the whole player within the city boundary', () => {
  for (const x of [-WORLD_LIMIT + 1.6, WORLD_LIMIT - 1.6]) {
    for (const z of [-WORLD_LIMIT + 1.6, WORLD_LIMIT - 1.6]) {
      for (let degrees = 0; degrees < 360; degrees += 15) {
        const car = { x, z, yaw: degrees * Math.PI / 180 }, exit = findExitPosition(car, [], .48, WORLD_LIMIT);
        if (!exit) continue;
        assert.ok(Math.abs(exit.x) < WORLD_LIMIT - .48 && Math.abs(exit.z) < WORLD_LIMIT - .48);
        assert.equal(circleHitsBox(exit.x, exit.z, .48, carCollider(car)), false);
      }
    }
  }
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

test('a clear camera aim cannot shoot through a car between the muzzle and its target', () => {
  const car = { x: 0, z: 0, yaw: .2 }, target = { x: 0, y: 3, z: -20 };
  const trace = origin => {
    const dx = target.x - origin.x, dy = target.y - origin.y, dz = target.z - origin.z, distance = Math.hypot(dx, dy, dz);
    return rayObstructionDistance(origin, { x: dx / distance, y: dy / distance, z: dz / distance }, distance, [], [car]);
  };
  assert.equal(trace({ x: .8, y: 3, z: 12 }), Infinity, 'Shoulder camera sees over the car');
  assert.ok(trace({ x: 0, y: 1.4, z: 4 }) < 3, 'The lower muzzle still hits its body');
  const origin = { x: 0, y: 1.4, z: 6 }, direction = { x: 0, y: 0, z: -1 };
  assert.ok(rayObstructionDistance(origin, direction, 20, { along: () => [] }, [car]) < 5, 'Touch assist and enemy sight honor car cover');
  assert.equal(rayObstructionDistance(origin, direction, 20, [], [car], car), Infinity, 'Enemy fire can target the occupied vehicle');
});

test('camera takes the short turn across the angle wrap', () => {
  assert.ok(Math.abs(angleDelta(Math.PI - .1, -Math.PI + .1) - .2) < 1e-6);
});
