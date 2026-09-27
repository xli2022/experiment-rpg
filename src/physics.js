export const WORLD_LIMIT = 147;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const damp = (a, b, speed, dt) => a + (b - a) * (1 - Math.exp(-speed * dt));
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function circleHitsBox(x, z, radius, box) {
  const dx = x - clamp(x, box.minX, box.maxX);
  const dz = z - clamp(z, box.minZ, box.maxZ);
  return dx * dx + dz * dz < radius * radius;
}

// Resolve movement in small steps so sprinting and fast cars cannot tunnel through walls.
export function moveWithCollisions(position, dx, dz, radius, colliders, limit = WORLD_LIMIT) {
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

export function findExitPosition(car, colliders, radius = 0.48) {
  // Try both doors, then front/back. Never deposit a player inside a building.
  const offsets = [[-2.8, 0], [2.8, 0], [0, 4.3], [0, -4.3], [-3.4, 3], [3.4, 3]];
  for (const [x, z] of offsets) {
    const p = {
      x: car.x + x * Math.cos(car.yaw) + z * Math.sin(car.yaw),
      z: car.z - x * Math.sin(car.yaw) + z * Math.cos(car.yaw),
    };
    if (Math.abs(p.x) < WORLD_LIMIT - radius && Math.abs(p.z) < WORLD_LIMIT - radius &&
        !colliders.some(b => circleHitsBox(p.x, p.z, radius, b))) return p;
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

export function seededRandom(seed = 314159) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}
