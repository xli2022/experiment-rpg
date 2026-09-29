import { WORLD_LIMIT } from './world-config.js';
import { footprintVertices, polygonFaces } from './building-footprints.js';
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
export function orientedPrism(x, z, w, d, yaw, maxY, minY, footprint = 'rectangle', extra = {}) {
  const box = orientedBox(x, z, w, d, yaw, maxY, minY, { ...extra, footprint });
  if (footprint !== 'rectangle') {
    box.vertices = footprintVertices(footprint, w, d);
    box.faces = polygonFaces(box.vertices);
  }
  return box;
}
export function boxCoordinates(x, z, box) {
  const cx = box.x ?? (box.minX + box.maxX) / 2, cz = box.z ?? (box.minZ + box.maxZ) / 2;
  const c = Math.cos(box.yaw ?? 0), s = Math.sin(box.yaw ?? 0), dx = x - cx, dz = z - cz;
  return { x: dx * c - dz * s, z: dx * s + dz * c, w: box.w ?? box.maxX - box.minX, d: box.d ?? box.maxZ - box.minZ };
}
export function boxContainsPoint(x, z, box, inset = 0) {
  const p = boxCoordinates(x, z, box);
  if (box.faces) return box.faces.every(f => (p.x - f.x) * f.nx + (p.z - f.z) * f.nz <= -inset + 1e-9);
  return Math.abs(p.x) <= p.w / 2 - inset && Math.abs(p.z) <= p.d / 2 - inset;
}
export function overlapsHeight(box, y = 0, height = 1.8, step = .25) {
  return (box.maxY ?? Infinity) > y + step && (box.minY ?? 0) < y + height - .02;
}

function surfaceFrame(box) {
  const surface = box.surface ?? (box.a && box.b ? box : null);
  if (!surface) return null;
  const { a, b } = surface, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
  if (length < 1e-8) return null;
  return { a, length, tx: dx / length, tz: dz / length, slope: ((b.y ?? 0) - (a.y ?? 0)) / length,
    crossSlope: surface.crossSlope ?? box.crossSlope ?? 0, width: surface.width ?? box.width ?? box.w,
    thickness: Math.max(0, box.slabThickness ?? surface.slabThickness ?? .5), endOverlap: box.supportOverlap ?? surface.supportOverlap ?? .12 };
}

// Road endpoints describe the top of the slab. The broad-phase bounds may span
// many vertical metres, so their maxY is never a valid ramp support height.
export function surfaceHeightAt(x, z, box) {
  const frame = surfaceFrame(box);
  if (!frame) return boxContainsPoint(x, z, box) && Number.isFinite(box.maxY) ? box.maxY : null;
  const dx = x - frame.a.x, dz = z - frame.a.z;
  const along = dx * frame.tx + dz * frame.tz, across = -dx * frame.tz + dz * frame.tx;
  // Rendered road boxes overlap at joins, with larger caps on wide/tight bends.
  // Continue the slab's grade through that same extension so outer lanes cannot
  // fall between segments or snap onto an incorrectly flattened cap.
  if (along < -frame.endOverlap - 1e-7 || along > frame.length + frame.endOverlap + 1e-7 || Math.abs(across) > frame.width / 2 + 1e-7) return null;
  return (frame.a.y ?? 0) + frame.slope * along + frame.crossSlope * across;
}

export function supportHeight(x, z, colliders, ceiling = Infinity, baseHeight = 0) {
  let height = baseHeight;
  for (const box of colliders) {
    if (box.walkable === false) continue;
    const top = surfaceHeightAt(x, z, box);
    if (top !== null && top <= ceiling + .02) height = Math.max(height, top);
  }
  return height;
}

export function circleHitsBox(x, z, radius, box) {
  const p = boxCoordinates(x, z, box);
  if (box.faces) {
    let inside = true, distance2 = Infinity;
    for (const f of box.faces) {
      const dx = p.x - f.x, dz = p.z - f.z, outward = dx * f.nx + dz * f.nz;
      if (outward > radius) return false;
      inside &&= outward <= 0;
      const along = clamp(dx * f.nz - dz * f.nx, -f.width / 2, f.width / 2);
      distance2 = Math.min(distance2, (dx - f.nz * along) ** 2 + (dz + f.nx * along) ** 2);
    }
    return inside || distance2 < radius * radius;
  }
  const dx = p.x - clamp(p.x, -p.w / 2, p.w / 2);
  const dz = p.z - clamp(p.z, -p.d / 2, p.d / 2);
  return dx * dx + dz * dz < radius * radius;
}

