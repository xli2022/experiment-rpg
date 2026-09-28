import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createContactShadows } from '../src/contact-shadows.js';

const actor = (changes = {}) => ({ x: 5, y: .04, z: -8, width: 2.4, length: 4.6, ...changes });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);

test('contact shadows follow current actor transforms on every update', () => {
  const shadows = createContactShadows(new THREE.Scene());
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  shadows.update([actor()]);
  shadows.mesh.getMatrixAt(0, matrix);
  point.set(0, 0, 0).applyMatrix4(matrix);
  close(point.x, 5); close(point.y, .04); close(point.z, -8);
  const firstVersion = shadows.mesh.instanceMatrix.version;

  shadows.update([actor({ x: 145, y: .24, z: 1200, yaw: Math.PI / 2, opacity: .25 })]);
  shadows.mesh.getMatrixAt(0, matrix);
  point.set(0, 0, 0).applyMatrix4(matrix);
  close(point.x, 145); close(point.y, .24); close(point.z, 1200);
  point.set(.5, 0, 0).applyMatrix4(matrix);
  close(point.x, 145); close(point.z, 1198.8);
  assert.ok(shadows.mesh.instanceMatrix.version > firstVersion);
  close(shadows.mesh.geometry.attributes.shadowOpacity.getX(0), .25);
  assert.equal(shadows.mesh.frustumCulled, false);
  shadows.dispose();
});

test('contact shadows keep one bounded draw and disappear when actors are omitted', () => {
  const scene = new THREE.Scene(), shadows = createContactShadows(scene, { capacity: 2 });
  const geometry = shadows.mesh.geometry, texture = shadows.mesh.material.uniforms.shadowMap.value;
  shadows.update([actor(), actor({ x: 30 }), actor({ x: 60 })]);
  assert.deepEqual(shadows.snapshot(), { count: 2, capacity: 2, drawCalls: 1, triangles: 4, textureSize: 32 });
  assert.equal(scene.children.length, 1);
  assert.equal(geometry.attributes.position.count, 4);
  assert.equal(geometry.index.count, 6);
  assert.equal(shadows.mesh.instanceMatrix.count, 2);
  assert.equal(texture.image.data.length, 32 * 32 * 4);
  assert.equal(texture.generateMipmaps, false);
  assert.equal(texture.image.data[3], 0, 'quad edges blend into the ground');
  assert.ok(texture.image.data[(16 * 32 + 16) * 4 + 3] > 250);
  assert.equal(shadows.mesh.castShadow, false);
  assert.equal(shadows.mesh.receiveShadow, false);
  assert.equal(shadows.mesh.material.depthWrite, false);
  assert.equal(shadows.mesh.material.lights, false);
  shadows.update([]);
  assert.equal(shadows.mesh.count, 0);
  assert.equal(shadows.mesh.visible, false);
  assert.equal(shadows.snapshot().drawCalls, 0);
  assert.equal(shadows.mesh.geometry, geometry);
  assert.equal(shadows.mesh.material.uniforms.shadowMap.value, texture);
  shadows.dispose();
});

test('invalid actor descriptors cannot upload non-finite transforms or stale shadows', () => {
  const shadows = createContactShadows(new THREE.Scene());
  shadows.update([actor(), actor({ x: NaN }), actor({ y: Infinity }), actor({ yaw: NaN }),
    actor({ width: -2 }), actor({ length: 0 }), actor({ opacity: 0 }), actor({ opacity: Infinity }),
    actor({ opacity: 2 })]);
  assert.equal(shadows.mesh.count, 2);
  assert.ok(shadows.mesh.instanceMatrix.array.every(Number.isFinite));
  assert.equal(shadows.mesh.geometry.attributes.shadowOpacity.getX(1), 1);
  shadows.update([actor({ z: NaN })]);
  assert.equal(shadows.mesh.count, 0);
  assert.equal(shadows.mesh.visible, false);
  shadows.dispose();
  assert.throws(() => createContactShadows(new THREE.Scene(), { capacity: Infinity }), RangeError);
  assert.throws(() => createContactShadows(new THREE.Scene(), { capacity: 0 }), RangeError);
});

test('disposing contact shadows releases the shared GPU resources once', () => {
  const scene = new THREE.Scene(), shadows = createContactShadows(scene);
  const mesh = shadows.mesh, texture = mesh.material.uniforms.shadowMap.value;
  const disposed = { mesh: 0, geometry: 0, material: 0, texture: 0 };
  for (const [name, resource] of Object.entries({ mesh, geometry: mesh.geometry, material: mesh.material, texture })) {
    resource.addEventListener('dispose', () => disposed[name]++);
  }
  shadows.dispose(); shadows.dispose(); shadows.update([actor()]);
  assert.equal(scene.children.length, 0);
  assert.equal(shadows.mesh.count, 0);
  assert.deepEqual(disposed, { mesh: 1, geometry: 1, material: 1, texture: 1 });
});
