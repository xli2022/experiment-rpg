import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createCharacter, animateCharacter, characterShot } from '../src/characters.js';
import { beginJump, stepJump, JUMP } from '../src/jump.js';

function loadGLB(name) {
  const file = readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
  assert.equal(file.readUInt32LE(0), 0x46546c67);
  assert.equal(file.readUInt32LE(4), 2);
  assert.equal(file.readUInt32LE(8), file.length);
  const length = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + length).toString());
  const binary = file.subarray(28 + length);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const formats = { 5121: [1, 'readUInt8'], 5123: [2, 'readUInt16LE'], 5125: [4, 'readUInt32LE'], 5126: [4, 'readFloatLE'] };
  function accessor(index) {
    const a = json.accessors[index], width = components[a.type], [size, read] = formats[a.componentType];
    const values = new Float64Array(a.count * width);
    if (a.bufferView !== undefined) {
      const view = json.bufferViews[a.bufferView], start = (view.byteOffset || 0) + (a.byteOffset || 0);
      const stride = view.byteStride || size * width;
      for (let row = 0; row < a.count; row++) for (let col = 0; col < width; col++) values[row * width + col] = binary[read](start + row * stride + col * size);
    }
    if (a.sparse) {
      const { count, indices, values: data } = a.sparse;
      const [indexSize, indexRead] = formats[indices.componentType];
      const indexStart = (json.bufferViews[indices.bufferView].byteOffset || 0) + (indices.byteOffset || 0);
      const dataStart = (json.bufferViews[data.bufferView].byteOffset || 0) + (data.byteOffset || 0);
      for (let i = 0; i < count; i++) {
        const row = binary[indexRead](indexStart + i * indexSize);
        for (let col = 0; col < width; col++) values[row * width + col] = binary[read](dataStart + (i * width + col) * size);
      }
    }
    return values;
  }
  return { json, file, accessor, primitives: json.meshes.flatMap(mesh => mesh.primitives) };
}

const player = loadGLB('vex'), citizen = loadGLB('citizen');

test('character assets are self-contained and retain full detail', () => {
  for (const asset of [player, citizen]) {
    assert.ok(asset.json.images.length >= 3, 'skin, fabric and hair textures must be bundled');
    assert.ok(asset.json.images.every(image => image.bufferView !== undefined));
    assert.ok(asset.json.buffers.every(buffer => !buffer.uri));
    for (const primitive of asset.primitives) {
      assert.ok(asset.accessor(primitive.attributes.POSITION).every(Number.isFinite));
      assert.ok(asset.accessor(primitive.attributes.NORMAL).every(Number.isFinite));
    }
    const hair = asset.json.materials.find(material => material.name === 'Hair');
    assert.equal(hair.alphaMode, 'MASK', 'hair cutouts must not depend on transparency sorting');
  }
  const triangles = asset => asset.primitives.reduce((sum, p) => sum + asset.json.accessors[p.indices].count / 3, 0);
  assert.ok(triangles(player) > 20000);
  assert.equal(triangles(citizen), triangles(player), 'crowd keeps the full character mesh');
});

test('player skin has valid normalized weights and articulated hands', () => {
  const skin = player.json.skins[0];
  const names = skin.joints.map(index => player.json.nodes[index].name);
  for (const name of ['Hips', 'Chest', 'Head', 'HandL', 'HandR', 'FootL', 'FootR', 'Finger11R', 'Finger53L']) assert.ok(names.includes(name), `missing ${name}`);
  for (const p of player.primitives) {
    const joints = player.accessor(p.attributes.JOINTS_0), weights = player.accessor(p.attributes.WEIGHTS_0);
    assert.ok(joints.every(value => value >= 0 && value < skin.joints.length));
    for (let i = 0; i < weights.length; i += 4) {
      const sum = weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3];
      assert.ok(Math.abs(sum - 1) < .001, `invalid skin weights at ${i / 4}`);
    }
  }
});

test('locomotion and weapon poses have finite, ordered animation tracks', () => {
  for (const name of ['Idle', 'Walk', 'WalkFormal', 'Jog', 'Run', 'JumpStart', 'JumpLoop', 'JumpLand', 'ArmedIdle', 'Aim', 'AimUp', 'AimDown', 'Reload', 'Fire', 'Hit', 'Driving']) {
    const clip = player.json.animations.find(animation => animation.name === name);
    assert.ok(clip?.channels.length > 10, `missing animation ${name}`);
    for (const sampler of clip.samplers) {
      const times = player.accessor(sampler.input), values = player.accessor(sampler.output);
      assert.ok(values.every(Number.isFinite));
      assert.ok(times.every((time, i) => Number.isFinite(time) && (!i || time > times[i - 1])));
    }
  }
});