// Resolve movement in small steps so sprinting and fast cars cannot tunnel through walls.
export function moveWithCollisions(position, dx, dz, radius, colliders, limit = WORLD_LIMIT) {
  if (!Array.isArray(colliders)) colliders = colliders.query(Math.min(position.x, position.x + dx) - radius, Math.min(position.z, position.z + dz) - radius, Math.max(position.x, position.x + dx) + radius, Math.max(position.z, position.z + dz) + radius);
  // Height is resolved against the actual terrain/road support by the caller.
  // Ramp slabs therefore never act as the tall walls of their bounding boxes.
  colliders = colliders.filter(box => !box.supportOnly && overlapsHeight(box, position.y ?? 0, position.bodyHeight ?? 1.8));
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
  const y = car.y ?? 0;
  return orientedBox(car.x, car.z, 2.34, 4.74, car.yaw, y + 1.85, y, { walkable: false });
}

export function findExitPosition(car, colliders, radius = 0.48) {
  const obstacles = [carCollider(car), ...colliders.filter(box => !box.supportOnly && overlapsHeight(box, car.y ?? 0))];
  // Try both doors, then front/back. Never deposit a player inside a collider.
  const offsets = [[-2.8, 0], [2.8, 0], [0, 4.3], [0, -4.3], [-3.4, 3], [3.4, 3]];
  for (const [x, z] of offsets) {
    const p = {
      x: car.x + x * Math.cos(car.yaw) + z * Math.sin(car.yaw),
      z: car.z - x * Math.sin(car.yaw) + z * Math.cos(car.yaw),
    };
    if (car.y !== undefined) p.y = car.y;
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
  const frame = surfaceFrame(box);
  if (frame) {
    const dx = origin.x - frame.a.x, dz = origin.z - frame.a.z;
    const along = dx * frame.tx + dz * frame.tz, alongDirection = direction.x * frame.tx + direction.z * frame.tz;
    const across = -dx * frame.tz + dz * frame.tx, acrossDirection = -direction.x * frame.tz + direction.z * frame.tx;
    // A shear flattens the inclined slab without changing the ray parameter.
    // This gives its real top, underside and edge hits instead of phantom cover
    // filling the full vertical bounds beneath an elevated approach.
    return rayBoxDistance(
      { x: across, y: origin.y - (frame.a.y ?? 0) - frame.slope * along - frame.crossSlope * across, z: along },
      { x: acrossDirection, y: direction.y - frame.slope * alongDirection - frame.crossSlope * acrossDirection, z: alongDirection },
      { minX: -frame.width / 2, maxX: frame.width / 2, minZ: -frame.endOverlap, maxZ: frame.length + frame.endOverlap, minY: -frame.thickness, maxY: 0 },
      maxDistance,
    );
  }
  if (box.w !== undefined) {
    const p = boxCoordinates(origin.x, origin.z, box), c = Math.cos(box.yaw ?? 0), s = Math.sin(box.yaw ?? 0);
    origin = { x: p.x, y: origin.y, z: p.z };
    direction = { x: direction.x * c - direction.z * s, y: direction.y, z: direction.x * s + direction.z * c };
    if (box.faces) {
      let near = 0, far = maxDistance;
      // Clip against the actual convex walls, roof and underside. Camera and
      // projectile rays must pass through the unused corners of the lot.
      const planes = box.faces.map(f => [f.nx, 0, f.nz, f.nx * f.x + f.nz * f.z]);
      planes.push([0, 1, 0, box.maxY ?? 100], [0, -1, 0, -(box.minY ?? 0)]);
      for (const [nx, ny, nz, offset] of planes) {
        const distance = offset - nx * origin.x - ny * origin.y - nz * origin.z;
        const velocity = nx * direction.x + ny * direction.y + nz * direction.z;
        if (Math.abs(velocity) < 1e-8) { if (distance < -1e-9) return Infinity; }
        else if (velocity < 0) near = Math.max(near, distance / velocity);
        else far = Math.min(far, distance / velocity);
        if (near > far + 1e-9) return Infinity;
      }
      return near;
    }
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
