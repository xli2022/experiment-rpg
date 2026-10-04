import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createVisitor, VISITOR_PROFILES } from '../src/npc-visitors.js';

// Retain the actual geometry, skin and animation data. Browser image decoding is
// unavailable in Node, so remove only image references from the loader fixture.
async function loadVisitor(id) {
  const file = readFileSync(new URL(`../public/models/visitors/${id}.glb`, import.meta.url));
  assert.equal(file.readUInt32LE(0), 0x46546c67, `${id}: binary glTF`);
  assert.equal(file.readUInt32LE(4), 2, `${id}: glTF 2`);
  assert.equal(file.readUInt32LE(8), file.length, `${id}: complete file`);
  const jsonLength = file.readUInt32LE(12);
  const document = JSON.parse(file.subarray(20, 20 + jsonLength));
  for (const buffer of document.buffers ?? []) {
    assert.ok(!buffer.uri || buffer.uri.startsWith('data:'), `${id}: no external buffer`);
  }
  for (const image of document.images ?? []) {
    assert.ok(image.bufferView !== undefined || image.uri?.startsWith('data:'), `${id}: embedded image`);
  }
  const fixture = structuredClone(document);
  delete fixture.images; delete fixture.textures; delete fixture.samplers;
  for (const material of fixture.materials ?? []) {
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
    if (material.pbrMetallicRoughness) {
      delete material.pbrMetallicRoughness.baseColorTexture;
      delete material.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    // These exports use core glTF PBR. Removing material extensions also avoids
    // any optional texture decoder while preserving all mesh/animation data.
    delete material.extensions;
  }
  const json = Buffer.from(JSON.stringify(fixture));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const binary = file.subarray(20 + jsonLength);
  const glb = Buffer.alloc(20 + paddedLength + binary.length, 32);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(paddedLength, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20); binary.copy(glb, 20 + paddedLength);
  const asset = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  return { asset, document };
}

const loaded = new Map(await Promise.all(VISITOR_PROFILES.map(async profile => [profile.id, await loadVisitor(profile.id)])));
const objects = (root, predicate) => {
  const result = []; root.traverse(object => { if (predicate(object)) result.push(object); }); return result;
};
const bones = root => objects(root, object => object.isBone);
const skins = root => objects(root, object => object.isSkinnedMesh);
const transforms = root => objects(root, () => true).map(object => ({
  name: object.name, position: object.position.toArray(), quaternion: object.quaternion.toArray(),
  scale: object.scale.toArray(), visible: object.visible, castShadow: object.castShadow,
  receiveShadow: object.receiveShadow, frustumCulled: object.frustumCulled,
}));
const digest = array => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const resources = root => {
  const meshes = objects(root, object => object.isMesh);
  return {
    geometries: [...new Set(meshes.map(mesh => mesh.geometry))],
    materials: [...new Set(meshes.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]))],
  };
};
const geometryState = geometry => Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, digest(attribute.array)]));

test('all eight visitor exports contain embedded models and real animated skeletons', () => {
  assert.deepEqual(VISITOR_PROFILES.map(profile => profile.id).sort(), ['alien-envoy', 'alien-navigator', 'alien-resident', 'alien-scout', 'robot-courier', 'robot-scout', 'robot-sentinel', 'robot-worker']);
  for (const profile of VISITOR_PROFILES) {
    const { asset, document } = loaded.get(profile.id);
    assert.ok(document.skins?.length > 0, `${profile.id}: exported skin`);
    assert.ok(skins(asset.scene).length > 0, `${profile.id}: loaded skinned mesh`);
    assert.ok(bones(asset.scene).length >= 4, `${profile.id}: articulated rig`);
    for (const clipName of ['Idle', 'Walk']) {
      const clip = asset.animations.find(animation => animation.name === clipName);
      assert.ok(clip?.duration > .1, `${profile.id}: ${clipName} has a duration`);
      const animatedBones = clip.tracks.filter(track => {
        const binding = THREE.PropertyBinding.parseTrackName(track.name);
        return THREE.PropertyBinding.findNode(asset.scene, binding.nodeName)?.isBone;
      });
      assert.ok(animatedBones.length > 0, `${profile.id}: ${clipName} targets actual bones`);
      assert.ok(animatedBones.every(track => [...track.times, ...track.values].every(Number.isFinite)), `${profile.id}: finite animation keys`);
      const actor = createVisitor(asset, profile, clipName);
      const initial = bones(actor.root).map(bone => bone.quaternion.clone());
      actor.mixer.setTime(clip.duration * .37);
      assert.ok(bones(actor.root).some((bone, index) => bone.quaternion.angleTo(initial[index]) > .001), `${profile.id}: ${clipName} moves bones`);
      actor.dispose();
    }
  }
});

