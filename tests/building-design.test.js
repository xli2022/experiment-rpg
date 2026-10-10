import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildingDesign, buildingVolumes, buildingVolumeColliders, buildingDetails } from '../src/world/building-design.js';
import { createFacadeMaterial, FACADE_STYLES, facadeUV } from '../src/world/building-materials.js';
import { createVerticalCity } from '../src/world/vertical-city.js';
import { WorldStream, WORLD_GEOMETRY } from '../src/world/world-stream.js';
import { SHOWCASE } from '../src/world/master-plan.js';
import { AFTERLIGHT_LANDMARKS as LANDMARKS } from '../src/world/landmarks.js';
import { boxContainsPoint, supportHeight } from '../src/core/physics.js';

const types = ['office', 'apartment', 'terrace', 'civic', 'market', 'warehouse', 'factory'];
const example = (type, i) => ({ id: `${type}:design:${i}`, type, x: 37, z: -23, y: 4, ground: 3.5,
  w: 18, d: 16, h: type === 'market' ? 12 : ['warehouse', 'terrace'].includes(type) ? 20 : 86, yaw: .63 });
const point = (p, x, z) => ({ x: p.x + x * Math.cos(p.yaw) + z * Math.sin(p.yaw), z: p.z - x * Math.sin(p.yaw) + z * Math.cos(p.yaw) });

test('each use has distinct repeatable silhouettes, with independently varied finishes', () => {
  for (const type of types) {
    const shapes = new Set(), finishes = new Map(), lighting = new Map();
    for (let i = 0; i < 160; i++) {
      const p = example(type, i), design = buildingDesign(p), volumes = buildingVolumes(p);
      assert.deepEqual(design, buildingDesign(structuredClone(p)));
      assert.deepEqual(volumes, buildingVolumes(structuredClone(p)));
      shapes.add(JSON.stringify(volumes.map(({ x, y, z, w, h, d }) => [x, y, z, w, h, d])));
      if (!finishes.has(design.variant)) finishes.set(design.variant, new Set());
      finishes.get(design.variant).add(design.color);
      if (!lighting.has(design.variant)) lighting.set(design.variant, new Set());
      lighting.get(design.variant).add(design.windowLighting);
      assert.ok(buildingDetails(p).length < 160, 'architectural detail stays bounded even on tall buildings');
    }
    assert.equal(finishes.size, 4, `${type} uses all four architectural variants`);
    assert.ok(shapes.size >= 4, `${type} changes geometry as well as paint`);
    assert.ok([...finishes.values()].every(colors => colors.size === 4), `${type} does not couple its finish to its silhouette`);
    assert.ok([...lighting.values()].every(states => states.size === 2), `${type} has mostly lit and mostly dark buildings for every silhouette`);
  }
});

test('rotated stepped buildings have supported volumes and matching roof collision', () => {
  for (const type of types) for (let i = 0; i < 24; i++) {
    const p = example(type, i), volumes = buildingVolumes(p), boxes = buildingVolumeColliders(p);
    assert.equal(volumes.length, boxes.length);
    for (const [index, volume] of volumes.entries()) {
      assert.ok([volume.x, volume.y, volume.z, volume.w, volume.h, volume.d].every(Number.isFinite));
      assert.ok(volume.w > 0 && volume.h > 0 && volume.d > 0);
      assert.ok(Math.abs(volume.x) + volume.w / 2 <= p.w / 2 + 1e-8, `${p.id} fits its reserved width`);
      assert.ok(Math.abs(volume.z) + volume.d / 2 <= p.d / 2 + 1e-8, `${p.id} fits its reserved depth`);
      const position = point(p, volume.x, volume.z), bottom = p.y + volume.y - volume.h / 2, box = boxes[index];
      assert.equal(box.x, position.x); assert.equal(box.z, position.z);
      assert.equal(box.maxY, p.y + volume.y + volume.h / 2 + (volume.cap ? .5 : 0));
      assert.ok(boxContainsPoint(position.x, position.z, box));
      if (index) {
        const support = supportHeight(position.x, position.z, boxes.filter((_, j) => j !== index), bottom + .51, p.ground);
        assert.ok(Math.abs(support - bottom) < .51, `${p.id} volume ${index} sits on another rendered surface`);
      }
    }
    // Cast into independent rendered box geometry, checking an entire grid of
    // points including empty setbacks rather than just volume centers.
    const meshes = volumes.map(v => {
      const mesh = new THREE.Mesh(WORLD_GEOMETRY.box);
      const position = point(p, v.x, v.z), cap = v.cap ? .5 : 0;
      mesh.position.set(position.x, p.y + v.y + cap / 2, position.z);
      mesh.rotation.y = p.yaw; mesh.scale.set(v.w, v.h + cap, v.d); mesh.updateMatrixWorld(); return mesh;
    });
    for (const x of [-.44, -.19, .07, .31, .46]) for (const z of [-.43, -.17, .13, .37]) {
      const position = point(p, p.w * x, p.d * z), height = p.y + p.h + 50;
      const hit = new THREE.Raycaster(new THREE.Vector3(position.x, height, position.z), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes)[0];
      const floor = supportHeight(position.x, position.z, boxes, height, p.ground);
      assert.ok(hit && Math.abs(hit.point.y - floor) < 1e-6, `${p.id} supports the visible roof, including lower terraces`);
    }
    for (const mesh of meshes) mesh.material.dispose();
  }
});

