// Development-only asset review surface, deliberately outside the game bundle.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadCharacterAssets } from '../engine/player/characters.js';
import { createNPC } from './npc-appearance.js';
import { NPC_PROFILES, CROWD_PROFILES } from './npc-profiles.js';
import { createVisitor, VISITOR_PROFILES } from './npc-visitors.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#10181e'); scene.fog = new THREE.Fog('#10181e', 12, 30);
const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
const environment = pmrem.fromScene(room, .04); scene.environment = environment.texture;
scene.environmentIntensity = .45; pmrem.dispose(); room.dispose();
const ambient = new THREE.HemisphereLight(0xe9f2ff, 0x56544c, 1.5); scene.add(ambient);
const key = new THREE.DirectionalLight(0xffeddd, 3); key.position.set(-3, 6, -4); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -5, right: 5, top: 4, bottom: -4, near: .1, far: 20 });
key.shadow.bias = -.00015; key.shadow.normalBias = .015; scene.add(key);
const rim = new THREE.DirectionalLight(0xb0d5e5, 2); rim.position.set(3, 4, 3); scene.add(rim);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#090f14', roughness: .9 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.015; ground.receiveShadow = true; scene.add(ground);
const grid = new THREE.GridHelper(30, 60, '#304149', '#25333a'); grid.position.y = -.01; scene.add(grid);
const camera = new THREE.PerspectiveCamera(32, 1, .05, 120);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, .98, 0);
controls.maxPolarAngle = Math.PI * .52; controls.minDistance = .6; controls.maxDistance = 16;
let actors = [], assets, page = 0, paused = false, turntable = false, playback = 1, last = performance.now();

const collections = {
  cast: Object.values(NPC_PROFILES), human: CROWD_PROFILES,
  bases: [
    ['citizen', 'Jacket · male base'], ['flight', 'Casual · female base'], ['utility', 'Overalls · male base'], ['tailored', 'Tailored · female base'],
  ].map(([baseModel, name]) => ({ id: `base-${baseModel}`, baseModel, name,
    gender: ['citizen', 'utility'].includes(baseModel) ? 'man' : 'woman',
    height: 1.85, width: 1, depth: 1, waist: 1, hips: 1, jaw: 1, cheeks: 1, faceLength: 1, nose: 0, faceShape: 0, shoulders: 1, chest: 0,
    skin: '#c6a081', hair: '#36302c', hairstyle: 'shaved', jacket: '#607b87', trousers: '#344550', accent: '#c7b28b', iris: '#687567', outfit: 'casual' })),
  robot: VISITOR_PROFILES.filter(p => p.species === 'robot'), alien: VISITOR_PROFILES.filter(p => p.species === 'alien'),
  player: [{ id: 'vex', name: 'Vex · Last signal', height: 1.9331 }],
};
function assetFor(profile) {
  if (profile.species) return assets.visitors[profile.id];
  if (profile.id === 'vex') return assets.player;
  return profile.baseModel && profile.baseModel !== 'citizen' ? assets.humanBases?.[profile.baseModel] : assets.citizen;
}
function makeActor(profile) {
  const asset = assetFor(profile);
  if (!asset) throw new Error(`Asset unavailable: ${profile.id}`);
  if (profile.species) return Object.assign(createVisitor(asset, profile), { asset });
  if (profile.id !== 'vex') return Object.assign(createNPC(asset, profile), { asset });
  const root = clone(asset.scene), mixer = new THREE.AnimationMixer(root);
  root.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; } });
  return { root, mixer, profile, asset, dispose() { mixer.stopAllAction(); mixer.uncacheRoot(root); root.traverse(m => { if (m.isSkinnedMesh) m.skeleton.dispose(); }); } };
}
function setAnimation(name) {
  for (const actor of actors) {
    const clip = actor.asset.animations.find(c => c.name === name);
    if (!clip) throw new Error(`Missing ${name}: ${actor.profile.id}`);
    if (actor.setAnimation) { actor.setAnimation(name); actor.previewAction = actor.action; }
    else {
      actor.mixer.stopAllAction();
      actor.previewAction = actor.mixer.clipAction(clip).reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    }
    actor.mixer.update(0); actor.ground?.(); actor.root.updateMatrixWorld(true);
  }
  $('animation').value = name;
}
function show(collection = $('collection').value, index = 0) {
  if (!collections[collection]) throw new Error(`Unknown collection: ${collection}`);
  $('collection').value = collection; page = Math.max(0, Math.min(Math.ceil(collections[collection].length / 4) - 1, index));
  for (const actor of actors) { scene.remove(actor.root); actor.dispose(); }
  actors = collections[collection].slice(page * 4, page * 4 + 4).map(makeActor);
  actors.forEach((actor, i) => { actor.root.position.x = ((actors.length - 1) / 2 - i) * 1.45; scene.add(actor.root); });
  const previous = $('animation').value;
  const clips = actors[0].asset.animations.map(c => c.name).filter(name => actors.every(a => a.asset.animations.some(c => c.name === name)));
  $('animation').replaceChildren(...clips.map(name => new Option(name, name)));
  setAnimation(clips.includes(previous) ? previous : 'Idle');
  $('captions').replaceChildren(...actors.map(actor => {
    const caption = document.createElement('div'); caption.className = 'caption';
    const title = document.createElement('strong'); title.textContent = actor.profile.name ?? actor.profile.archetype ?? actor.profile.id.replaceAll('-', ' ');
    const note = document.createElement('small'); note.textContent = `${actor.profile.species ?? 'human'} / ${actor.profile.height.toFixed(2)} m`;
    caption.append(title, note); return caption;
  }));
  frameActors();
  $('previous').disabled = page === 0; $('next').disabled = (page + 1) * 4 >= collections[collection].length;
  $('page-label').textContent = `${page * 4 + 1}–${Math.min((page + 1) * 4, collections[collection].length)} of ${collections[collection].length} models`;
  render();
  const stats = snapshot();
  $('status').textContent = `${stats.actors.length} models · ${stats.triangles.toLocaleString()} triangles · ${stats.textures} textures`;
  return stats;
}
function frameActors() {
  if (!actors.length) return;
  const bounds = new THREE.Box3();
  for (const actor of actors) bounds.union(new THREE.Box3().setFromObject(actor.root, true));
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const aspect = viewport.clientWidth / viewport.clientHeight;
  const distance = Math.max(size.y / (2 * Math.tan(fov / 2)), size.x / (2 * Math.tan(fov / 2) * aspect)) * 1.27 + size.z / 2;
  controls.target.copy(center); camera.position.set(center.x + .12, center.y + .6, center.z - distance); controls.update();
}
function render() { renderer.render(scene, camera); }
function snapshot() {
  return {
    collection: $('collection').value, page, animation: $('animation').value,
    triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures,
    actors: actors.map(actor => {
      let meshes = 0, textured = 0, vertices = 0, invalid = 0, missingUV = 0;
      const materials = new Map(), bounds = new THREE.Box3().makeEmpty(), vertex = new THREE.Vector3();
      actor.root.updateMatrixWorld(true);
      actor.root.traverse(mesh => {
        if (!mesh.isMesh || !mesh.visible) return;
        meshes++; const position = mesh.geometry.getAttribute('position'); vertices += position.count;
        if (mesh.isSkinnedMesh) mesh.skeleton.update();
        for (let i = 0; i < position.count; i++) {
          mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
          if (!vertex.toArray().every(Number.isFinite)) invalid++;
          else bounds.expandByPoint(vertex);
        }
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'].filter(key => material[key]);
          if (maps.length) textured++;
          if (maps.length && !mesh.geometry.getAttribute('uv')) missingUV++;
          materials.set(material.uuid, { name: material.name, maps, imagesReady: maps.every(key => {
            const image = material[key].image; return image && image.width > 0 && image.height > 0;
          }) });
        }
      });
      return { id: actor.profile.id, gender: actor.profile.gender,
        baseModel: actor.asset.userData?.baseModel ?? (actor.profile.species ? actor.profile.id : 'citizen'), requestedBase: actor.profile.baseModel,
        meshes, textured, vertices, invalid, missingUV, materials: [...materials.values()], bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
    }),
  };
}