test('authored gait, jump and reload clips contain real motion, with continuous loops', () => {
  for (const asset of [player, citizen]) {
    assert.ok(asset.json.skins?.length, 'both the player and crowd use complete skeletal animation');
    for (const name of ['Walk', 'Jog', 'Run', 'JumpStart', 'JumpLand', 'Reload']) {
      const clip = asset.json.animations.find(animation => animation.name === name);
      let changingTracks = 0;
      for (const channel of clip.channels.filter(c => c.target.path === 'rotation')) {
        const sampler = clip.samplers[channel.sampler], values = asset.accessor(sampler.output);
        if (values.some((value, i) => Math.abs(value - values[i % 4]) > .015)) changingTracks++;
      }
      assert.ok(changingTracks > 12, `${name} is a moving performance, not a static pose`);
    }
    for (const name of ['Idle', 'Walk', 'Jog', 'Run', 'ArmedIdle']) {
      const clip = asset.json.animations.find(animation => animation.name === name);
      for (const channel of clip.channels.filter(c => c.target.path === 'rotation')) {
        const values = asset.accessor(clip.samplers[channel.sampler].output);
        let dot = 0;
        for (let i = 0; i < 4; i++) dot += values[i] * values[values.length - 4 + i];
        assert.ok(Math.abs(dot) > .999, `${name} must loop without a pose pop`);
      }
    }
    assert.ok(asset.primitives.every(p => !p.targets), 'crowd no longer uses eight baked morph poses');
  }
});