test('facade atlas banks contain uniform dark/lit panes for per-window shader selection', () => {
  const material = createFacadeMaterial(), { map, emissiveMap } = material;
  try {
    assert.equal(map.image.width * map.image.height, 1024 * 1024);
    assert.equal(map.generateMipmaps, true); assert.equal(map.anisotropy, 4);
    const signatures = new Set();
    for (let style = 0; style < FACADE_STYLES.length; style++) {
      const uv = facadeUV(style), pixels = [];
      const startX = Math.round(uv[0] * map.image.width), startY = Math.round(uv[1] * map.image.height);
      for (let y = 0; y < 240; y += 3) for (let x = 0; x < 240; x += 3) {
        const at = ((startY + y) * map.image.width + startX + x) * 4;
        pixels.push(map.image.data[at], map.image.data[at + 1], map.image.data[at + 2]);
      }
      signatures.add(JSON.stringify(pixels));
      const walls = [];
      for (const state of ['dark', 'lit']) {
        const rect = facadeUV(style, state), x = Math.round(rect[0] * map.image.width), y = Math.round(rect[1] * map.image.height);
        let litWindows = 0;
        // Sample the interior of all sixteen panes, excluding their frames.
        for (let floor = 0; floor < 4; floor++) for (let column = 0; column < 4; column++) {
          const at = ((y + floor * 60 + 30) * map.image.width + x + column * 60 + 25) * 4;
          const emitting = emissiveMap.image.data[at] > 0;
          if (emitting) litWindows++;
          const brightness = map.image.data[at] + map.image.data[at + 1] + map.image.data[at + 2];
          assert.equal(brightness > 400, emitting, 'the visible pane color follows its lighting state, not just its glow');
        }
        assert.equal(litWindows, state === 'lit' ? 16 : 0, `${FACADE_STYLES[style]} has no baked repeating light pattern`);
        const wall = ((y + 2) * map.image.width + x + 2) * 4;
        walls.push([...map.image.data.slice(wall, wall + 3)]);
        assert.deepEqual([...emissiveMap.image.data.slice(wall, wall + 3)], [0, 0, 0], 'walls never emit light');
      }
      assert.deepEqual(walls[0], walls[1], 'lighting does not alter the cladding');
    }
    assert.equal(signatures.size, 6);
  } finally { map.dispose(); emissiveMap.dispose(); material.dispose(); }
});

test('facade variants batch by footprint with one shared material and release their per-chunk UV buffers', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream, LANDMARKS);
  const buildings = city.metropolis.area(SHOWCASE.x - 180, SHOWCASE.z - 180, SHOWCASE.x + 180, SHOWCASE.z + 180).flatMap(b => b.buildings);
  const materials = new Set(), tiles = new Set();
  try {
    for (const p of buildings.slice(0, 40)) {
      const cell = stream.cell(Math.floor(p.x / 96), Math.floor(p.z / 96));
      if (cell.groups[0]) continue;
      stream.build(cell, 0);
      const meshes = cell.groups[0].children.filter(m => m.material.name === 'vertical-facade');
      assert.ok(meshes.length >= 1 && meshes.length <= 3, 'at most one facade draw per footprint, regardless of facade styles');
      assert.equal(new Set(meshes.map(m => m.geometry.name)).size, meshes.length, 'each footprint shares its facade draw');
      for (const mesh of meshes) materials.add(mesh.material);
      const mesh = meshes.find(m => m.geometry.name === `building-${p.footprint}`), uv = mesh.geometry.attributes.instanceUvRect, seeds = mesh.geometry.attributes.instanceWindowSeed, matrix = new THREE.Matrix4();
      assert.equal(uv.count, mesh.count);
      assert.equal(seeds.count, mesh.count);
      assert.ok([...seeds.array].every(seed => Number.isInteger(seed) && seed >= 0 && seed <= 0xffffff), 'seeds survive float instance attributes exactly');
      for (let i = 0; i < uv.count; i++) tiles.add(`${uv.getX(i)},${uv.getY(i)}`);
      const volumes = buildingVolumes(p).filter(v => v.mat === 'facade'), design = buildingDesign(p);
      let found = 0;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        const position = new THREE.Vector3().setFromMatrixPosition(matrix);
        if (!volumes.some(volume => {
          const location = point(p, volume.x, volume.z);
          return Math.hypot(position.x - location.x, position.z - location.z) < .001 && Math.abs(position.y - p.y - volume.y) < .001;
        })) continue;
        assert.deepEqual([uv.getX(i), uv.getY(i), uv.getZ(i), uv.getW(i)], facadeUV(design.surface, design.windowLighting)); found++;
        assert.equal(seeds.getX(i), design.windowSeed, 'all sections carry their building’s stable random seed');
      }
      assert.equal(found, volumes.length, 'every wing and setback uses this building’s facade and lighting profile');
      let disposed = 0; mesh.geometry.addEventListener('dispose', () => disposed++);
      const expected = [...uv.array], expectedSeeds = [...seeds.array]; stream.release(cell, 0); assert.equal(disposed, 1);
      stream.build(cell, 0);
      const rebuilt = cell.groups[0].children.find(m => m.material.name === 'vertical-facade' && m.geometry.name === mesh.geometry.name);
      assert.equal(rebuilt.material, mesh.material);
      assert.deepEqual([...rebuilt.geometry.attributes.instanceUvRect.array], expected);
      assert.deepEqual([...rebuilt.geometry.attributes.instanceWindowSeed.array], expectedSeeds, 'streaming does not reshuffle the lights');
    }
    assert.equal(materials.size, 1); assert.ok(tiles.size >= 4, 'nearby streets visibly use multiple finishes at the shell LOD');
  } finally { stream.dispose(); }
});
