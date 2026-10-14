import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RESIDENT_REST } from '../../src/core/resident-behaviors.js';

export function checkResidentPoses(actor) {
  const angle = (a, b) => a.clone().normalize().angleTo(b.clone().normalize());
  const label = actor.profile.id, bones = [];
  actor.root.traverse(object => { if (object.isBone) bones.push(object); });
  actor.root.position.set(3, 2, -5);
  const position = actor.root.position.clone(), quaternion = actor.root.quaternion.clone();
  actor.setAnimation('Idle');
  const idle = bones.map(bone => bone.quaternion.clone());
  actor.update(0, 0, { kind: 'dance', elapsed: .7 });
  assert.ok(bones.some((bone, i) => angle(bone.quaternion, idle[i]) > .15), `${label}: dance articulates the skeleton`);
  const dance = bones.map(bone => bone.quaternion.clone());
  for (let frame = 0; frame < 10; frame++) actor.update(0, 0, { kind: 'dance', elapsed: .7 });
  bones.forEach((bone, i) => assert.ok(angle(bone.quaternion, dance[i]) < 1e-6, `${label}: ${bone.name} pose does not accumulate`));
  actor.update(0, 0);
  bones.forEach((bone, i) => assert.ok(angle(bone.quaternion, idle[i]) < 1e-6, `${label}: stopping dance restores every affected bone`));
  for (const recline of [.1, .3, .6, .9, 1, 1, 1, .9, .6, .3, 0]) {
    actor.update(1 / 60, 0, { kind: recline === 1 ? 'lie_down' : 'get_up', recline });
    const bounds = new THREE.Box3().setFromObject(actor.root, true), size = bounds.getSize(new THREE.Vector3());
    assert.ok([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite), `${label}: finite rest transition`);
    assert.ok(bounds.min.y >= position.y - .002, `${label}: resting body stays above the floor (${bounds.min.y - position.y})`);
    if (recline === 1) {
      assert.ok(size.y < actor.profile.height * .7, `${label}: visibly lying flat (${size.y})`);
      assert.ok(size.x < RESIDENT_REST.width && size.z < RESIDENT_REST.length, `${label}: fits the reserved floor footprint (${size.x}, ${size.z})`);
      assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).z - position.z) < .05, `${label}: centered on reserved spot`);
    }
  }
  const standing = new THREE.Box3().setFromObject(actor.root, true).getSize(new THREE.Vector3());
  assert.ok(standing.y > actor.profile.height * .9, `${label}: standing height restored`);
  assert.ok(actor.root.position.equals(position) && actor.root.quaternion.equals(quaternion), `${label}: actions preserve navigation transform`);
}
