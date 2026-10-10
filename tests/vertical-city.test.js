import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVerticalCity, createVerticalGroundGeometry, VerticalMetropolis, frontageBlocked } from '../src/world/vertical-city.js';
import { createMasterPlan, terrainHeight, TERRAIN_GRID, SHOWCASE, MASTER_DISTRICTS } from '../src/world/master-plan.js';
import { WorldStream } from '../src/world/world-stream.js';
import { surfaceHeightAt, boxContainsPoint } from '../src/core/physics.js';
import { SpatialGrid } from '../src/core/spatial-grid.js';
import { CITY_SCALE } from '../src/world/world-scale.js';
import { buildingVolumes } from '../src/world/building-design.js';
import { footprintVertices, polygonFaces } from '../src/world/building-footprints.js';

const worldPoint = (p, x, z) => ({ x: p.x + x * Math.cos(p.yaw) + z * Math.sin(p.yaw), z: p.z - x * Math.sin(p.yaw) + z * Math.cos(p.yaw) });

test('vertical terrain uses the physical 32 m triangles without overlapping floor layers', () => {
  const geometry = createVerticalGroundGeometry(), position = geometry.attributes.position, normal = geometry.attributes.normal;
  assert.ok(geometry.index.count / 3 < 65000, 'resident ground has a bounded triangle budget');
  for (let i = 0; i < position.count; i += 59) {
    const x = position.getX(i), z = position.getZ(i);
    assert.ok(x % TERRAIN_GRID === 0); assert.ok(z % TERRAIN_GRID === 0);
    assert.ok(Math.abs(position.getY(i) + .035 - terrainHeight(x, z)) < .00002);
    assert.ok(normal.getY(i) > 0);
  }
  const index = geometry.index, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 351) {
    a.fromBufferAttribute(position, index.getX(i)); b.fromBufferAttribute(position, index.getX(i + 1)); c.fromBufferAttribute(position, index.getX(i + 2));
    const x = (a.x + b.x + c.x) / 3, z = (a.z + b.z + c.z) / 3;
    assert.ok(Math.abs((a.y + b.y + c.y) / 3 + .035 - terrainHeight(x, z)) < .00002, 'simulation follows the mesh interior');
  }
  geometry.dispose();
});

test('procedural districts regenerate identical collision blueprints with bounded residency', () => {
  const plan = createMasterPlan(), metro = new VerticalMetropolis(plan, [SHOWCASE.spawn]);
  const showcaseBlock = [Math.floor(SHOWCASE.x / 192), Math.floor(SHOWCASE.z / 192)];
  const first = structuredClone(metro.block(...showcaseBlock));
  for (let x = -15; x <= 15; x++) for (let z = -4; z <= 4; z++) metro.block(x, z);
  assert.ok(metro.blocks.size <= 160);
  assert.deepEqual(metro.block(...showcaseBlock), first);
  let total = 0;
  for (const d of MASTER_DISTRICTS) {
    const blocks = metro.area(d.x - 140, d.z - 140, d.x + 140, d.z + 140);
    const buildings = blocks.flatMap(b => b.buildings); total += buildings.length;
    for (const p of buildings) {
      const base = buildingVolumes(p)[0];
      assert.ok(p.box.minY <= p.y);
      assert.equal(p.box.maxY, p.y + base.y + base.h / 2 + .5, 'the climbable base ends at its actual first terrace');
      assert.ok(Number.isFinite(p.y) && p.h > 0);
      assert.equal(frontageBlocked(p.box, plan, 2), false, `${p.id} leaves roads and access ramps clear`);
    }
  }
  assert.ok(total > 350, 'all thirteen districts contain actual explorable massing');
});