test('visitor animation stays finite, in place, and near the ground', () => {
  for (const profile of VISITOR_PROFILES) {
    const { asset } = loaded.get(profile.id);
    for (const clipName of ['Idle', 'Walk']) {
      const actor = createVisitor(asset, profile, clipName);
      const clip = asset.animations.find(animation => animation.name === clipName);
      const rootBones = bones(actor.root).filter(bone => !bone.parent?.isBone);
      // George's Body is the torso root; its independent FootL/FootR roots are
      // animated IK controls, not navigation roots. The other rigs use Bone.
      const motionRoot = rootBones.find(bone => bone.name === 'Bone') ?? rootBones.find(bone => bone.name === 'Body');
      assert.ok(motionRoot, `${profile.id}: known source rig motion anchor`);
      actor.root.updateMatrixWorld(true);
      const origins = rootBones.map(bone => bone.getWorldPosition(new THREE.Vector3()));
      const motionOrigin = motionRoot.getWorldPosition(new THREE.Vector3());
      const originalBody = actor.body.position.clone();
      for (const phase of [0, .13, .37, .61, .89, 1, 4.37, 40.61]) {
        actor.mixer.setTime(clip.duration * phase); actor.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(actor.root, true);
        const size = box.getSize(new THREE.Vector3());
        assert.ok([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite), `${profile.id} ${clipName} at ${phase}: finite bounds`);
        assert.ok(size.y > profile.height * .75 && size.y < profile.height * 1.2, `${profile.id} ${clipName} at ${phase}: height ${size.y}`);
        assert.ok(size.x > .1 && size.x < profile.height * 2 && size.z > .1 && size.z < profile.height * 2, `${profile.id} ${clipName} at ${phase}: compact silhouette`);
        const clearance = box.min.y;
        assert.ok(clearance > -.1 && clearance < .22, `${profile.id} ${clipName} at ${phase}: clearance ${clearance}`);
        assert.ok(actor.root.position.length() < 1e-8 && actor.body.position.equals(originalBody), `${profile.id}: animations preserve world placement`);
        const position = motionRoot.getWorldPosition(new THREE.Vector3());
        const horizontalDrift = Math.hypot(position.x - motionOrigin.x, position.z - motionOrigin.z);
        assert.ok(horizontalDrift < .08, `${profile.id} ${clipName} at ${phase}: horizontal body drift ${horizontalDrift}`);
      }
      // Compare like phases to detect accumulated offsets without mistaking
      // authored foot steps or torso sway for world movement.
      actor.mixer.setTime(clip.duration * .37); actor.root.updateMatrixWorld(true);
      const phasePositions = bones(actor.root).map(bone => bone.getWorldPosition(new THREE.Vector3()));
      actor.mixer.setTime(clip.duration * 40.37); actor.root.updateMatrixWorld(true);
      bones(actor.root).forEach((bone, index) => {
        assert.ok(bone.getWorldPosition(new THREE.Vector3()).distanceTo(phasePositions[index]) < 1e-5, `${profile.id} ${clipName}: no cumulative bone drift`);
      });
      // Evaluate the actual last key without looping back to time zero. A
      // translating root-motion clip would otherwise appear to close its loop.
      actor.action.reset().setLoop(THREE.LoopOnce, 1); actor.action.clampWhenFinished = true;
      actor.mixer.setTime(clip.duration); actor.root.updateMatrixWorld(true);
      rootBones.forEach((bone, index) => {
        const end = bone.getWorldPosition(new THREE.Vector3());
        const displacement = Math.hypot(end.x - origins[index].x, end.z - origins[index].z);
        assert.ok(displacement < 1e-5, `${profile.id} ${clipName}: ${bone.name} returns horizontally at clip end (${displacement})`);
      });
      actor.dispose();
    }
  }
});

