import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDING_SIGN_CATALOG } from '../src/world/building-signs.js';
import { createVerticalCity, VerticalMetropolis } from '../src/world/vertical-city.js';
import { createMasterPlan, MASTER_DISTRICTS, SHOWCASE } from '../src/world/master-plan.js';
import { WorldStream, WORLD_GEOMETRY } from '../src/world/world-stream.js';
import { WORLD_LIMIT } from '../src/world/world-config.js';
import { AFTERLIGHT_LANDMARKS as LANDMARKS } from '../src/world/landmarks.js';
import { SpatialGrid } from '../src/core/spatial-grid.js';
import { footprintVertices, polygonFaces } from '../src/world/building-footprints.js';
import { createInfrastructureIndex, geometryVolume, infrastructureIntersections } from '../src/world/infrastructure-clearance.js';

let worldAudit;
function entireWorld() {
  if (worldAudit) return worldAudit;
  // Match live reserved landmarks: suppressing a frontage candidate can also
  // change which neighboring candidate wins the deterministic lot selection.
  const plan = createMasterPlan(), metro = new VerticalMetropolis(plan, LANDMARKS);
  const blocks = metro.area(-WORLD_LIMIT, -WORLD_LIMIT, WORLD_LIMIT, WORLD_LIMIT);
  const buildings = blocks.flatMap(block => block.buildings);
  const infrastructure = createInfrastructureIndex(plan, blocks.flatMap(block => block.infrastructure));
  return worldAudit = { blocks, buildings, infrastructure };
}

test('every generated building and landmark has a type-appropriate sign on its street-facing wall', () => {
  const types = new Set(), designs = new Set(), world = entireWorld();
  let buildings = 0, landmarks = 0;
  for (const block of world.blocks) {
    for (const p of block.buildings) {
      buildings++; landmarks += Number(Boolean(p.anchor)); types.add(p.type);
      const sign = p.sign; assert.ok(sign, `${p.id} has a sign`); designs.add(sign.title);
      assert.ok(BUILDING_SIGN_CATALOG[p.type].some(design => design.title === sign.title && design.subtitle === sign.subtitle));
      const nx = Math.sin(sign.yaw), nz = Math.cos(sign.yaw), dx = sign.street.x - p.x, dz = sign.street.z - p.z;
      assert.ok((nx * dx + nz * dz) / Math.hypot(dx, dz) >= Math.SQRT1_2 - 1e-9, `${p.id} faces the street, not a rear yard`);
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), lx = (sign.x - p.x) * c - (sign.z - p.z) * s, lz = (sign.x - p.x) * s + (sign.z - p.z) * c;
      const faces = polygonFaces(footprintVertices(p.footprint, p.w, p.d));
      const distance = Math.max(...faces.map(f => (lx - f.x) * f.nx + (lz - f.z) * f.nz));
      assert.ok(Math.abs(distance - .38) < 1e-8, 'sign is attached just outside the actual wall perimeter');
      const mounted = faces.find(f => Math.hypot(lx - f.x - f.nx * .38, lz - f.z - f.nz * .38) < 1e-8);
      assert.ok(mounted && sign.w < (p.footprint === 'circle' ? p.w * .65 : mounted.width) && sign.h > 1, 'sign fits the frontage');
      assert.ok(sign.y - sign.h / 2 > p.y + 4 && sign.y + sign.h / 2 < p.y + p.h, 'sign clears the entrance and roof');
      if (['apartment', 'terrace'].includes(p.type)) assert.ok(sign.y + sign.h / 2 < p.y + 6.8, 'first balcony does not hide the residential nameplate');
      assert.ok(sign.uv.every(Number.isFinite) && sign.uv[0] >= 0 && sign.uv[1] >= 0 && sign.uv[0] + sign.uv[2] <= 1 && sign.uv[1] + sign.uv[3] <= 1);
    }
  }
  assert.ok(buildings > 12000 && landmarks > 0, 'the audit covers the entire map, including roads between named districts');
  assert.equal(new Set(world.buildings.map(building => building.id)).size, buildings, 'every deterministic building is audited once');
  assert.deepEqual(types, new Set(Object.keys(BUILDING_SIGN_CATALOG)));
  assert.equal(designs.size, 28, 'districts use the full shared tenant catalog');
});

test('every building sign and its backboard clear all rendered road shoulders, ramps, decks, rails and piers', () => {
  const { buildings, infrastructure } = entireWorld();
  assert.ok(infrastructure.size > 26000, 'the full infrastructure network is checked');
  for (const building of buildings) {
    const sign = building.sign;
    // The visible plane is at depth 0; its wider backing spans -.22 to -.04.
    // Audit their combined envelope, including the backing border.
    const volume = { ...sign, x: sign.x - Math.sin(sign.yaw) * .11, z: sign.z - Math.cos(sign.yaw) * .11,
      w: sign.w + .24, h: sign.h + .2, d: .22 };
    const hits = infrastructureIntersections(volume, infrastructure);
    assert.equal(hits.length, 0, `${building.id} intersects ${hits.map(hit => `${hit.kind}:${hit.id ?? ''}`).join(', ')}`);
  }
});

test('clearance checks use the actual pitched slab and diagonal footprint instead of their broad bounds', () => {
  const slab = geometryVolume({ x: 0, y: 10, z: 0, w: 6, h: .6, d: 20, yaw: Math.PI / 4, pitch: -Math.atan(.5) });
  const infrastructure = new SpatialGrid([slab]);
  const panel = { x: 0, y: 6, z: 0, w: 1, h: 1, d: .2, yaw: 0 };
  assert.equal(infrastructureIntersections(panel, infrastructure).length, 0, 'a panel below the local ramp surface remains valid');
  assert.equal(infrastructureIntersections({ ...panel, y: 10 }, infrastructure).length, 1, 'a panel through the slab is rejected');
  assert.equal(infrastructureIntersections({ ...panel, x: 7, y: 10, z: -7 }, infrastructure).length, 0, 'a diagonal road does not occupy the corners of its AABB');
  const rail = new SpatialGrid([geometryVolume({ x: 0, y: 6, z: .4, w: 10, h: 1, d: .2 })]);
  assert.equal(infrastructureIntersections(panel, rail).length, 0);
  assert.equal(infrastructureIntersections(panel, rail, .21).length, 1, 'requested mounting clearance includes the space beside a rail');
});

test('sign faces are visible from the street for every building type and share a single draw per chunk', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream, LANDMARKS), examples = new Map(), materials = new Set();
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
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream, LANDMARKS);
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
