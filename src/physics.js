import { WORLD_LIMIT } from './world-config.js';
export { WORLD_LIMIT } from './world-config.js';
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const damp = (a, b, speed, dt) => a + (b - a) * (1 - Math.exp(-speed * dt));
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// Axis-aligned bounds are for the spatial index only. Narrow-phase tests use
// the same oriented dimensions as the rendered mesh.
export function orientedBox(x, z, w, d, yaw = 0, maxY = 1, minY = 0, extra = {}) {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const sx = (c * w + s * d) / 2, sz = (s * w + c * d) / 2;
  return { x, z, w, d, yaw, minX: x - sx, maxX: x + sx, minZ: z - sz, maxZ: z + sz, minY, maxY, ...extra };
}
export function boxCoordinates(x, z, box) {
  const cx = box.x ?? (box.minX + box.maxX) / 2, cz = box.z ?? (box.minZ + box.maxZ) / 2;
  const c = Math.cos(box.yaw ?? 0), s = Math.sin(box.yaw ?? 0), dx = x - cx, dz = z - cz;
  return { x: dx * c - dz * s, z: dx * s + dz * c, w: box.w ?? box.maxX - box.minX, d: box.d ?? box.maxZ - box.minZ };
}
export function boxContainsPoint(x, z, box, inset = 0) {
  const p = boxCoordinates(x, z, box);
  return Math.abs(p.x) <= p.w / 2 - inset && Math.abs(p.z) <= p.d / 2 - inset;
}
export function overlapsHeight(box, y = 0, height = 1.8, step = .25) {
  return (box.maxY ?? Infinity) > y + step && (box.minY ?? 0) < y + height - .02;
}
export function supportHeight(x, z, colliders, ceiling = Infinity) {
  let height = 0;
  for (const box of colliders) if (box.maxY <= ceiling + .02 && box.walkable !== false && boxContainsPoint(x, z, box)) height = Math.max(height, box.maxY);
  return height;
}

export function circleHitsBox(x, z, radius, box) {
  const p = boxCoordinates(x, z, box);
  const dx = p.x - clamp(p.x, -p.w / 2, p.w / 2);
  const dz = p.z - clamp(p.z, -p.d / 2, p.d / 2);
  return dx * dx + dz * dz < radius * radius;
}

// Resolve movement in small steps so sprinting and fast cars cannot tunnel through walls.
export function moveWithCollisions(position, dx, dz, radius, colliders, limit = WORLD_LIMIT) {
  if (!Array.isArray(colliders)) colliders = colliders.query(Math.min(position.x, position.x + dx) - radius, Math.min(position.z, position.z + dz) - radius, Math.max(position.x, position.x + dx) + radius, Math.max(position.z, position.z + dz) + radius);
  colliders = colliders.filter(box => overlapsHeight(box, position.y ?? 0, position.bodyHeight ?? 1.8));
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / Math.max(radius * 0.65, 0.2)));
  const sx = dx / steps, sz = dz / steps;
  let collided = false;
  for (let i = 0; i < steps; i++) {
    const nx = clamp(position.x + sx, -limit + radius, limit - radius);
    if (!colliders.some(b => circleHitsBox(nx, position.z, radius, b))) position.x = nx;
    else collided = true;
    const nz = clamp(position.z + sz, -limit + radius, limit - radius);
    if (!colliders.some(b => circleHitsBox(position.x, nz, radius, b))) position.z = nz;
    else collided = true;
    if (Math.abs(position.x) >= limit - radius || Math.abs(position.z) >= limit - radius) collided = true;
  }
  return collided;
}

export function carCollider(car) {
  return orientedBox(car.x, car.z, 2.34, 4.74, car.yaw, 1.85, 0, { walkable: false });
}

export function findExitPosition(car, colliders, radius = 0.48) {
  const obstacles = [carCollider(car), ...colliders.filter(box => overlapsHeight(box))];
  // Try both doors, then front/back. Never deposit a player inside a collider.
  const offsets = [[-2.8, 0], [2.8, 0], [0, 4.3], [0, -4.3], [-3.4, 3], [3.4, 3]];
  for (const [x, z] of offsets) {
    const p = {
      x: car.x + x * Math.cos(car.yaw) + z * Math.sin(car.yaw),
      z: car.z - x * Math.sin(car.yaw) + z * Math.cos(car.yaw),
    };
    if (Math.abs(p.x) < WORLD_LIMIT - radius && Math.abs(p.z) < WORLD_LIMIT - radius &&
        !obstacles.some(b => circleHitsBox(p.x, p.z, radius, b))) return p;
  }
  return null;
}

export function stepVehicle(car, throttle, steering, handbrake, dt) {
  const acceleration = throttle > 0 ? 20 : car.speed > 1 ? 34 : 11;
  car.speed += throttle * acceleration * dt;
  car.speed *= Math.exp(-(handbrake ? 4.5 : Math.abs(throttle) < 0.05 ? 0.85 : 0.2) * dt);
  car.speed = clamp(car.speed, -13, 42);
  if (Math.abs(car.speed) < 0.04) car.speed = 0;
  const turn = clamp(Math.abs(car.speed) / 7, 0, 1) * (1.3 - Math.min(Math.abs(car.speed) / 80, 0.5));
  car.yaw -= steering * turn * Math.sign(car.speed) * (handbrake ? 1.8 : 1) * dt;
  return { x: -Math.sin(car.yaw) * car.speed * dt, z: -Math.cos(car.yaw) * car.speed * dt };
}

export function rayBoxDistance(origin, direction, box, maxDistance = Infinity) {
  if (box.w !== undefined) {
    const p = boxCoordinates(origin.x, origin.z, box), c = Math.cos(box.yaw ?? 0), s = Math.sin(box.yaw ?? 0);
    origin = { x: p.x, y: origin.y, z: p.z };
    direction = { x: direction.x * c - direction.z * s, y: direction.y, z: direction.x * s + direction.z * c };
    box = { minX: -p.w / 2, maxX: p.w / 2, minZ: -p.d / 2, maxZ: p.d / 2, minY: box.minY, maxY: box.maxY };
  }
  let near = 0, far = maxDistance;
  for (const axis of ['x', 'y', 'z']) {
    const min = axis === 'x' ? box.minX : axis === 'z' ? box.minZ : (box.minY ?? 0);
    const max = axis === 'x' ? box.maxX : axis === 'z' ? box.maxZ : (box.maxY ?? 100);
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < min || origin[axis] > max) return Infinity;
    } else {
      let a = (min - origin[axis]) / direction[axis];
      let b = (max - origin[axis]) / direction[axis];
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a);
      far = Math.min(far, b);
      if (near > far) return Infinity;
    }
  }
  return near <= maxDistance ? near : Infinity;
}

// Camera aim, muzzle clearance, touch assist and enemy fire use the same cover.
export function rayObstructionDistance(origin, direction, maxDistance, scenery, cars = [], excludeCar = null) {
  const boxes = Array.isArray(scenery) ? scenery : scenery.along(origin, direction, maxDistance);
  let nearest = Infinity;
  for (const box of boxes) nearest = Math.min(nearest, rayBoxDistance(origin, direction, box, Math.min(nearest, maxDistance)));
  for (const car of cars) if (car !== excludeCar) nearest = Math.min(nearest, rayBoxDistance(origin, direction, carCollider(car), Math.min(nearest, maxDistance)));
  return nearest;
}

export function seededRandom(seed = 314159) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}
