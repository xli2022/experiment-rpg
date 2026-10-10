import { circleHitsBox, moveWithCollisions, overlapsHeight, supportHeight } from '../../src/core/physics.js';
import { stepJump } from '../../src/engine/player/jump.js';
import { footVelocity, MOVEMENT } from '../../src/engine/player/locomotion.js';
import { interiorContext, interiorSpatial, toLocal, toWorld } from '../../src/world/interior-physics.js';
import { cachedInteriorPlan, levelY } from '../../src/world/interior-plan.js';

// Player-scale grid search over one level, using the same collision tests as
// movement. Returns world-space waypoints from start to goal, or null.
export function findPath(spatial, plan, start, goal, y, step = .25) {
  const radius = .45, key = (i, j) => `${i},${j}`;
  const local = [toLocal(plan, start.x, start.z), toLocal(plan, goal.x, goal.z)];
  const ox = Math.min(local[0].x, local[1].x, ...plan.outline.map(p => p.x)) - 3, oz = Math.min(local[0].z, local[1].z, ...plan.outline.map(p => p.z)) - 3;
  const cell = p => [Math.round((p.x - ox) / step), Math.round((p.z - oz) / step)];
  const point = (i, j) => toWorld(plan, ox + i * step, oz + j * step);
  const [si, sj] = cell(local[0]), [gi, gj] = cell(local[1]);
  const free = new Map();
  const clear = (i, j) => {
    const k = key(i, j);
    if (!free.has(k)) {
      const p = point(i, j), floor = supportHeight(p.x, p.z, spatial.near(p.x, p.z, 1), y + .35, -100);
      free.set(k, Math.abs(floor - y) < .4 && !spatial.near(p.x, p.z, 1.5).some(b => !b.supportOnly && overlapsHeight(b, y) && circleHitsBox(p.x, p.z, radius, b)));
    }
    return free.get(k);
  };
  const previous = new Map([[key(si, sj), null]]), queue = [[si, sj]];
  for (let head = 0; head < queue.length && queue.length < 60000; head++) {
    const [i, j] = queue[head];
    if (i === gi && j === gj) {
      const path = []; let k = key(i, j);
      while (k) { const [a, b] = k.split(',').map(Number); path.unshift(point(a, b)); k = previous.get(k); }
      return path;
    }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [i + di, j + dj], k = key(...n);
      if (previous.has(k) || (!(n[0] === gi && n[1] === gj) && !clear(...n))) continue;
      previous.set(k, key(i, j)); queue.push(n);
    }
  }
  return null;
}

// Follow waypoints with main.js's movement order: velocity, collision,
// support and jump/fall. Returns the trace and any solid overlaps.
export function walk(city, player, waypoints, fps, { radius = .43 } = {}) {
  const dt = 1 / fps, trace = [], overlaps = [];
  let falls = 0;
  for (const target of waypoints) {
    for (let frame = 0; frame < fps * 12; frame++) {
      const dx = target.x - player.x, dz = target.z - player.z, distance = Math.hypot(dx, dz);
      if (distance < .2) break;
      const plan = city.planNear(player.x, player.z);
      const context = plan ? interiorContext(plan, player.x, player.y, player.z) : null;
      const spatial = context ? interiorSpatial(city.spatial, context) : city.spatial;
      const axes = { x: dx / distance, y: -dz / distance };
      const delta = footVelocity(player, axes, 0, dt, { sprint: false });
      const scale = Math.min(1, distance / Math.max(1e-6, Math.hypot(delta.x, delta.z)));
      moveWithCollisions(player, delta.x * scale, delta.z * scale, radius, spatial.near(player.x, player.z, 3));
      const ground = supportHeight(player.x, player.z, spatial.near(player.x, player.z, 2), player.y + .35, city.terrainHeight(player.x, player.z));
      const before = player.jumpPhase;
      stepJump(player, dt, ground);
      if (player.jumpPhase === 'fall' && before !== 'fall') falls++;
      if (spatial.near(player.x, player.z, 2).some(b => !b.supportOnly && overlapsHeight(b, player.y) && circleHitsBox(player.x, player.z, radius - .02, b))) overlaps.push({ x: player.x, y: player.y, z: player.z });
      trace.push({ x: player.x, y: player.y, z: player.z, level: context?.level ?? null, inside: context?.inside ?? false });
    }
  }
  return { trace, overlaps, falls };
}

export { cachedInteriorPlan, levelY, MOVEMENT };
