import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadCharacterAssets } from '../src/engine/player/characters.js';
import { createNPC } from '../src/actors/npc-appearance.js';
import { CROWD_PROFILES, HUMAN_BASE_MODELS, NPC_PROFILES } from '../src/actors/npc-profiles.js';
import { VISITOR_PROFILES } from '../src/actors/npc-visitors.js';
import { createAvatarPool, rosterBases } from '../src/traffic/pedestrians.js';
import { createWorldLife } from '../src/modes/story/world-life.js';
import { Campaign } from '../src/modes/story/campaign.js';

// Parse production geometry, rig and animation bytes through GLTFLoader. Image
// pixels need a browser decoder; marker textures let the loader test verify
// that similarly named materials never replace an independent base's atlas.
async function readAsset(file) {
  const bytes = readFileSync(new URL(`../public/models/${file}`, import.meta.url));
  const length = bytes.readUInt32LE(12), document = JSON.parse(bytes.subarray(20, 20 + length));
  assert.ok(document.images.every(image => image.bufferView !== undefined), `${file}: embedded textures`);
  const data = structuredClone(document);
  delete data.images; delete data.textures; delete data.samplers;
  data.materials = data.materials.map(material => ({ name: material.name,
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], roughnessFactor: .8 },
  }));
  const json = Buffer.from(JSON.stringify(data)), padded = Math.ceil(json.length / 4) * 4, binary = bytes.subarray(20 + length);
  const glb = Buffer.alloc(20 + padded + binary.length, 32);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20); binary.copy(glb, 20 + padded);
  const asset = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  asset.scene.traverse(object => {
    if (!object.isMesh) return;
    const atlas = new THREE.Texture(); atlas.name = `${file}:${object.material.name}`; atlas.colorSpace = THREE.SRGBColorSpace;
    object.material.map = atlas;
  });
  return { asset, document };
}
const files = ['vex.glb', 'citizen.glb', ...HUMAN_BASE_MODELS.map(base => base.file), ...VISITOR_PROFILES.map(profile => `visitors/${profile.id}.glb`)];
const production = new Map(await Promise.all(files.map(async file => [file, await readAsset(file)])));
const requested = [], originalLoad = GLTFLoader.prototype.loadAsync;
let assets;
try {
  GLTFLoader.prototype.loadAsync = async function (url) { requested.push(url); return production.get(url.replace('/models/', '')).asset; };
  assets = await loadCharacterAssets();
} finally { GLTFLoader.prototype.loadAsync = originalLoad; }

test('the production loader loads every independent human base and preserves its own clothing atlas', () => {
  assert.equal(Object.keys(assets.humanBases).length, 4, 'two male and two female base meshes are available');
  for (const base of HUMAN_BASE_MODELS) {
    assert.ok(requested.includes(`/models/${base.file}`), `${base.id} has an actual asset request`);
    const asset = assets.humanBases[base.id];
    assert.notEqual(asset, assets.citizen);
    assert.equal(asset.userData.baseModel, base.id);
    assert.ok(asset.userData.height > 1.5 && asset.userData.height < 2.2);
    assert.ok(asset.userData.motionSpeeds.Walk > 0);
    asset.scene.traverse(object => {
      if (!object.isMesh) return;
      assert.ok(object.material.map.name.startsWith(base.file), `${base.id}: same material names must not replace its atlas with the old suit`);
      assert.equal(object.material.map.colorSpace, THREE.SRGBColorSpace);
      assert.ok(object.material.map.anisotropy >= 4);
    });
  }
});

