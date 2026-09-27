import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCity, addSky } from './city.js';
import { createDrone } from './models.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { HUD } from './ui.js';
import { createCrowd } from './crowd.js';
import { loadCharacterAssets, createCharacter, animateCharacter, characterShot } from './characters.js';
import { beginJump, stepJump } from './jump.js';
import { clamp, damp, angleDelta, moveWithCollisions, carCollider, findExitPosition, stepVehicle, rayBoxDistance, rayObstructionDistance, circleHitsBox, overlapsHeight, supportHeight } from './physics.js';
import { MOVEMENT, footVelocity } from './locomotion.js';
import { findClimbFace, startClimb, dropClimb, stepClimb } from './climbing.js';
import { Campaign, freshProgress, readSave, writeSave } from './campaign.js';
import { WORLD_OBJECTS, REGIONAL_STOPS, ENCOUNTERS, districtAt, placeById } from './content.js';
import { streetPoint } from './metropolis.js';
import { expandCity, createWorldLife } from './world.js';
import { RPGUI } from './rpg-ui.js';
import { createNPCPortraits } from './npc-appearance.js';
import { DialogueVoice } from './voice.js';
import { WorldStream, RENDER_PROFILES, ResolutionGovernor } from './world-stream.js';
import { createCityScenery } from './city-scenery.js';
import './npc.css';

const $ = id => document.getElementById(id);
const canvas = $('world');
const storage = { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) };
const saved = readSave(storage), campaign = new Campaign(saved.progress);
const state = { started: false, paused: false, mapOpen: false, modal: null, health: 100, armor: campaign.maxArmor, ammo: 24, reloading: 0, cooldown: 0, damageAt: -100, time: campaign.data.elapsed };
const player = { x: -2.5, y: 0, z: 30, yaw: 0, velocityY: 0, vx: 0, vz: 0, speed: 0, jumpPhase: '', jumpTime: 0, jumpElapsed: 0, launched: false, groundY: 0, climb: null, climbCandidate: null, pushTime: 0 };
let renderer, composer, bloom, city, character, hud, input, scene, camera, crowd, worldLife, rpgUI;
let worldStream, sky;
const resolution = new ResolutionGovernor();
const frameCosts = { updateMs: 0, renderMs: 0 };
let driving = null, nearestCar = null, quality = 'high', animationId;
let cameraYaw = -.025, cameraPitch = .19, fps = 60, lastFrame = performance.now(), lastUI = 0, shotRecoil = 0;
const audio = new GameAudio(), drones = [], effects = [];
const voice = new DialogueVoice({ storage });
const raycaster = new THREE.Raycaster(), vector = new THREE.Vector3(), direction = new THREE.Vector3(), cameraTarget = new THREE.Vector3(), desiredCamera = new THREE.Vector3();
const tempPoint = new THREE.Vector3(), muzzlePoint = new THREE.Vector3(), droneSphere = new THREE.Sphere(new THREE.Vector3(), 1.02);
let contactShadow, damageFlashUntil = 0, hitUntil = 0, lastSavedAt = 0, savedRevision = -1, saveWarningShown = false;

function showError(error) {
  console.error(error); $('loading').classList.add('hidden'); $('error').classList.remove('hidden');
  $('error-message').textContent = error?.message?.includes('WebGL') ? 'This city needs WebGL 2. Enable hardware acceleration or open it in a recent version of Chrome, Edge, Firefox, or Safari.' : `The city could not start: ${error.message || error}`;
}

