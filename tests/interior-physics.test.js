import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVerticalCity } from '../src/vertical-city.js';
import { WorldStream } from '../src/world-stream.js';
import { WORLD_OBJECTS, DISTRICTS } from '../src/content.js';
import { cachedInteriorPlan, levelY, INTERIOR } from '../src/interior-plan.js';
import { interiorHull, interiorContext, toWorld, toLocal } from '../src/interior-physics.js';
import { circleHitsBox, overlapsHeight, rayBoxDistance, rayObstructionDistance, supportHeight } from '../src/physics.js';
import { findSpawnPosition } from '../src/spawn.js';
import { polygonFaces } from '../src/building-footprints.js';
import { interiorClipUniforms, patchInteriorClip, createFacadeMaterial } from '../src/building-materials.js';
import { findPath, walk } from './helpers/interior-walk.js';

const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream, WORLD_OBJECTS);
const byLayout = new Map();
for (const d of DISTRICTS) for (const block of city.metropolis.area(d.x - 90, d.z - 90, d.x + 90, d.z + 90)) for (const p of block.buildings) {
  const plan = cachedInteriorPlan(p);
  if (plan && !byLayout.has(`${plan.layout}/${plan.footprint}`)) byLayout.set(`${plan.layout}/${plan.footprint}`, { p, plan });
}
const samples = [...byLayout.values()];
const blocked = (spatial, x, y, z, radius = .43) => spatial.near(x, z, 2).some(b => !b.supportOnly && overlapsHeight(b, y) && circleHitsBox(x, z, radius, b));

test('outside the door, the hull collides and blocks rays exactly like the shell', () => {
  assert.ok(samples.length >= 6);
  for (const { p, plan } of samples) {
    const hull = interiorHull(plan).filter(b => !b.supportOnly), shell = p.box, faces = polygonFaces(plan.outline);
    faces.forEach((face, i) => {
      for (const t of [-.4, -.15, .15, .4]) for (const gap of [.05, .3, .8, 1.5]) {
        const lx = face.x - face.nz * face.width * t + face.nx * gap, lz = face.z + face.nx * face.width * t + face.nz * gap;
        if (plan.entrances.some(e => Math.hypot(lx - e.x, lz - e.z) < e.width / 2 + .6)) continue;
        const w = toWorld(plan, lx, lz);
        for (const y of [plan.floor0, plan.floor0 + 6]) {
          if (y > plan.top - 2) continue;
          const viaShell = overlapsHeight(shell, y) && circleHitsBox(w.x, w.z, .43, shell);
          const viaHull = hull.some(b => overlapsHeight(b, y) && circleHitsBox(w.x, w.z, .43, b));
          assert.equal(viaHull, viaShell, `${plan.id} face ${i} gap ${gap}`);
          const origin = { x: w.x, y: y + 1, z: w.z }, center = toWorld(plan, 0, 0), length = Math.hypot(center.x - w.x, center.z - w.z);
          const direction = { x: (center.x - w.x) / length, y: 0, z: (center.z - w.z) / length };
          const toShell = rayBoxDistance(origin, direction, shell, 100), toHull = Math.min(...hull.map(b => rayBoxDistance(origin, direction, b, 100)));
          // A ray may legitimately enter through another street door.
          const entry = toLocal(plan, origin.x + direction.x * toShell, origin.z + direction.z * toShell);
          if (origin.y < plan.floor0 + 4.3 && plan.entrances.some(e => Math.hypot(entry.x - e.x, entry.z - e.z) < e.width / 2 + .05)) continue;
          assert.ok(Math.abs(toShell - toHull) < .01, `${plan.id} ray ${toShell} vs ${toHull}`);
        }
      }
    });
  }
});

test('players walk in through the street door and climb a storey at any frame rate', () => {
  for (const { plan } of samples) {
    const e = plan.entrances[0], outside = toWorld(plan, e.x + e.nx * 3, e.z + e.nz * 3), inside = toWorld(plan, e.x - e.nx * 1.2, e.z - e.nz * 1.2);
    for (const fps of [20, 30, 60, 120]) {
      const player = { x: outside.x, z: outside.z, y: city.terrainHeight(outside.x, outside.z), velocityY: 0, vx: 0, vz: 0, jumpPhase: '', groundY: 0 };
      const entry = walk(city, player, [toWorld(plan, e.x + e.nx, e.z + e.nz), inside], fps);
      assert.equal(entry.falls, 0, `${plan.id} ${fps} fps steps up without falling`);
      assert.deepEqual(entry.overlaps, []);
      assert.ok(Math.abs(player.y - plan.floor0) < 1e-6, `${plan.id} ${fps} fps reaches the lobby floor`);
      assert.ok(interiorContext(plan, player.x, player.y, player.z)?.inside, `${plan.id} is inside`);
      if (!plan.core) continue;
      const s = plan.core.stair, lane = l => (l.x0 + l.x1) / 2, context = interiorContext(plan, player.x, player.y, player.z);
      const path = findPath(city.spatialFor(context), plan, player, toWorld(plan, lane(s.up), s.near + .7), plan.floor0);
      assert.ok(path, `${plan.id} lobby connects to the stairs`);
      const climb = walk(city, player, [...path, toWorld(plan, lane(s.up), s.far - .5), toWorld(plan, lane(s.down), s.far - .5), toWorld(plan, lane(s.down), s.near + .7)], fps);
      assert.equal(climb.falls, 0, `${plan.id} ${fps} fps keeps its footing on the stairs`);
      assert.deepEqual(climb.overlaps, []);
      assert.ok(Math.abs(player.y - levelY(plan, 1)) < 1e-6, `${plan.id} ${fps} fps arrives upstairs`);
      assert.equal(interiorContext(plan, player.x, player.y, player.z).level, 1);
    }
  }
});

