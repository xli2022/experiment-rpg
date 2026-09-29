import { boxContainsPoint, boxCoordinates, circleHitsBox, moveWithCollisions, overlapsHeight, supportHeight } from '../../src/physics.js';
import { beginJump, JUMP, stepJump } from '../../src/jump.js';
import { footVelocity, MOVEMENT } from '../../src/locomotion.js';
import { SpatialGrid } from '../../src/spatial-grid.js';
import { terrainHeight } from '../../src/master-plan.js';

function corners(box) {
  const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  const vertices = box.vertices ?? [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({ x: x * box.w / 2, z: z * box.d / 2 }));
  return vertices.map(({ x, z }) => ({
    x: box.x + x * c + z * s,
    z: box.z - x * s + z * c,
  }));
}

function pointToEdge(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

// Measure the rotated roof perimeter, not its broad-phase bounding rectangle.
export function roofGap(a, b) {
  const ac = corners(a), bc = corners(b);
  return Math.min(...ac.flatMap(p => bc.map((q, i) => pointToEdge(p, q, bc[(i + 1) % bc.length]))),
    ...bc.flatMap(p => ac.map((q, i) => pointToEdge(p, q, ac[(i + 1) % ac.length]))));
}

export function nearestRoofPairs(buildings) {
  return buildings.flatMap(source => {
    let target, gap = Infinity;
    for (const candidate of buildings) {
      if (candidate === source || Math.hypot(source.x - candidate.x, source.z - candidate.z) > 150) continue;
      const distance = roofGap(source.box, candidate.box);
      if (distance < gap) { gap = distance; target = candidate; }
    }
    return target ? [{ source, target, gap, drop: source.box.maxY - target.box.maxY }] : [];
  });
}

export function traversalSpatial(blocks, plan) {
  const grid = new SpatialGrid(blocks.flatMap(block => block.colliders));
  const supportCollider = s => s.a
    ? { ...s, supportOnly: true, walkable: true, slabThickness: .65 }
    : { ...s, w: s.width ?? s.w, d: s.depth ?? s.d, yaw: 0, supportOnly: true, walkable: true, minY: s.y - .65, maxY: s.y };
  return {
    near(x, z, radius) {
      return grid.near(x, z, radius).concat(plan.roadIndex.near(x, z, radius).map(supportCollider),
        plan.supportIndex.near(x, z, radius).map(supportCollider));
    },
  };
}

function lineSpan(box, origin, direction) {
  const p = boxCoordinates(origin.x, origin.z, box), c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  if (box.faces) {
    const dx = direction.x * c - direction.z * s, dz = direction.x * s + direction.z * c;
    let enter = -Infinity, exit = Infinity;
    for (const face of box.faces) {
      const distance = (face.x - p.x) * face.nx + (face.z - p.z) * face.nz;
      const velocity = dx * face.nx + dz * face.nz;
      if (Math.abs(velocity) < 1e-8) { if (distance < .6) return null; }
      else if (velocity > 0) exit = Math.min(exit, distance / velocity);
      else enter = Math.max(enter, distance / velocity);
    }
    return enter < exit ? { enter, exit } : null;
  }
  const axes = [[p.x, direction.x * c - direction.z * s, box.w / 2],
    [p.z, direction.x * s + direction.z * c, box.d / 2]];
  let enter = -Infinity, exit = Infinity;
  for (const [position, velocity, half] of axes) {
    if (Math.abs(velocity) < 1e-8) { if (Math.abs(position) >= half - .6) return null; continue; }
    const a = (-half - position) / velocity, b = (half - position) / velocity;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  return enter < exit ? { enter, exit } : null;
}

// Start on a clear roof with an established sprint. Use the same horizontal,
// collision, support and jump ordering as main.js; braking in the air is normal
// player input and prevents overshooting a low roof during a longer descent.
export function simulateRoofJump(pair, spatial, fps, lane = 0) {
  const { source, target } = pair;
  const dx = target.x - source.x, dz = target.z - source.z, length = Math.hypot(dx, dz);
  const direction = { x: dx / length, z: dz / length };
  const origin = { x: source.x - direction.z * lane, z: source.z + direction.x * lane };
  const from = lineSpan(source.box, origin, direction), to = lineSpan(target.box, origin, direction);
  if (!from || !to || to.enter <= from.exit || to.exit - to.enter < 3) return null;
  const start = from.exit - MOVEMENT.sprint * JUMP.takeoff - .4;
  const point = distance => ({ x: origin.x + direction.x * distance, z: origin.z + direction.z * distance });
  const player = { ...point(start), y: source.box.maxY, groundY: source.box.maxY,
    vx: direction.x * MOVEMENT.sprint, vz: direction.z * MOVEMENT.sprint, velocityY: 0, jumpPhase: '' };
  const bodyBlocked = () => spatial.near(player.x, player.z, 3)
    .some(box => !box.supportOnly && overlapsHeight(box, player.y) && circleHitsBox(player.x, player.z, .43, box));
  const safelyOnTarget = () => Math.abs(player.y - target.box.maxY) < .001 &&
    boxContainsPoint(player.x, player.z, target.box, .43) && !bodyBlocked();
  if (!boxContainsPoint(player.x, player.z, source.box, .43) || bodyBlocked()) return null;
  if (!beginJump(player)) return null;
  const stopAt = to.enter + Math.min(3, (to.exit - to.enter) / 3);
  let leftSource = false;
  for (let frame = 0; frame < fps * 20; frame++) {
    const progress = (player.x - origin.x) * direction.x + (player.z - origin.z) * direction.z;
    const axes = progress < stopAt ? { x: direction.x, y: -direction.z } : { x: 0, y: 0 };
    const delta = footVelocity(player, axes, 0, 1 / fps, { sprint: true });
    moveWithCollisions(player, delta.x, delta.z, .43, spatial.near(player.x, player.z, 3));
    const groundY = supportHeight(player.x, player.z, spatial.near(player.x, player.z, 2), player.y + .35, terrainHeight(player.x, player.z));
    stepJump(player, 1 / fps, groundY);
    leftSource ||= !boxContainsPoint(player.x, player.z, source.box);
    if (player.jumpPhase === 'land') {
      // Falling is resolved after horizontal collision. A center supported by
      // the main roof can still have its body inside nearby rooftop equipment;
      // require an unobstructed landing and enough room to finish braking.
      if (!leftSource || !safelyOnTarget()) return null;
      for (let settle = 0; settle < Math.ceil(fps * .3); settle++) {
        const brake = footVelocity(player, { x: 0, y: 0 }, 0, 1 / fps, { sprint: true });
        moveWithCollisions(player, brake.x, brake.z, .43, spatial.near(player.x, player.z, 3));
        const support = supportHeight(player.x, player.z, spatial.near(player.x, player.z, 2), player.y + .35, terrainHeight(player.x, player.z));
        stepJump(player, 1 / fps, support);
        if (!safelyOnTarget()) return null;
      }
      return { fps, lane, frames: frame + 1, position: { x: player.x, y: player.y, z: player.z }, crossingGap: to.enter - from.exit };
    }
  }
  return null;
}

export function findRepeatableJump(pairs, spatial) {
  for (const pair of pairs) for (const lane of [0, -2, 2, -4, 4, -6, 6]) {
    const runs = [30, 60, 120].map(fps => simulateRoofJump(pair, spatial, fps, lane));
    if (runs.every(Boolean)) return { ...pair, runs };
  }
  return null;
}