async function init() {
  const mobile = matchMedia('(pointer: coarse)').matches;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: mobile ? 'default' : 'high-performance' });
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;
  scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x1b2940, .0048);
  sky = addSky(scene);
  worldStream = new WorldStream(scene); scene.userData.worldStream = worldStream;
  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .12, 760);
  const hemisphere = new THREE.HemisphereLight(0xb9d9fc, 0x3a3051, 1.7); scene.add(hemisphere);
  const moon = new THREE.DirectionalLight(0xc5d8ff, 2.3); moon.position.set(-45, 85, 25); scene.add(moon);
  const rim = new THREE.DirectionalLight(0xb282c9, .7); rim.position.set(40, 20, -45); scene.add(rim);
  const environment = new RoomEnvironment(); const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(environment, .025); scene.environment = envMap.texture; scene.environmentIntensity = .24;
  environment.dispose(); pmrem.dispose();
  // Wait briefly for the local UI font before drawing the permanent shop textures.
  await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1000))]);
  $('loading-text').textContent = 'LOADING VESPER CITY AND CHARACTERS...';
  const characterAssets = await loadCharacterAssets();
  const beforeCity = new Set(scene.children);
  city = createCity(scene); expandCity(scene, city);
  const carRoots = new Set(city.cars.map(c => c.root));
  worldStream.capture(scene.children.filter(o => !beforeCity.has(o) && !carRoots.has(o) && o !== city.rain && o !== city.motes && !o.userData.resident));
  createCityScenery(scene, city, worldStream);
  const carTemplates = [...city.cars];
  for (const [i, stop] of REGIONAL_STOPS.entries()) {
    const template = carTemplates[i % carTemplates.length], root = template.root.clone(true);
    const p = streetPoint(stop.roadX, stop.roadZ - 32), q = streetPoint(stop.roadX, stop.roadZ - 30);
    const x = p.x + 3.5, z = p.z, yaw = Math.atan2(q.x - p.x, q.z - p.z);
    const wheels = template.wheels.map(w => root.children[template.root.children.indexOf(w)]);
    root.position.set(x, .04, z); root.rotation.y = yaw; scene.add(root);
    city.cars.push({ root, wheels, x, z, yaw, speed: 0, spawn: { x, z, yaw } });
  }
  crowd = createCrowd(scene, characterAssets.citizen); character = createCharacter(characterAssets.player); scene.add(character.root);
  worldLife = createWorldLife(scene, characterAssets.citizen, campaign);
  const portraits = createNPCPortraits(renderer, worldLife.avatars);
  const resume = saved.position ?? placeById(campaign.data.rest);
  if (saved.loaded && resume && !nearbyColliders(resume.x, resume.z, 2).some(box => overlapsHeight(box, resume.y ?? 0) && circleHitsBox(resume.x, resume.z, .43, box))) {
    player.x = resume.x; player.z = resume.z; player.y = resume.y ?? 0;
    player.groundY = supportHeight(player.x, player.z, nearbyColliders(player.x, player.z, 2), player.y + .2);
  }
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
  const ctx = shadowCanvas.getContext('2d'), gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, '#00000099'); gradient.addColorStop(1, '#00000000'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false })); contactShadow.rotation.x = -Math.PI / 2; scene.add(contactShadow);
  ENCOUNTERS.forEach(encounter => encounter.positions.forEach(([x, z], i) => {
    const model = createDrone(); model.root.position.set(x, 3.1, z); scene.add(model.root);
    const id = `${encounter.id}-${i}`, dead = campaign.data.kills.includes(id); model.root.visible = !dead;
    drones.push({ ...model, id, group: encounter.id, homeX: x, homeZ: z, health: dead ? 0 : 100, dead, phase: i * 2.3, fireTimer: 2 + i * .5, engaged: false });
  }));
  hud = new HUD(city, campaign);
  input = new Input(canvas, { interact, reload, jump, climb: toggleClimb, fire: shoot, map: toggleMap, journal: toggleJournal, medkit: useMedkit, pause: togglePause, blur: () => { voice.stop(); if (state.started && !state.paused) setPause(true); }, audio: () => audio.init() });
  rpgUI = new RPGUI(campaign, { voice, portraits, mapView: city.mapView, position: () => player, open: openModal, close: closeMenus, notify: (text) => hud.notify(text), changed: campaignChanged, medkit: useMedkit, health: () => state.health, upgraded: () => { state.armor = campaign.maxArmor; }, travel: fastTravel, newStory });
  quality = input.touch ? 'low' : 'high'; $('quality').value = quality;
  setQuality(quality);
  setupUI(); updateCamera(.016, true); updateCharacter(.016);
  worldStream.update(camera, player, performance.now() / 1000, true);
  if (saved.loaded) $('start-button').innerHTML = 'CONTINUE YOUR STORY <span>↗</span>';
  renderer.compile(scene, camera);
  $('loading').style.opacity = '0'; setTimeout(() => $('loading').classList.add('hidden'), 500);
  lastFrame = performance.now(); frame(lastFrame);
  // Read-only diagnostics are exposed only in Vite's development mode.
  if (import.meta.env.DEV) window.__AFTERLIGHT__ = { snapshot: () => ({
    started: state.started, paused: state.paused, modal: state.modal, health: state.health, armor: state.armor, ammo: state.ammo, reloading: state.reloading,
    voice: voice.snapshot(), cast: Object.keys(worldLife.avatars), crowdArchetypes: crowd.archetypes,
    position: { x: player.x, y: player.y, z: player.z }, driving: driving ? { x: driving.x, z: driving.z, speed: driving.speed, yaw: driving.yaw } : null,
    traversal: { groundY: player.groundY, climb: player.climb && { mode: player.climb.mode, roofY: player.climb.roofY, phase: player.climb.phase, blocked: player.climb.blocked }, candidate: player.climbCandidate, nearby: nearbyColliders(player.x, player.z, 3) },
    yaw: cameraYaw, pitch: cameraPitch, fps, quality, touch: input.touch, drawCalls: renderer.info.render.calls,
    rendering: { triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, pixelRatio: renderer.getPixelRatio() },
    performance: { ...frameCosts, scale: resolution.scale, activeCrowd: crowd.active, streaming: { ...worldStream.stats }, blueprints: city.metropolis.blocks.size },
    city: { span: 11000, areaKm2: 121, districts: 16, coreBuildings: city.plan.buildings.length + 64, coreTrees: city.plan.trees.length, buildingTypes: 8 },
    character: { bones: character.bones.size, animations: Object.keys(character.clips), activeAnimation: character.animation, jumpPhase: player.jumpPhase, speed: player.speed, combatWeight: character.combatWeight, crowdCount: crowd.count, crowdDrawCalls: crowd.drawCalls, muzzle: character.muzzle.getWorldPosition(new THREE.Vector3()).toArray() },
    camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: camera.fov, aspect: camera.aspect },
    cars: city.cars.map(c => ({ x: c.x, z: c.z })), drones: drones.map(d => { const projected = d.root.position.clone().project(camera); return { x: d.root.position.x, y: d.root.position.y, z: d.root.position.z, health: d.health, dead: d.dead, screen: { x: projected.x, y: projected.y, z: projected.z } }; }),
    colliders: city.colliders, objective: objective(), campaign: structuredClone(campaign.data), interaction: worldLife.nearest(player)?.id ?? null, renderer: renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL',
  }) };
}

