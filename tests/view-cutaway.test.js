import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CUTAWAY, blockingSurfaces, createCutawayFader, cutawayOpacity, cutawayTargets, patchViewCutaway, setViewCutaway, viewCutawayUniforms } from '../src/world/view-cutaway.js';
import { interiorClipUniforms, patchInteriorClip, createFacadeMaterial } from '../src/world/building-materials.js';
import { createCameraRig } from '../src/engine/camera-rig.js';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { MASTER_DISTRICTS as DISTRICTS } from '../src/world/master-plan.js';
import { cachedInteriorPlan, levelY } from '../src/world/interior-plan.js';
import { interiorColliders, toWorld } from '../src/world/interior-physics.js';
import { circleHitsBox, orientedBox, orientedPrism, rayBoxDistance } from '../src/core/physics.js';
import { createWorld } from '../src/world/index.js';

// Below this opacity the dither drops every pixel.
const CLEAR = .5 / 64;
// The camera 2.2 m behind and above a player standing at the origin, looking toward -z.
const eye = { x: .5, y: 2.4, z: 2.2 }, feet = { x: 0, y: 0, z: 0 }, targets = cutawayTargets(eye, feet);
const wall = (x, z, w, d, extra = {}) => orientedBox(x, z, w, d, 0, 3, 0, { interior: 'flat', id: `interior:flat:${x}:${z}`, ...extra });
// Somewhere along the sight line to a point on the body.
const along = (target, t) => ({ x: eye.x + (target.x - eye.x) * t, y: eye.y + (target.y - eye.y) * t, z: eye.z + (target.z - eye.z) * t });

const fadeFor = share => { const t = Math.min(1, Math.max(0, (share - CUTAWAY.from) / (CUTAWAY.to - CUTAWAY.from))); return t * t * (3 - 2 * t); };

test('how much a surface hides the player is a share of the body, not a yes or no', () => {
  const behind = wall(0, .8, 4, .14), beside = wall(1.3, 1, .14, 4), slab = orientedBox(0, 0, 6, 6, 0, 0, -.3, { interior: 'flat', id: 'interior:flat:slab' });
  // A small box in front of the head, and nothing else.
  const head = along({ x: 0, y: 1.7, z: 0 }, .5), lamp = orientedBox(head.x, head.z, .12, .12, 0, head.y + .06, head.y - .06, { interior: 'flat', id: 'interior:flat:lamp' });
  const shares = blockingSurfaces(eye, targets, [behind, beside, slab, lamp]);
  assert.equal(shares.get(behind), 1, 'a wall across the view hides all of them');
  assert.ok(!shares.has(beside), 'a wall beside the view hides none');
  assert.ok(!shares.has(slab), 'nor the floor they stand on');
  assert.ok(fadeFor(shares.get(lamp)) < .15, `a lamp in front of their head barely fades (${shares.get(lamp).toFixed(3)})`);
  // The further a wall reaches across the body, the more of it it hides, rising steadily.
  const reach = [];
  for (let end = -.3; end <= .7; end += .05) {
    const part = orientedBox(end - 1, .8, 2, .14, 0, 3, 0, { interior: 'flat', id: 'interior:flat:part' });
    reach.push(blockingSurfaces(eye, targets, [part]).get(part) ?? 0);
  }
  assert.ok(reach[0] === 0 && reach.at(-1) === 1, `${reach.map(v => v.toFixed(2))}`);
  for (let i = 1; i < reach.length; i++) assert.ok(reach[i] >= reach[i - 1] && reach[i] - reach[i - 1] < .25, `${reach.map(v => v.toFixed(2))}`);
  // A counter is drawn with a wall cupboard above its body: that hides the player too.
  const counter = orientedBox(.3, 1.4, 2, .6, 0, .9, 0, { interior: 'flat', id: 'interior:flat:counter', viewMaxY: 2.05 });
  assert.ok(fadeFor(blockingSurfaces(eye, targets, [counter]).get(counter)) > .9, 'a wall cupboard at eye level');
  assert.ok(cutawayOpacity({ x: .3, y: 1.9, z: 1.4 }, { surfaces: [{ box: counter, fade: 1 }], floor: 0 }) < 1, 'and fades with its counter');
  // A camera inside a partition sees its faces from within: it is in the way.
  const partition = wall(eye.x, eye.z, .14, 3);
  assert.equal(blockingSurfaces(eye, targets, [partition]).get(partition), 1);
  // So does a building's shell around the camera.
  const shell = orientedPrism(0, 4, 8, 8, 0, 20, 0, 'rectangle', { id: 'building:tower' });
  assert.equal(blockingSurfaces(eye, targets, [shell]).get(shell), 1);
  // ...but seen from outside it does, and streets, cars and props never do.
  const across = orientedPrism(0, 1, 8, .6, 0, 20, 0, 'rectangle', { id: 'building:corner' }), deck = orientedBox(0, 1, 8, .6, 0, 20, 0, { kind: 'deck' });
  const outside = blockingSurfaces(eye, targets, [across, deck]);
  assert.ok(outside.has(across) && !outside.has(deck));
  // A stair flight is a sloped slab: sight lines over its low end pass clear,
  // though they cross the box round the whole flight.
  const flight = { ...orientedBox(0, 2.4, 1.2, 3.6, 0, 1.8, -.3), interior: 'flat', id: 'interior:flat:flight', supportOnly: true, slabThickness: .3, supportOverlap: .02, surface: { a: { x: 0, y: 0, z: .6 }, b: { x: 0, y: 1.8, z: 4.2 }, width: 1.2 } };
  assert.ok(!blockingSurfaces(eye, targets, [flight]).has(flight), 'not its whole bounding box');
});