// Load just the actual exported skeleton and animation data in Node. Rendering
// is covered in browser checks; no fabricated animation curves are used here.
function actorAsset() {
  const joints = new Set(player.json.skins[0].joints);
  const nodes = player.json.nodes.map((node, i) => {
    const object = joints.has(i) ? new THREE.Bone() : new THREE.Group();
    object.name = node.name;
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  player.json.nodes.forEach((node, i) => node.children?.forEach(child => nodes[i].add(nodes[child])));
  const scene = new THREE.Group(); player.json.scenes[0].nodes.forEach(index => scene.add(nodes[index]));
  const animations = player.json.animations.map(clip => new THREE.AnimationClip(clip.name, -1, clip.channels.map(channel => {
    const sampler = clip.samplers[channel.sampler];
    const property = { rotation: 'quaternion', translation: 'position', scale: 'scale' }[channel.target.path];
    const Track = property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    return new Track(`${nodes[channel.target.node].name}.${property}`, player.accessor(sampler.input), player.accessor(sampler.output));
  })));
  return { scene, animations };
}

test('animation transitions keep both body layers normalized and the gun attached', () => {
  const model = createCharacter(actorAsset());
  const step = options => {
    animateCharacter(model, options.aiming, 1 / 60, options);
    for (const layer of [model.lower, model.upper]) {
      const sum = Object.values(layer).reduce((n, action) => n + action.getEffectiveWeight(), 0);
      assert.ok(Math.abs(sum - 1) < .00001, `body layer has weight ${sum}; blending must not expose the bind pose`);
    }
    for (const bone of model.bones.values()) assert.ok(bone.quaternion.toArray().every(Number.isFinite));
    const gun = model.muzzle.getWorldPosition(new THREE.Vector3());
    const hand = model.bones.get('HandR').getWorldPosition(new THREE.Vector3());
    assert.ok(gun.distanceTo(hand) < .5, 'weapon follows the animated hand through every transition');
  };
  for (let i = 0; i < 90; i++) step({ speed: 1.65 });
  assert.equal(model.animation, 'Walk');
  for (let i = 0; i < 90; i++) step({ speed: 6.6 });
  assert.equal(model.animation, 'Run');
  for (let i = 0; i < 30; i++) step({ speed: 1.4, aiming: true, pitch: -.3 });
  characterShot(model);
  for (let i = 0; i < 20; i++) step({ speed: 0, aiming: true });
  for (let i = 0; i < 100; i++) step({ speed: 0, reloading: 1.667 - i / 60 });
  assert.equal(model.animation, 'Reload');
  for (let i = 0; i < 180; i++) step({ speed: 0 });
  assert.equal(model.animation, 'Idle');
  for (const jumpPhase of ['start', 'air', 'land']) for (let i = 0; i < 20; i++) step({ speed: 0, jumpPhase, jumpTime: i / 60 });
});

test('jump clips keep their outgoing pose through takeoff, contact and recovery', () => {
  const model = createCharacter(actorAsset());
  const player = { y: 0, velocityY: 0, jumpPhase: '', jumpTime: 0 };
  for (let i = 0; i < 60; i++) animateCharacter(model, false, 1 / 60);
  beginJump(player);
  const history = [], previousHead = new THREE.Vector3();
  model.bones.get('Head').getWorldPosition(previousHead);
  let largestStep = 0, largestFrame = '';
  for (let i = 0; i < 130; i++) {
    const oldPhase = player.jumpPhase;
    const oldTimes = { ...model.jumpTimes };
    stepJump(player, 1 / 60);
    model.root.position.y = player.y;
    animateCharacter(model, false, 1 / 60, { jumpPhase: player.jumpPhase, jumpTime: player.jumpTime, height: player.y, verticalSpeed: player.velocityY });
    const head = model.bones.get('Head').getWorldPosition(new THREE.Vector3());
    const distance = head.distanceTo(previousHead);
    if (distance > largestStep) { largestStep = distance; largestFrame = `${i}: ${player.jumpPhase} / ${player.jumpTime.toFixed(3)}s`; }
    previousHead.copy(head);
    if (oldPhase !== player.jumpPhase) {
      history.push([oldPhase, player.jumpPhase]);
      const outgoing = { start: 'JumpStart', air: 'JumpLoop', land: 'JumpLand' }[oldPhase];
      assert.equal(model.jumpTimes[outgoing], oldTimes[outgoing], `${outgoing} must not rewind while fading out`);
    }
  }
  assert.deepEqual(history, [['start', 'air'], ['air', 'land'], ['land', '']]);
  assert.ok(largestStep < .12, `jump has a visible head snap: ${largestStep.toFixed(3)}m at frame ${largestFrame}`);
  assert.equal(player.y, 0);
});

test('jump arc and landing timing remain consistent across frame rates', () => {
  for (const fps of [30, 60, 120]) {
    const player = { y: 0, velocityY: 0, jumpPhase: '' };
    assert.ok(beginJump(player));
    assert.equal(beginJump(player), false, 'jump cannot restart in midair');
    let elapsed = 0, peak = 0, landedAt;
    while (player.jumpPhase && elapsed < 3) {
      stepJump(player, 1 / fps); elapsed += 1 / fps; peak = Math.max(peak, player.y);
      if (player.jumpPhase === 'land' && landedAt === undefined) landedAt = elapsed;
      assert.ok(player.y >= 0);
    }
    assert.ok(Math.abs(peak - JUMP.velocity ** 2 / (2 * JUMP.gravity)) < .004);
    assert.ok(Math.abs(landedAt - (JUMP.takeoff + 2 * JUMP.velocity / JUMP.gravity)) <= 1 / fps + .001);
    assert.ok(Math.abs(elapsed - (JUMP.takeoff + 2 * JUMP.velocity / JUMP.gravity + JUMP.landing)) <= 1 / fps + .001);
    assert.equal(player.y, 0); assert.equal(player.velocityY, 0);
    assert.ok(beginJump(player), 'another jump is available after recovery');
  }
});

test('climbing animates alternating hands and boots on the actual rig, hides the gun and blends back to running', () => {
  const model = createCharacter(actorAsset()), positions = [];
  for (let i = 0; i < 120; i++) {
    animateCharacter(model, false, 1 / 60, { climb: { mode: 'climb', phase: i / 60, speed: 3.4, roofY: 30 } });
    const hands = ['HandL', 'HandR'].map(name => model.bones.get(name).getWorldPosition(new THREE.Vector3()));
    if (i > 60) positions.push(hands.map(p => p.y));
    for (const bone of model.bones.values()) assert.ok(bone.quaternion.toArray().every(Number.isFinite));
    if (i > 30) {
      assert.equal(model.gun.visible, false);
      for (const hand of hands) assert.ok(hand.z < -.2, 'Hands reach toward the wall');
    }
  }
  assert.ok(positions.some(([left, right]) => left > right + .1));
  assert.ok(positions.some(([left, right]) => right > left + .1));
  assert.equal(model.animation, 'Climb');
  animateCharacter(model, false, 1 / 60, { climb: { mode: 'climb', phase: 1, speed: 0, roofY: 30 } });
  assert.equal(model.animation, 'ClimbHang');
  for (let i = 0; i < 45; i++) animateCharacter(model, false, 1 / 60, { climb: { mode: 'mantle', phase: 1, speed: 0, roofY: 1.15, progress: i / 44 } });
  assert.equal(model.animation, 'Mantle');
  for (let i = 0; i < 120; i++) animateCharacter(model, false, 1 / 60, { speed: 10.8 });
  assert.equal(model.animation, 'Run'); assert.equal(model.gun.visible, true);
});