function setupUI() {
  $('start-button').addEventListener('click', start);
  $('help-button').addEventListener('click', () => setPause(true)); $('all-controls').addEventListener('click', () => setPause(true));
  $('resume-button').addEventListener('click', () => { closeMenus(); if (!state.started) start(); });
  $('respawn-button').addEventListener('click', () => { respawn(); closeMenus(); if (!state.started) start(); });
  $('map-button').addEventListener('click', toggleMap); $('close-map').addEventListener('click', toggleMap);
  $('journal-button').addEventListener('click', toggleJournal);
  $('medkit-button').addEventListener('click', () => { useMedkit(); canvas.focus(); });
  $('new-game-button').addEventListener('click', () => rpgUI.confirmNewStory());
  $('sound-button').addEventListener('click', () => {
    const enabled = audio.toggle(); const button = $('sound-button');
    button.setAttribute('aria-pressed', String(enabled)); button.setAttribute('aria-label', enabled ? 'Mute sound effects' : 'Enable sound effects');
    button.innerHTML = enabled ? '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6"/></svg>';
    if (state.started && !state.paused) canvas.focus();
  });
  $('quality').addEventListener('change', e => setQuality(e.target.value));
  $('sensitivity').addEventListener('input', e => { input.sensitivity = Number(e.target.value); });
  $('voice-enabled').addEventListener('change', e => voice.setEnabled(e.target.checked));
  $('voice-volume').addEventListener('input', e => voice.setVolume(Number(e.target.value) / 100));
  voice.subscribe(settings => {
    $('voice-enabled').checked = settings.enabled; $('voice-enabled').disabled = !settings.supported;
    $('voice-volume').value = Math.round(settings.volume * 100); $('voice-volume').disabled = !settings.supported;
    $('voice-volume-value').textContent = `${Math.round(settings.volume * 100)}%`;
    $('voice-settings-note').textContent = settings.supported ? 'Spoken dialogue uses your browser’s voices. Subtitles stay on. Sound effects have a separate speaker button.' : 'This browser has no speech service. All dialogue remains available as subtitles.';
  });
  window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); applyResolution(); });
  // Keep keyboard focus inside whichever game dialog is open.
  document.addEventListener('keydown', event => {
    if ((event.code === 'KeyM' && state.mapOpen) || (event.code === 'KeyJ' && state.modal === 'journal')) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) closeMenus(); return; }
    const dialog = state.modal ? $(state.modal) : null;
    if (event.key !== 'Tab' || !dialog) return;
    const elements = [...dialog.querySelectorAll('button:not(:disabled), select, input')]; const first = elements[0], last = elements.at(-1);
    if (!elements.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}
function start() {
  state.started = true; state.paused = false; document.body.classList.add('playing'); $('welcome').classList.add('hidden');
  input.setEnabled(true); audio.init();
  hud.notify(saved.warning ?? (saved.loaded ? 'WELCOME BACK // Your story continues. J for your field journal.' : 'MARA: Vex. Outside Kōji. We need to talk. // E to interact · J for your journal'), 7);
  saveProgress();
}
const modalIds = ['pause', 'city-map', 'journal', 'dialogue', 'service'];
function openModal(id) {
  voice.stop();
  state.paused = true; state.modal = id; state.mapOpen = id === 'city-map';
  input.setEnabled(false); audio.update(0, false); document.body.classList.add('menu-open');
  for (const modal of modalIds) $(modal)?.classList.toggle('hidden', modal !== id);
  $(id)?.querySelector('button:not(:disabled)')?.focus();
  if (state.started) saveProgress();
}
function setPause(paused) {
  if (!paused) { closeMenus(); return; }
  openModal('pause'); $('resume-button').focus();
}
function closeMenus() {
  voice.stop();
  state.paused = false; state.mapOpen = false; state.modal = null; document.body.classList.remove('menu-open');
  for (const modal of modalIds) $(modal)?.classList.add('hidden');
  input.setEnabled(state.started);
}
function togglePause() { if (state.paused) closeMenus(); else if (state.started) setPause(true); }
function toggleMap() {
  if (state.mapOpen) { closeMenus(); return; }
  city.mapView.x = player.x; city.mapView.z = player.z;
  openModal('city-map'); rpgUI.renderMap(); $('close-map').focus();
  hud.drawMap(player, cameraYaw, drones, objective(), true);
}
function toggleJournal() {
  if (!state.started) return;
  if (state.modal === 'journal') closeMenus(); else rpgUI.openJournal();
}
function setQuality(value) {
  quality = value;
  resolution.reset(); worldStream.setQuality(quality);
  if (quality === 'high' && !composer) {
    composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .31, .55, 1.03); composer.addPass(bloom); composer.addPass(new OutputPass());
  } else if (quality === 'low' && composer) {
    for (const pass of composer.passes) pass.dispose?.(); composer.dispose(); composer = bloom = null;
  }
  scene.fog.density = quality === 'high' ? .0048 : .007;
  camera.far = quality === 'high' ? 720 : 600; camera.updateProjectionMatrix();
  sky.scale.setScalar(camera.far / 700);
  city.rain.geometry.setDrawRange(0, RENDER_PROFILES[quality].rain * 2);
  applyResolution();
}
function applyResolution() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER_PROFILES[quality].dpr) * resolution.scale);
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); }
}
function nearbyColliders(x, z, radius = 8, exclude = null) {
  return city.spatial.near(x, z, radius).concat(city.cars.filter(c => c !== exclude && Math.hypot(c.x - x, c.z - z) < radius + 5).map(carCollider));
}

