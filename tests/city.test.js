import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCityPlan, BUILDING_TYPES } from '../src/city-plan.js';
import { Metropolis, streetPoint } from '../src/metropolis.js';
import { SpatialGrid } from '../src/spatial-grid.js';
import { WORLD_LIMIT } from '../src/world-config.js';
import { WORLD_OBJECTS, REGIONAL_STOPS } from '../src/content.js';
import { circleHitsBox, moveWithCollisions, overlapsHeight } from '../src/physics.js';
import { WorldStream, ResolutionGovernor } from '../src/world-stream.js';
import { Campaign, writeSave, readSave } from '../src/campaign.js';

test('city covers 121 square kilometres without exceeding San Francisco land area', () => {
  const area = (WORLD_LIMIT * 2 / 1000) ** 2;
  assert.equal(area, 121); assert.ok(area < 46.91 * 2.589988110336);
  const point = { x: WORLD_LIMIT - 3, z: WORLD_LIMIT - 3 };
  moveWithCollisions(point, 30, 30, .5, []);
  assert.equal(point.x, WORLD_LIMIT - .5); assert.equal(point.z, WORLD_LIMIT - .5);
});

test('the inner expansion has all building types, organic roads and clear story destinations', () => {
  const plan = createCityPlan(WORLD_OBJECTS);
  assert.deepEqual([...new Set(plan.buildings.map(b => b.type))].sort(), [...BUILDING_TYPES].sort());
  assert.ok(plan.buildings.length > 500 && plan.trees.length > 900 && plan.props.length > 150);
  assert.ok(plan.roads.some(r => r.points.some((p, i) => i && Math.abs(p.x - r.points[i - 1].x) > .1 && Math.abs(p.z - r.points[i - 1].z) > .1)));
  for (const b of plan.buildings) assert.equal(plan.onRoad(b.box), false, `Building obstructs road: ${b.id}`);
  for (const place of WORLD_OBJECTS) assert.equal(plan.colliders.some(b => circleHitsBox(place.x, place.z, .5, b)), false, place.id);
  assert.deepEqual(createCityPlan(WORLD_OBJECTS).buildings, plan.buildings);
});

test('inner road lanes and intersections stay clear of trees and street furniture', () => {
  const plan = createCityPlan(WORLD_OBJECTS), index = new SpatialGrid(plan.colliders);
  for (const road of plan.roads) for (let i = 1; i < road.points.length; i++) {
    const p = road.points[i], a = road.points[i - 1], length = Math.hypot(p.x - a.x, p.z - a.z);
    for (const offset of road.width >= 14 ? [-2.5, 0, 2.5] : [0]) {
      const x = p.x + (p.z - a.z) / length * offset, z = p.z - (p.x - a.x) / length * offset;
      assert.equal(index.near(x, z, 2).some(b => overlapsHeight(b) && circleHitsBox(x, z, 1.6, b)), false, `${road.name} at ${x},${z}`);
    }
  }
});

test('regional blueprints are deterministic after eviction and bounded in memory', () => {
  const metro = new Metropolis(WORLD_OBJECTS), first = structuredClone(metro.block(16, -14));
  for (let x = -26; x < 26; x++) for (let z = -3; z < 3; z++) metro.block(x, z);
  assert.ok(metro.blocks.size <= 160);
  assert.deepEqual(metro.block(16, -14), first);
  assert.ok(first.buildings.length > 0 && first.trees.length > 0);
});

test('the whole regional city stays within bounds and keeps buildings out of streets', () => {
  const metro = new Metropolis(WORLD_OBJECTS); let buildings = 0, trees = 0;
  for (let x = -29; x < 29; x++) for (let z = -29; z < 29; z++) {
    const block = metro.block(x, z); buildings += block.buildings.length; trees += block.trees.length;
    for (const b of block.buildings) {
      assert.equal(metro.onRoad(b.box), false);
      assert.ok(Math.max(Math.abs(b.box.minX), Math.abs(b.box.minZ), Math.abs(b.box.maxX), Math.abs(b.box.maxZ)) < WORLD_LIMIT);
    }
  }
  assert.ok(buildings > 30000 && trees > 40000);
});

test('regional transit, fast travel arrival and parked cars have collision-free clearance', () => {
  const metro = new Metropolis(WORLD_OBJECTS);
  for (const stop of REGIONAL_STOPS) {
    const boxes = metro.collidersIn(stop.x - 60, stop.z - 60, stop.x + 60, stop.z + 60);
    assert.equal(boxes.some(b => circleHitsBox(stop.x, stop.z + 2, .5, b)), false, stop.id);
    const p = streetPoint(stop.roadX, stop.roadZ - 32);
    assert.equal(boxes.some(b => circleHitsBox(p.x + 3.5, p.z, 1.6, b)), false, `Car at ${stop.id}`);
  }
});