test('cloned visitors animate and dispose independently without changing source assets', () => {
  for (const profile of VISITOR_PROFILES) {
    const { asset } = loaded.get(profile.id);
    const sourceTransforms = transforms(asset.scene), sourceResources = resources(asset.scene);
    const sourceGeometry = sourceResources.geometries.map(geometryState);
    const sourceMaterials = sourceResources.materials.map(material => material.toJSON());
    const disposals = [];
    for (const resource of [...sourceResources.geometries, ...sourceResources.materials]) resource.addEventListener('dispose', () => disposals.push(resource));
    const first = createVisitor(asset, profile, 'Idle'), second = createVisitor(asset, profile, 'Walk');
    const firstBones = bones(first.root), secondBones = bones(second.root), originalBones = new Set(bones(asset.scene));
    assert.equal(firstBones.length, secondBones.length);
    for (let index = 0; index < firstBones.length; index++) {
      assert.notEqual(firstBones[index], secondBones[index], `${profile.id}: independent bones`);
      assert.ok(!originalBones.has(firstBones[index]), `${profile.id}: no source bones reused`);
    }
    assert.notEqual(skins(first.root)[0].skeleton, skins(second.root)[0].skeleton);
    const pausedFirst = transforms(first.root);
    second.mixer.update(.37);
    assert.deepEqual(transforms(first.root), pausedFirst, `${profile.id}: second animation cannot alter first`);
    first.dispose();
    const secondBefore = bones(second.root).map(bone => bone.quaternion.clone());
    second.mixer.update(.31); second.root.updateMatrixWorld(true);
    assert.ok(bones(second.root).some((bone, index) => bone.quaternion.angleTo(secondBefore[index]) > .001), `${profile.id}: surviving clone still animates`);
    second.dispose();
    assert.deepEqual(transforms(asset.scene), sourceTransforms, `${profile.id}: source transforms preserved`);
    assert.deepEqual(sourceResources.geometries.map(geometryState), sourceGeometry, `${profile.id}: source geometry preserved`);
    assert.deepEqual(sourceResources.materials.map(material => material.toJSON()), sourceMaterials, `${profile.id}: source materials preserved`);
    assert.equal(disposals.length, 0, `${profile.id}: shared GPU resources remain usable`);
  }
});

test('every visitor primitive has usable UVs and embedded color, roughness and normal atlases', () => {
  for (const profile of VISITOR_PROFILES) {
    const { asset, document } = loaded.get(profile.id);
    assert.equal(document.images.length, 3, `${profile.id}: three shared PBR atlases`);
    for (const image of document.images) {
      assert.equal(image.mimeType, 'image/png', `${profile.id}: lossless packed atlas`);
      assert.ok(document.bufferViews[image.bufferView].byteLength > 1000, `${profile.id}: actual surface detail`);
    }
    for (const material of document.materials) {
      assert.ok(material.pbrMetallicRoughness?.baseColorTexture, `${profile.id}/${material.name}: base color map`);
      assert.ok(material.pbrMetallicRoughness?.metallicRoughnessTexture, `${profile.id}/${material.name}: roughness map`);
      assert.ok(material.normalTexture, `${profile.id}/${material.name}: tangent normal map`);
      if (material.name === 'Glass') {
        assert.equal(material.alphaMode, 'BLEND');
        assert.ok(material.pbrMetallicRoughness.baseColorFactor[3] < .2, `${profile.id}: see-through helmet`);
      }
    }
    for (const mesh of objects(asset.scene, object => object.isMesh)) {
      const uv = mesh.geometry.getAttribute('uv');
      assert.ok(uv?.count > 0, `${profile.id}: UV-mapped mesh`);
      assert.ok([...uv.array].every(value => Number.isFinite(value) && value >= 0 && value <= 1), `${profile.id}: valid atlas UVs`);
      const u = new Set(), v = new Set();
      for (let index = 0; index < uv.count; index++) { u.add(uv.getX(index)); v.add(uv.getY(index)); }
      assert.ok(u.size >= 2 && v.size >= 2, `${profile.id}/${mesh.name}/${mesh.material.name}: nondegenerate texture coordinates (${u.size},${v.size}, ${uv.count} vertices)`);
      const weights = mesh.geometry.getAttribute('skinWeight');
      for (let index = 0; index < weights.count; index++) {
        const total = weights.getX(index) + weights.getY(index) + weights.getZ(index) + weights.getW(index);
        assert.ok(Math.abs(total - 1) < 1e-5, `${profile.id}: normalized skin weights`);
      }
    }
  }
});