function objective() {
  return campaign.objective(player);
}
function saveProgress() {
  if (!state.started) return;
  campaign.data.elapsed = state.time;
  const position = driving ? findExitPosition(driving, nearbyColliders(driving.x, driving.z, 8, driving)) ?? placeById(campaign.data.rest) : player;
  const success = writeSave(storage, campaign.data, position);
  if ($('save-status')) $('save-status').textContent = success ? 'PROGRESS SAVED / THIS BROWSER' : 'SAVE UNAVAILABLE / THIS SESSION ONLY';
  if (!success && !saveWarningShown) { hud.notify('Browser storage is unavailable. Progress will last for this session only.', 7); saveWarningShown = true; }
  lastSavedAt = state.time; savedRevision = campaign.revision;
}
function campaignChanged() {
  const messages = campaign.messages.splice(0);
  if (messages.length) { hud.notify(messages.slice(-2).join('  /  '), 5); if (messages.some(m => m.startsWith('COMPLETED'))) audio.reward(); }
  if (state.started && savedRevision !== campaign.revision) saveProgress();
}
function useMedkit() {
  if (!state.started) return;
  const health = campaign.useMedkit(state.health);
  if (!health) { hud.notify(state.health >= 100 ? 'Your health is already full.' : 'No medkits. Visit Imani, Orrin or Rook for supplies.', 3); return; }
  state.health += health; audio.reward(); campaignChanged();
}
function newStory() {
  if (driving) driving.speed = 0;
  driving = null; campaign.data = freshProgress(); campaign.pin = null; campaign.messages = []; campaign.changed();
  for (const car of city.cars) { Object.assign(car, car.spawn, { speed: 0 }); car.root.position.set(car.x, .04, car.z); car.root.rotation.y = car.yaw; }
  for (const drone of drones) { drone.dead = false; drone.health = 100; drone.root.visible = true; drone.engaged = false; drone.fireTimer = 2; }
  state.time = 0; state.damageAt = -100; state.started = true; respawn(); player.x = -2.5; player.z = 30;
  closeMenus(); document.body.classList.add('playing'); $('welcome').classList.add('hidden'); updateCamera(.016, true);
  rpgUI.selectedQuest = 'dead-air'; rpgUI.tab = 'quests'; saveProgress();
  hud.notify('A NEW SIGNAL // Mara is waiting outside Kōji. Your story starts here.', 6);
}
function fastTravel(id) {
  if (!campaign.data.transit.includes(id)) return 'Discover this platform first.';
  if (driving) return 'Exit your vehicle before taking the tram.';
  if (state.time - state.damageAt < 10 || drones.some(d => !d.dead && d.engaged && Math.hypot(d.root.position.x - player.x, d.root.position.z - player.z) < 30)) return 'Lose the patrols and stay clear of combat for 10 seconds.';
  const stop = placeById(id);
  resetTraversal();
  player.x = stop.x; player.z = stop.z + 2; player.y = 0; player.vx = player.vz = player.speed = player.velocityY = 0; player.jumpPhase = '';
  state.time += 90; cameraYaw = 0; updateCharacter(.016); updateCamera(.016, true); input.clear();
  worldStream.update(camera, player, performance.now() / 1000, true);
  hud.notify(`NIGHT TRAM // ${stop.name}`, 4); saveProgress(); return true;
}
const terminalReplies = {
  trace: 'TRANSMISSION RECOVERED // “Vex. If you can hear this, the city has not forgotten you. Find the ledger. Find the names. — ECHO / 09”',
  archive: 'LEDGER COPIED // 8,412 identities marked for deletion. Authorization: HELIX CIVIC CONTINUITY. Sable needs to see this.',
  solar: 'SOLAR CAPACITOR RECOVERED // The reserve cell is charged. The greenhouse lights remain at full power.',
  'garden-relay': 'SUBSTATION CONNECTED // Broadcast circuit isolated. Clinic and garden power preserved. Jun will want to know.',
  blackbox: 'MEMORY CORE RECOVERED // “Passenger comfort: acceptable. Water temperature: unknown. I would like to see the morning.” Bring ECHO to Mara.',
  'breaker-west': 'WEST BREAKER ONLINE // An old circuit hums back to life.',
  'breaker-east': 'EAST BREAKER ONLINE // Both arrays are synchronized. Clear the patrol before connecting the Crown uplink.',
  uplink: 'CROWN UPLINK ONLINE // The whole city is within reach. Talk to Mara before you decide what to broadcast.',
  medicine: 'COLD CHAIN INTACT // Antibiotics secured. Return to Dr. Imani at the HALO clinic.',
  'valve-west': 'PRESSURE RESTORED // The western beds are receiving water.',
  'valve-east': 'IRRIGATION STABLE // Both lines are flowing. Report back to Jun.',
  parcel: 'DELIVERY RECEIVED // A paper message slips through the slot. Collect payment at the neighborhood job board.',
  'freight-manifest': 'MANIFEST RECOVERED // These “abandoned” crates belong to residents of the Neon Quarter. Return the records to Rook.',
};
function useWorldObject(place) {
  if (campaign.pin === place.id) campaign.pin = null;
  if (place.type === 'contact') rpgUI.openContact(place.id);
  else if (place.type === 'cache' || place.type === 'memory') {
    if (campaign.collect(place.id) && place.type === 'memory') rpgUI.openMemory(place.id);
  } else if (place.type === 'transit') { campaign.unlockTransit(place.id); rpgUI.selectedPlace = place.id; toggleMap(); }
  else if (place.type === 'rest') { campaign.data.rest = place.id; campaign.changed(); state.health = 100; state.armor = campaign.maxArmor; state.ammo = 24; state.reloading = 0; hud.notify('REFUGE // Health, armor and ammo restored. Progress saved.', 5); }
  else if (place.type === 'board') { campaign.event('interact', 'board'); rpgUI.openBoard(); }
  else if (place.id === 'uplink' && campaign.current('before-dawn')?.type === 'choice') rpgUI.openEnding();
  else {
    const relevant = campaign.activeSteps().some(({ step }) => step.type === 'interact' && step.target === place.id);
    if (relevant) { campaign.event('interact', place.id); audio.reward(); }
    rpgUI.showTerminal(place, relevant ? terminalReplies[place.id] ?? 'Data recovered. Your journal has been updated.' : `${place.description}\n\nNo active task requires this terminal. Speak to local contacts or check your journal.`);
  }
  campaignChanged();
}

