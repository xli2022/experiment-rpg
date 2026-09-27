import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createNPC, shapePoint } from '../src/npc-appearance.js';
import { NPC_PROFILES, CROWD_PROFILES, VOICE_PROFILES } from '../src/npc-profiles.js';
import { CONTACTS, ENDINGS, QUESTS } from '../src/content.js';
import { Campaign } from '../src/campaign.js';
import { dialogueFor, acceptanceReply, offerScene, replyScene } from '../src/dialogue.js';

// Load the actual exported mesh, skin and animations with the actual GLTF
// loader. Omit only embedded images, which require a browser image decoder.
async function citizenAsset() {
  const file = readFileSync(new URL('../public/models/citizen.glb', import.meta.url));
  const jsonLength = file.readUInt32LE(12), doc = JSON.parse(file.subarray(20,20+jsonLength));
  delete doc.images; delete doc.textures; delete doc.samplers;
  doc.materials = doc.materials.map(m => ({name:m.name,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.8}}));
  const json = Buffer.from(JSON.stringify(doc)), padded = Math.ceil(json.length/4)*4, binary = file.subarray(20+jsonLength);
  const glb = Buffer.alloc(20+padded+binary.length,32);
  glb.writeUInt32LE(0x46546c67,0); glb.writeUInt32LE(2,4); glb.writeUInt32LE(glb.length,8);
  glb.writeUInt32LE(padded,12); glb.writeUInt32LE(0x4e4f534a,16); json.copy(glb,20); binary.copy(glb,20+padded);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
}
const asset = await citizenAsset();
const meshes = root => {const m=[];root.traverse(o=>{if(o.isMesh)m.push(o);});return m;};

test('the cast includes women, men and a nonbinary contact with individual personalities and voice profiles', () => {
  const humans = CONTACTS.filter(c=>!c.terminal);
  for (const gender of ['woman','man','nonbinary']) assert.ok(humans.some(c=>c.gender===gender));
  assert.equal(new Set(humans.map(c=>c.personality)).size, humans.length);
  for (const c of CONTACTS) { assert.ok(c.pronouns); assert.ok(VOICE_PROFILES[c.id]); if(!c.terminal) assert.ok(NPC_PROFILES[c.id]); }
  assert.ok(Object.values(NPC_PROFILES).every(p=>p.age>=21));
  assert.ok(new Set(CROWD_PROFILES.map(p=>p.skin)).size >= 7);
  assert.ok(new Set(CROWD_PROFILES.map(p=>p.hairstyle)).size >= 7);
});

test('NPC variants preserve the source mesh, skinning and independent animation rigs', () => {
  const originals = meshes(asset.scene).map(m=>({mesh:m,positions:m.geometry.attributes.position.array.slice(),color:m.material.color.clone()}));
  const a = createNPC(asset,NPC_PROFILES.mara), b = createNPC(asset,NPC_PROFILES.rook,'Walk');
  assert.equal(a.bones.size,49); assert.equal(b.bones.size,49); assert.notEqual(a.bones.get('Head'),b.bones.get('Head'));
  const aSkin = meshes(a.root).find(m=>m.material.name==='Skin'), bSkin = meshes(b.root).find(m=>m.material.name==='Skin');
  assert.notDeepEqual(aSkin.geometry.attributes.position.array,bSkin.geometry.attributes.position.array);
  assert.deepEqual(aSkin.geometry.attributes.skinWeight.array,bSkin.geometry.attributes.skinWeight.array);
  assert.equal(aSkin.skeleton.bones.length,49);
  const head = a.bones.get('Head').quaternion.clone(); b.mixer.update(.37); assert.ok(a.bones.get('Head').quaternion.equals(head));
  for(const o of originals){assert.deepEqual(o.mesh.geometry.attributes.position.array,o.positions);assert.deepEqual(o.mesh.material.color,o.color);assert.equal(o.mesh.visible,true);}
  assert.notEqual(a.root.scale.y,b.root.scale.y); a.dispose();b.dispose();
});