test('visitor archetypes have different geometry and exporter-verified rig metadata', () => {
  for (const [original, variant] of [['robot-scout','robot-courier'], ['robot-worker','robot-sentinel'], ['alien-resident','alien-envoy'], ['alien-scout','alien-navigator']]) {
    const geometry = id => skins(loaded.get(id).asset.scene).map(mesh => digest(mesh.geometry.attributes.position.array));
    assert.notDeepEqual(geometry(original), geometry(variant), `${variant}: an actual geometric variant`);
  }
  for (const profile of VISITOR_PROFILES) {
    const metadata = JSON.parse(readFileSync(new URL(`../public/models/visitors/${profile.id}.json`, import.meta.url)));
    assert.equal(metadata.recommendedHeight, profile.height);
    assert.equal(metadata.estimatedWalkSpeed, profile.walkSpeed, `${profile.id}: gait calibration matches exported height`);
    assert.ok(metadata.triangles > 3000 && metadata.triangles < 35000, `${profile.id}: detailed crowd mesh budget`);
    assert.ok(metadata.maxBakedPoseBoundsError < .002);
    assert.ok(metadata.maxExportedPoseBoundsError < metadata.sourceHeight * .005);
    assert.ok(Object.values(metadata.rootTranslationDrift).every(drift => drift < .001));
  }
});

test('visitor gait responds to speed and blends to a stable idle', () => {
  for (const profile of VISITOR_PROFILES) {
    const actor = createVisitor(loaded.get(profile.id).asset, profile, 'Idle');
    for (let frame = 0; frame < 30; frame++) actor.update(1 / 60, profile.walkSpeed * .6);
    assert.equal(actor.animation, 'Walk');
    assert.ok(Math.abs(actor.actions.Walk.getEffectiveTimeScale() - .6) < 1e-6, `${profile.id}: distance-matched gait`);
    assert.ok(actor.actions.Walk.getEffectiveWeight() > .99, `${profile.id}: smooth transition completes`);
    for (let frame = 0; frame < 30; frame++) actor.update(1 / 60, 0);
    assert.equal(actor.animation, 'Idle');
    assert.ok(actor.actions.Idle.getEffectiveWeight() > .99, `${profile.id}: settled idle`);
    assert.equal(actor.actions.Walk.getEffectiveTimeScale(), 0, `${profile.id}: stopped feet`);
    actor.setAnimation('Walk');
    assert.equal(actor.action.getEffectiveWeight(), 1, `${profile.id}: preview exact clip`);
    actor.dispose();
  }
});

test('visitor contact correction prevents sole penetration throughout gait and blends', () => {
  for (const profile of VISITOR_PROFILES) {
    const actor = createVisitor(loaded.get(profile.id).asset, profile, 'Walk');
    actor.root.position.set(3, 1.2, -4); actor.root.rotation.y = .7;
    const clip = actor.action.getClip(), originalPosition = actor.root.position.clone();
    for (let index = 0; index <= 80; index++) {
      actor.mixer.setTime(clip.duration * index / 81); actor.ground();
      const bounds = new THREE.Box3().setFromObject(actor.root, true);
      assert.ok(bounds.min.y >= actor.root.position.y + .0028, `${profile.id}: soles clear the ground at phase ${index / 81} (${bounds.min.y - actor.root.position.y})`);
      assert.ok(bounds.min.y < actor.root.position.y + .15, `${profile.id}: preserve compact native foot lift`);
    }
    for (let index = 0; index < 80; index++) {
      actor.update(1 / 60, index < 40 ? 0 : profile.walkSpeed);
      const bounds = new THREE.Box3().setFromObject(actor.root, true);
      assert.ok(bounds.min.y >= actor.root.position.y + .0028, `${profile.id}: blended soles stay above ground`);
    }
    assert.ok(actor.root.position.equals(originalPosition), `${profile.id}: grounding preserves navigation placement`);
    actor.dispose();
  }
});

test('clear alien helmets do not cast opaque shadows over their faces', () => {
  for (const profile of VISITOR_PROFILES.filter(profile => ['alien-resident','alien-envoy'].includes(profile.id))) {
    const actor = createVisitor(loaded.get(profile.id).asset, profile);
    const helmet = objects(actor.root, object => object.isMesh && object.material.name === 'Glass');
    assert.equal(helmet.length, 1);
    assert.equal(helmet[0].castShadow, false);
    assert.equal(helmet[0].material.transparent, true);
    assert.ok(helmet[0].material.opacity < .2);
    actor.dispose();
  }
});