function interact() {
  if (!state.started || state.paused) return;
  if (player.climb) return;
  if (driving) {
    if (Math.abs(driving.speed) > 7) { hud.notify('Slow down before exiting the vehicle.', 2); return; }
    const others = nearbyColliders(driving.x, driving.z, 8, driving);
    const exit = findExitPosition(driving, others);
    if (!exit) { hud.notify('Both doors are blocked. Move the car into the street.', 3); return; }
    resetTraversal();
    player.x = exit.x; player.z = exit.z; player.y = 0; player.velocityY = 0; player.yaw = driving.yaw;
    driving.speed = 0; driving = null; character.root.visible = true; state.cooldown = .3;
    player.vx = player.vz = player.speed = 0; player.jumpPhase = '';
    hud.notify(input.touch ? 'Weapon ready. Aim with the right side; tap the crosshair to fire.' : 'Back on foot. Left click to fire. Right click to aim.', 3);
  } else {
    const place = worldLife.nearest(player);
    if (place) { useWorldObject(place); return; }
    nearestCar = findNearestCar(); if (!nearestCar) { hud.notify('Approach a person, glowing terminal, cache or vehicle. E to interact.', 3); return; }
    resetTraversal();
    driving = nearestCar; driving.speed = 0; player.x = driving.x; player.z = driving.z; player.y = 0; player.velocityY = 0;
    player.vx = player.vz = player.speed = 0; player.jumpPhase = '';
    cameraYaw = driving.yaw; cameraPitch = .22; character.root.visible = false;
    hud.notify('ARCHER GT // WASD to drive. Space to handbrake. E to exit.', 3);
  }
  input.firing = false; input.aiming = false;
}
function findNearestCar() {
  if (player.y > 1.1 || player.climb) return null;
  let best = null, distance = 4.5;
  for (const car of city.cars) { const d = Math.hypot(player.x - car.x, player.z - car.z); if (d < distance) { best = car; distance = d; } }
  return best;
}
function jump() {
  if (driving || !state.started || state.paused) return;
  if (player.climb) { dropClimb(player, true); return; }
  if (!grabWall(true)) beginJump(player);
}
function grabWall(requireFacing = false) {
  const boxes = nearbyColliders(player.x, player.z, 3);
  if (!startClimb(player, findClimbFace(player, boxes, cameraYaw, requireFacing), boxes)) return false;
  cameraYaw = player.yaw; cameraPitch = .05;
  input.firing = input.aiming = false; state.reloading = 0;
  return true;
}
function toggleClimb() {
  if (driving || !state.started || state.paused) return;
  if (player.climb) dropClimb(player);
  else if (!grabWall()) hud.notify('Move within arm’s reach of a building wall to climb.', 2);
}
function resetTraversal() {
  player.climb = player.climbCandidate = null; player.groundY = player.pushTime = 0;
}
function reload() {
  if (driving || player.climb || state.reloading > 0 || state.ammo === 24) return;
  state.reloading = character.clips.Reload.duration; input.firing = false; audio.reload();
}
function respawn() {
  if (driving) driving.speed = 0;
  resetTraversal();
  const refuge = placeById(campaign.data.rest);
  driving = null; player.x = refuge.x; player.z = refuge.z - 2; player.y = 0; player.velocityY = 0; player.yaw = 0;
  player.vx = player.vz = player.speed = 0; player.jumpPhase = ''; player.jumpTime = 0;
  cameraYaw = -.025; cameraPitch = .19; state.health = 100; state.armor = campaign.maxArmor; state.ammo = 24; state.reloading = 0; state.cooldown = .5; state.damageAt = -100;
  for (const drone of drones) { drone.engaged = false; drone.root.position.set(drone.homeX, 3, drone.homeZ); }
  character.root.visible = true; input.clear(); updateCamera(.016, true);
  worldStream.update(camera, player, performance.now() / 1000, true);
  hud.notify(`BACK ON YOUR FEET // ${refuge.name}. Your story progress is safe.`, 4); saveProgress();
}

