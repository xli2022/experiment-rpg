import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNPCAnimation } from '../src/npc-animation.js';

function controller(initial = 'Walk') {
  const model = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'Hips'; model.add(bone);
  const clip = (name, angle, duration) => new THREE.AnimationClip(name, duration, [new THREE.QuaternionKeyframeTrack('Hips.quaternion',
    [0, duration / 2, duration], [0, 0, 0, 1, ...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle).toArray(), 0, 0, 0, 1])]);
  const clips = [clip('Idle', .05, 3), clip('Walk', .5, 1.3), clip('WalkFormal', .35, 1.5)];
  const mixer = new THREE.AnimationMixer(model);
  return { animation: createNPCAnimation(mixer, clips, { initial, walkSpeed: 1.4 }), mixer, bone };
}

test('pedestrian clips follow actual travel speed and blend to a living idle when stopped', () => {
  const { animation, bone } = controller();
  for (let frame = 0; frame < 60; frame++) animation.update(1 / 60, .7);
  assert.ok(Math.abs(animation.actions.Walk.time - .5) < 1e-6, 'half the stride speed advances half a cycle-second');
  for (let frame = 0; frame < 60; frame++) animation.update(1 / 60, 0);
  assert.equal(animation.animation, 'Idle');
  assert.ok(animation.actions.Idle.getEffectiveWeight() > .999);
  assert.ok(animation.actions.Walk.getEffectiveWeight() < .001);
  assert.equal(animation.actions.Walk.getEffectiveTimeScale(), 0, 'stopped pedestrians do not walk in place');
  const pose = bone.quaternion.clone(); animation.update(.35, 0);
  assert.ok(bone.quaternion.angleTo(pose) > .001, 'stopping keeps the breathing idle alive');
  const walkingTime = animation.actions.Walk.time;
  animation.update(.2, -2.8);
  assert.ok(Math.abs(animation.actions.Walk.time - (walkingTime + .4) % 1.3) < 1e-6, 'reverse navigation uses forward-facing gait at the correct speed');
  assert.equal(animation.animation, 'Walk');
});

test('idle and walking blends remain normalized and consistent across frame rates', () => {
  const results = [];
  for (const fps of [30, 60, 120]) {
    const { animation } = controller('Idle');
    for (const speed of [0, 1.4, 2.1, .7, 0]) for (let frame = 0; frame < fps; frame++) {
      animation.update(1 / fps, speed);
      const weight = Object.values(animation.actions).reduce((sum, action) => sum + action.getEffectiveWeight(), 0);
      assert.ok(Math.abs(weight - 1) < 1e-9, 'no bind-pose contribution during starts and stops');
    }
    results.push({ time: animation.actions.Walk.time, weight: animation.actions.Walk.getEffectiveWeight() });
  }
  for (const result of results) {
    assert.ok(Math.abs(result.time - results[0].time) < 1e-6);
    assert.ok(Math.abs(result.weight - results[0].weight) < 1e-6);
  }
});

test('preview clip selection resets only its own clips and leaves independent pose layers active', () => {
  const { animation, mixer } = controller();
  const presence = mixer.clipAction(new THREE.AnimationClip('Presence', 1, [], THREE.AdditiveAnimationBlendMode)).play();
  animation.setAnimation('WalkFormal');
  assert.equal(animation.action.getClip().name, 'WalkFormal');
  assert.equal(animation.action.time, 0);
  assert.equal(animation.action.getEffectiveWeight(), 1);
  animation.update(.1, 1.4);
  assert.equal(presence.getEffectiveWeight(), 1);
  assert.equal(animation.actions.WalkFormal.getEffectiveWeight(), 0);
  assert.throws(() => animation.setAnimation('Missing'), /Unknown NPC animation/);
});