// Where a ray from inside crosses the outline, in building-local space.
function leavesThroughDoor(plan, origin, direction) {
  const o = toLocal(plan, origin.x, origin.z), far = toLocal(plan, origin.x + direction.x, origin.z + direction.z), d = { x: far.x - o.x, z: far.z - o.z };
  let exit = Infinity;
  for (const f of polygonFaces(plan.outline)) {
    const speed = d.x * f.nx + d.z * f.nz;
    if (speed > 1e-9) exit = Math.min(exit, ((f.x - o.x) * f.nx + (f.z - o.z) * f.nz) / speed);
  }
  const p = { x: o.x + d.x * exit, z: o.z + d.z * exit };
  return plan.entrances.some(e => Math.hypot(p.x - e.x, p.z - e.z) < e.width / 2 + .05 && origin.y < plan.floor0 + e.height);
}

test('rays from inside a room stop at its walls, floor and ceiling', () => {
  for (const { plan } of samples) {
    const context = interiorContext(plan, ...(() => { const c = toWorld(plan, plan.entrances[0].x - plan.entrances[0].nx * 1.5, plan.entrances[0].z - plan.entrances[0].nz * 1.5); return [c.x, plan.floor0, c.z]; })());
    const spatial = city.spatialFor(context), origin = { ...toWorld(plan, plan.entrances[0].x - plan.entrances[0].nx * 1.5, plan.entrances[0].z - plan.entrances[0].nz * 1.5), y: plan.floor0 + 1.5 };
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, direction = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      const distance = rayObstructionDistance(origin, direction, 60, spatial);
      assert.ok(distance > 0, `${plan.id} heading ${i} starts inside open space`);
      if (distance === Infinity) assert.ok(leavesThroughDoor(plan, origin, direction), `${plan.id} heading ${i} only escapes through a street door`);
    }
    const ceiling = plan.levels > 1 ? levelY(plan, 1) - INTERIOR.slab : plan.top;
    assert.ok(Math.abs(rayObstructionDistance(origin, { x: 0, y: 1, z: 0 }, 60, spatial) - (ceiling - origin.y)) < .01, `${plan.id} ceiling`);
    assert.ok(Math.abs(rayObstructionDistance(origin, { x: 0, y: -1, z: 0 }, 60, spatial) - 1.5) < .01, `${plan.id} floor`);
  }
});

test('a save made indoors validates against the interior, not the solid shell', () => {
  for (const { plan } of samples) {
    const e = plan.entrances[0], at = toWorld(plan, e.x - e.nx * 1.5, e.z - e.nz * 1.5), y = plan.floor0;
    assert.ok(blocked(city.spatial, at.x, y, at.z), 'the exterior shell alone rejects an indoor position');
    const context = city.interiorContextAt(at.x, y, at.z), spatial = city.spatialFor(context);
    assert.ok(!blocked(spatial, at.x, y, at.z), `${plan.id} the interior accepts it`);
    const spot = findSpawnPosition({ x: at.x, y, z: at.z }, (x, z, r) => spatial.near(x, z, r), (x, z, ceiling) => supportHeight(x, z, spatial.near(x, z, 2), ceiling, city.terrainHeight(x, z)));
    assert.ok(spot && Math.abs(spot.y - plan.floor0) < 1e-6);
  }
});

test('entrance steps rise from the street to the threshold in small steps', () => {
  for (const { p, plan } of samples) {
    for (const e of plan.entrances) {
      let previous = null;
      for (let d = 2.6; d >= -.25; d -= .05) {
        const w = toWorld(plan, e.x + e.nx * d, e.z + e.nz * d);
        const y = supportHeight(w.x, w.z, city.spatial.near(w.x, w.z, 2), plan.floor0 + .01, city.terrainHeight(w.x, w.z));
        if (previous !== null) assert.ok(y - previous <= .3 + 1e-6, `${plan.id} ${e.id} rise at ${d.toFixed(2)}`);
        previous = y;
      }
      assert.ok(Math.abs(previous - plan.floor0) < 1e-6, `${p.id} reaches the threshold`);
    }
  }
});

test('the interior clip patches exterior materials without changing their other shaders', () => {
  const uniforms = interiorClipUniforms(), material = patchInteriorClip(new THREE.MeshStandardMaterial(), uniforms);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.interiorDoorCenter, uniforms.interiorDoorCenter);
  assert.match(shader.vertexShader, /vInteriorClip = \(modelMatrix \* interiorClipWorld\)\.xyz/);
  assert.match(shader.fragmentShader, /discard/);
  assert.ok(uniforms.interiorDoorHalf.value.every(v => v.w === 0) && uniforms.interiorCavity.value.w === 0, 'inactive until a lobby exists');
  assert.match(material.customProgramCacheKey(), /interior-clip/);
  const facade = patchInteriorClip(createFacadeMaterial(), uniforms), facadeShader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  facade.onBeforeCompile(facadeShader);
  assert.match(facadeShader.vertexShader, /instanceWindowSeed/, 'the facade window patch still applies');
  assert.match(facade.customProgramCacheKey(), /building-facade-atlas-v4\|interior-clip/);
  assert.ok(city.interiorClip.interiorDoorCenter.value.length === 4);
  assert.ok(INTERIOR.hull > 0);
});
