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
import { clamp, damp, angleDelta, moveWithCollisions, findExitPosition, stepVehicle, rayBoxDistance } from './physics.js';

const $ = id => document.getElementById(id);
const canvas = $('world');
const state = { started: false, paused: false, mapOpen: false, health: 100, armor: 50, ammo: 24, reloading: 0, cooldown: 0, credits: 1250, cred: 0, stage: 0, kills: 0, damageAt: -100, time: 0 };
const player = { x: -2.5, y: 0, z: 30, yaw: 0, velocityY: 0, vx: 0, vz: 0, speed: 0, jumpPhase: '', jumpTime: 0, jumpElapsed: 0, launched: false };
let renderer, composer, bloom, city, character, hud, input, scene, camera, crowd;
let driving = null, nearestCar = null, quality = 'high', animationId;
let cameraYaw = -.025, cameraPitch = .19, fps = 60, lastFrame = performance.now(), lastUI = 0, shotRecoil = 0;
const audio = new GameAudio(), drones = [], effects = [];
const raycaster = new THREE.Raycaster(), vector = new THREE.Vector3(), direction = new THREE.Vector3(), cameraTarget = new THREE.Vector3(), desiredCamera = new THREE.Vector3();
const tempPoint = new THREE.Vector3(), muzzlePoint = new THREE.Vector3(), droneSphere = new THREE.Sphere(new THREE.Vector3(), 1.02);
const weaponRay = new THREE.Ray();
let checkpoint, checkpointRing, contactShadow, damageFlashUntil = 0, hitUntil = 0;

function showError(error) {
  console.error(error); $('loading').classList.add('hidden'); $('error').classList.remove('hidden');
  $('error-message').textContent = error?.message?.includes('WebGL') ? 'This city needs WebGL 2. Enable hardware acceleration or open it in a recent version of Chrome, Edge, Firefox, or Safari.' : `The city could not start: ${error.message || error}`;
}

async function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x1b2940, .0068);
  addSky(scene);
  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .12, 530);
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
  city = createCity(scene); crowd = createCrowd(scene, characterAssets.citizen); character = createCharacter(characterAssets.player); scene.add(character.root);
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
  const ctx = shadowCanvas.getContext('2d'), gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, '#00000099'); gradient.addColorStop(1, '#00000000'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false })); contactShadow.rotation.x = -Math.PI / 2; scene.add(contactShadow);
  [[-3, -81], [5, -92], [-5, -103], [70, 4], [-60, -30], [13, 85]].forEach(([x, z], i) => {
    const model = createDrone(); model.root.position.set(x, 3.1, z); scene.add(model.root);
    drones.push({ ...model, homeX: x, homeZ: z, health: 100, dead: false, respawn: 0, phase: i * 2.3, fireTimer: 2 + i * .5, engaged: false });
  });
  checkpoint = new THREE.Group(); checkpoint.position.set(0, .1, -65); scene.add(checkpoint);
  checkpointRing = new THREE.Mesh(new THREE.TorusGeometry(4.7, .055, 6, 60), new THREE.MeshBasicMaterial({ color: 0xdfff84, transparent: true, opacity: .8 })); checkpointRing.rotation.x = Math.PI / 2; checkpoint.add(checkpointRing);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, 16, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xdfff9b, transparent: true, opacity: .25, depthWrite: false })); beam.position.y = 8; checkpoint.add(beam);
  checkpoint.visible = false;
  hud = new HUD(city);
  input = new Input(canvas, { interact, reload, jump, fire: shoot, map: toggleMap, pause: togglePause, blur: () => { if (state.started && !state.paused) setPause(true); }, audio: () => audio.init() });
  quality = input.touch ? 'low' : 'high'; $('quality').value = quality;
  composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .31, .55, 1.03); composer.addPass(bloom); composer.addPass(new OutputPass());
  setQuality(quality);
  setupUI(); updateCamera(.016, true); updateCharacter(.016);
  renderer.compile(scene, camera);
  $('loading').style.opacity = '0'; setTimeout(() => $('loading').classList.add('hidden'), 500);
  lastFrame = performance.now(); frame(lastFrame);
  // Read-only diagnostics are exposed only in Vite's development mode.
  if (import.meta.env.DEV) window.__AFTERLIGHT__ = { snapshot: () => ({
    started: state.started, paused: state.paused, stage: state.stage, kills: state.kills, health: state.health, armor: state.armor, ammo: state.ammo, reloading: state.reloading,
    position: { x: player.x, y: player.y, z: player.z }, driving: driving ? { x: driving.x, z: driving.z, speed: driving.speed, yaw: driving.yaw } : null,
    yaw: cameraYaw, pitch: cameraPitch, fps, quality, touch: input.touch, drawCalls: renderer.info.render.calls,
    character: { bones: character.bones.size, animations: Object.keys(character.clips), activeAnimation: character.animation, jumpPhase: player.jumpPhase, speed: player.speed, combatWeight: character.combatWeight, crowdCount: crowd.count, crowdDrawCalls: crowd.drawCalls, muzzle: character.muzzle.getWorldPosition(new THREE.Vector3()).toArray() },
    camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: camera.fov, aspect: camera.aspect },
    cars: city.cars.map(c => ({ x: c.x, z: c.z })), drones: drones.map(d => { const projected = d.root.position.clone().project(camera); return { x: d.root.position.x, y: d.root.position.y, z: d.root.position.z, health: d.health, dead: d.dead, screen: { x: projected.x, y: projected.y, z: projected.z } }; }),
    colliders: city.colliders, objective: objective(), renderer: renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL',
  }) };
}