function tracer(start, end, color = 0xeeffab, ttl = .065) {
  const geometry = new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: .95, depthWrite: false });
  const line = new THREE.Line(geometry, mat); scene.add(line); effects.push({ mesh: line, life: ttl, max: ttl });
}
function sparks(position, color, count = 9) {
  const geometry = new THREE.BufferGeometry(), vertices = new Float32Array(count * 3), velocities = [];
  for (let i = 0; i < count; i++) { vertices.set([position.x, position.y, position.z], i * 3); velocities.push(new THREE.Vector3((Math.random() - .5) * 10, Math.random() * 6, (Math.random() - .5) * 10)); }
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  const mesh = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: .09, transparent: true, depthWrite: false }));
  scene.add(mesh); effects.push({ mesh, life: .5, max: .5, velocities });
}
function damageDrone(drone, amount) {
  drone.health -= amount; drone.engaged = true; hitUntil = state.time + .13; audio.hit();
  sparks(drone.root.position, 0xffb37f, 6);
  if (drone.health <= 0 && !drone.dead) {
    drone.dead = true; drone.root.visible = false; audio.explosion();
    sparks(drone.root.position, 0xff8c6f, 28); campaign.recordKill(drone.id, drone.group); campaignChanged();
  }
}
function shoot() {
  if (!state.started || state.paused || driving || player.climb || state.cooldown > 0 || state.reloading > 0) return;
  if (state.ammo === 0) { reload(); return; }
  state.ammo--; state.cooldown = .2; shotRecoil = 1; character.flash.visible = true; characterShot(character); audio.shot();
  raycaster.setFromCamera(new THREE.Vector2(0, .02), camera); const ray = raycaster.ray;
  let hitDistance = Math.min(150, rayObstructionDistance(ray.origin, ray.direction, 150, city.spatial, city.cars)), hitDrone = null;
  for (const drone of drones) {
    if (drone.dead) continue;
    droneSphere.center.copy(drone.root.position);
    if (ray.intersectSphere(droneSphere, tempPoint)) {
      const distance = tempPoint.distanceTo(ray.origin);
      if (distance < hitDistance) { hitDistance = distance; hitDrone = drone; }
    }
  }
  // A small touch aim assist compensates for thumbs obscuring a tiny distant target.
  if (!hitDrone && input.touch) {
    for (const drone of drones) {
      if (drone.dead) continue;
      vector.copy(drone.root.position).project(camera);
      const distance = drone.root.position.distanceTo(ray.origin);
      if (vector.z < 1 && Math.hypot(vector.x, vector.y - .02) < .11 && distance < hitDistance) {
        direction.subVectors(drone.root.position, ray.origin).normalize();
        if (rayObstructionDistance(ray.origin, direction, distance, city.spatial, city.cars) === Infinity) { hitDrone = drone; hitDistance = distance; break; }
      }
    }
  }
  const endpoint = hitDrone ? hitDrone.root.position.clone() : ray.at(hitDistance, new THREE.Vector3());
  character.muzzle.getWorldPosition(muzzlePoint);
  direction.subVectors(endpoint, muzzlePoint); const length = direction.length(); direction.normalize();
  const muzzleBlock = rayObstructionDistance(muzzlePoint, direction, length, city.spatial, city.cars);
  if (muzzleBlock < length - .1) { endpoint.copy(muzzlePoint).addScaledVector(direction, muzzleBlock); hitDrone = null; }
  tracer(muzzlePoint, endpoint);
  if (hitDrone) damageDrone(hitDrone, campaign.damage); else if (hitDistance < 150 || muzzleBlock < length) sparks(endpoint, 0xf9e8b7, 5);
}

function updatePlayer(dt) {
  const axes = input.axes(), look = input.look();
  cameraYaw -= look.x; cameraPitch = clamp(cameraPitch + look.y, -.65, 1.03);
  if (driving) {
    const delta = stepVehicle(driving, axes.y, axes.x, input.keys.has('Space'), dt);
    const previousSpeed = driving.speed;
    const colliders = nearbyColliders(driving.x, driving.z, 6, driving);
    const collision = moveWithCollisions(driving, delta.x, delta.z, 1.6, colliders);
    if (collision) {
      driving.speed *= -.14;
      if (Math.abs(previousSpeed) > 14 && state.time - state.damageAt > .7) damagePlayer(Math.min(16, Math.abs(previousSpeed) * .3));
    }
    driving.root.position.set(driving.x, .04 + Math.sin(state.time * 35) * Math.abs(driving.speed) * .0005, driving.z);
    driving.root.rotation.y = driving.yaw;
    for (const wheel of driving.wheels) wheel.rotation.x -= driving.speed * dt / .44;
    player.x = driving.x; player.z = driving.z; player.yaw = driving.yaw;
    if (Math.abs(look.x) < .001 && Math.abs(driving.speed) > 1.8) cameraYaw += angleDelta(cameraYaw, driving.yaw) * (1 - Math.exp(-2.1 * dt));
    audio.update(driving.speed, !state.paused);
    for (const drone of drones) if (!drone.dead && drone.root.position.distanceTo(driving.root.position) < 3.5 && Math.abs(driving.speed) > 9) damageDrone(drone, 100);
  } else {
    const amount = Math.hypot(axes.x, axes.y);
    const sprint = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') || (input.touch && amount > .9);
    const colliders = nearbyColliders(player.x, player.z, 3);
    if (player.climb) {
      const result = stepClimb(player, axes, dt, colliders, sprint);
      if (result === 'roof') { hud.notify('ROOFTOP // Keep exploring. Space to jump; C to grab another wall.', 3); saveProgress(); }
    } else {
      const walk = input.keys.has('AltLeft') || input.keys.has('AltRight');
      const delta = footVelocity(player, axes, cameraYaw, dt, { sprint, walk, aiming: input.aiming, sprintSpeed: campaign.sprintSpeed });
      if (player.pushTime > 0) { player.pushTime -= dt; delta.x = player.pushVX * dt; delta.z = player.pushVZ * dt; }
      const beforeX = player.x, beforeZ = player.z;
      moveWithCollisions(player, delta.x, delta.z, .43, colliders);
      player.speed = Math.hypot(player.x - beforeX, player.z - beforeZ) / dt;
      if (amount > .08 && !input.aiming && !input.firing) player.yaw += angleDelta(player.yaw, Math.atan2(-delta.x, -delta.z)) * (1 - Math.exp(-MOVEMENT.turn * dt));
      if (input.aiming || input.firing) player.yaw += angleDelta(player.yaw, cameraYaw) * (1 - Math.exp(-MOVEMENT.turn * dt));
      const groundY = supportHeight(player.x, player.z, nearbyColliders(player.x, player.z, 2), player.y + .25);
      stepJump(player, dt, groundY);
    }
    player.climbCandidate = player.climb ? null : findClimbFace(player, colliders);
    updateCharacter(dt); audio.update(0, false);
    if (input.firing) shoot();
    nearestCar = findNearestCar();
  }
  if (state.reloading > 0) { state.reloading -= dt; if (state.reloading <= 0) { state.reloading = 0; state.ammo = 24; audio.tone(670, .08, 'triangle', .15); } }
  state.cooldown = Math.max(0, state.cooldown - dt);
  if (state.time - state.damageAt > 7) {
    state.armor = Math.min(campaign.maxArmor, state.armor + dt * 5); state.health = Math.min(100, state.health + dt * 1.8);
  }
  const district = districtAt(player.x, player.z);
  if (campaign.discover(district.id)) rpgUI.announceDistrict(district);
  if (!driving && player.y < 2) for (const place of WORLD_OBJECTS) if (place.type === 'transit' && Math.hypot(player.x - place.x, player.z - place.z) < 6) campaign.unlockTransit(place.id);
  campaignChanged();
  if (state.time - lastSavedAt > 12) saveProgress();
}

