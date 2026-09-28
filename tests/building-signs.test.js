import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDING_SIGN_CATALOG } from '../src/building-signs.js';
import { createVerticalCity, VerticalMetropolis } from '../src/vertical-city.js';
import { createMasterPlan, MASTER_DISTRICTS, SHOWCASE } from '../src/master-plan.js';
import { WorldStream, WORLD_GEOMETRY } from '../src/world-stream.js';

test('every generated building and landmark has a type-appropriate sign on its street-facing wall', () => {
  const metro = new VerticalMetropolis(createMasterPlan()), types = new Set(), designs = new Set();
  const districts = [...MASTER_DISTRICTS, SHOWCASE];
  let buildings = 0, landmarks = 0;
  for (const district of districts) for (const block of metro.area(district.x - 260, district.z - 260, district.x + 260, district.z + 260)) {
    for (const p of block.buildings) {
      buildings++; landmarks += Number(Boolean(p.anchor)); types.add(p.type);
      const sign = p.sign; assert.ok(sign, `${p.id} has a sign`); designs.add(sign.title);
      assert.ok(BUILDING_SIGN_CATALOG[p.type].some(design => design.title === sign.title && design.subtitle === sign.subtitle));
      const nx = Math.sin(sign.yaw), nz = Math.cos(sign.yaw), dx = sign.street.x - p.x, dz = sign.street.z - p.z;
      assert.ok((nx * dx + nz * dz) / Math.hypot(dx, dz) >= Math.SQRT1_2 - 1e-9, `${p.id} faces the street, not a rear yard`);
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), lx = (sign.x - p.x) * c - (sign.z - p.z) * s, lz = (sign.x - p.x) * s + (sign.z - p.z) * c;
      const onSide = Math.abs(lx) > Math.abs(lz);
      assert.ok(Math.abs(Math.abs(onSide ? lx : lz) - (onSide ? p.w : p.d) / 2 - .38) < 1e-8, 'sign is attached just outside its wall');
      assert.ok(sign.w < (onSide ? p.d : p.w) && sign.h > 1, 'sign fits the frontage');
      assert.ok(sign.y - sign.h / 2 > p.y + 4 && sign.y + sign.h / 2 < p.y + p.h, 'sign clears the entrance and roof');
      if (['apartment', 'terrace'].includes(p.type)) assert.ok(sign.y + sign.h / 2 < p.y + 6.8, 'first balcony does not hide the residential nameplate');
      assert.ok(sign.uv.every(Number.isFinite) && sign.uv[0] >= 0 && sign.uv[1] >= 0 && sign.uv[0] + sign.uv[2] <= 1 && sign.uv[1] + sign.uv[3] <= 1);
    }
  }
  assert.ok(buildings > 600 && landmarks > 0);
  assert.deepEqual(types, new Set(Object.keys(BUILDING_SIGN_CATALOG)));
  assert.equal(designs.size, 28, 'districts use the full shared tenant catalog');
});

test('sign faces are visible from the street for every building type and share a single draw per chunk', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream), examples = new Map(), materials = new Set();
  try {
    for (const d of MASTER_DISTRICTS) for (const b of city.metropolis.area(d.x - 200, d.z - 200, d.x + 200, d.z + 200)) {
      for (const p of b.buildings) if (!examples.has(p.type)) examples.set(p.type, p);
    }
    for (const p of examples.values()) {
      const cell = stream.cell(Math.floor(p.x / 96), Math.floor(p.z / 96));
      if (!cell.groups[0]) stream.build(cell, 0);
      if (!cell.groups[1]) stream.build(cell, 1);
      scene.updateMatrixWorld(true);
      const meshes = cell.groups.flatMap(group => group.children), signs = meshes.filter(mesh => mesh.material.name === 'building-signs');
      assert.equal(signs.length, 1, `${p.type}: all tenants in one chunk share a sign draw`);
      const mesh = signs[0]; materials.add(mesh.material);
      const occupants = city.metropolis.area(cell.x, cell.z, cell.x + 96, cell.z + 96).flatMap(block => block.buildings)
        .filter(building => building.x >= cell.x && building.x < cell.x + 96 && building.z >= cell.z && building.z < cell.z + 96);
      assert.equal(mesh.count, occupants.length, 'no building loses its sign at shell detail');
      assert.equal(mesh.geometry.attributes.instanceUvRect.count, mesh.count);
      assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
      assert.equal(mesh.material.side, THREE.FrontSide, 'lettering is not mirrored onto the back');
      const normal = new THREE.Vector3(Math.sin(p.sign.yaw), 0, Math.cos(p.sign.yaw));
      const center = new THREE.Vector3(p.sign.x, p.sign.y, p.sign.z);
      const hit = new THREE.Raycaster(center.clone().addScaledVector(normal, 4), normal.clone().negate(), 0, 5).intersectObjects(meshes, false)[0];
      assert.equal(hit?.object, mesh, `${p.id}: the actual visible surface is the sign, not its wall, canopy or trim`);
      const uv = mesh.geometry.attributes.instanceUvRect;
      const actual = [uv.getX(hit.instanceId), uv.getY(hit.instanceId), uv.getZ(hit.instanceId), uv.getW(hit.instanceId)];
      actual.forEach((value, i) => assert.ok(Math.abs(value - p.sign.uv[i]) < 1e-6, 'instance selects its assigned tenant artwork'));
    }
    assert.equal(examples.size, 7); assert.equal(materials.size, 1, 'all types share the atlas/material, including across chunks');
  } finally { stream.dispose(); }
});

test('sign instance UV buffers are released with chunks and regenerate without losing the shared atlas', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream);
  const p = city.metropolis.area(SHOWCASE.x - 150, SHOWCASE.z - 150, SHOWCASE.x + 150, SHOWCASE.z + 150).flatMap(b => b.buildings)[0];
  const cell = stream.cell(Math.floor(p.x / 96), Math.floor(p.z / 96));
  try {
    stream.build(cell, 0);
    const mesh = cell.groups[0].children.find(mesh => mesh.material.name === 'building-signs');
    const atlas = mesh.material.map, expected = [...mesh.geometry.attributes.instanceUvRect.array];
    let disposed = 0, sharedDisposed = 0;
    mesh.geometry.addEventListener('dispose', () => disposed++);
    const onSharedDispose = () => sharedDisposed++;
    WORLD_GEOMETRY.plane.addEventListener('dispose', onSharedDispose); atlas.addEventListener('dispose', onSharedDispose);
    stream.release(cell, 0);
    assert.equal(disposed, 1); assert.equal(sharedDisposed, 0);
    stream.build(cell, 0);
    const rebuilt = cell.groups[0].children.find(mesh => mesh.material.name === 'building-signs');
    assert.equal(rebuilt.material.map, atlas); assert.notEqual(rebuilt.geometry, mesh.geometry);
    assert.deepEqual([...rebuilt.geometry.attributes.instanceUvRect.array], expected);
    WORLD_GEOMETRY.plane.removeEventListener('dispose', onSharedDispose); atlas.removeEventListener('dispose', onSharedDispose);
  } finally { stream.dispose(); }
});