function setupUI() {
  $('start-button').addEventListener('click', start);
  $('help-button').addEventListener('click', () => setPause(true)); $('all-controls').addEventListener('click', () => setPause(true));
  $('resume-button').addEventListener('click', () => { if (!state.started) { closeMenus(); start(); } else { closeMenus(); input.lock(); } });
  $('respawn-button').addEventListener('click', () => { respawn(); closeMenus(); if (!state.started) start(); });
  $('map-button').addEventListener('click', toggleMap); $('close-map').addEventListener('click', toggleMap);
  $('sound-button').addEventListener('click', () => {
    const enabled = audio.toggle(); const button = $('sound-button');
    button.setAttribute('aria-pressed', String(enabled)); button.setAttribute('aria-label', enabled ? 'Mute sound' : 'Enable sound');
    button.innerHTML = enabled ? '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6"/></svg>';
    if (state.started && !state.paused) canvas.focus();
  });
  $('quality').addEventListener('change', e => setQuality(e.target.value));
  $('sensitivity').addEventListener('input', e => { input.sensitivity = Number(e.target.value); });
  window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });
  // Keep keyboard focus inside whichever game dialog is open.
  document.addEventListener('keydown', event => {
    if (event.code === 'KeyM' && state.mapOpen) { event.preventDefault(); toggleMap(); return; }
    const dialog = !$('pause').classList.contains('hidden') ? $('pause') : !$('city-map').classList.contains('hidden') ? $('city-map') : null;
    if (event.key !== 'Tab' || !dialog) return;
    const elements = [...dialog.querySelectorAll('button, select, input')]; const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}
function start() {
  state.started = true; state.paused = false; document.body.classList.add('playing'); $('welcome').classList.add('hidden');
  input.setEnabled(true); audio.init(); canvas.tabIndex = 0; canvas.focus();
  if (!input.touch) input.lock();
  hud.notify(input.touch ? 'Drag the right side to look. Use the left stick to move.' : 'Welcome, Vex. E to take a car. Click to fire. Esc for controls.', 5);
}
function setPause(paused) {
  if (!paused) { closeMenus(); return; }
  state.paused = true; state.mapOpen = false; input.setEnabled(false); audio.update(0, false);
  $('city-map').classList.add('hidden'); $('pause').classList.remove('hidden'); $('resume-button').focus();
}
function closeMenus() {
  state.paused = false; state.mapOpen = false; $('pause').classList.add('hidden'); $('city-map').classList.add('hidden');
  input.setEnabled(state.started); if (state.started) canvas.focus();
}
function togglePause() { if (state.paused) closeMenus(); else if (state.started) setPause(true); }
function toggleMap() {
  if (state.mapOpen) { closeMenus(); return; }
  state.mapOpen = true; state.paused = true; input.setEnabled(false); audio.update(0, false);
  $('pause').classList.add('hidden'); $('city-map').classList.remove('hidden'); $('close-map').focus();
  hud.drawMap(player, cameraYaw, drones, objective(), true);
}
function setQuality(value) {
  quality = value;
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1));
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); }
  if (city) city.rain.geometry.setDrawRange(0, quality === 'high' ? 2200 : 700);
}

