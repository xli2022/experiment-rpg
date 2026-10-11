import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVerticalCity } from '../src/world/vertical-city.js';
import { WorldStream } from '../src/world/world-stream.js';
import { AFTERLIGHT_LANDMARKS as LANDMARKS } from '../src/world/landmarks.js';
import { MASTER_DISTRICTS as DISTRICTS } from '../src/world/master-plan.js';
import { cachedInteriorPlan, levelY } from '../src/world/interior-plan.js';
import { interiorContext, toWorld } from '../src/world/interior-physics.js';
import { circleHitsBox, moveWithCollisions, overlapsHeight, supportHeight } from '../src/core/physics.js';
import { footVelocity } from '../src/engine/player/locomotion.js';
import { beginJump, stepJump } from '../src/engine/player/jump.js';
import { VAULT, windowAhead, planVault, startVault, stepVault } from '../src/engine/player/window-vault.js';

const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream, LANDMARKS);
// One window on the first upper floor of each of a few buildings, with a clear
// spot to start from inside it.
const windows = [];
for (const d of DISTRICTS.slice(0, 6)) for (const block of city.metropolis.area(d.x - 90, d.z - 90, d.x + 90, d.z + 90)) for (const p of block.buildings) {
  const plan = cachedInteriorPlan(p);
  if (!plan || plan.industrial || plan.levels < 3 || windows.length >= 24) continue;
  const floor = levelY(plan, 1), template = plan.templates[Math.min(1, plan.templates.length - 1)];
  for (const seg of template.perimeter) for (const o of seg.openings.filter(o => o.window).slice(0, 1)) {
    const length = Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z), ux = (seg.b.x - seg.a.x) / length, uz = (seg.b.z - seg.a.z) / length, out = { x: uz, z: -ux };
    const mid = (o.from + o.to) / 2, local = { x: seg.a.x + ux * mid, z: seg.a.z + uz * mid };
    const spatial = city.spatialFor(interiorContext(plan, toWorld(plan, local.x - out.x * 1.6, local.z - out.z * 1.6).x, floor, toWorld(plan, local.x - out.x * 1.6, local.z - out.z * 1.6).z));
    const free = back => { const w = toWorld(plan, local.x - out.x * back, local.z - out.z * back); return !spatial.near(w.x, w.z, 2).some(b => !b.supportOnly && overlapsHeight(b, floor) && circleHitsBox(w.x, w.z, .45, b)); };
    if ([.95, 1.6, 3].every(free)) windows.push({ p, plan, floor, local, out });
  }
}
const glass = ({ plan, floor, local, out }) => ({ ...toWorld(plan, local.x + out.x * .1, local.z + out.z * .1), y: floor + 1.2 });

// The game loop on foot: jump (or vault) when asked, steer straight ahead, and
// vault from mid-air when a window comes within reach.
function run(w, { back, jumpAt, angle = 0, fps = 60 }) {
  const { plan, floor, local, out } = w, dt = 1 / fps;
  const dir = { x: out.x * Math.cos(angle) - out.z * Math.sin(angle), z: out.z * Math.cos(angle) + out.x * Math.sin(angle) };
  const start = toWorld(plan, local.x - dir.x * back, local.z - dir.z * back), toward = toWorld(plan, local.x + dir.x, local.z + dir.z);
  const heading = Math.atan2(-(toward.x - start.x), -(toward.z - start.z));
  const player = { x: start.x, z: start.z, y: floor, groundY: floor, velocityY: 0, vx: 0, vz: 0, jumpPhase: '', yaw: heading };
  const vault = (reach, yaw) => {
    const context = interiorContext(plan, player.x, player.y, player.z);
    if (!context?.inside) return false;
    const ahead = windowAhead(player, city.windows.find, context.id, yaw, reach), plan2 = ahead && planVault(player, ahead.hit);
    if (!plan2) return false;
    if (!city.windows.has(ahead.hit.p.id, ahead.hit.pane.key)) city.windows.breakAt(ahead.point);
    startVault(player, plan2); return true;
  };
  let vaulted = false;
  for (let f = 0; f < fps * 3; f++) {
    if (player.vault) { stepVault(player, dt); vaulted = true; continue; }
    const spatial = city.spatialFor(interiorContext(plan, player.x, player.y, player.z));
    if (f === Math.round(jumpAt * fps) && !vault(VAULT.reach, heading)) beginJump(player);
    const delta = footVelocity(player, { x: 0, y: 1 }, heading, dt, { sprint: false });
    if (player.pushTime > 0) { player.pushTime -= dt; delta.x = player.pushVX * dt; delta.z = player.pushVZ * dt; }
    moveWithCollisions(player, delta.x, delta.z, .43, spatial.near(player.x, player.z, 3));
    stepJump(player, dt, supportHeight(player.x, player.z, spatial.near(player.x, player.z, 2), player.y + .35, city.terrainHeight(player.x, player.z)));
    if (player.jumpPhase && player.jumpPhase !== 'land') vault(VAULT.airReach, Math.atan2(-delta.x, -delta.z));
    if (!interiorContext(plan, player.x, player.y, player.z)?.inside && player.y < floor - 1) return { out: true, vaulted };
  }
  return { out: false, vaulted };
}

test('jumping at a window from inside climbs over the sill and drops out, glass or not', () => {
  assert.ok(windows.length >= 12, `${windows.length} windows`);
  const failed = [];
  for (const w of windows) for (const [name, options, broken] of [
    ['standing jump', { back: .95, jumpAt: .02 }, true],
    ['jump at an angle', { back: 1.2, jumpAt: .02, angle: .5 }, true],
    ['running jump', { back: 3, jumpAt: .1 }, true],
    ['into whole glass', { back: .95, jumpAt: .02 }, false],
    ['at 30 FPS', { back: .95, jumpAt: .02, fps: 30 }, true],
  ]) {
    city.windows.clear();
    if (broken) city.windows.breakAt(glass(w));
    const result = run(w, options);
    if (!result.out || !result.vaulted) failed.push(`${w.p.id} ${name}`);
    if (!broken) assert.ok(city.windows.of(w.p.id).size > 0, 'the vault smashes the glass');
  }
  assert.deepEqual(failed, []);
});

test('a vault needs a sill within reach and an opening to duck through', () => {
  const w = windows[0], player = { x: 0, y: w.floor, z: 0, groundY: w.floor };
  city.windows.clear();
  const hit = city.windows.find(glass(w)), vault = planVault(player, hit);
  assert.ok(vault, 'from its own floor');
  // The character is posed with the climb's mantle; a missing field there
  // turns the leg targets into NaN and hides the body after landing.
  for (const key of ['progress', 'phase', 'speed', 'roofY']) assert.ok(Number.isFinite(vault[key]), key);
  assert.equal(planVault({ ...player, y: w.floor - 3.6, groundY: w.floor - 3.6 }, hit), null, 'not from the floor below');
  assert.equal(planVault({ ...player, groundY: w.floor + 2, y: w.floor + 2 }, hit), null, 'not from above the sill');
  // Walking past a window without jumping leaves it alone.
  assert.equal(windowAhead({ ...player, ...toWorld(w.plan, w.local.x - w.out.x * 3, w.local.z - w.out.z * 3) }, city.windows.find, w.p.id, 0, .5), null);
  city.windows.clear();
});