test('as the camera sweeps past a wall, its share and fade change smoothly, never back and forth', () => {
  // A wall that ends beside the line of sight; the camera slides across its end.
  const edge = wall(-1.5, 1, 3, .14), fader = createCutawayFader(), shares = [], fades = [];
  fader.update(new Map([[edge, 1]]), 1);
  for (let k = 0; k <= 120; k++) {
    const from = { x: -1.2 + k * .02, y: 2.4, z: 2.2 }, share = blockingSurfaces(from, cutawayTargets(from, { x: from.x - .5, y: 0, z: 0 }), [edge]).get(edge) ?? 0;
    shares.push(share); fades.push(fader.update(new Map(share ? [[edge, share]] : []), 1 / 60).find(s => s.box === edge)?.fade ?? 0);
  }
  assert.ok(shares[0] > .9 && shares.at(-1) === 0, 'from hidden to clear');
  for (let k = 1; k < shares.length; k++) {
    assert.ok(shares[k] <= shares[k - 1] + 1e-9 && shares[k - 1] - shares[k] < .1, `share at ${k}: ${shares[k - 1].toFixed(3)} → ${shares[k].toFixed(3)}`);
    // Never faster than easing allows: no frame jumps.
    assert.ok(Math.abs(fades[k] - fades[k - 1]) <= 1 - Math.exp(-CUTAWAY.rate / 60) + 1e-9, `fade at ${k}: ${fades[k - 1].toFixed(3)} → ${fades[k].toFixed(3)}`);
  }
  // It only ever eases out, never back in.
  for (let k = 1; k < fades.length; k++) assert.ok(fades[k] <= fades[k - 1] + 1e-4, `fade at ${k}`);
});

test('a camera dipping into a building in the way and out again keeps it faded: no flash of its facade', () => {
  // The player stands beyond a tower; the camera sways through its facade.
  const tower = orientedPrism(0, 0, 8, 8, 0, 20, 0, 'rectangle', { id: 'building:tower' }), feet = { x: 0, y: 0, z: -5.5 }, fader = createCutawayFader();
  const shares = from => blockingSurfaces(from, cutawayTargets(from, feet), [tower]);
  fader.update(shares({ x: .3, y: 2.4, z: 4.4 }), 1);
  for (let k = 0; k <= 120; k++) {
    const from = { x: .3, y: 2.4, z: 4 + .45 * Math.cos(k / 6) }, fade = fader.update(shares(from), 1 / 60).find(s => s.box === tower)?.fade ?? 0;
    assert.ok(fade > .99, `frame ${k}, ${from.z > 4 ? 'outside' : 'inside'}: faded ${fade.toFixed(3)}`);
  }
});