test('frontage buildings face accessible surface streets and sit on their rotated terrain corners', () => {
  const plan = createMasterPlan(), metro = new VerticalMetropolis(plan);
  let count = 0, diagonal = 0;
  const sizes = new Set(), setbacks = new Set();
  for (const district of MASTER_DISTRICTS) {
    const buildings = metro.area(district.x - 260, district.z - 260, district.x + 260, district.z + 260).flatMap(block => block.buildings);
    const footprints = new SpatialGrid(buildings.map(p => p.box));
    for (const p of buildings.filter(p => !p.anchor)) {
      count++; if (Math.abs(Math.sin(p.yaw * 2)) > .2) diagonal++;
      const road = plan.roads.find(r => r.id === p.street.roadId);
      assert.notEqual(road.class, 'expressway'); assert.notEqual(road.kind, 'ramp');
      assert.ok(Math.abs(p.street.y - terrainHeight(p.street.x, p.street.z)) < 1.1);
      const dx = p.street.x - p.x, dz = p.street.z - p.z, distance = Math.hypot(dx, dz);
      assert.ok((dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / distance > .99999, `${p.id} presents its entrance to its street`);
      assert.ok(Math.abs(distance - p.d / 2 - p.street.width / 2 - p.setback) < 1e-7);
      assert.ok(p.setback >= 6.5 * CITY_SCALE, 'awnings leave walking space beside the carriageway');
      assert.equal(p.box.yaw, p.yaw, 'rotated visual footprints and collision agree');
      const heights = [-.5, .5].flatMap(sx => [-.5, .5].map(sz => {
        const corner = worldPoint(p, sx * p.w, sz * p.d); return terrainHeight(corner.x, corner.z);
      }));
      assert.ok(Math.abs(p.y - Math.max(...heights) - .12) < 1e-9);
      assert.ok(Math.max(...heights) - Math.min(...heights) <= 2.4, 'steep lots leave open hillside instead of huge foundation walls');
      // Follow the public approach from the curb to just outside the front
      // wall. Neighboring lots must never strand an entrance in an interior.
      for (let i = 0; i <= 5; i++) {
        const localZ = p.d / 2 + 1 + (p.setback - 1) * i / 5;
        const approach = worldPoint(p, 0, localZ);
        assert.ok(!footprints.near(approach.x, approach.z, 1).some(box => boxContainsPoint(approach.x, approach.z, box)), `${p.id} has a clear route to the curb`);
      }
      sizes.add(Math.round(p.w)); setbacks.add(Math.round(p.setback));
    }
  }
  assert.ok(count > 550, 'district streets supply actual frontage development');
  assert.ok(diagonal > 50, 'buildings follow bends instead of retaining a world-axis grid');
  assert.ok(sizes.size > 8 && setbacks.size > 3, 'compact lot dimensions and yards vary');
  const remote = metro.area(-5300 * CITY_SCALE, -3500 * CITY_SCALE, -5200 * CITY_SCALE, -3400 * CITY_SCALE).flatMap(block => block.buildings);
  assert.ok(remote.every(p => p.anchor || p.street), 'no independent carpet of off-street buildings remains');
});

test('neighboring frontage lots never overlap and have stable ownership across block load order', () => {
  const plan = createMasterPlan(), first = new VerticalMetropolis(plan), reverse = new VerticalMetropolis(plan);
  const keys = [];
  for (const id of ['shadowmarket', 'ember-heights', 'citadel']) {
    const d = MASTER_DISTRICTS.find(d => d.id === id), bx = Math.floor(d.x / 192), bz = Math.floor(d.z / 192);
    for (let x = bx - 2; x <= bx + 2; x++) for (let z = bz - 2; z <= bz + 2; z++) keys.push([x, z]);
  }
  const blocks = keys.map(key => first.block(...key));
  for (const key of keys.toReversed()) reverse.block(...key);
  for (const key of keys) assert.deepEqual(first.block(...key), reverse.block(...key));
  const buildings = blocks.flatMap(block => block.buildings), lots = buildings.filter(p => p.lot).map(p => ({ ...p.lot, id: p.id }));
  assert.equal(new Set(buildings.map(p => p.id)).size, buildings.length, 'every lot has exactly one streaming owner');
  const grid = new SpatialGrid(lots);
  const corners = p => [-.5, .5].flatMap(x => [-.5, .5].map(z => worldPoint(p, x * p.w, z * p.d)));
  for (const a of lots) for (const b of grid.query(a.minX, a.minZ, a.maxX, a.maxZ)) {
    if (a.id >= b.id) continue;
    const ac = corners(a), bc = corners(b), axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2];
    const separated = axes.some(yaw => {
      const project = points => points.map(p => p.x * Math.sin(yaw) + p.z * Math.cos(yaw));
      const ap = project(ac), bp = project(bc);
      return Math.max(...ap) <= Math.min(...bp) || Math.max(...bp) <= Math.min(...ap);
    });
    assert.ok(separated, `${a.id} and ${b.id} retain their side passage and rear yard`);
  }
  // Thin queries immediately outside an owner's block still discover any
  // rotated footprint reaching across the boundary.
  for (const p of buildings.filter(p => p.lot)) {
    const point = worldPoint(p, p.w * .49, p.d * .49);
    assert.ok(first.collidersIn(point.x - .05, point.z - .05, point.x + .05, point.z + .05).some(box => box.id === p.box.id));
  }
});