test('all silhouettes stay finite and wardrobe pieces follow animated bones', () => {
  for(const profile of [...Object.values(NPC_PROFILES),...CROWD_PROFILES]) {
    const actor = createNPC(asset,profile,'Walk'); actor.mixer.update(.2);actor.root.updateMatrixWorld(true);
    const wardrobe = meshes(actor.root).filter(m=>m.name.startsWith('Wardrobe_'));
    assert.ok(wardrobe.length>0 && wardrobe.length<=12,`${profile.id} batches`);
    const offsets = wardrobe.map(m=>({mesh:m,local:m.matrix.clone(),world:m.matrixWorld.clone()}));
    actor.mixer.update(.43);actor.root.updateMatrixWorld(true);
    assert.ok(offsets.some(o=>!o.world.equals(o.mesh.matrixWorld)),`${profile.id} accessories animate`);
    for(const o of offsets){assert.ok(o.mesh.parent.isBone);assert.ok(o.local.equals(o.mesh.matrix));}
    for(const piece of wardrobe.filter(m=>m.parent.name.startsWith('UpperArm'))){
      const center=new THREE.Box3().setFromObject(piece).getCenter(new THREE.Vector3());
      assert.ok(center.distanceTo(piece.parent.getWorldPosition(new THREE.Vector3()))<.22,`${profile.id} shoulder piece must stay at its own shoulder`);
    }
    for(const m of meshes(actor.root).filter(m=>m.visible)){
      assert.ok(m.geometry.attributes.position.array.every(Number.isFinite));
      assert.ok(m.geometry.attributes.normal.array.every(Number.isFinite));
    }
    const height = new THREE.Box3().setFromObject(actor.root).getSize(new THREE.Vector3()).y;
    assert.ok(height>1.3 && height<2.15,`${profile.id} height ${height}`);actor.dispose();
  }
});

test('individual idle poses remain bounded without changing foot placement or accumulating offsets', () => {
  for(const profile of [NPC_PROFILES.mara,NPC_PROFILES.rook,NPC_PROFILES.orrin]) {
    const actor=createNPC(asset,profile), neutral=createNPC(asset,{...profile,id:`${profile.id}-neutral`,stance:null});
    for(const t of [0,.5,5.6,28,280,560]) {
      actor.mixer.setTime(t);neutral.mixer.setTime(t);actor.root.updateMatrixWorld(true);neutral.root.updateMatrixWorld(true);
      const angle=actor.bones.get('Head').quaternion.angleTo(neutral.bones.get('Head').quaternion);
      assert.ok(angle>.02 && angle<.2,`${profile.id} head offset ${angle} at ${t}`);
      for(const foot of ['FootL','FootR']) assert.ok(actor.bones.get(foot).getWorldPosition(new THREE.Vector3()).distanceTo(neutral.bones.get(foot).getWorldPosition(new THREE.Vector3()))<1e-6);
    }
    actor.dispose();neutral.dispose();
  }
});

test('Rook and Orrin have optional personal conversations with earned follow-ups', () => {
  const game=new Campaign();
  for(const [id,quest] of [['rook','spare-parts'],['orrin','letters']]) {
    const branch=dialogueFor(game,id).choices.find(c=>c.topics);
    assert.equal(branch.topics.length,3);
    const scene=replyScene(CONTACTS.find(c=>c.id===id),branch.reply,branch.topics);
    assert.equal(scene.choices.filter(c=>c.kind==='topic').length,3);
    assert.ok(scene.choices.every(c=>c.kind!=='accept' && c.kind!=='talk'),'personal topics cannot advance a job');
    game.data.quests[quest]={status:'complete',step:2,runs:1};
    assert.equal(dialogueFor(game,id).choices.find(c=>c.topics).topics.length,4);
  }
});

test('face fitting deforms eyewear and nearby facial surfaces consistently', () => {
  const profile=NPC_PROFILES.sable;
  const skin=new THREE.Vector3(.035,1.795,-.155), glasses=new THREE.Vector3(.035,1.795,-.169);
  const original=skin.distanceTo(glasses);shapePoint(skin,profile);shapePoint(glasses,profile);
  assert.ok(Math.abs(skin.distanceTo(glasses)-original)<.009);
});

test('personal conversations, job acceptance and every ending retain each contact’s personality', () => {
  const game=new Campaign(), acceptances=CONTACTS.map(c=>acceptanceReply(c.id));
  assert.equal(new Set(acceptances).size,CONTACTS.length);
  for(const c of CONTACTS){const scene=dialogueFor(game,c.id);assert.ok(scene.choices.filter(c=>c.kind==='topic').length>=3);}
  for(const q of QUESTS.filter(q=>q.kind==='side')){
    const offer=offerScene(CONTACTS.find(c=>c.id===q.giver),q);
    assert.notEqual(offer.text,q.description,'spoken offers use the character’s words, not journal narration');
    assert.equal(offer.choices.find(c=>c.kind==='accept').quest,q.id);
  }
  for(const ending of Object.keys(ENDINGS)){
    game.data.ending=ending;
    const replies=CONTACTS.map(c=>dialogueFor(game,c.id).text);
    assert.ok(replies.every(t=>t?.length>50));assert.equal(new Set(replies).size,CONTACTS.length);
  }
});