function updateCharacter(dt) {
  character.root.position.set(player.x, player.y + .05, player.z); character.root.rotation.y = player.yaw;
  const height = Math.max(0, player.y - player.groundY);
  animateCharacter(character, input?.aiming || input?.firing, dt, { speed: player.speed, climb: player.climb, jumpPhase: player.jumpPhase, jumpTime: player.jumpTime, height, groundHeight: player.groundY, verticalSpeed: player.velocityY, pitch: cameraPitch, reloading: state.reloading });
  contactShadow.position.set(player.x, player.groundY + .03, player.z); contactShadow.visible = !driving && !player.climb; contactShadow.material.opacity = 1 / (1 + height * .5);
}

function updateCamera(dt, snap = false) {
  const aiming = !driving && !player.climb && input?.aiming;
  const distance = driving ? 10.4 : aiming ? 3.3 : 5.9;
  const targetHeight = driving ? 1.45 : 1.35;
  cameraTarget.set(player.x, player.y + targetHeight, player.z);
  const shoulder = driving ? .35 : aiming ? .8 : .68;
  cameraTarget.x += Math.cos(cameraYaw) * shoulder; cameraTarget.z -= Math.sin(cameraYaw) * shoulder;
  desiredCamera.set(cameraTarget.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * distance, cameraTarget.y + Math.sin(cameraPitch) * distance + .5, cameraTarget.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * distance);
  // Prevent the follow camera from clipping through nearby buildings.
  direction.subVectors(desiredCamera, cameraTarget); const length = direction.length(); direction.normalize();
  let obstruction = length;
  for (const box of city.spatial.along(cameraTarget, direction, length)) obstruction = Math.min(obstruction, rayBoxDistance(cameraTarget, direction, { ...box, w: box.w === undefined ? undefined : box.w + .5, d: box.d === undefined ? undefined : box.d + .5, minX: box.minX - .25, maxX: box.maxX + .25, minZ: box.minZ - .25, maxZ: box.maxZ + .25 }, length));
  if (obstruction < length) desiredCamera.copy(cameraTarget).addScaledVector(direction, Math.max(.6, obstruction - .35));
  if (snap) camera.position.copy(desiredCamera); else camera.position.lerp(desiredCamera, 1 - Math.exp(-12 * dt));
  const groundCorrection = Math.max(0, .55 - camera.position.y);
  camera.position.y += groundCorrection;
  camera.lookAt(cameraTarget.x, cameraTarget.y + groundCorrection + shotRecoil * .045, cameraTarget.z);
  camera.fov = damp(camera.fov, aiming ? 48 : driving ? 66 + Math.abs(driving.speed) * .16 : 62, 8, dt); camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  character.root.visible = !driving && camera.position.distanceTo(character.root.position) > 1.5;
}

function damagePlayer(amount) {
  state.damageAt = state.time;
  const absorbed = Math.min(state.armor, amount); state.armor -= absorbed; state.health = Math.max(0, state.health - (amount - absorbed));
  damageFlashUntil = state.time + .19; audio.tone(100, .09, 'triangle', .24, 40);
  if (state.health <= 0) { respawn(); hud.notify('SIGNAL RECOVERED // You were brought back to your last refuge.', 5); }
}

