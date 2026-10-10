import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTraffic, TAKEOVER_HITS } from '../src/traffic/index.js';
import { gridPlan, crowdAsset } from './helpers/street-grid.js';

const player = { x: 25, y: 0, z: 25 };
function harness() {
  const scene = new THREE.Scene(), traffic = createTraffic({ scene, world: { masterPlan: gridPlan(), spatial: null }, assets: { citizen: crowdAsset() } });
  traffic.update(0, { player });
  assert.ok(traffic.cars.length > 0);
  return { scene, traffic };
}
const fleet = traffic => traffic.root.children.find(group => group.name === 'NPC traffic');

test('traffic needs three separate hits before a moving car becomes drivable', () => {
  const { traffic, scene } = harness(), npc = traffic.cars[0], count = traffic.cars.length;
  for (let hit = 1; hit < TAKEOVER_HITS; hit++) {
    assert.deepEqual(traffic.hit(npc), { hit: true, hitsRemaining: TAKEOVER_HITS - hit, car: null });
    // It brakes hard, then drives on along its route (allowing for a red light).
    let travelled = 0, last = { x: npc.x, z: npc.z };
    for (let i = 0; i < 40 * 30; i++) {
      traffic.update(1 / 30, { player });
      if (i > 2.5 * 30) travelled += Math.hypot(npc.x - last.x, npc.z - last.z);
      last = { x: npc.x, z: npc.z };
    }
    assert.ok(traffic.cars.includes(npc), 'a damaged car stays in traffic');
    assert.ok(travelled > 10, `a damaged car carries on (${travelled.toFixed(1)} m)`);
    assert.equal(traffic.owned.length, 0);
    assert.equal(traffic.snapshot().cars.find(car => car.id === npc.id).damageHits, hit);
  }
  const result = traffic.hit(npc);
  assert.equal(result.hit, true); assert.equal(result.hitsRemaining, 0);
  assert.ok(result.car?.root.isGroup && result.car.speed === 0);
  assert.equal(traffic.cars.includes(npc), false);
  assert.equal(traffic.cars.length, count - 1);
  assert.deepEqual(traffic.owned, [result.car], 'the traffic module owns acquired cars');
  assert.ok(scene.children.includes(result.car.root));
  const meshes = fleet(traffic).children.filter(mesh => mesh.isInstancedMesh && mesh.geometry.type !== 'PlaneGeometry');
  assert.ok(meshes.every(mesh => mesh.count === count - 1), 'the instance disappears in the same operation');
  traffic.dispose();
});

test('a stopped car can be taken over in place, keeping its paint, body and pose', () => {
  const { traffic } = harness(), npc = traffic.cars.find(car => car.body.id !== 'sedan') ?? traffic.cars[0];
  npc.speed = 0;
  assert.equal(traffic.hijackable({ x: npc.x + 1.8, y: npc.y, z: npc.z }), npc, 'within reach of the door');
  assert.equal(traffic.hijackable({ x: npc.x + 6, y: npc.y, z: npc.z }), null);
  assert.equal(traffic.hijackable({ x: npc.x, y: npc.y + 6, z: npc.z }), null, 'not from a floor above');
  npc.speed = 8;
  assert.equal(traffic.hijackable({ x: npc.x + 1.8, y: npc.y, z: npc.z }), null, 'moving traffic cannot be boarded');
  npc.speed = 0; npc.spin = -5.7;
  const pose = { x: npc.x, y: npc.y, z: npc.z, yaw: npc.yaw, pitch: npc.pitch, roll: npc.roll };
  const painted = fleet(traffic).children.find(mesh => mesh.instanceColor), instancePaint = new THREE.Color();
  painted.getColorAt(traffic.cars.indexOf(npc), instancePaint);
  const materials = new Set(); fleet(traffic).traverse(o => { if (o.isMesh && o.geometry.type !== 'PlaneGeometry') materials.add(o.material); });
  let disposed = 0; for (const material of materials) material.addEventListener('dispose', () => disposed++);
  const car = traffic.takeOver(npc);
  assert.deepEqual(car.spawn, pose);
  assert.deepEqual(car.root.position.toArray(), [pose.x, pose.y + .04, pose.z]);
  assert.deepEqual(car.root.rotation.toArray(), [pose.pitch, pose.yaw, pose.roll, 'YXZ']);
  assert.equal(car.body, npc.body.id);
  assert.equal(car.paint, instancePaint.getHex(), 'same paint as its instance in the fleet');
  assert.ok(car.root.children.some(mesh => mesh.isMesh && mesh.material.color.getHex() === car.paint), 'the model is painted that colour');
  assert.ok(car.wheels.length === 4 && car.wheels.every(wheel => wheel.rotation.x === -5.7));
  if (npc.body.id !== 'sedan') assert.ok(car.root.children.some(mesh => mesh.isMesh && mesh.scale.z !== 1), 'body proportions carry over');
  car.root.traverse(mesh => { if (mesh.isMesh) assert.equal(mesh.castShadow, false, 'moving cars use contact shadows'); });
  assert.equal(traffic.takeOver(npc), null, 'a car cannot be taken twice');
  assert.deepEqual(traffic.hit(npc), { hit: false, hitsRemaining: 0, car: null });
  assert.deepEqual(traffic.hit(car), { hit: false, hitsRemaining: 0, car: null });
  traffic.dispose();
  assert.equal(disposed, 0, 'shared car materials stay alive for acquired cars');
});

test('acquired cars stay put, count toward the street budget, and survive a reset', () => {
  const { traffic } = harness(), budget = traffic.snapshot().target;
  const car = traffic.takeOver(traffic.cars[0]);
  const original = { x: car.x, y: car.y, z: car.z, yaw: car.yaw, speed: car.speed };
  for (let i = 0; i < 90; i++) traffic.update(1 / 30, { player });
  assert.deepEqual({ x: car.x, y: car.y, z: car.z, yaw: car.yaw, speed: car.speed }, original);
  assert.equal(traffic.snapshot().target, budget - 1);
  assert.ok(traffic.cars.length <= traffic.snapshot().capacity);
  const stale = traffic.cars[0];
  traffic.reset();
  assert.equal(traffic.cars.length, 0);
  assert.deepEqual(traffic.hit(stale), { hit: false, hitsRemaining: 0, car: null });
  assert.deepEqual(traffic.owned, [car]);
  traffic.update(0, { player });
  assert.ok(traffic.cars.length > 0, 'a cut repopulates the streets at once');
  traffic.dispose();
});
