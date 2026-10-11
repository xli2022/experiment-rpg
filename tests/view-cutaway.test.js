import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CUTAWAY, cutsAway, patchViewCutaway, setViewCutaway, viewCutawayUniforms } from '../src/world/view-cutaway.js';
import { interiorClipUniforms, patchInteriorClip, createFacadeMaterial } from '../src/world/building-materials.js';
import { createCameraRig } from '../src/engine/camera-rig.js';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { MASTER_DISTRICTS as DISTRICTS } from '../src/world/master-plan.js';
import { cachedInteriorPlan, levelY } from '../src/world/interior-plan.js';
import { interiorColliders, toWorld } from '../src/world/interior-physics.js';
import { circleHitsBox, rayBoxDistance } from '../src/core/physics.js';
import { createWorld } from '../src/world/index.js';

const eye = { x: 0, y: 2.7, z: 6 }, focus = { x: 0, y: 1.35, z: 0 };

test('the cutaway opens a slot from the camera to the player, down to their feet, and keeps the rest', () => {
  assert.ok(cutsAway({ x: 0, y: 1.5, z: 3 }, eye, focus, 0), 'a wall halfway');
  assert.ok(cutsAway({ x: .9, y: .2, z: 1 }, eye, focus, 0), 'a wall right behind them, down to their feet');
  assert.ok(cutsAway({ x: 0, y: 1.3, z: .5 }, eye, focus, 0), 'a wall at their back');
  assert.ok(cutsAway({ x: 1.6, y: 2.4, z: 5.8 }, eye, focus, 0), 'clutter round the camera');
  assert.ok(!cutsAway({ x: 0, y: .04, z: 2 }, eye, focus, 0), 'never the floor they stand on');
  assert.ok(!cutsAway({ x: 0, y: 1.5, z: -.5 }, eye, focus, 0), 'nothing beyond them');
  assert.ok(!cutsAway({ x: 2.5, y: 1.5, z: 2 }, eye, focus, 0), 'nothing well to the side');
  assert.ok(!cutsAway({ x: 0, y: 3.5, z: 2 }, eye, focus, 0), 'nor the ceiling above the line of sight');
  assert.ok(!cutsAway({ x: 0, y: 1.5, z: 7 }, eye, focus, 0), 'nor anything behind the camera');
  // Gliding high above the city, the buildings far beneath stay whole.
  assert.ok(!cutsAway({ x: 0, y: 30, z: 4 }, { x: 0, y: 53, z: 9 }, { x: 0, y: 51, z: 0 }, 0));
  assert.ok(CUTAWAY.focusRadius >= 1 && CUTAWAY.below > 1.35 + .1, 'wide and deep enough for the whole body');
});

test('in real rooms, every wall between the camera and any part of the player is cut away', () => {
  const metropolis = new VerticalMetropolis(), seen = new Set(), rig = createCameraRig();
  let checked = 0, rooms = 0;
  for (const d of DISTRICTS.slice(0, 4)) for (const block of metropolis.area(d.x - 50, d.z - 50, d.x + 50, d.z + 50)) for (const p of block.buildings) {
    const plan = cachedInteriorPlan(p);
    if (!plan || seen.has(plan.layout + plan.footprint) || seen.size > 8) continue;
    seen.add(plan.layout + plan.footprint);
    const level = 0, floor = levelY(plan, level), walls = interiorColliders(plan, level).filter(b => !b.supportOnly && (b.maxY ?? Infinity) > floor + .1);
    for (const zone of plan.templates[0].zones.filter(z => !['void', 'shaft', 'stair', 'lift'].includes(z.kind))) {
      const c = zone.polygon.reduce((a, q) => ({ x: a.x + q.x / zone.polygon.length, z: a.z + q.z / zone.polygon.length }), { x: 0, z: 0 }), at = toWorld(plan, c.x, c.z);
      // Only where the player can stand: not inside a bed at the room's centre.
      if (walls.some(b => circleHitsBox(at.x, at.z, .43, b))) continue;
      for (const yaw of [0, 1.3, 2.6, 3.9, 5.2]) {
        rig.update({ dt: 1 / 60, snap: true, player: { x: at.x, y: floor, z: at.z }, yaw, pitch: .12, floor });
        const from = rig.position;
        // Feet, waist and head, and the shoulders either side.
        for (const [side, up] of [[0, .1], [0, 1], [0, 1.75], [.25, 1.4], [-.25, 1.4]]) {
          const body = new THREE.Vector3(at.x + Math.cos(yaw) * side, floor + up, at.z - Math.sin(yaw) * side), dir = body.clone().sub(from), length = dir.length() - .45;
          dir.normalize();
          for (const box of walls) {
            const d = rayBoxDistance(from, dir, box, length);
            if (d >= length) continue;
            const hit = from.clone().addScaledVector(dir, d + .01);
            assert.ok(cutsAway(hit, from, rig.focus, floor), `${plan.id} ${zone.kind} yaw ${yaw}: a wall hides the player at ${up} m`);
            checked++;
          }
        }
      }
      rooms++;
    }
  }
  assert.ok(rooms > 15 && checked > 150, `${rooms} rooms, ${checked} walls in the way`);
});

test('the cutaway patches any material, alongside the interior clip', () => {
  const uniforms = viewCutawayUniforms();
  for (const material of [new THREE.MeshBasicMaterial(), new THREE.MeshStandardMaterial(), patchInteriorClip(createFacadeMaterial(), interiorClipUniforms())]) {
    const lib = material.isMeshBasicMaterial ? THREE.ShaderLib.basic : THREE.ShaderLib.standard;
    patchViewCutaway(material, uniforms);
    const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.cutawayEye, uniforms.cutawayEye);
    assert.match(shader.vertexShader, /vCutaway = \(modelMatrix \* cutawayWorld\)\.xyz/);
    assert.match(shader.fragmentShader, /cutawayEye\.w > \.5[\s\S]*discard/);
    assert.match(material.customProgramCacheKey(), /view-cutaway/);
    if (shader.uniforms.interiorCavity) assert.match(shader.fragmentShader, /interiorCavity/, 'the interior clip still applies');
  }
  setViewCutaway(uniforms, eye, focus, 0);
  assert.deepEqual(uniforms.cutawayEye.value.toArray(), [0, 2.7, 6, 1]);
  assert.deepEqual(uniforms.cutawayFocus.value.toArray(), [0, 1.35, 0, 0]);
  setViewCutaway(uniforms, null);
  assert.equal(uniforms.cutawayEye.value.w, 0, 'off');
});

test('buildings, signs, broken windows and interiors all open up for the camera', () => {
  const scene = new THREE.Scene(), world = createWorld({ scene });
  const patched = new Set();
  scene.traverse(object => { for (const m of [object.material].flat()) if (m?.customProgramCacheKey?.().includes('view-cutaway')) patched.add(m.name); });
  for (const name of ['interior-surface', 'interior-fixture', 'interior-glass', 'interior-leaf', 'interior-glassLeaf', 'interior-shard', 'broken-window']) assert.ok(patched.has(name), name);
  world.setCutaway(eye, focus, 0);
  assert.equal(world.viewCutaway.cutawayEye.value.w, 1);
  world.dispose();
});
