import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCar } from '../src/models.js';
import { carCollider } from '../src/physics.js';

test('car body and spinning wheels fit the existing vehicle collision envelope', () => {
  const car = createCar(), box = carCollider({ x: 0, z: 0, yaw: 0 });
  for (const angle of [0, .37, Math.PI / 2]) {
    for (const wheel of car.wheels) wheel.rotation.x = angle;
    car.root.position.y = .04;
    const bounds = new THREE.Box3().setFromObject(car.root, true);
    assert.ok(bounds.min.x >= box.minX && bounds.max.x <= box.maxX);
    assert.ok(bounds.min.z >= box.minZ && bounds.max.z <= box.maxZ);
    assert.ok(bounds.min.y >= box.minY && bounds.max.y <= box.maxY);
  }
  let meshes = 0, triangles = 0;
  car.root.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    const { position, normal } = object.geometry.attributes;
    for (const attribute of [position, normal]) assert.ok(attribute.array.every(Number.isFinite));
    triangles += (object.geometry.index?.count ?? position.count) / 3;
  });
  assert.ok(meshes <= 28 && triangles < 5000, 'parked cars retain a small rendering budget');
});

test('regional clones keep four independent wheel pivots while sharing static geometry', () => {
  const car = createCar(), clone = car.root.clone(true);
  const wheels = car.wheels.map(wheel => clone.children[car.root.children.indexOf(wheel)]);
  assert.equal(wheels.length, 4);
  for (const [i, wheel] of wheels.entries()) {
    assert.ok(wheel.isGroup && wheel.parent === clone);
    assert.notEqual(wheel, car.wheels[i]);
    assert.equal(wheel.children[0].geometry, car.wheels[i].children[0].geometry);
    wheel.rotation.x = 1.2;
    assert.equal(car.wheels[i].rotation.x, 0);
  }
  assert.equal(new Set(wheels).size, 4);
});
