import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTraffic, TRAFFIC_TAKEOVER_HITS } from '../src/traffic/traffic.js';

const player = { x: 20, y: 10, z: 0 };
function harness() {
  const scene = new THREE.Scene(), city = { cars: [], colliders: [], masterPlan: { roads: [
    { id: 'slope', width: 18, class: 'secondary', closed: false, points: [{ x: 0, y: 0, z: -500 }, { x: 0, y: 20, z: 500 }] },
  ] } };
  const traffic = createTraffic(scene, city);
  traffic.update(0, player, null, null);
  assert.ok(traffic.cars.length > 0);
  return { scene, city, traffic };
}

test('traffic requires three separate hits before a moving NPC becomes a drivable car', () => {
  const { traffic, city } = harness(), npc = traffic.cars[0], count = traffic.cars.length;
  for (let hit = 1; hit < TRAFFIC_TAKEOVER_HITS; hit++) {
    assert.deepEqual(traffic.hitCar(npc), { hit: true, hitsRemaining: TRAFFIC_TAKEOVER_HITS - hit, car: null });
    const before = npc.along;
    traffic.update(.1, player, null, null);
    assert.ok(npc.along > before, 'non-disabling hits must leave the NPC following its route');
    assert.equal(traffic.cars.length, count);
    assert.equal(city.cars.length, 0);
    assert.equal(traffic.snapshot().cars.find(car => car.id === npc.id).damageHits, hit);
  }
  const result = traffic.hitCar(npc);
  assert.equal(result.hit, true); assert.equal(result.hitsRemaining, 0);
  assert.ok(result.car?.root.isGroup);
  assert.equal(result.car.speed, 0);
  assert.equal(traffic.cars.length, count - 1);
  assert.equal(traffic.cars.includes(npc), false);
  assert.ok(traffic.root.children.every(mesh => mesh.count === count - 1), 'the old instance disappears in the same operation');
  assert.equal(city.cars.length, 0, 'the caller owns adding the converted car to the game');
  traffic.dispose();
});

test('conversion preserves fleet paint, banked slope pose and wheel rotation without disposing shared assets', () => {
  const { traffic } = harness(), npc = traffic.cars[0];
  npc.roll = .035; npc.wheelAngle = -5.7;
  const old = { x: npc.x, y: npc.y, z: npc.z, yaw: npc.yaw, pitch: npc.pitch, roll: npc.roll };
  let geometryDisposals = 0, materialDisposals = 0;
  for (const mesh of traffic.root.children) {
    mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
    mesh.material.addEventListener('dispose', () => materialDisposals++);
  }
  const painted = traffic.root.children.find(mesh => mesh.instanceColor), paint = new THREE.Color();
  painted.getColorAt(0, paint);
  traffic.hitCar(npc); traffic.hitCar(npc);
  const { car } = traffic.hitCar(npc);
  assert.deepEqual(car.spawn, old);
  assert.deepEqual(car.root.position.toArray(), [old.x, old.y + .04, old.z]);
  assert.deepEqual(car.root.rotation.toArray(), [old.pitch, old.yaw, old.roll, 'YXZ']);
  assert.equal(car.paint, paint.getHex());
  const paintMeshes = car.root.children.filter(mesh => mesh.isMesh && mesh.material.color.getHex() === car.paint);
  assert.ok(paintMeshes.length > 0, 'the full model must use the same paint as the instance');
  assert.equal(car.wheels.length, 4);
  assert.ok(car.wheels.every(wheel => wheel.rotation.x === -5.7));
  car.root.traverse(mesh => { if (mesh.isMesh) assert.equal(mesh.castShadow, false, 'moving cars use contact shadows'); });
  assert.equal(geometryDisposals, 0); assert.equal(materialDisposals, 0);
  traffic.dispose();
  assert.equal(materialDisposals, 0, 'disposing the fleet must not dispose materials used by acquired cars');
});

test('converted and stale cars cannot convert twice and subsequent traffic updates leave acquired cars alone', () => {
  const { traffic, city, scene } = harness(), npc = traffic.cars[0];
  traffic.hitCar(npc); traffic.hitCar(npc);
  const { car } = traffic.hitCar(npc);
  city.cars.push(car); scene.add(car.root);
  car.root.updateMatrix();
  const pose = car.root.matrix.clone();
  const original = { x: car.x, y: car.y, z: car.z, yaw: car.yaw, speed: car.speed };
  assert.deepEqual(traffic.hitCar(npc), { hit: false, hitsRemaining: 0, car: null });
  assert.deepEqual(traffic.hitCar(car), { hit: false, hitsRemaining: 0, car: null });
  for (let i = 0; i < 180; i++) traffic.update(1 / 60, player, null, null);
  car.root.updateMatrix();
  assert.deepEqual({ x: car.x, y: car.y, z: car.z, yaw: car.yaw, speed: car.speed }, original);
  assert.ok(car.root.matrix.equals(pose));
  assert.equal(city.cars.length, 1);
  assert.ok(traffic.cars.every(other => other.id !== npc.id));
  assert.ok(traffic.cars.length <= traffic.snapshot().capacity);
  const stale = traffic.cars[0]; traffic.reset();
  assert.deepEqual(traffic.hitCar(stale), { hit: false, hitsRemaining: 0, car: null });
  traffic.dispose();
  assert.equal(scene.children.includes(car.root), true);
});