test('tall buildings expose their window facades around every footprint', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream);
  try {
    for (const [districtId, type] of [['core', 'office'], ['stacks', 'apartment'], ['citadel', 'civic']]) {
      const district = MASTER_DISTRICTS.find(d => d.id === districtId);
      const tower = city.metropolis.area(district.x - 240, district.z - 240, district.x + 240, district.z + 240)
        .flatMap(block => block.buildings).find(p => !p.anchor && p.type === type && p.h > 75);
      assert.ok(tower, `${districtId} supplies a representative tall ${type}`);
      const cell = stream.cell(Math.floor(tower.x / 96), Math.floor(tower.z / 96));
      stream.build(cell, 0); stream.build(cell, 1); scene.updateMatrixWorld(true);
      const meshes = cell.groups.flatMap(group => group.children);
      // Follow every actual tier, including inset and offset upper floors.
      // Probe between balcony floors and corner columns, at both shell/detail LOD.
      for (const body of buildingVolumes(tower).filter(part => part.cap)) for (const face of polygonFaces(footprintVertices(body.shape, body.w, body.d))) for (const offset of [-.19, .11]) {
        const point = worldPoint(tower, body.x + face.x + face.nx * .45 + face.nz * face.width * offset,
          body.z + face.z + face.nz * .45 - face.nx * face.width * offset);
        const origin = new THREE.Vector3(point.x, tower.y + body.y + body.h * .13, point.z);
        const direction = new THREE.Vector3(-face.nx, 0, -face.nz).applyAxisAngle(new THREE.Vector3(0, 1, 0), tower.yaw);
        const hit = new THREE.Raycaster(origin, direction, 0, .9).intersectObjects(meshes, false)[0];
        assert.equal(hit?.object.material.name, 'vertical-facade', `${tower.id} ${type} tier at ${body.y} height, ${offset} width exposes its facade`);
      }
    }
  } finally { stream.dispose(); }
});

test('industrial buildings retain textured walls on every face at both streaming detail levels', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream);
  const materials = new Set(), maps = new Set();
  try {
    for (const [districtId, type] of [['void-port', 'warehouse'], ['foundry', 'factory']]) {
      const district = MASTER_DISTRICTS.find(d => d.id === districtId);
      const building = city.metropolis.area(district.x - 300, district.z - 300, district.x + 300, district.z + 300)
        .flatMap(block => block.buildings).find(p => p.type === type && p.h > 9 && Math.abs(Math.sin(p.yaw * 2)) > .04);
      assert.ok(building, `${districtId} supplies a rotated ${type}`);
      const cell = stream.cell(Math.floor(building.x / 96), Math.floor(building.z / 96));
      for (const level of [0, 1]) {
        stream.build(cell, level); scene.updateMatrixWorld(true);
        const meshes = cell.groups.filter(Boolean).flatMap(group => group.children);
        // Probe above loading doors and between front ribs. The actual nearest
        // visible surface must be textured, including when near details unload.
        for (const axis of ['x', 'z']) for (const side of [-1, 1]) for (const offset of [-.23, .13]) for (const height of [.65, .87]) {
          const local = { x: 0, z: 0 }, along = axis === 'x' ? 'z' : 'x';
          local[axis] = side * (building[axis === 'x' ? 'w' : 'd'] / 2 + 2);
          local[along] = offset * building[along === 'x' ? 'w' : 'd'];
          if (axis === 'z' && side === 1) local.x = -building.w / 2 + (Math.floor((local.x + building.w / 2) / 4.5) + .5) * 4.5;
          const point = worldPoint(building, local.x, local.z);
          const origin = new THREE.Vector3(point.x, building.y + building.h * height, point.z);
          const direction = new THREE.Vector3(); direction[axis] = -side; direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), building.yaw);
          const hit = new THREE.Raycaster(origin, direction, 0, 3).intersectObjects(meshes, false)[0];
          assert.equal(hit?.object.material.name, 'vertical-industrial', `${building.id} ${axis}${side} at ${height} height must retain its industrial facade in level ${level}`);
          assert.ok(hit.uv && [hit.uv.x, hit.uv.y].every(Number.isFinite), 'each wall has usable texture coordinates');
          materials.add(hit.object.material); maps.add(hit.object.material.map);
        }
        assert.equal(meshes.filter(mesh => mesh.material.name === 'vertical-industrial').length, 1, 'industrial shells share one instanced material draw per chunk');
      }
    }
    assert.equal(materials.size, 1, 'different buildings and chunks reuse the same material');
    assert.equal(maps.size, 1, 'no per-building facade texture allocations');
    const [map] = maps;
    assert.ok(map?.isTexture && map.image?.data, 'industrial cladding has an actual shared image');
    assert.ok(map.image.width * map.image.height <= 256 * 256, 'the repeatable industrial atlas stays small');
    assert.equal(map.wrapS, THREE.RepeatWrapping); assert.equal(map.wrapT, THREE.RepeatWrapping);
    assert.equal(map.magFilter, THREE.LinearFilter); assert.equal(map.minFilter, THREE.LinearMipmapLinearFilter);
    assert.equal(map.generateMipmaps, true, 'distant cladding is filtered instead of sparkling');
    const colors = new Set();
    for (let i = 0; i < map.image.data.length; i += 4) colors.add(`${map.image.data[i]},${map.image.data[i + 1]},${map.image.data[i + 2]}`);
    assert.ok(colors.size >= 4, 'the shell image contains visible panel and window variation instead of one solid color');
  } finally { stream.dispose(); }
});