function objective() {
  if (state.stage === 0) { const car = city.cars[0]; return { x: car.x, z: car.z, y: 3.6, label: 'ARCHER GT' }; }
  if (state.stage === 1) return { x: 0, z: -65, y: 4.8, label: 'NORTH EXCHANGE' };
  if (state.stage === 2) {
    const d = drones.slice(0, 3).filter(d => !d.dead).sort((a, b) => a.root.position.distanceToSquared(character.root.position) - b.root.position.distanceToSquared(character.root.position))[0];
    return d ? { x: d.root.position.x, z: d.root.position.z, y: d.root.position.y + 2, label: 'ROGUE SECURITY' } : { x: 0, z: -90, label: 'NORTH EXCHANGE' };
  }
  return { x: 0, z: 0, label: 'EXPLORE', hidden: true };
}
function advanceMission() {
  if (state.stage >= 3) return;
  state.stage++; state.cred += 250; state.credits += 250; audio.reward();
  const messages = ['', 'Nice ride. Head north to the Exchange. +250 street cred', 'You made it. Exit the car and take out 3 rogue drones. +250 street cred', 'CONTRACT COMPLETE // +250 street cred. The city is yours.'];
  hud.notify(messages[state.stage], 6); checkpoint.visible = state.stage === 1;
}