test('a fade eases toward how much the surface hides, and a cut settles at once', () => {
  const fader = createCutawayFader(), behind = wall(0, .8, 4, .14), lamp = wall(.2, 1.2, .1, .1);
  let faded = fader.update(new Map([[behind, 1], [lamp, .05]]), 1 / 60);
  assert.deepEqual(faded.map(s => s.box), [behind], 'a slight blocker never fades');
  assert.ok(faded[0].fade > 0 && faded[0].fade < .3, 'easing in');
  for (let i = 0; i < 60; i++) faded = fader.update(new Map([[behind, 1]]), 1 / 60);
  assert.ok(faded[0].fade > .99);
  // Hiding a little less fades a little less: in between, partway.
  for (let i = 0; i < 60; i++) faded = fader.update(new Map([[behind, (CUTAWAY.from + CUTAWAY.to) / 2]]), 1 / 60);
  assert.ok(Math.abs(faded[0].fade - .5) < .02, `${faded[0].fade}`);
  for (let i = 0; i < 60; i++) faded = fader.update(new Map(), 1 / 60);
  assert.deepEqual(faded, [], 'and gone once it hides nothing');
  // A teleport or cut settles at once; at most a few surfaces fade together.
  faded = fader.update(new Map(Array.from({ length: 12 }, (_, i) => [wall(i, .8, .5, .14), 1])), 1);
  assert.equal(faded.length, CUTAWAY.slots);
  assert.ok(faded.every(s => s.fade > .999));
});

test('every point of a faded surface fades alike, down to a ghost, except at the floor', () => {
  const behind = orientedBox(.3, .8, 4, .14, .4, 3, 0, { interior: 'flat' }), view = { surfaces: [{ box: behind, fade: 1 }], floor: 0 };
  const c = Math.cos(.4), s = Math.sin(.4), on = (u, y, side = 1) => ({ x: .3 + u * c + side * .07 * s, y, z: .8 - u * s + side * .07 * c });
  for (const [u, y] of [[0, 1.5], [-1.9, 2.9], [1.9, .3], [1, 2]]) for (const side of [-1, 1]) assert.ok(Math.abs(cutawayOpacity(on(u, y, side), view) - CUTAWAY.ghost) < 1e-9, `${u}, ${y}, ${side}`);
  assert.equal(cutawayOpacity(on(0, .02), view), 1, 'its foot stays at the floor');
  assert.equal(cutawayOpacity(on(2.2, 1.5), view), 1, 'beyond its end');
  assert.equal(cutawayOpacity(on(0, 1.5, 3), view), 1, 'and off its face');
  assert.ok(cutawayOpacity(on(0, 1.5), { surfaces: [{ box: behind, fade: .5 }], floor: 0 }) > CUTAWAY.ghost, 'part way while easing');
  // A convex slab fades over its own outline, not the building frame it shares.
  const slab = { x: 10, z: 0, yaw: 0, w: 20, d: 20, vertices: [{ x: 2, z: 2 }, { x: 6, z: 2 }, { x: 6, z: 5 }, { x: 2, z: 5 }], minY: 3.3, maxY: 3.6 };
  const above = { surfaces: [{ box: slab, fade: 1 }], floor: 0 };
  assert.ok(cutawayOpacity({ x: 14, y: 3.45, z: 3 }, above) < 1 && cutawayOpacity({ x: 18, y: 3.45, z: 3 }, above) === 1);
  assert.equal(cutawayOpacity({ x: 0, y: 1.5, z: 0 }, null), 1, 'nothing fades without a view');
});