test('roads and pedestrian decks remain support surfaces while piers and rails are solid', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream, [SHOWCASE.spawn]);
  const deck = city.masterPlan.supports.find(s => s.id === 'eastpoint-concourse');
  const supports = city.spatial.near(deck.x, deck.z, 2).filter(p => p.supportOnly);
  assert.ok(supports.some(p => p.id === deck.id && p.maxY === deck.y));
  assert.equal(city.surfaceHeight(deck.x, deck.z, deck.y + .1), deck.y);
  assert.ok(city.surfaceHeight(deck.x, deck.z, terrainHeight(deck.x, deck.z) + 1) < deck.y - 3, 'the lower level remains independently walkable');
  const objects = city.metropolis.area(deck.x - 90, deck.z - 90, deck.x + 90, deck.z + 90).flatMap(b => b.infrastructure);
  assert.ok(objects.some(p => p.kind === 'pier'));
  assert.ok(objects.some(p => p.kind === 'rail' && p.minY >= deck.y - .1 && !p.walkable));
  const ramp = city.masterPlan.supports.find(s => s.id === 'eastpoint-west-walk-ramp');
  const rampCollider = city.spatial.near((ramp.a.x + ramp.b.x) / 2, (ramp.a.z + ramp.b.z) / 2, 1).find(p => p.id === ramp.id);
  assert.ok(Math.abs(surfaceHeightAt((ramp.a.x + ramp.b.x) / 2, (ramp.a.z + ramp.b.z) / 2, rampCollider) - (ramp.a.y + ramp.b.y) / 2) < .001);
  assert.equal(city.cars.length, 0, 'drivable cars come from stopped traffic, not designated parked spawns');
});

test('sloped road meshes follow their support height and stay batched by material', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream);
  const road = city.masterPlan.roads.find(r => r.id === 'eastpoint-ramp'), a = road.points[4], b = road.points[5];
  const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, y = (a.y + b.y) / 2;
  const cell = stream.cell(Math.floor(x / 96), Math.floor(z / 96)); stream.build(cell, 0); stream.build(cell, 1);
  const meshes = cell.groups.flatMap(group => group.children), matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  assert.ok(meshes.length <= 25, 'a district-boundary chunk batches buildings and roads, with bounded grass and evergreen/tuft batches');
  let found = false;
  for (const mesh of meshes) {
    assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
    if (mesh.material.name !== 'vertical-road') continue;
    assert.equal(mesh.material.roughness, 1); assert.equal(mesh.material.metalness, 0);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); point.set(0, 0, 0).applyMatrix4(matrix);
      if (Math.hypot(point.x - x, point.z - z) > .01) continue;
      const top = new THREE.Vector3(0, .5, 0).applyMatrix4(matrix);
      assert.ok(Math.abs(top.y - y) < .003);
      const direction = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
      assert.ok(Math.abs(direction.y - (b.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)) < .00001);
      found = true;
    }
  }
  assert.ok(found, 'the ramp is represented by an inclined physical road mesh');
  stream.dispose();
});