function interact() {
  if (driving) {
    if (Math.abs(driving.speed) > 7) { hud.notify('Slow down before exiting the vehicle.', 2); return; }
    const others = city.colliders.concat(city.cars.filter(c => c !== driving).map(carCollider));
    const exit = findExitPosition(driving, others);
    if (!exit) { hud.notify('Both doors are blocked. Move the car into the street.', 3); return; }
    player.x = exit.x; player.z = exit.z; player.y = 0; player.velocityY = 0; player.yaw = driving.yaw;
    driving.speed = 0; driving = null; character.root.visible = true; state.cooldown = .3;
    player.vx = player.vz = player.speed = 0; player.jumpPhase = '';
    hud.notify(input.touch ? 'Weapon ready. Aim with the right side; tap the crosshair to fire.' : 'Back on foot. Left click to fire. Right click to aim.', 3);
  } else {
    nearestCar = findNearestCar(); if (!nearestCar) { hud.notify('Get closer to a vehicle to take the wheel.', 2); return; }
    driving = nearestCar; driving.speed = 0; player.x = driving.x; player.z = driving.z; player.y = 0; player.velocityY = 0;
    player.vx = player.vz = player.speed = 0; player.jumpPhase = '';
    cameraYaw = driving.yaw; cameraPitch = .22; character.root.visible = false;
    if (state.stage === 0) advanceMission(); else hud.notify('ARCHER GT // WASD to drive. Space to handbrake.', 3);
  }
  input.firing = false; input.aiming = false;
}
function findNearestCar() {
  let best = null, distance = 4.5;
  for (const car of city.cars) { const d = Math.hypot(player.x - car.x, player.z - car.z); if (d < distance) { best = car; distance = d; } }
  return best;
}
function carCollider(car) {
  const sx = Math.abs(Math.cos(car.yaw)) * 1.17 + Math.abs(Math.sin(car.yaw)) * 2.37;
  const sz = Math.abs(Math.sin(car.yaw)) * 1.17 + Math.abs(Math.cos(car.yaw)) * 2.37;
  return { minX: car.x - sx, maxX: car.x + sx, minZ: car.z - sz, maxZ: car.z + sz, maxY: 1.85 };
}
function jump() {
  if (!driving) beginJump(player);
}
function reload() {
  if (driving || state.reloading > 0 || state.ammo === 24) return;
  state.reloading = character.clips.Reload.duration; input.firing = false; audio.reload();
}
function respawn() {
  if (driving) driving.speed = 0;
  driving = null; player.x = -2.5; player.z = 30; player.y = 0; player.velocityY = 0; player.yaw = 0;
  player.vx = player.vz = player.speed = 0; player.jumpPhase = ''; player.jumpTime = 0;
  cameraYaw = -.025; cameraPitch = .19; state.health = 100; state.armor = 50; state.ammo = 24; state.reloading = 0; state.cooldown = .5;
  character.root.visible = true; input.clear(); updateCamera(.016, true);
  hud.notify('Back on your feet. Health, armor, and ammo restored.', 4);
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
    drone.dead = true; drone.respawn = 55; drone.root.visible = false; audio.explosion();
    sparks(drone.root.position, 0xff8c6f, 28); state.credits += 75; state.cred += 25;
    if (state.stage === 2) { state.kills++; if (state.kills >= 3) advanceMission(); else hud.notify(`ROGUE DISABLED // ${state.kills}/3 · +75 credits`, 2); }
    else hud.notify('ROGUE DISABLED // +75 credits', 2);
  }
}
function shoot() {
  if (driving || state.cooldown > 0 || state.reloading > 0) return;
  if (state.ammo === 0) { reload(); return; }
  state.ammo--; state.cooldown = .2; shotRecoil = 1; character.flash.visible = true; characterShot(character); audio.shot();
  raycaster.setFromCamera(new THREE.Vector2(0, .02), camera); const ray = raycaster.ray;
  let hitDistance = 150, hitDrone = null;
  for (const box of city.colliders) hitDistance = Math.min(hitDistance, rayBoxDistance(ray.origin, ray.direction, box, hitDistance));
  for (const car of city.cars) hitDistance = Math.min(hitDistance, rayBoxDistance(ray.origin, ray.direction, carCollider(car), hitDistance));
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
        if (city.colliders.every(box => rayBoxDistance(ray.origin, direction, box, distance) === Infinity)) { hitDrone = drone; hitDistance = distance; break; }
      }
    }
  }
  const endpoint = hitDrone ? hitDrone.root.position.clone() : ray.at(hitDistance, new THREE.Vector3());
  character.muzzle.getWorldPosition(muzzlePoint);
  direction.subVectors(endpoint, muzzlePoint); const length = direction.length(); direction.normalize();
  let muzzleBlock = Infinity;
  for (const box of city.colliders) muzzleBlock = Math.min(muzzleBlock, rayBoxDistance(muzzlePoint, direction, box, length));
  if (muzzleBlock < length - .1) { endpoint.copy(muzzlePoint).addScaledVector(direction, muzzleBlock); hitDrone = null; }
  tracer(muzzlePoint, endpoint);
  if (hitDrone) damageDrone(hitDrone, 34); else if (hitDistance < 150 || muzzleBlock < length) sparks(endpoint, 0xf9e8b7, 5);
}