test('all four human bases contain different real geometry and complete animated rigs', () => {
  const signatures = new Set();
  for (const [id, asset] of Object.entries(assets.humanBases)) {
    const hash = createHash('sha256'), bones = new Set();
    asset.scene.traverse(object => {
      if (object.isBone) bones.add(object.name);
      if (!object.isSkinnedMesh) return;
      for (const attribute of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
        assert.ok(object.geometry.attributes[attribute], `${id}: ${attribute}`);
        assert.ok(object.geometry.attributes[attribute].array.every(Number.isFinite));
      }
      const positions = object.geometry.attributes.position.array;
      hash.update(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength));
    });
    signatures.add(hash.digest('hex'));
    assert.equal(bones.size, 49, `${id}: full hand/foot rig`);
    for (const name of ['Idle', 'Walk', 'WalkFormal', 'Jog', 'Run', 'JumpStart', 'JumpLoop', 'JumpLand', 'ArmedIdle', 'Aim', 'AimUp', 'AimDown', 'Reload', 'Fire', 'Hit', 'Driving']) {
      assert.ok(asset.animations.some(clip => clip.name === name && clip.tracks.length > 10), `${id}: authored ${name}`);
    }
    const profile = CROWD_PROFILES.find(profile => profile.baseModel === id);
    assert.ok(profile, `${id}: assigned to the balanced crowd roster`);
    const actor = createNPC(asset, profile);
    for (const clipName of ['Idle', 'Walk', 'Run']) {
      actor.setAnimation(clipName);
      const initial = actor.bones.get('Head').quaternion.clone(); actor.mixer.update(.37); actor.ground();
      assert.ok(actor.bones.get('Head').quaternion.toArray().every(Number.isFinite));
      assert.ok(actor.bones.get('Head').quaternion.angleTo(initial) > .0001, `${id}: ${clipName} animates its own skeleton`);
      const box = new THREE.Box3().setFromObject(actor.root, true);
      assert.ok(box.min.y > -.003 && box.min.y < .15, `${id}: animated feet remain near the floor (${box.min.y})`);
    }
    actor.dispose();
  }
  assert.equal(signatures.size, 4, 'anatomy and garment vertex data must differ, not just profile tints');
});

test('each human anatomy follows its own stride calibration and grounds the animated boots through starts and stops', () => {
  for (const [id, asset] of Object.entries(assets.humanBases)) {
    const profile = CROWD_PROFILES.find(profile => profile.baseModel === id), actor = createNPC(asset, profile);
    actor.root.position.set(13, 7.5, -9); actor.root.rotation.y = 1.1;
    const contacts = [], vertex = new THREE.Vector3();
    actor.body.traverse(mesh => {
      if (!mesh.isSkinnedMesh || !mesh.visible) return;
      const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
      for (let i = 0; i < indices.count; i++) if (weights.getX(i) > .999 && /^Foot[LR]$/.test(mesh.skeleton.bones[indices.getX(i)].name)) contacts.push({ mesh, i });
    });
    assert.ok(contacts.length > 0, `${id}: real exported boot vertices`);
    const speed = 1.2, calibratedSpeed = (asset.userData.motionSpeeds?.Walk ?? 1.084589) * actor.scale * profile.depth;
    const walkDuration = actor.actions.Walk.getClip().duration;
    for (let frame = 0; frame < 120; frame++) {
      actor.update(1 / 60, frame < 60 ? speed : 0);
      if (frame % 12 !== 0) continue;
      let lowest = Infinity;
      for (const { mesh, i } of contacts) lowest = Math.min(lowest, mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld).y);
      assert.ok(lowest > 7.498 && lowest < 7.65, `${id}: boots remain at translated floor during blends (${lowest})`);
      assert.ok(Math.abs(Object.values(actor.actions).reduce((sum, action) => sum + action.getEffectiveWeight(), 0) - 1) < 1e-7);
    }
    assert.ok(Math.abs(actor.actions.Walk.time - speed / calibratedSpeed % walkDuration) < 1e-6, `${id}: anatomy-specific stride distance matches navigation`);
    assert.equal(actor.action.getClip().name, 'Idle');
    assert.ok(actor.actions.Idle.getEffectiveWeight() > .999);
    actor.dispose();
  }
});

test('crowd and named contacts instantiate every assigned base in the city', () => {
  const people = createAvatarPool(assets);
  assert.deepEqual(rosterBases(people), { tailored: 5, flight: 5, utility: 5, citizen: 5 });
  for (const person of people.filter(person => person.species === 'human')) {
    assert.equal(person.root.userData.baseModel, person.avatar.profile.baseModel);
  }
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) };
  try {
    const world = createWorldLife(new THREE.Scene(), assets.citizen, new Campaign(), assets.humanBases);
    for (const [id, avatar] of Object.entries(world.avatars)) {
      assert.equal(avatar.root.userData.baseModel, NPC_PROFILES[id].baseModel, `${id}: requested anatomy is actually instantiated`);
      assert.equal(avatar.body.getObjectByProperty('isSkinnedMesh', true).geometry.attributes.position.count,
        assets.humanBases[NPC_PROFILES[id].baseModel].scene.getObjectByProperty('isSkinnedMesh', true).geometry.attributes.position.count);
    }
  } finally { globalThis.document = previousDocument; }
});