test('road crossfall uses the same bank direction as its physical surface', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream);
  const s = city.masterPlan.roadIndex.query(-5500, -5500, 5500, 5500).find(s => Math.abs(s.crossSlope) > .008);
  assert.ok(s, 'the hillside road network contains a banked road');
  const x = (s.a.x + s.b.x) / 2, z = (s.a.z + s.b.z) / 2;
  const cell = stream.cell(Math.floor(x / 96), Math.floor(z / 96)); stream.build(cell, 0);
  const mesh = cell.groups[0].children.find(m => m.material.name === 'vertical-road'), matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  let found = false;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); point.set(0, 0, 0).applyMatrix4(matrix);
    if (Math.hypot(point.x - x, point.z - z) > .01) continue;
    for (const side of [-.45, .45]) {
      const edge = new THREE.Vector3(side, .5, 0).applyMatrix4(matrix);
      assert.ok(Math.abs(edge.y - surfaceHeightAt(edge.x, edge.z, s)) < .002);
      assert.ok(edge.y - terrainHeight(edge.x, edge.z) > .035, 'asphalt stays visibly above terrain on both sides');
    }
    found = true;
  }
  assert.ok(found); stream.dispose();
});

test('curved ramp joints extend visible asphalt and physical support by the same amount', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream);
  const s = city.masterPlan.roadIndex.query(-5500, -5500, 5500, 5500).find(s => s.road.kind === 'ramp' && s.supportOverlap > 1 && Math.abs(s.b.y - s.a.y) > .3);
  assert.ok(s, 'a tight interchange turn requires an extended deck cap');
  const x = (s.a.x + s.b.x) / 2, z = (s.a.z + s.b.z) / 2;
  const flatLength = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), length = Math.hypot(flatLength, s.b.y - s.a.y);
  const expectedLength = length + 2 * s.supportOverlap * length / flatLength;
  const cell = stream.cell(Math.floor(x / 96), Math.floor(z / 96)); stream.build(cell, 0);
  const mesh = cell.groups[0].children.find(m => m.material.name === 'vertical-road'), matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  let found = false;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); point.set(0, 0, 0).applyMatrix4(matrix);
    if (Math.hypot(point.x - x, point.z - z) > .01) continue;
    assert.ok(Math.abs(new THREE.Vector3().setFromMatrixColumn(matrix, 2).length() - expectedLength) < .0001);
    for (const end of [-.49, .49]) {
      const cap = new THREE.Vector3(0, .5, end).applyMatrix4(matrix);
      const supported = surfaceHeightAt(cap.x, cap.z, s);
      assert.notEqual(supported, null, 'visible cap is also a supported driving surface');
      assert.ok(Math.abs(cap.y - supported) < .003, 'extended ramp uses its continuing grade');
      assert.ok(cell.bounds.containsPoint(cap), 'streaming bounds retain the full extended road');
    }
    found = true;
  }
  assert.ok(found); stream.dispose();
});

test('pedestrian slabs share matte paving without stacking an extra floor', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream);
  const deck = city.masterPlan.supports.find(s => s.id === 'eastpoint-concourse');
  const cell = stream.cell(Math.floor(deck.x / 96), Math.floor(deck.z / 96)); stream.build(cell, 0);
  const paving = cell.groups[0].children.filter(mesh => mesh.material.name === 'vertical-pedestrian-paving');
  assert.equal(paving.length, 1, 'all pedestrian slabs in a chunk share one material batch');
  const material = paving[0].material;
  assert.equal(material.map, city.ground.material.map, 'the existing texture is reused');
  assert.equal(material.vertexColors, false); assert.equal(city.ground.material.vertexColors, true);
  assert.equal(material.roughness, 1); assert.equal(material.metalness, 0);
  assert.equal(material.color.getHex(), 0x64787b);
  const matrix = new THREE.Matrix4(), center = new THREE.Vector3(); let matchingSlabs = 0;
  for (const mesh of cell.groups[0].children) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); center.set(0, 0, 0).applyMatrix4(matrix);
    if (Math.hypot(center.x - deck.x, center.z - deck.z) > .01 || Math.abs(center.y - deck.y + .325) > .01) continue;
    matchingSlabs++; assert.equal(mesh.material, material);
    assert.ok(Math.abs(new THREE.Vector3(0, .5, 0).applyMatrix4(matrix).y - deck.y) < .0001);
  }
  assert.equal(matchingSlabs, 1, 'the existing physical slab supplies the textured top');
  stream.dispose();
});