function updatePlayer(dt) {
  const axes = input.axes(), look = input.look();
  cameraYaw -= look.x; cameraPitch = clamp(cameraPitch + look.y, -.65, 1.03);
  if (driving) {
    const delta = stepVehicle(driving, axes.y, axes.x, input.keys.has('Space'), dt);
    const previousSpeed = driving.speed;
    const colliders = city.colliders.concat(city.cars.filter(c => c !== driving).map(carCollider));
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
    const speed = input.aiming ? 1.4 : sprint ? 6.6 : 1.65;
    const recovery = player.jumpPhase === 'start' && !player.launched ? .55 : player.jumpPhase === 'land' ? .65 + .35 * Math.min(1, player.jumpTime / .25) : 1;
    const targetVX = (Math.cos(cameraYaw) * axes.x - Math.sin(cameraYaw) * axes.y) * speed * recovery;
    const targetVZ = (-Math.sin(cameraYaw) * axes.x - Math.cos(cameraYaw) * axes.y) * speed * recovery;
    player.vx = damp(player.vx, targetVX, amount > .08 ? 11 : 15, dt);
    player.vz = damp(player.vz, targetVZ, amount > .08 ? 11 : 15, dt);
    const dx = player.vx * dt, dz = player.vz * dt;
    const beforeX = player.x, beforeZ = player.z;
    const colliders = city.colliders.concat(city.cars.map(carCollider));
    moveWithCollisions(player, dx, dz, .43, colliders);
    const traveled = Math.hypot(player.x - beforeX, player.z - beforeZ);
    player.speed = traveled / dt;
    if (amount > .08 && !input.aiming && !input.firing) player.yaw += angleDelta(player.yaw, Math.atan2(-dx, -dz)) * (1 - Math.exp(-13 * dt));
    if (input.aiming || input.firing) player.yaw += angleDelta(player.yaw, cameraYaw) * (1 - Math.exp(-17 * dt));
    stepJump(player, dt);
    updateCharacter(dt); audio.update(0, false);
    if (input.firing) shoot();
    nearestCar = findNearestCar();
  }
  if (state.reloading > 0) { state.reloading -= dt; if (state.reloading <= 0) { state.reloading = 0; state.ammo = 24; audio.tone(670, .08, 'triangle', .15); } }
  state.cooldown = Math.max(0, state.cooldown - dt);
  if (state.stage === 1 && Math.hypot(player.x, player.z + 65) < 8) advanceMission();
  if (state.time - state.damageAt > 7) {
    state.armor = Math.min(50, state.armor + dt * 5); state.health = Math.min(100, state.health + dt * 1.8);
  }
}

function updateCharacter(dt) {
  character.root.position.set(player.x, player.y + .05, player.z); character.root.rotation.y = player.yaw;
  animateCharacter(character, input?.aiming || input?.firing, dt, { speed: player.speed, jumpPhase: player.jumpPhase, jumpTime: player.jumpTime, height: player.y, verticalSpeed: player.velocityY, pitch: cameraPitch, reloading: state.reloading });
  contactShadow.position.set(player.x, .03, player.z); contactShadow.visible = !driving; contactShadow.material.opacity = 1 / (1 + player.y * .5);
}

function updateCamera(dt, snap = false) {
  const aiming = !driving && input?.aiming;
  const distance = driving ? 10.4 : aiming ? 3.3 : 5.9;
  const targetHeight = driving ? 1.45 : 1.35;
  cameraTarget.set(player.x, player.y + targetHeight, player.z);
  const shoulder = driving ? .35 : aiming ? .8 : .68;
  cameraTarget.x += Math.cos(cameraYaw) * shoulder; cameraTarget.z -= Math.sin(cameraYaw) * shoulder;
  desiredCamera.set(cameraTarget.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * distance, cameraTarget.y + Math.sin(cameraPitch) * distance + .5, cameraTarget.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * distance);
  // Prevent the follow camera from clipping through nearby buildings.
  direction.subVectors(desiredCamera, cameraTarget); const length = direction.length(); direction.normalize();
  let obstruction = length;
  for (const box of city.colliders) obstruction = Math.min(obstruction, rayBoxDistance(cameraTarget, direction, { minX: box.minX - .25, maxX: box.maxX + .25, minZ: box.minZ - .25, maxZ: box.maxZ + .25, maxY: box.maxY }, length));
  if (obstruction < length) desiredCamera.copy(cameraTarget).addScaledVector(direction, Math.max(.6, obstruction - .35));
  if (snap) camera.position.copy(desiredCamera); else camera.position.lerp(desiredCamera, 1 - Math.exp(-12 * dt));
  const groundCorrection = Math.max(0, .55 - camera.position.y);
  camera.position.y += groundCorrection;
  camera.lookAt(cameraTarget.x, cameraTarget.y + groundCorrection + shotRecoil * .045, cameraTarget.z);
  camera.fov = damp(camera.fov, aiming ? 48 : driving ? 66 + Math.abs(driving.speed) * .16 : 62, 8, dt); camera.updateProjectionMatrix();
  character.root.visible = !driving && camera.position.distanceTo(character.root.position) > 1.5;
}