test('broad-phase queries match full collision and ray candidates across cell boundaries', () => {
  const boxes = [{ minX: 47, maxX: 50, minZ: -5, maxZ: 5, maxY: 6 }, { minX: -48, maxX: -46, minZ: -49, maxZ: -45, maxY: 10 }];
  const grid = new SpatialGrid(boxes);
  assert.deepEqual(grid.near(48, 0, 3), [boxes[0]]);
  assert.deepEqual(grid.along({ x: -100, z: -47 }, { x: 1, z: 0 }, 120), [boxes[1]]);
  const a = { x: 30, z: 0 }, b = { ...a };
  moveWithCollisions(a, 40, 3, .5, boxes); moveWithCollisions(b, 40, 3, .5, grid);
  assert.deepEqual(a, b); assert.ok(a.x < 47);
});

test('regional collision metadata works before any visual mesh is loaded', () => {
  const metro = new Metropolis(WORLD_OBJECTS), building = metro.block(12, -12).buildings[0];
  const { box } = building, player = { x: box.minX - 1, z: building.z };
  const query = { query: (...bounds) => metro.collidersIn(...bounds) };
  moveWithCollisions(player, 8, 0, .43, query);
  assert.ok(player.x <= box.minX - .43);
});

test('streaming releases far instance buffers, preserves shared geometry, and rebuilds on return', () => {
  const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), camera = new THREE.PerspectiveCamera(65, 1.6, .1, 700);
  const stream = new WorldStream(scene);
  stream.add(mat, 2, 5, -20, 8, 10, 8);
  const player = { x: 0, z: 0 };
  camera.position.set(0, 4, 6); camera.lookAt(0, 2, -20);
  for (let i = 0; i < 8; i++) stream.update(camera, player, i * .2, true);
  const cell = stream.cell(0, -1), mesh = cell.groups[0].children[0];
  assert.ok(mesh.isInstancedMesh); assert.ok(mesh.boundingSphere);
  let released = false, geometryDisposed = false;
  mesh.addEventListener('dispose', () => { released = true; }); mesh.geometry.addEventListener('dispose', () => { geometryDisposed = true; });
  player.x = 4200; player.z = 3500; camera.position.set(4200, 4, 3506); camera.lookAt(4200, 2, 3480);
  stream.update(camera, player, 20, true);
  assert.ok(released); assert.equal(geometryDisposed, false); assert.equal(cell.groups[0], null);
  player.x = player.z = 0; camera.position.set(0, 4, 6); camera.lookAt(0, 2, -20);
  for (let i = 0; i < 8; i++) stream.update(camera, player, 30 + i * .2, true);
  assert.equal(cell.groups[0].children[0].count, 1); assert.notEqual(cell.groups[0].children[0], mesh);
  stream.dispose(); mat.dispose();
});

test('adaptive resolution ignores background stalls and needs sustained frame pressure', () => {
  const governor = new ResolutionGovernor();
  for (let i = 0; i < 20; i++) governor.sample(1);
  assert.equal(governor.scale, 1);
  for (let i = 0; i < 60; i++) governor.sample(1 / 30);
  assert.equal(governor.scale, 1);
  for (let i = 0; i < 90; i++) governor.sample(1 / 30);
  assert.ok(governor.scale < 1);
  for (let i = 0; i < 1000; i++) governor.sample(1 / 30, .65);
  assert.equal(governor.scale, .65);
});

test('a long road stays visible near its far end even when its owning cell is behind the camera', () => {
  const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), stream = new WorldStream(scene);
  const camera = new THREE.PerspectiveCamera(65, 1.6, .1, 600), player = { x: 0, z: -500 };
  stream.setQuality('low'); stream.add(mat, 0, 0, 0, 15, .01, 1100);
  camera.position.set(0, 4, -496); camera.lookAt(0, 0, -550);
  for (let i = 0; i < 8; i++) stream.update(camera, player, i * .2, true);
  const cell = stream.cell(0, 0);
  assert.ok(cell.groups[0]?.visible, 'the road crosses both the distance limit and the camera frustum');
  stream.dispose(); mat.dispose();
});

test('saves retain metropolitan positions and still read original city saves', () => {
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  for (const position of [{ x: -2.5, z: 30 }, { x: 5000, z: -4900 }]) {
    writeSave(storage, new Campaign().data, position); assert.deepEqual(readSave(storage).position, position);
  }
  writeSave(storage, new Campaign().data, { x: WORLD_LIMIT + 5, z: 0 }); assert.equal(readSave(storage).position, null);
});