test('in real rooms, walls that hide the player fade whole and walls beside the view stay', () => {
  const metropolis = new VerticalMetropolis(), seen = new Set(), rig = createCameraRig();
  let rooms = 0, faded = 0, kept = 0;
  for (const d of DISTRICTS.slice(0, 4)) for (const block of metropolis.area(d.x - 50, d.z - 50, d.x + 50, d.z + 50)) for (const p of block.buildings) {
    const plan = cachedInteriorPlan(p);
    if (!plan || seen.has(plan.layout + plan.footprint) || seen.size > 8) continue;
    seen.add(plan.layout + plan.footprint);
    const level = 0, floor = levelY(plan, level), colliders = interiorColliders(plan, level), solid = colliders.filter(b => !b.supportOnly && (b.maxY ?? Infinity) > floor + .1);
    for (const zone of plan.templates[0].zones.filter(z => !['void', 'shaft', 'stair', 'lift'].includes(z.kind))) {
      const c = zone.polygon.reduce((a, q) => ({ x: a.x + q.x / zone.polygon.length, z: a.z + q.z / zone.polygon.length }), { x: 0, z: 0 }), at = toWorld(plan, c.x, c.z);
      // Only where the player can stand: not inside a bed at the room's centre.
      if (solid.some(b => circleHitsBox(at.x, at.z, .43, b))) continue;
      for (const yaw of [0, 1.3, 2.6, 3.9, 5.2]) {
        rig.update({ dt: 1 / 60, snap: true, player: { x: at.x, y: floor, z: at.z }, yaw, pitch: .12, floor });
        const from = rig.position, body = cutawayTargets(from, { x: at.x, y: floor, z: at.z }), shares = blockingSurfaces(from, body, colliders);
        const view = { surfaces: createCutawayFader().update(shares, 1), floor }, fading = new Map(view.surfaces.map(s => [s.box, s.fade]));
        for (const [box, share] of shares) if (share >= CUTAWAY.to && view.surfaces.length < CUTAWAY.slots) assert.ok(fading.get(box) > .999, `${plan.id} yaw ${yaw}: ${box.id} hides ${share.toFixed(2)} of the body, fade ${fading.get(box)}, ${view.surfaces.length} fading: ${view.surfaces.map(s => s.box.id + "=" + s.fade.toFixed(3))}`);
        // Where a sight line to the chest meets a faded surface, it shows as a ghost.
        const chest = new THREE.Vector3(at.x, floor + 1.35, at.z), dir = chest.clone().sub(from), length = dir.length();
        dir.normalize();
        for (const { box } of view.surfaces) {
          const distance = rayBoxDistance(from, dir, box, length);
          if (distance >= length || distance < .12) continue;
          const hit = from.clone().addScaledVector(dir, distance + .005);
          if (hit.y < floor + .2 || fading.get(box) < .999) continue;
          assert.ok(cutawayOpacity(hit, view) < CLEAR, `${plan.id} yaw ${yaw}: ${box.id}`);
          faded++;
        }
        // Sight lines that pass the player well to the side meet walls that hide nothing: those stay.
        for (const offset of [-2.5, 2.5]) {
          const aim = new THREE.Vector3(at.x + Math.cos(yaw) * offset, floor + 1.4, at.z - Math.sin(yaw) * offset), side = aim.clone().sub(from), reach = side.length();
          side.normalize();
          for (const box of solid.filter(b => !shares.has(b))) {
            const distance = rayBoxDistance(from, side, box, reach);
            if (distance >= reach) continue;
            const hit = from.clone().addScaledVector(side, distance + .02);
            if (view.surfaces.some(s => rayBoxDistance(from, side, s.box, reach) <= distance + .01)) continue;
            assert.equal(cutawayOpacity(hit, view), 1, `${plan.id} yaw ${yaw}: ${box.id} beside the view`);
            kept++;
          }
        }
      }
      rooms++;
    }
  }
  assert.ok(rooms > 15 && faded > 30 && kept > 50, `${rooms} rooms, ${faded} faded walls, ${kept} kept`);
});

