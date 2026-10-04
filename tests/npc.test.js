import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createNPC, shapePoint } from '../src/npc-appearance.js';
import { NPC_PROFILES, CROWD_PROFILES, VOICE_PROFILES, HUMAN_BASE_MODELS } from '../src/npc-profiles.js';
import { npcSurfaceTextures } from '../src/npc-surfaces.js';
import { npcClothMaterial, npcSkinMaterial } from '../src/npc-materials.js';
import { CONTACTS, ENDINGS, QUESTS } from '../src/content.js';
import { Campaign } from '../src/campaign.js';
import { dialogueFor, acceptanceReply, offerScene, replyScene } from '../src/dialogue.js';

// Load the actual exported mesh, skin and animations with the actual GLTF
// loader. Omit only embedded images, which require a browser image decoder.
async function citizenAsset(name = 'citizen') {
  const file = readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
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
asset.userData.baseModel = 'citizen';
const nativeAssets = Object.fromEntries(await Promise.all(HUMAN_BASE_MODELS.map(async base => [base.id, await citizenAsset(`humans/${base.id}`)])));
const baseFor = profile => profile.baseModel === 'citizen' ? asset : nativeAssets[profile.baseModel];
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

test('disposing an NPC releases its GPU bone textures without invalidating other actors or the source', () => {
  const a = createNPC(asset, NPC_PROFILES.mara), b = createNPC(asset, NPC_PROFILES.mara);
  const skeletons = root => [...new Set(meshes(root).filter(m => m.isSkinnedMesh).map(m => m.skeleton))];
  const owned = skeletons(a.root), siblings = skeletons(b.root), sources = skeletons(asset.scene);
  const counts = new Map();
  for (const skeleton of [...owned, ...siblings, ...sources]) {
    skeleton.computeBoneTexture(); counts.set(skeleton, 0);
    skeleton.boneTexture.addEventListener('dispose', () => counts.set(skeleton, counts.get(skeleton) + 1));
  }
  a.dispose(); a.dispose();
  for (const skeleton of owned) { assert.equal(counts.get(skeleton), 1); assert.equal(skeleton.boneTexture, null); }
  for (const skeleton of [...siblings, ...sources]) { assert.equal(counts.get(skeleton), 0); assert.ok(skeleton.boneTexture); }
  b.update(.2, 1); assert.ok(b.bones.get('Head').quaternion.toArray().every(Number.isFinite));
  b.dispose(); sources.forEach(skeleton => skeleton.dispose());
});

test('all silhouettes stay finite and wardrobe pieces follow animated bones', () => {
  for(const profile of [...Object.values(NPC_PROFILES),...CROWD_PROFILES]) {
    const actor = createNPC(baseFor(profile),profile,'Walk'); actor.mixer.update(.2);actor.root.updateMatrixWorld(true);
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

test('named idle presence yields to explicit action clips and returns with idle', () => {
  const actor = createNPC(asset, NPC_PROFILES.mara, 'Walk');
  const neutral = createNPC(asset, { ...NPC_PROFILES.mara, id: 'mara-action-neutral', stance: null });
  actor.setAnimation('Run'); neutral.setAnimation('Run');
  actor.mixer.update(.31); neutral.mixer.update(.31);
  assert.ok(actor.bones.get('Head').quaternion.angleTo(neutral.bones.get('Head').quaternion) < 1e-6);
  actor.setAnimation('Idle'); neutral.setAnimation('Idle');
  assert.ok(actor.bones.get('Head').quaternion.angleTo(neutral.bones.get('Head').quaternion) > .02);
  actor.dispose(); neutral.dispose();
});

test('grounding keeps the real boot soles above translated terrain without accumulating lift', () => {
  for (const profile of [NPC_PROFILES.mara, CROWD_PROFILES[15], CROWD_PROFILES[18]]) {
    const actor = createNPC(baseFor(profile), profile);
    actor.root.position.set(12, 8.25, -4); actor.root.rotation.y = 1.37;
    actor.root.scale.multiply(new THREE.Vector3(1.12, .93, .87));
    const soles = [];
    for (const mesh of meshes(actor.root).filter(m => m.visible && m.isSkinnedMesh)) {
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) if (positions.getY(i) < .15) soles.push({ mesh, i });
    }
    const vertex = new THREE.Vector3();
    for (const speed of [0, .6, 1.4, 0]) {
      for (let frame = 0; frame < 20; frame++) actor.update(1 / 30, speed);
      let lowest = Infinity;
      for (const { mesh, i } of soles) lowest = Math.min(lowest, mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld).y);
      assert.ok(lowest >= 8.25 - .002, `${profile.id} boot at ${lowest} for speed ${speed}`);
      assert.ok(lowest < 8.4, `${profile.id} must remain in contact with the terrain`);
    }
    actor.setAnimation('Idle'); actor.ground(); const initial = actor.body.position.y;
    for (let i = 0; i < 60; i++) actor.ground();
    assert.ok(Math.abs(actor.body.position.y - initial) < 1e-8);
    actor.dispose();
  }
});

test('legacy vendor bib stays in front of the animated jacket instead of flickering through its folds', () => {
  for (const profile of CROWD_PROFILES.filter(p => p.outfit === 'vendor')) {
    const actor = createNPC(asset, profile), all = meshes(actor.root);
    const jacket = all.find(m => m.material.name === 'Jacket');
    const bib = all.find(m => m.name.endsWith('_Chest') && m.material.color.equals(new THREE.Color(profile.accent)));
    bib.geometry.computeBoundingBox();
    const bounds = bib.geometry.boundingBox, center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3()), samples = [];
    for (const u of [-.3, 0, .3]) for (const v of [-.3, 0, .3]) samples.push(new THREE.Vector3(center.x + size.x * u, center.y + size.y * v, bounds.min.z));
    for (const clip of ['Idle', 'WalkFormal', 'Run', 'Aim']) for (const time of [.2, .6]) {
      actor.setAnimation(clip); actor.mixer.update(time); actor.ground();
      jacket.computeBoundingSphere();
      const normal = new THREE.Vector3(0, 0, -1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(bib.matrixWorld));
      for (const sample of samples) {
        const point = sample.clone().applyMatrix4(bib.matrixWorld);
        const ray = new THREE.Raycaster(point.clone().addScaledVector(normal, .3), normal.clone().negate());
        const bibHit = ray.intersectObject(bib, false)[0], jacketHit = ray.intersectObject(jacket, false)[0];
        assert.ok(bibHit, `${profile.id}/${clip} bib covers ${sample.x},${sample.y}`);
        if (jacketHit) assert.ok(jacketHit.distance > bibHit.distance + .002, `${profile.id}/${clip} intersects jacket at ${sample.x},${sample.y}: ${jacketHit.distance - bibHit.distance}`);
      }
    }
    actor.dispose();
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

test('eyebrows follow each native forehead instead of disappearing into it', () => {
  for (const baseModel of ['citizen', 'flight', 'utility', 'tailored']) {
    const profile = { ...NPC_PROFILES.jun, id: `brow-check-${baseModel}`, baseModel, hairstyle: 'shaved', beard: null, glasses: null, outfit: 'casual', jewelry: null, stance: null };
    const actor = createNPC(baseFor(profile), profile), all = meshes(actor.root);
    const skin = all.find(m => m.material.name === 'Skin');
    const brow = all.find(m => m.name.endsWith('_Head') && m.material.userData.surface === 'hair');
    actor.root.updateMatrixWorld(true); skin.computeBoundingSphere();
    const positions = brow.geometry.getAttribute('position'), normals = brow.geometry.getAttribute('normal');
    let checked = 0;
    for (let i = 0; i < positions.count; i += 5) {
      if (normals.getZ(i) > -.6 || Math.abs(positions.getX(i)) < .025 || Math.abs(positions.getX(i)) > .043) continue;
      const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(brow.matrixWorld);
      const direction = new THREE.Vector3(0, 0, 1).transformDirection(brow.matrixWorld);
      const ray = new THREE.Raycaster(point.clone().addScaledVector(direction, -.1), direction);
      const eyebrowHit = ray.intersectObject(brow, false)[0], skinHit = ray.intersectObject(skin, false)[0];
      assert.ok(eyebrowHit && skinHit, `${baseModel} eyebrow has a forehead behind it`);
      const clearance = skinHit.distance - eyebrowHit.distance;
      assert.ok(clearance >= -.0005 && clearance < .009, `${baseModel} eyebrow clearance ${clearance}`);
      checked++;
    }
    assert.ok(checked >= 2); actor.dispose();
  }
});

test('human crowd includes distinct jobs, wardrobe silhouettes and hairstyles on the complete rig', () => {
  assert.equal(CROWD_PROFILES.length, 20);
  assert.equal(new Set(CROWD_PROFILES.map(p => p.id)).size, CROWD_PROFILES.length);
  assert.ok(new Set(CROWD_PROFILES.map(p => p.hairstyle)).size >= 13);
  for (const outfit of ['pilot', 'coat', 'utility', 'vendor']) {
    const profiles = CROWD_PROFILES.filter(p => p.outfit === outfit);
    assert.equal(profiles.length, 2);
    assert.notDeepEqual(profiles.map(p => [p.height, p.width])[0], profiles.map(p => [p.height, p.width])[1]);
    for (const profile of profiles) {
      const actor = createNPC(baseFor(profile), profile, 'WalkFormal');
      for (const clip of ['Idle', 'WalkFormal', 'Run', 'JumpLoop', 'Aim', 'Reload']) {
        actor.setAnimation(clip); actor.mixer.update(.43); actor.root.updateMatrixWorld(true);
        for (const mesh of meshes(actor.root).filter(m => m.visible)) {
          const bounds = new THREE.Box3().setFromObject(mesh);
          assert.ok([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite), `${profile.id}/${clip}/${mesh.name}`);
        }
      }
      actor.dispose();
    }
  }
});

test('human crowd is balanced across four authored bases while preserving named identities', () => {
  assert.deepEqual(HUMAN_BASE_MODELS.map(base => base.id).sort(), ['flight', 'tailored', 'utility']);
  for (const base of ['citizen', 'flight', 'tailored', 'utility']) assert.equal(CROWD_PROFILES.filter(p => p.baseModel === base).length, 5);
  for (const gender of ['woman', 'man']) assert.equal(CROWD_PROFILES.filter(p => p.gender === gender).length, 10);
  for (const contact of CONTACTS.filter(c => !c.terminal)) assert.equal(NPC_PROFILES[contact.id].gender, contact.gender);
  assert.equal(NPC_PROFILES.jun.gender, 'nonbinary');
  assert.ok(['flight', 'tailored'].every(base => Object.values(NPC_PROFILES).some(p => p.baseModel === base && p.gender === 'woman')));
});

test('native human meshes retain authored body geometry and clothing while keeping subtle face variety', () => {
  for (const profile of [NPC_PROFILES.imani, NPC_PROFILES.rook, NPC_PROFILES.mara]) {
    const base = baseFor(profile);
    assert.equal(base.userData.baseModel, profile.baseModel);
    assert.ok(base.userData.height > 1.8 && base.userData.height < 2.1);
    assert.ok(base.userData.motionSpeeds.Walk > .9);
    const sourceSkin = meshes(base.scene).find(m => m.material.name === 'Skin');
    const actor = createNPC(base, profile), skin = meshes(actor.root).find(m => m.material.name === 'Skin');
    const a = sourceSkin.geometry.getAttribute('position'), b = skin.geometry.getAttribute('position');
    let shapedFace = false;
    for (let i = 0; i < a.count; i++) {
      const before = new THREE.Vector3().fromBufferAttribute(a, i), after = new THREE.Vector3().fromBufferAttribute(b, i);
      if (before.y < 1.6) assert.ok(before.equals(after), `${profile.id} native body must not receive legacy suit corrections`);
      else if (before.distanceTo(after) > .0001) shapedFace = true;
    }
    assert.ok(shapedFace, `${profile.id} retains individual facial proportions`);
    const jacket = meshes(actor.root).find(m => m.material.name === 'Jacket');
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    jacket.material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.npcFashion.value, 0);
    assert.equal(shader.uniforms.npcCrop.value, 0);
    actor.dispose();
  }
});

test('native overalls and skirts are not obscured by legacy belts or rigid apron panels', () => {
  for (const profile of [NPC_PROFILES.rook, NPC_PROFILES.jun, ...CROWD_PROFILES.filter(p => p.outfit === 'vendor' || p.outfit === 'utility')]) {
    const actor = createNPC(baseFor(profile), profile);
    assert.ok(!meshes(actor.root).some(mesh => mesh.name.startsWith('Wardrobe_') && mesh.parent.name === 'Hips'), profile.id);
    actor.dispose();
  }
});

test('wardrobe has complete UVs and shared color-managed material maps through disposal', () => {
  const a = createNPC(asset, CROWD_PROFILES[12]), b = createNPC(asset, CROWD_PROFILES[15]);
  for (const actor of [a, b]) for (const mesh of meshes(actor.root).filter(m => m.name.startsWith('Wardrobe_'))) {
    const uv = mesh.geometry.getAttribute('uv');
    assert.equal(uv.count, mesh.geometry.getAttribute('position').count);
    assert.ok(uv.array.every(Number.isFinite));
    for (const slot of ['map', 'normalMap', 'roughnessMap']) {
      const texture = mesh.material[slot];
      assert.ok(texture?.isDataTexture, `${mesh.name}/${slot}`);
      assert.equal(texture.colorSpace, slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace);
      assert.ok(texture.generateMipmaps);
      assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
      assert.ok(new Set(texture.image.data).size > 4, 'map contains real surface variation');
    }
  }
  const maps = npcSurfaceTextures('cloth');
  let disposed = false; maps.map.addEventListener('dispose', () => { disposed = true; });
  a.dispose(); assert.equal(disposed, false, 'disposing one actor cannot destroy shared wardrobe textures');
  assert.equal(maps, npcSurfaceTextures('cloth'));
  b.dispose();
});

test('material finishing preserves source UV maps and compiles bind-space details for every complexion', () => {
  const source = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture() });
  for (const profile of [NPC_PROFILES.sable, CROWD_PROFILES[15]]) {
    source.name = 'Skin'; const skin = npcSkinMaterial(source, profile);
    source.name = 'Jacket'; const cloth = npcClothMaterial(source, profile);
    for (const material of [skin, cloth]) {
      assert.equal(material.map, source.map); assert.equal(material.normalMap, source.normalMap);
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      material.onBeforeCompile(shader);
      assert.ok(shader.vertexShader.includes('vNpcBindPosition = npcBindPosition'));
      assert.ok(!shader.fragmentShader.includes('undefined'));
      if (material === skin) assert.ok(shader.fragmentShader.includes('skinChroma'), 'untouched faces still use complexion-correct albedo');
      else assert.ok(shader.fragmentShader.includes('fwidth(stripeCoordinate)'), 'pinstripes are filtered at distance');
      material.dispose();
    }
  }
  source.dispose();
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
