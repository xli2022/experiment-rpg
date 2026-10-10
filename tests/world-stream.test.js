import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldStream, ResolutionGovernor } from '../src/world/world-stream.js';

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
