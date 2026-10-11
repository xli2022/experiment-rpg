import { wallPoint } from '../../world/facade-windows.js';
import { INTERIOR } from '../../world/interior-plan.js';
import { resetFall } from './jump.js';

// Vaulting out through a window. A jump alone can't carry the body through
// many panes: some sills sit at hip height, and some openings are shorter
// than a standing person. Jumping at a window from inside (or reaching one in
// mid-air) instead climbs onto the sill, ducks through the middle of the
// opening and drops outside, smashing the glass first if it is still whole.

export const VAULT = Object.freeze({
  reach: 1.4, // how far ahead a jump looks for a window, in metres
  airReach: .9, // and an airborne body already moving toward one
  time: .55, // seconds from the floor to clear of the wall
  maxSill: 1.6, // highest sill above the floor that can be climbed onto
  minOpening: .7, // lowest opening that can be ducked through
  clear: .7, // how far outside the wall the body ends up
});

/**
 * The window ahead of an indoor player, as `{ hit, point }` where `hit` is
 * what `find(point)` gave (the building and pane), or null. `find` is the
 * world's window lookup; `buildingId` the building the player is in.
 */
export function windowAhead(player, find, buildingId, yaw = player.yaw, reach = VAULT.reach) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), floor = player.groundY ?? player.y;
  for (let d = .25; d <= reach; d += .1) for (const height of [1.1, .8, 1.4]) {
    const point = { x: player.x + fx * d, y: floor + height, z: player.z + fz * d }, hit = find(point);
    if (!hit || hit.p.id !== buildingId) continue;
    // The pane's wall faces away from the player, out of the building.
    const c = Math.cos(hit.p.yaw ?? 0), s = Math.sin(hit.p.yaw ?? 0), n = hit.pane.wall.normal;
    const nx = n.x * c + n.z * s, nz = -n.x * s + n.z * c;
    if (nx * fx + nz * fz < .3) continue;
    return { hit, point };
  }
  return null;
}

/** The vault through a window `hit`, or null when its sill or opening is out of reach. */
export function planVault(player, hit) {
  const { p, pane } = hit, wall = pane.wall, floor = player.groundY ?? player.y;
  const sill = wall.bottom + pane.v0, top = wall.bottom + pane.v1;
  if (sill < floor - .3 || sill - floor > VAULT.maxSill || top - sill < VAULT.minOpening) return null;
  const c = Math.cos(p.yaw ?? 0), s = Math.sin(p.yaw ?? 0), world = local => ({ x: p.x + local.x * c + local.z * s, z: p.z - local.x * s + local.z * c });
  const middle = (pane.s0 + pane.s1) / 2, inner = world(wallPoint(wall, middle, -INTERIOR.hull - .45)), outer = world(wallPoint(wall, middle, VAULT.clear));
  const nx = wall.normal.x * c + wall.normal.z * s, nz = -wall.normal.x * s + wall.normal.z * c;
  // Posed as a climb's final mantle: the climb animation reads phase and speed too.
  return {
    progress: 0, phase: 0, speed: 0, sill, roofY: sill, mode: 'mantle', yaw: Math.atan2(-nx, -nz), normal: { x: nx, z: nz },
    start: { x: player.x, y: player.y, z: player.z }, inner: { x: inner.x, y: Math.max(player.y, sill + .05), z: inner.z }, end: { x: outer.x, y: sill + .05, z: outer.z },
  };
}

export function startVault(player, vault) {
  resetFall(player);
  player.vault = vault; player.yaw = vault.yaw;
  player.jumpPhase = ''; player.velocityY = player.vx = player.vz = player.speed = player.pushTime = 0;
}

/** Advance a vault; on the last step the body drops away from the wall. Returns 'vault' or 'out'. */
export function stepVault(player, dt) {
  const vault = player.vault; if (!vault) return null;
  vault.progress = Math.min(1, vault.progress + dt / VAULT.time);
  const t = vault.progress, smooth = x => x * x * (3 - 2 * x);
  // Onto the sill and up to the opening first, then out through it.
  const up = smooth(Math.min(1, t / .45)), out = smooth(Math.max(0, (t - .45) / .55));
  const ax = vault.start.x + (vault.inner.x - vault.start.x) * up, az = vault.start.z + (vault.inner.z - vault.start.z) * up;
  player.x = ax + (vault.end.x - vault.inner.x) * out;
  player.z = az + (vault.end.z - vault.inner.z) * out;
  player.y = vault.start.y + (vault.inner.y - vault.start.y) * up + (vault.end.y - vault.inner.y) * out;
  if (t < 1) return 'vault';
  player.vault = null;
  resetFall(player);
  // A small hop outward, so the drop clears the sill and the wall below it.
  player.jumpPhase = 'fall'; player.jumpTime = 0; player.velocityY = 1.6;
  player.pushTime = .25; player.pushVX = vault.normal.x * 3.5; player.pushVZ = vault.normal.z * 3.5;
  player.vx = player.pushVX; player.vz = player.pushVZ;
  return 'out';
}