function damagePlayer(amount) {
  state.damageAt = state.time;
  const absorbed = Math.min(state.armor, amount); state.armor -= absorbed; state.health = Math.max(0, state.health - (amount - absorbed));
  damageFlashUntil = state.time + .19; audio.tone(100, .09, 'triangle', .24, 40);
  if (state.health <= 0) { respawn(); hud.notify('SIGNAL RECOVERED // You were brought back to the Neon Quarter.', 5); }
}

function updateDrones(dt) {
  const targetPosition = new THREE.Vector3(player.x, player.y + (driving ? 1.1 : 1.4), player.z);
  for (const drone of drones) {
    if (drone.dead) {
      drone.respawn -= dt;
      if (drone.respawn <= 0 && Math.hypot(player.x - drone.homeX, player.z - drone.homeZ) > 30) { drone.dead = false; drone.health = 100; drone.engaged = false; drone.root.visible = true; }
      continue;
    }
    drone.phase += dt; const pos = drone.root.position;
    const distance = pos.distanceTo(targetPosition); const awake = state.started && !state.paused && distance < 24;
    const targetX = awake && drone.engaged ? player.x + Math.sin(drone.phase * .7) * 9 : drone.homeX + Math.sin(drone.phase * .35) * 2.6;
    const targetZ = awake && drone.engaged ? player.z - 10 + Math.cos(drone.phase * .6) * 3 : drone.homeZ + Math.cos(drone.phase * .32) * 2.7;
    const moveX = damp(pos.x, targetX, .55, dt) - pos.x, moveZ = damp(pos.z, targetZ, .55, dt) - pos.z;
    moveWithCollisions(pos, moveX, moveZ, .9, city.colliders);
    pos.y = 2.9 + Math.sin(drone.phase * 1.8) * .35;
    drone.root.rotation.y = awake ? Math.atan2(-(player.x - pos.x), -(player.z - pos.z)) : drone.phase * .3;
    drone.root.rotation.z = Math.sin(drone.phase * 1.2) * .045;
    for (const rotor of drone.rotors) rotor.rotation.y += dt * 42;
    if (awake) {
      drone.fireTimer -= dt;
      if (drone.fireTimer <= 0) {
        drone.fireTimer = 2.1 + Math.random() * .6;
        direction.subVectors(targetPosition, pos).normalize();
        const visible = city.colliders.every(box => rayBoxDistance(pos, direction, box, distance) === Infinity);
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
  for (let i = 0; i < positions.count; i += 2) {
    let y = positions.getY(i) - dt * 15; if (y < 0) y = 37;
    positions.setY(i, y); positions.setY(i + 1, y + .52);
  }
  positions.needsUpdate = true; city.rain.position.set(player.x, 0, player.z); city.motes.position.set(player.x, 0, player.z); city.motes.rotation.y += dt * .012;
  checkpointRing.rotation.z += dt * .25;
}

function frame(now) {
  animationId = requestAnimationFrame(frame);
  const rawDt = (now - lastFrame) / 1000; const dt = Math.min(Math.max(rawDt, .001), .05); lastFrame = now;
  fps = damp(fps, Math.min(144, 1 / Math.max(rawDt, .001)), 2, dt);
  if (!state.paused) {
    state.time += dt;
    if (state.started) updatePlayer(dt);
    if (!state.started) updateCharacter(dt);
    updateCamera(dt); updateDrones(dt); updateEffects(dt); updateWeather(dt); crowd.update(dt);
  }
  const goal = objective(); hud.waypoint(camera, goal, player, vector, state.started && !state.paused);
  $('crosshair').classList.toggle('aim', !!input.aiming);
  if (now - lastUI > 85) {
    hud.update(state, player, driving, nearestCar, goal, fps); hud.drawMap(player, cameraYaw, drones, goal);
    if (state.mapOpen) hud.drawMap(player, cameraYaw, drones, goal, true);
    const minute = 48 + Math.floor(state.time / 45); $('game-time').textContent = `${String((23 + Math.floor(minute / 60)) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    lastUI = now;
  }
  if (quality === 'high') composer.render(); else renderer.render(scene, camera);
}

init().catch(showError);
window.addEventListener('pagehide', () => { if (animationId) cancelAnimationFrame(animationId); });
