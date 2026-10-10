import test from 'node:test';
import assert from 'node:assert/strict';
import { orientedBox, surfaceHeightAt, supportHeight, moveWithCollisions, carCollider, findExitPosition, rayBoxDistance, rayObstructionDistance, overlapsHeight } from '../src/core/physics.js';

function ramp(a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 10, z: 100 }, width = 12, nested = true) {
  const yaw = Math.atan2(b.x - a.x, b.z - a.z), length = Math.hypot(b.x - a.x, b.z - a.z);
  return orientedBox((a.x + b.x) / 2, (a.z + b.z) / 2, width, length, yaw, Math.max(a.y, b.y), Math.min(a.y, b.y) - .6,
    { supportOnly: true, slabThickness: .6, ...(nested ? { surface: { a, b, width } } : { a, b, width }) });
}

test('ramp support interpolates along its oriented footprint and accepts both metadata forms', () => {
  for (const nested of [true, false]) {
    const slope = ramp({ x: 10, y: -2, z: 20 }, { x: 70, y: 10, z: 100 }, 12, nested);
    assert.equal(surfaceHeightAt(10, 20, slope), -2);
    assert.equal(surfaceHeightAt(40, 60, slope), 4);
    assert.equal(surfaceHeightAt(70, 100, slope), 10);
    assert.equal(surfaceHeightAt(40 - 4, 60 + 3, slope), 4, 'Across-road offset has no change in elevation');
    assert.equal(surfaceHeightAt(40 - 8, 60 + 6, slope), null, 'Bounding-box corner is outside the real ramp');
    assert.equal(surfaceHeightAt(9.4, 19.2, slope), null, 'There is no support past a segment end');
    assert.equal(supportHeight(40, 60, [slope], 4.1, -5), 4);
    assert.equal(supportHeight(40, 60, [slope], 3.8, -5), -5, 'A higher deck cannot pull a player up from below');
  }
});

test('ascending and descending ramp travel stays smooth without hitting its enclosing volume', () => {
  const slope = ramp(), deck = orientedBox(0, 115, 12, 30, 0, 10, 9.4, { supportOnly: true });
  const colliders = [slope, deck], car = { x: 0, y: 0, z: 0, bodyHeight: 1.85 };
  for (let i = 0; i < 120; i++) {
    assert.equal(moveWithCollisions(car, 0, 1, 1.6, colliders), false);
    const next = supportHeight(car.x, car.z, colliders, car.y + .3, 0);
    assert.ok(Math.abs(next - car.y) <= .100001); car.y = next;
  }
  assert.equal(car.y, 10);
  for (let i = 0; i < 120; i++) {
    assert.equal(moveWithCollisions(car, 0, -1, 1.6, colliders), false);
    const next = supportHeight(car.x, car.z, colliders, car.y + .3, 0);
    assert.ok(Math.abs(next - car.y) <= .100001); car.y = next;
  }
  assert.ok(Math.abs(car.y) < 1e-8);
});

test('bridge support is separated from ground movement while elevated rails remain solid', () => {
  const bridge = ramp({ x: -30, y: 10, z: 0 }, { x: 30, y: 10, z: 0 });
  const rail = orientedBox(0, 6, 60, .4, 0, 11.5, 9.8);
  const below = { x: 0, y: 0, z: -15 }, above = { x: 0, y: 10, z: 0 };
  assert.equal(moveWithCollisions(below, 0, 30, 1.6, [bridge, rail]), false);
  assert.equal(supportHeight(0, 0, [bridge], 1, -3), -3);
  assert.equal(supportHeight(0, 0, [bridge], 10.2, -3), 10);
  assert.equal(moveWithCollisions(above, 0, 12, 1.6, [bridge, rail]), true);
  assert.ok(above.z < 6);
  assert.equal(supportHeight(50, 50, [], Infinity, -8), -8, 'Terrain below sea level is not clamped to zero');
});