$('collection').onchange = () => show();
$('previous').onclick = () => show($('collection').value, page - 1);
$('next').onclick = () => show($('collection').value, page + 1);
$('animation').onchange = () => setAnimation($('animation').value);
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Play' : 'Pause'; };
$('rate').oninput = () => { playback = Number($('rate').value); $('rate-label').textContent = `${playback}×`; };
$('turntable').onchange = () => { turntable = $('turntable').checked; };
$('lighting').onchange = () => {
  const night = $('lighting').value === 'city';
  ambient.intensity = night ? .8 : 1.5; key.intensity = night ? 1.8 : 3;
  key.color.set(night ? '#80d7db' : '#ffeddd'); rim.color.set(night ? '#ba86c6' : '#b0d5e5');
  scene.environmentIntensity = night ? .18 : .45;
};
new ResizeObserver(() => {
  renderer.setSize(viewport.clientWidth, viewport.clientHeight, false);
  camera.aspect = viewport.clientWidth / viewport.clientHeight; camera.updateProjectionMatrix();
  frameActors();
}).observe(viewport);

try {
  assets = await loadCharacterAssets();
  const initial = new URLSearchParams(location.search).get('collection');
  show(collections[initial] ? initial : 'bases');
  if (import.meta.env.DEV) window.__CHARACTER_STUDIO__ = {
    collections: Object.fromEntries(Object.entries(collections).map(([name, profiles]) => [name, profiles.map(p => p.id)])),
    show, snapshot, setAnimation,
    clips() { return actors[0].asset.animations.map(clip => ({ name: clip.name, duration: clip.duration })); },
    sample(name, time) { paused = true; $('pause').textContent = 'Play'; setAnimation(name); for (const actor of actors) { actor.previewAction.time = time; actor.mixer.update(0); actor.ground?.(); } render(); return snapshot(); },
    pause(value = true) { paused = value; $('pause').textContent = paused ? 'Play' : 'Pause'; },
  };
  renderer.setAnimationLoop(now => {
    const dt = Math.min((now - last) / 1000, .06); last = now;
    if (!paused) for (const actor of actors) { actor.mixer.update(dt * playback); actor.ground?.(dt); }
    if (turntable) for (const actor of actors) actor.root.rotation.y += dt * .25;
    controls.update(); render();
  });
} catch (error) { $('status').textContent = error.message; console.error(error); }