test('door leaves fade like walls, from where they stand as they swing', () => {
  const scene = new THREE.Scene(), world = createWorld({ scene });
  let checked = 0;
  for (const p of world.buildingsNear(world.spawn.x, world.spawn.z, 120)) {
    const plan = cachedInteriorPlan(p);
    if (!plan || plan.industrial || checked) continue;
    const at = toWorld(plan, 0, 0), floor = levelY(plan, 0), context = world.interiorContextAt(at.x, floor, at.z);
    if (!context?.inside) continue;
    const player = { x: at.x, y: floor, z: at.z };
    world.interiors.update(player, context, 0, 0);
    const leaves = world.interiors.doorLeaves(at.x, at.z, 60);
    const floorGroup = world.interiors.root.children.find(g => g.name === `Interior ${p.id}`)?.children.find(g => g.name.endsWith('level 0'));
    const meshes = floorGroup?.children.filter(m => m.isInstancedMesh && m.material === world.interiors.materials.leaf) ?? [];
    if (!leaves.length || !meshes.length) continue;
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), size = new THREE.Vector3();
    for (const box of leaves) {
      const index = Number(box.id.split(':').at(-1));
      meshes[0].getMatrixAt(index, matrix);
      matrix.premultiply(floorGroup.parent.matrix).decompose(position, quaternion, size);
      const yaw = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ').y;
      assert.ok(Math.hypot(box.x - position.x, box.z - position.z) < 1e-6 && Math.abs(box.w - size.x) < 1e-6 && Math.abs((box.minY + box.maxY) / 2 - position.y) < 1e-6, box.id);
      assert.ok(Math.abs(Math.sin(box.yaw - yaw)) < 1e-6 && box.interior === plan.id);
      checked++;
    }
  }
  assert.ok(checked > 2, `${checked} leaves`);
  world.dispose();
});

test('the cutaway patches any material, alongside the interior clip', () => {
  const uniforms = viewCutawayUniforms();
  for (const material of [new THREE.MeshBasicMaterial(), new THREE.MeshStandardMaterial(), patchInteriorClip(createFacadeMaterial(), interiorClipUniforms())]) {
    const lib = material.isMeshBasicMaterial ? THREE.ShaderLib.basic : THREE.ShaderLib.standard;
    patchViewCutaway(material, uniforms);
    const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.cutawaySurfaces, uniforms.cutawaySurfaces);
    assert.match(shader.vertexShader, /vCutaway = \(modelMatrix \* cutawayWorld\)\.xyz;/);
    assert.match(shader.fragmentShader, /cutawayState\.y > \.5[\s\S]*cutawayThreshold\(gl_FragCoord\.xy\)\) discard/);
    assert.match(material.customProgramCacheKey(), /view-cutaway/);
    if (shader.uniforms.interiorCavity) assert.match(shader.fragmentShader, /interiorCavity/, 'the interior clip still applies');
  }
  const behind = orientedBox(1, 2, 4, .2, .5, 3, 0);
  setViewCutaway(uniforms, { surfaces: [{ box: behind, fade: .6 }], floor: 1.5 });
  assert.deepEqual(uniforms.cutawayState.value.toArray(), [1.5, 1, 0, 0]);
  const [a, b, f] = uniforms.cutawaySurfaces.value;
  assert.deepEqual([a.x, a.y, a.z, b.x, b.y, b.z, f.x, f.y], [1, 1.5, 2, 2, 1.5, .1, .6, CUTAWAY.pad]);
  assert.ok(Math.abs(a.w - Math.cos(.5)) < 1e-9 && Math.abs(b.w - Math.sin(.5)) < 1e-9);
  setViewCutaway(uniforms, null);
  assert.equal(uniforms.cutawayState.value.y, 0, 'off');
});

test('buildings, signs, broken windows and interiors all open up for the camera', () => {
  const scene = new THREE.Scene(), world = createWorld({ scene });
  const patched = new Set();
  scene.traverse(object => { for (const m of [object.material].flat()) if (m?.customProgramCacheKey?.().includes('view-cutaway')) patched.add(m.name); });
  for (const name of ['interior-surface', 'interior-fixture', 'interior-glass', 'interior-leaf', 'interior-glassLeaf', 'interior-shard', 'broken-window']) assert.ok(patched.has(name), name);
  world.setCutaway({ surfaces: [{ box: orientedBox(0, 0, 1, 1, 0, 1, 0), fade: 1 }], floor: 0 });
  assert.equal(world.viewCutaway.cutawayState.value.y, 1);
  world.dispose();
});