test('vehicle colliders and exits stay on their floor and ignore objects on other levels', () => {
  const car = { x: 0, y: 12, z: 0, yaw: 0 }, box = carCollider(car);
  assert.equal(box.minY, 12); assert.equal(box.maxY, 13.85);
  assert.equal(overlapsHeight(box, 0), false); assert.equal(overlapsHeight(box, 12), true);
  const bridge = orientedBox(0, 0, 16, 30, 0, 12, 11.4, { supportOnly: true });
  const groundBuilding = orientedBox(0, 0, 20, 20, 0, 8, 0);
  const overhead = orientedBox(0, 0, 20, 20, 0, 20, 16);
  const doorWall = orientedBox(-2.8, 0, 1, 6, 0, 15, 12);
  const exit = findExitPosition(car, [bridge, groundBuilding, overhead, doorWall]);
  assert.equal(exit.y, 12); assert.ok(exit.x > 0);
  assert.equal(moveWithCollisions({ ...exit }, .3, 0, .43, [box, bridge, groundBuilding, overhead]), false);
  assert.equal('y' in findExitPosition({ x: 0, z: 0, yaw: 0 }, []), false, 'Legacy callers keep the previous object shape');
});

test('rays intersect a ramp top and underside without phantom walls in the empty space below', () => {
  const slope = ramp();
  assert.equal(rayBoxDistance({ x: -20, y: 2, z: 80 }, { x: 1, y: 0, z: 0 }, slope), Infinity);
  assert.ok(Math.abs(rayBoxDistance({ x: 0, y: 2, z: 80 }, { x: 0, y: 1, z: 0 }, slope) - 5.4) < 1e-8);
  assert.equal(rayBoxDistance({ x: 0, y: 15, z: 80 }, { x: 0, y: -1, z: 0 }, slope), 7);
  assert.equal(rayBoxDistance({ x: -20, y: 7.8, z: 80 }, { x: 1, y: 0, z: 0 }, slope), 14);
  assert.equal(rayBoxDistance({ x: 0, y: 15, z: 80 }, { x: 0, y: -1, z: 0 }, slope, 6), Infinity);
  const barrier = orientedBox(8, 80, 1, 4, 0, 4);
  assert.equal(rayObstructionDistance({ x: -20, y: 2, z: 80 }, { x: 1, y: 0, z: 0 }, 40, [slope, barrier]), 27.5);
});

test('ground and elevated vehicle cover only obstruct rays at their real elevation', () => {
  const elevated = { x: 0, y: 12, z: 0, yaw: 0 };
  assert.equal(rayObstructionDistance({ x: 0, y: 1.5, z: 10 }, { x: 0, y: 0, z: -1 }, 20, [], [elevated]), Infinity);
  assert.ok(Math.abs(rayObstructionDistance({ x: 0, y: 13.5, z: 10 }, { x: 0, y: 0, z: -1 }, 20, [], [elevated]) - 7.63) < 1e-8);
});

test('inclined slab ray hits remain correct after rotation and when its height decreases', () => {
  for (const reverse of [false, true]) for (const nested of [false, true]) {
    const a = { x: -40, y: 3, z: 20 }, b = { x: 20, y: 15, z: 100 };
    const slope = ramp(reverse ? b : a, reverse ? a : b, 12, nested);
    assert.ok(Math.abs(rayBoxDistance({ x: -10, y: 0, z: 60 }, { x: 0, y: 1, z: 0 }, slope) - 8.4) < 1e-8);
    assert.ok(Math.abs(rayBoxDistance({ x: -10, y: 15, z: 60 }, { x: 0, y: -1, z: 0 }, slope) - 6) < 1e-8);
    assert.ok(Math.abs(rayBoxDistance({ x: -26, y: 8.8, z: 72 }, { x: .8, y: 0, z: -.6 }, slope) - 14) < 1e-8);
    assert.equal(rayBoxDistance({ x: -26, y: 5, z: 72 }, { x: .8, y: 0, z: -.6 }, slope), Infinity);
  }
});