function updateDrones(dt) {
  const targetPosition = new THREE.Vector3(player.x, player.y + (driving ? 1.1 : 1.4), player.z);
  for (const drone of drones) {
    if (drone.dead) continue;
    drone.phase += dt; const pos = drone.root.position;
    const distance = pos.distanceTo(targetPosition); const awake = state.started && !state.paused && campaign.data.ending !== 'order' && distance < 24;
    drone.root.visible = distance < RENDER_PROFILES[quality].actors + 30;
    if (!drone.root.visible) { drone.engaged = false; continue; }
    // Patrols defend their own streets; they cannot follow a runner across the entire city.
    if (Math.hypot(player.x - drone.homeX, player.z - drone.homeZ) > 42 || campaign.data.ending === 'order') drone.engaged = false;
    const targetX = awake && drone.engaged ? player.x + Math.sin(drone.phase * .7) * 9 : drone.homeX + Math.sin(drone.phase * .35) * 2.6;
    const targetZ = awake && drone.engaged ? player.z - 10 + Math.cos(drone.phase * .6) * 3 : drone.homeZ + Math.cos(drone.phase * .32) * 2.7;
    const moveX = damp(pos.x, targetX, .55, dt) - pos.x, moveZ = damp(pos.z, targetZ, .55, dt) - pos.z;
    moveWithCollisions(pos, moveX, moveZ, .9, city.spatial);
    pos.y = 2.9 + Math.sin(drone.phase * 1.8) * .35;
    drone.root.rotation.y = awake ? Math.atan2(-(player.x - pos.x), -(player.z - pos.z)) : drone.phase * .3;
    drone.root.rotation.z = Math.sin(drone.phase * 1.2) * .045;
    for (const rotor of drone.rotors) rotor.rotation.y += dt * 42;
    if (awake) {
      drone.fireTimer -= dt;
      if (drone.fireTimer <= 0) {
        drone.fireTimer = 2.1 + Math.random() * .6;
        direction.subVectors(targetPosition, pos).normalize();
        const visible = rayObstructionDistance(pos, direction, distance, city.spatial, city.cars, driving) === Infinity;
        if (visible) { drone.engaged = true; tracer(pos, targetPosition, 0xff4967, .13); damagePlayer(driving ? 3 : 6); }
      }
    }
  }
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i]; effect.life -= dt;
    if (effect.life <= 0) { scene.remove(effect.mesh); effect.mesh.geometry.dispose(); effect.mesh.material.dispose(); effects.splice(i, 1); continue; }
    effect.mesh.material.opacity = effect.life / effect.max;
    if (effect.velocities) {
      const attr = effect.mesh.geometry.attributes.position;
      effect.velocities.forEach((velocity, j) => { velocity.y -= dt * 12; attr.setXYZ(j, attr.getX(j) + velocity.x * dt, attr.getY(j) + velocity.y * dt, attr.getZ(j) + velocity.z * dt); }); attr.needsUpdate = true;
    }
  }
  shotRecoil = Math.max(0, shotRecoil - dt * 12); if (shotRecoil < .5) character.flash.visible = false;
  $('damage-flash').style.opacity = state.time < damageFlashUntil ? '.35' : '0'; $('hitmarker').style.opacity = state.time < hitUntil ? '1' : '0';
}

function updateWeather(dt) {
  const positions = city.rain.geometry.attributes.position;
  for (let i = 0; i < city.rain.geometry.drawRange.count; i += 2) {
    let y = positions.getY(i) - dt * 15; if (y < 0) y = 37;
    positions.setY(i, y); positions.setY(i + 1, y + .52);
  }
  positions.needsUpdate = true; city.rain.position.set(player.x, 0, player.z); city.motes.position.set(player.x, 0, player.z); city.motes.rotation.y += dt * .012;
}

function frame(now) {
  animationId = requestAnimationFrame(frame);
  if (document.hidden) { lastFrame = now; return; }
  const updateStart = performance.now();
  const rawDt = (now - lastFrame) / 1000; const dt = Math.min(Math.max(rawDt, .001), .05); lastFrame = now;
  fps = damp(fps, Math.min(144, 1 / Math.max(rawDt, .001)), 2, dt);
  if (!state.paused) {
    state.time += dt;
    if (state.started) updatePlayer(dt);
    if (!state.started) updateCharacter(dt);
    updateCamera(dt); updateDrones(dt); updateEffects(dt); updateWeather(dt); crowd.update(dt, player, camera, RENDER_PROFILES[quality].actors); worldLife.update(dt, state.time, player, RENDER_PROFILES[quality].actors, camera);
  }
  sky.position.copy(camera.position);
  worldStream.update(camera, player, now / 1000);
  for (const car of city.cars) {
    car.root.visible = car === driving || Math.hypot(player.x - car.x, player.z - car.z) < 135;
    if (car.root.visible && !car.root.parent) scene.add(car.root);
    if (!car.root.visible && car.root.parent) scene.remove(car.root);
  }
  const goal = objective(); hud.waypoint(camera, goal, player, vector, state.started && !state.paused);
  $('crosshair').classList.toggle('aim', !!input.aiming);
  if (now - lastUI > 85) {
    hud.update(state, player, driving, nearestCar, goal, fps, worldLife.nearest(player)); hud.drawMap(player, cameraYaw, drones, goal);
    if (state.mapOpen) hud.drawMap(player, cameraYaw, drones, goal, true);
    const minute = 48 + Math.floor(state.time / 45); $('game-time').textContent = `${String((23 + Math.floor(minute / 60)) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    lastUI = now;
  }
  renderer.info.reset();
  frameCosts.updateMs = damp(frameCosts.updateMs, performance.now() - updateStart, 3, dt);
  const renderStart = performance.now();
  if (quality === 'high') composer.render(); else renderer.render(scene, camera);
  frameCosts.renderMs = damp(frameCosts.renderMs, performance.now() - renderStart, 3, dt);
  if (!state.paused && document.hasFocus() && !worldStream.stats.queued && resolution.sample(rawDt, RENDER_PROFILES[quality].minScale)) applyResolution();
}

init().catch(showError);
document.addEventListener('visibilitychange', () => { if (document.hidden) voice.stop(); });
window.addEventListener('pagehide', () => { voice.stop(); saveProgress(); if (animationId) cancelAnimationFrame(animationId); });
window.addEventListener('pageshow', event => { if (event.persisted) { lastFrame = performance.now(); frame(lastFrame); } });
