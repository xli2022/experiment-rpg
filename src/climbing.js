import { boxCoordinates, circleHitsBox, clamp, overlapsHeight, surfaceHeightAt } from './physics.js';
import { resetFall } from './jump.js';
import { footprintVertices, polygonFaces } from './building-footprints.js';

export const CLIMB = Object.freeze({ reach: 1.15, offset: .48, speed: 3.4, fast: 5.1, sideways: 2.3, mantleTime: .72 });
const identity = box => box.id ?? `${box.minX}:${box.minZ}:${box.maxX}:${box.maxZ}:${box.maxY}`;
const blocked = (x, y, z, boxes, own) => boxes.some(b => {
  if (identity(b) === own) return false;
  if (b.supportOnly) {
    const top = surfaceHeightAt(x, z, b);
    if (top === null) return false;
    const thickness = b.slabThickness ?? b.surface?.slabThickness ?? .5;
    return overlapsHeight({ minY: top - thickness, maxY: top }, y, 1.7, .08);
  }
  return overlapsHeight(b, y, 1.7, .08) && circleHitsBox(x, z, .38, b);
});

export function findClimbFace(player, boxes, yaw = player.yaw ?? 0, requireFacing = false) {
  let best = null;
  for (const box of boxes) {
    if (!box.climbable || box.maxY - (box.minY ?? 0) < 2.5 || player.y > box.maxY - .5 || player.y + 1.7 < (box.minY ?? 0)) continue;
    const p = boxCoordinates(player.x, player.z, box), c = Math.cos(box.yaw ?? 0), s = Math.sin(box.yaw ?? 0);
    const cx = box.x ?? (box.minX + box.maxX) / 2, cz = box.z ?? (box.minZ + box.maxZ) / 2;
    const faces = box.faces ?? polygonFaces(footprintVertices('rectangle', p.w, p.d));
    const worldFaces = faces.map((f, faceIndex) => {
      const nx = f.nx * c + f.nz * s, nz = -f.nx * s + f.nz * c;
      return { x: cx + f.x * c + f.z * s, z: cz - f.x * s + f.z * c,
        nx, nz, tx: nz, tz: -nx, width: f.width, faceIndex };
    });
    for (const [index, face] of faces.entries()) {
      const gap = (p.x - face.x) * face.nx + (p.z - face.z) * face.nz;
      const along = (p.x - face.x) * face.nz - (p.z - face.z) * face.nx;
      if (gap < .05 || gap > CLIMB.reach || Math.abs(along) > face.width / 2 - (box.faces ? 0 : .4)) continue;
      const { nx, nz } = worldFaces[index];
      if (requireFacing && -Math.sin(yaw) * nx - Math.cos(yaw) * nz > -.3) continue;
      if (best && best.gap <= gap) continue;
      best = { ...worldFaces[index], gap, roofY: box.maxY, baseY: box.minY ?? 0, id: identity(box), u: along,
        ...(box.faces ? { perimeterFaces: worldFaces } : {}) };
    }
  }
  return best;
}

export function startClimb(player, face, boxes = []) {
  if (!face || player.climb) return false;
  const x = face.x + face.tx * face.u + face.nx * CLIMB.offset, z = face.z + face.tz * face.u + face.nz * CLIMB.offset;
  if (blocked(x, player.y, z, boxes, face.id)) return false;
  resetFall(player);
  player.x = x; player.z = z; player.yaw = Math.atan2(face.nx, face.nz);
  player.climb = { ...face, mode: 'climb', phase: 0, speed: 0, blocked: false, progress: 0 };
  player.jumpPhase = ''; player.velocityY = player.vx = player.vz = player.speed = 0;
  return true;
}

export function dropClimb(player, push = false) {
  if (!player.climb) return false;
  resetFall(player);
  const { x, z, nx, nz, tx, tz, u } = player.climb;
  // A mantle moves inward before the feet clear the ledge. Cancelling must
  // return to the outside face so ordinary collision cannot trap us in it.
  player.x = x + tx * u + nx * CLIMB.offset;
  player.z = z + tz * u + nz * CLIMB.offset;
  player.climb = null; player.jumpPhase = 'fall'; player.jumpTime = 0;
  player.velocityY = push ? 3.8 : 0;
  player.pushTime = push ? .24 : 0; player.pushVX = nx * 5.5; player.pushVZ = nz * 5.5;
  player.vx = push ? player.pushVX : 0; player.vz = push ? player.pushVZ : 0;
  return true;
}

export function stepClimb(player, axes, dt, boxes, fast = false) {
  const state = player.climb; if (!state) return null;
  if (state.mode === 'mantle') {
    state.progress = Math.min(1, state.progress + dt / CLIMB.mantleTime);
    const t = state.progress, smooth = x => x * x * (3 - 2 * x);
    const lift = smooth(Math.min(1, t / .65)), inward = smooth(clamp((t - .25) / .75, 0, 1));
    player.y = state.start.y + (state.end.y - state.start.y) * lift;
    player.x = state.start.x + (state.end.x - state.start.x) * inward;
    player.z = state.start.z + (state.end.z - state.start.z) * inward;
    if (t === 1) { player.climb = null; player.groundY = player.y = state.end.y; player.velocityY = 0; player.jumpPhase = ''; resetFall(player); return 'roof'; }
    return 'mantle';
  }
  let face = state, u = state.u + axes.x * CLIMB.sideways * dt;
  if (state.perimeterFaces) {
    const faces = state.perimeterFaces;
    // Follow adjacent faces so round walls do not trap a shimmy in one tiny
    // tessellation segment. Hexagonal corners use the same perimeter path.
    for (let i = 0; i < faces.length && Math.abs(u) > face.width / 2; i++) {
      const forward = u > 0, excess = u - (forward ? 1 : -1) * face.width / 2;
      face = faces[(face.faceIndex + (forward ? -1 : 1) + faces.length) % faces.length];
      u = (forward ? -1 : 1) * face.width / 2 + excess;
    }
  } else u = clamp(u, -state.width / 2 + .5, state.width / 2 - .5);
  const y = Math.max(state.baseY, player.y + axes.y * (fast ? CLIMB.fast : CLIMB.speed) * dt);
  const x = face.x + face.tx * u + face.nx * CLIMB.offset, z = face.z + face.tz * u + face.nz * CLIMB.offset;
  state.blocked = blocked(x, y, z, boxes, state.id);
  state.speed = 0;
  if (!state.blocked) {
    const dy = y - player.y, du = face === state ? u - state.u : axes.x * CLIMB.sideways * dt;
    state.speed = Math.hypot(dy, du) / dt;
    state.phase += (dy || du) / .85;
    player.x = x; player.z = z; player.y = y; Object.assign(state, face, { u });
    player.yaw = Math.atan2(state.nx, state.nz);
  }
  if (player.y <= state.baseY + .02 && axes.y < 0) { dropClimb(player); return 'ground'; }
  if (player.y >= state.roofY - 1.15 && axes.y > 0) {
    const end = { x: state.x + state.tx * state.u - state.nx * .9, z: state.z + state.tz * state.u - state.nz * .9, y: state.roofY };
    if (blocked(end.x, end.y, end.z, boxes, state.id)) {
      player.y = Math.min(player.y, state.roofY - 1.15); state.blocked = true; state.speed = 0; return 'blocked';
    }
    state.mode = 'mantle'; state.progress = 0; state.start = { x: player.x, y: player.y, z: player.z }; state.end = end;
    return 'mantle';
  }
  return 'climb';
}
