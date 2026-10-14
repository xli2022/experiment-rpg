import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RESIDENT_SIT } from '../../src/core/resident-behaviors.js';

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
  for (const sitProgress of [.1, .3, .6, .9, 1, 1, 1, .9, .6, .3, 0]) {
    actor.update(1 / 60, 0, { kind: sitProgress === 1 ? 'sit_down' : 'get_up', sitProgress });
    const bounds = new THREE.Box3().setFromObject(actor.root, true), size = bounds.getSize(new THREE.Vector3());
    assert.ok([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite), `${label}: finite rest transition`);
    assert.ok(bounds.min.y >= position.y - .002, `${label}: resting body stays above the floor (${bounds.min.y - position.y})`);
    if (sitProgress === 1) {
      assert.ok(size.y < actor.profile.height - .15 && size.y < RESIDENT_SIT.height, `${label}: visibly seated within the collision height (${size.y})`);
      assert.ok(size.x < RESIDENT_SIT.width && size.z < RESIDENT_SIT.length, `${label}: fits the reserved floor footprint (${size.x}, ${size.z})`);
      assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).z - position.z) < .05, `${label}: centered on reserved spot`);
    }
  }
  const standing = new THREE.Box3().setFromObject(actor.root, true).getSize(new THREE.Vector3());
  assert.ok(standing.y > actor.profile.height * .9, `${label}: standing height restored`);
  const find = (...names) => bones.find(bone => names.includes(bone.name));
  const thigh = find('ThighL', 'UpperLegL', 'UpperLeg.L'), knee = find('MidLegL', 'MidLeg.L', 'ShinL', 'LowerLegL', 'LowerLeg.L');
  const shin = find('ShinL', 'LowerLegL', 'LowerLeg.L'), foot = find('FootL', 'Foot.L');
  const ankle = shin.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
  const restored = bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
  actor.update(0, 0, { kind: 'sit_down', sitProgress: 1 });
  const direction = knee.getWorldPosition(new THREE.Vector3()).sub(thigh.getWorldPosition(new THREE.Vector3())).normalize();
  assert.ok(direction.y > .2, `${label}: bends the knees up while seated`);
  const posedAnkle = shin.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
  assert.ok(ankle.distanceTo(posedAnkle) < .001, `${label}: the foot stays attached to its shin`);
  const seated = bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
  for (let frame = 0; frame < 10; frame++) actor.update(0, 0, { kind: 'sit_down', sitProgress: 1 });
  bones.forEach((bone, i) => {
    assert.ok(bone.position.distanceTo(seated[i].position) < 1e-6 && angle(bone.quaternion, seated[i].quaternion) < 1e-6, `${label}: seated ${bone.name} does not drift`);
  });
  actor.update(0, 0);
  bones.forEach((bone, i) => {
    assert.ok(bone.position.distanceTo(restored[i].position) < 1e-6 && angle(bone.quaternion, restored[i].quaternion) < 1e-6, `${label}: standing restores ${bone.name}`);
  });
  assert.ok(actor.root.position.equals(position) && actor.root.quaternion.equals(quaternion), `${label}: actions preserve navigation transform`);
}
