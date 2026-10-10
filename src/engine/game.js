import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createWorld } from '../world/index.js';
import { terrainHeight } from '../world/master-plan.js';
import { levelY, roomAt } from '../world/interior-plan.js';
import { toLocal } from '../world/interior-physics.js';
import { ResolutionGovernor } from '../world/world-stream.js';
import { createTraffic } from '../traffic/index.js';
import { clamp, damp, angleDelta, moveWithCollisions, carCollider, findExitPosition, stepVehicle, rayBoxDistance, circleHitsBox, overlapsHeight, supportHeight } from '../core/physics.js';
import { findSpawnPosition } from '../core/spawn.js';
import { RENDER_PROFILES } from '../core/quality.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { HUD } from './hud.js';
import { createUI, button } from './ui.js';
import { attachMapControls } from './map-controls.js';
import { modeCards } from './mode-picker.js';
import { createEffects } from './effects.js';
import { createWeapon } from './weapon.js';
import { createShadows } from './shadows.js';
import { createContactShadows } from './contact-shadows.js';
import { setupFullscreen } from './fullscreen.js';
import { createStorage, LAST_MODE_KEY } from './save.js';
import { loadCharacterAssets, createCharacter, animateCharacter, characterShot } from './player/characters.js';
import { beginJump, stepJump, resetFall } from './player/jump.js';
import { createParachute, updateParachute } from './player/parachute.js';
import { MOVEMENT, footVelocity } from './player/locomotion.js';
import { findClimbFace, startClimb, dropClimb, stepClimb } from './player/climbing.js';

const $ = id => document.getElementById(id);

/**
 * The game runtime shared by every mode: renderer, world, traffic, the player
 * (walking, climbing, gliding, driving, interiors), camera, HUD, menus and the
 * mode picker. Gameplay plugs in through a mode definition (see modes/index.js);
 * the engine hosts one mode at a time and never imports a specific mode.
 */
export async function createGame({ canvas, modes }) {
  const storage = createStorage();
  const state = { started: false, paused: false, mapOpen: false, modal: null, time: 0 };
  const player = { x: 0, y: 0, z: 0, yaw: -Math.PI / 2, velocityY: 0, vx: 0, vz: 0, speed: 0, jumpPhase: '', jumpTime: 0, jumpElapsed: 0, launched: false, groundY: 0, climb: null, climbCandidate: null, pushTime: 0, parachute: null, interior: null };
  const resolution = new ResolutionGovernor(), frameCosts = { updateMs: 0, renderMs: 0 }, audio = new GameAudio();
  const vector = new THREE.Vector3(), lookPoint = new THREE.Vector3(), desiredLook = new THREE.Vector3(), direction = new THREE.Vector3(), cameraTarget = new THREE.Vector3(), desiredCamera = new THREE.Vector3();
  let renderer, composer, bloom, world, character, hud, input, scene, camera, traffic, shadows, contactShadows, parachute, effects, weapon, ui, assets;
  let driving = null, nearestCar = null, quality = 'high', animationId, cameraYaw = 0, cameraPitch = .12, fps = 60, lastFrame = performance.now(), lastUI = 0, lastSavedAt = 0;
  let headCam = false, headLook = 0;
  let definition = null, mode = null, host = null, contactSourcesRef = new Set(), owned = [];

  // --- Modes ---------------------------------------------------------------
  function renderPicker() { $('mode-cards').innerHTML = modeCards(modes, storage); }
  $('mode-cards').addEventListener('click', e => {
    const start = e.target.closest('[data-mode-start]'), fresh = e.target.closest('[data-mode-new]'), confirmNew = e.target.closest('[data-mode-confirm]'), cancel = e.target.closest('[data-mode-cancel]');
    if (start) activate(start.dataset.modeStart).catch(reportError);
    else if (confirmNew) activate(confirmNew.dataset.modeConfirm, { fresh: true }).catch(reportError);
    else if (cancel) renderPicker();
    else if (fresh) {
      const actions = fresh.closest('.mode-actions');
      actions.innerHTML = `<span class="mode-confirm">Replace the saved game?</span><button class="primary-button" data-mode-confirm="${fresh.dataset.modeNew}">START OVER <span>↗</span></button><button class="text-button" data-mode-cancel>Keep my save</button>`;
      actions.querySelector('[data-mode-cancel]').focus();
    }
  });
  function reportError(error) { console.error(error); hud.notify(`This mode could not start: ${error.message ?? error}`, 8); }

  // A second click while a mode is still loading would start it twice.
  let activating = null;
  function activate(id, options) {
    activating ??= start(id, options).finally(() => { activating = null; });
    return activating;
  }
  async function start(id, { fresh = false } = {}) {
    if (mode) deactivate({ toPicker: false });
    const next = modes.find(m => m.id === id), nextHost = createHost();
    let instance = null;
    try {
      instance = await next.create(nextHost, { fresh });
      definition = next; host = nextHost; mode = instance;
      const spot = mode.spawn?.() ?? world.spawn;
      placeAt(spot, { cameraYaw: spot.cameraYaw ?? spot.yaw ?? world.spawn.yaw, cameraPitch: spot.cameraPitch ?? .12 });
    } catch (error) {
      // Leave nothing of a mode that failed to start, and stay on the picker.
      mode = definition = host = null;
      teardown(instance, nextHost);
      renderPicker();
      throw error;
    }
    try { storage.setItem(LAST_MODE_KEY, id); } catch { /* The choice lasts for this session. */ }
    $('brand-mode').textContent = (definition.brand ?? definition.title).toUpperCase();
    state.started = true; state.paused = false; document.body.classList.add('playing'); $('welcome').classList.add('hidden');
    input.setEnabled(true); audio.init(); renderer.compile(scene, camera);
    hud.notify(mode.welcome?.() ?? `${definition.title.toUpperCase()} // The city is yours.`, 7);
    save();
  }
  function deactivate({ toPicker = true } = {}) {
    if (!mode) return;
    save();
    if (driving) { driving.speed = 0; driving = null; }
    for (const car of [...owned]) removeDrivableCar(car);
    const [instance, instanceHost] = [mode, host];
    mode = definition = host = null; state.started = false;
    teardown(instance, instanceHost);
    if (toPicker) {
      ui.close(); input.setEnabled(false); document.body.classList.remove('playing'); $('brand-mode').textContent = 'CHOOSE A WAY TO PLAY';
      placeAt(world.spawn, { cameraYaw: world.spawn.yaw, cameraPitch: world.spawn.pitch });
      renderPicker(); $('welcome').classList.remove('hidden'); $('start-button')?.focus();
    }
  }

  function teardown(instance, instanceHost) {
    weapon.disable(); effects.clear();
    try { instance?.dispose?.(); } finally { instanceHost.cleanup(); }
  }

  function createHost() {
    const cleanups = [], contactSources = new Set();
    const track = fn => { cleanups.push(fn); return fn; };
    contactSourcesRef = contactSources;
    return {
      THREE, scene, camera, renderer, world, traffic, assets, storage, audio, effects, weapon, input, state,
      clock: { get time() { return state.time; }, set time(value) { state.time = value; } },
      actorRange: () => RENDER_PROFILES[quality].actors,
      hud: {
        notify: (text, duration) => hud.notify(text, duration),
        mount(element) { $('hud').append(element); track(() => element.remove()); return element; },
      },
      ui: {
        open: (id, handler) => ui.open(id, handler), close: () => ui.close(), panel: options => ui.panel(options),
        openMap() { if (!state.mapOpen) toggleMap(); },
        register(id, closeKey) { ui.register(id, closeKey); track(() => ui.unregister(id)); },
        menu(items, settings) { track(ui.menu(items, settings)); },
        legend(html) {
          const items = document.createElement('span'); items.className = 'mode-legend'; items.innerHTML = html;
          document.querySelector('.map-legend').append(items); track(() => items.remove());
        },
        mapSidebar(element) { document.querySelector('.map-layout').append(element); track(() => element.remove()); },
        controls(html) { $('mode-controls').innerHTML = html; track(() => { $('mode-controls').innerHTML = ''; }); },
      },
      player: {
        get state() { return player; },
        get driving() { return driving; },
        get interior() { return player.interior; },
        get cameraYaw() { return cameraYaw; },
        character,
        scenery, allCars, groundAt,
        colliders: (x, z, radius, exclude) => nearbyColliders(x, z, radius, exclude),
        canStandAt,
        spawnNear,
        teleport: (spot, options) => placeAt(spot, options),
        releaseVehicles() { if (driving) { driving.speed = 0; driving = null; character.root.visible = true; } for (const car of [...owned]) removeDrivableCar(car); },
        exitPoint: () => driving ? findExitPosition(driving, nearbyColliders(driving.x, driving.z, 8, driving), .48, world.limit) : null,
      },
      shadows: {
        addDynamic(root) { shadows.addDynamic(root); },
        addCasters(root) { shadows.addCasters(root); track(() => shadows.removeCasters(root)); },
        invalidate: () => shadows.invalidate(),
      },
      contactShadows: { add(source) { contactSources.add(source); } },
      save: () => save(),
      cleanup() { for (const fn of cleanups.splice(0).reverse()) fn(); contactSources.clear(); },
    };
  }
  function save() {
    if (!state.started || !mode) return;
    const exit = driving ? findExitPosition(driving, nearbyColliders(driving.x, driving.z, 8, driving), .48, world.limit) : null;
    const position = driving ? exit ?? mode.safeSpot?.() ?? player : player;
    mode.save?.({ position: { x: position.x, y: position.y ?? player.y, z: position.z }, time: state.time });
    lastSavedAt = state.time;
  }

  // --- Settings and chrome ---------------------------------------------------
  function setupUI() {
    setupFullscreen($('fullscreen-button'), {
      notify: message => hud.notify(message, 5),
      showHelp: showFullscreenHelp,
      restoreFocus: () => { if (state.started && !state.paused) canvas.focus({ preventScroll: true }); },
    });
    $('help-button').addEventListener('click', () => ui.setPause(true)); $('all-controls').addEventListener('click', () => ui.setPause(true));
    $('resume-button').addEventListener('click', () => ui.close());
    $('change-mode-button').addEventListener('click', () => deactivate());
    $('map-button').addEventListener('click', toggleMap); $('close-map').addEventListener('click', toggleMap);
    const syncSoundButton = () => {
      const enabled = audio.enabled, soundButton = $('sound-button');
      soundButton.setAttribute('aria-pressed', String(enabled)); soundButton.setAttribute('aria-label', enabled ? 'Mute sound effects' : 'Enable sound effects');
      soundButton.innerHTML = enabled ? '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6"/></svg>';
    };
    syncSoundButton();
    $('sound-button').addEventListener('click', () => {
      audio.toggle();
      if (state.started) audio.init();
      syncSoundButton();
      if (state.started && !state.paused) canvas.focus();
    });
    $('quality').addEventListener('change', e => setQuality(e.target.value));
    $('sensitivity').addEventListener('input', e => { input.sensitivity = Number(e.target.value); });
    window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); applyResolution(); });
  }
  function showFullscreenHelp({ installed = false } = {}) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const html = installed
      ? '<p class="service-note">Afterlight is already running as a Home Screen app. Your device controls the status bar and home indicator. Use the normal app switcher to leave the game.</p>'
      : ios
        ? '<p class="service-note">This browser cannot expand the game directly. Open it as a Home Screen app to hide Safari’s browser bars.</p><ol class="fullscreen-steps"><li>Open this page in <strong>Safari</strong>.</li><li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li><li>Keep <strong>Open as Web App</strong> enabled if shown, tap <strong>Add</strong>, then launch <strong>Afterlight</strong> from its new icon.</li></ol><p class="service-note">The Home Screen app may have a separate save from this browser. Your current game remains saved here.</p>'
        : '<p class="service-note">Fullscreen was blocked or is unavailable in this browser. Open the game directly in your mobile browser, outside an embedded preview, and try again.</p><p class="service-note">You can also use the browser menu to <strong>Install app</strong> or <strong>Add to Home Screen</strong>, then launch Afterlight from its icon. The installed app opens without browser bars where supported.</p>';
    ui.panel({ kicker: 'DISPLAY / AFTERLIGHT', title: installed ? 'Home Screen mode.' : 'Play without browser bars.', html: `${html}${button('Back to the game', 'close', 'accent')}` });
  }
  function toggleMap() {
    if (state.mapOpen) { ui.close(); return; }
    world.mapView.x = player.x; world.mapView.z = player.z;
    ui.open('city-map'); mode?.mapOpened?.(); $('close-map').focus();
    drawMaps(true);
  }
  function setQuality(value) {
    quality = value;
    resolution.reset();
    shadows.setQuality(quality); traffic.setQuality(quality);
    if (quality === 'high' && !composer) {
      composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .31, .55, 1.03); composer.addPass(bloom); composer.addPass(new OutputPass());
    } else if (quality === 'low' && composer) {
      for (const pass of composer.passes) pass.dispose?.(); composer.dispose(); composer = bloom = null;
    }
    camera.far = quality === 'high' ? 720 : 600; camera.updateProjectionMatrix();
    world.setQuality(quality, { far: camera.far });
    applyResolution();
  }
  function applyResolution() {
    renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER_PROFILES[quality].dpr) * resolution.scale);
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); }
  }

  // --- Collision helpers -----------------------------------------------------
  // The player's building context swaps that building's shell for its interior.
  function scenery() { return world.spatialFor(player.interior); }
  function allCars() { return owned.concat(traffic.cars); }
  function nearbyColliders(x, z, radius = 8, exclude = null, spatial = scenery()) {
    return spatial.near(x, z, radius).concat(allCars().filter(c => c !== exclude && Math.hypot(c.x - x, c.z - z) < radius + 5).map(carCollider));
  }
  // Walls are only climbable from outside a building's outline.
  function climbColliders() { return player.interior?.inside ? nearbyColliders(player.x, player.z, 3) : nearbyColliders(player.x, player.z, 3, null, world.spatial); }
  function groundAt(x, z, ceiling = Infinity) { return supportHeight(x, z, scenery().near(x, z, 2), ceiling, terrainHeight(x, z)); }
  function updateInterior() { player.interior = driving || player.climb ? null : world.interiorContextAt(player.x, player.y, player.z); }
  /** Whether the player could stand at `p`, using that point's own interior context. */
  function canStandAt(p) {
    const y = p.y ?? terrainHeight(p.x, p.z), context = world.interiorContextAt(p.x, y, p.z);
    return !world.spatialFor(context).near(p.x, p.z, 2).some(box => !box.supportOnly && overlapsHeight(box, y) && circleHitsBox(p.x, p.z, .43, box));
  }
  function spawnNear(p, offset = { x: 0, z: 0 }) {
    return findSpawnPosition({ x: p.x + offset.x, y: p.y ?? terrainHeight(p.x, p.z), z: p.z + offset.z }, nearbyColliders, groundAt, .43, world.limit);
  }
  function removeDrivableCar(car) {
    scene.remove(car.root);
    const geometries = new Set(); car.root.traverse(object => { if (object.isMesh) geometries.add(object.geometry); });
    for (const geometry of geometries) geometry.dispose();
    // Car materials are cached and shared with the remaining traffic.
    owned.splice(owned.indexOf(car), 1);
  }
  /** Move the player (and camera) to a spot. By default a cut, so traffic and shadows reset too. */
  function placeAt(spot, { cameraYaw: yaw, cameraPitch: pitch, playerYaw, cut = true } = {}) {
    if (driving) { driving.speed = 0; driving = null; }
    resetTraversal();
    player.x = spot.x; player.z = spot.z; player.y = Math.max(spot.y ?? terrainHeight(spot.x, spot.z), terrainHeight(spot.x, spot.z));
    updateInterior();
    player.groundY = groundAt(player.x, player.z, player.y + .5); player.velocityY = 0;
    player.vx = player.vz = player.speed = 0; player.jumpPhase = ''; player.jumpTime = 0;
    if (playerYaw !== undefined) player.yaw = playerYaw;
    if (yaw !== undefined) cameraYaw = yaw;
    if (pitch !== undefined) cameraPitch = pitch;
    character.root.visible = true; input.clear();
    updateCharacter(.016); updateCamera(.016, true);
    if (cut) { traffic.reset(); shadows.invalidate(); }
    world.update({ camera, focus: player, interior: player.interior, now: performance.now() / 1000, force: true, paused: true });
  }

  // --- Lifts -------------------------------------------------------------------
  function nearLift() {
    const context = player.interior, lift = context?.inside && context.plan.core?.lift;
    if (!lift || context.plan.levels < 2 || Math.abs(player.y - levelY(context.plan, context.level)) > .3) return false;
    const p = toLocal(context.plan, player.x, player.z);
    return p.x > lift.x0 && p.x < lift.x1 && p.z > lift.z0 && p.z < lift.z1;
  }
  function useLift(level) {
    const context = player.interior;
    if (!context || !nearLift() || level === context.level) return false;
    // Every floor shares the same shaft: arrive at the same spot in the car.
    const y = levelY(context.plan, level), target = world.interiorContextAt(player.x, y, player.z), spatial = world.spatialFor(target);
    const floor = supportHeight(player.x, player.z, spatial.near(player.x, player.z, 2), y + .3, terrainHeight(player.x, player.z));
    if (Math.abs(floor - y) > .05 || nearbyColliders(player.x, player.z, 2, null, spatial).some(box => !box.supportOnly && overlapsHeight(box, y) && circleHitsBox(player.x, player.z, .43, box))) return false;
    resetTraversal(); player.y = player.groundY = y; player.interior = target;
    player.vx = player.vz = player.speed = player.velocityY = 0; player.jumpPhase = '';
    updateCharacter(.016); updateCamera(.016, true); input.clear();
    hud.notify(`FLOOR ${level + 1}`, 2); return true;
  }
  function openElevator() {
    const { levels, level: current } = { levels: player.interior.plan.levels, level: player.interior.level };
    const floors = Array.from({ length: levels }, (_, i) => levels - 1 - i);
    ui.panel({ kicker: 'BUILDING / ELEVATOR', title: 'Choose a floor.',
      html: `<div class="elevator-floors">${floors.map(level => button(String(level + 1), `floor:${level}`, level === current ? '' : 'accent', level === current)).join('')}</div>`,
      onAction: action => {
        const [kind, value] = action.split(':');
        if (kind !== 'floor') return;
        if (useLift(Number(value))) ui.close(); else hud.notify('Step fully into the elevator to choose a floor.', 2);
      } });
  }
  function hijackPrompt() {
    return !driving && !nearestCar && !player.climb && !player.parachute && traffic.hijackable(player) ? { caption: 'TRAFFIC / WAITING', label: 'Take this car' } : null;
  }
  function liftPrompt() { return nearLift() ? { caption: `ELEVATOR / FLOOR ${player.interior.level + 1} OF ${player.interior.plan.levels}`, label: 'Choose a floor' } : null; }

  // --- Player actions ----------------------------------------------------------
  function interact() {
    if (!state.started || state.paused) return;
    if (player.climb || player.parachute) return;
    if (driving) {
      if (Math.abs(driving.speed) > 7) { hud.notify('Slow down before exiting the vehicle.', 2); return; }
      const exit = findExitPosition(driving, nearbyColliders(driving.x, driving.z, 8, driving), .48, world.limit);
      if (!exit) { hud.notify('Both doors are blocked. Move the car into the street.', 3); return; }
      resetTraversal();
      player.x = exit.x; player.z = exit.z; player.y = groundAt(exit.x, exit.z, (exit.y ?? driving.y) + .6); player.groundY = player.y; player.velocityY = 0; player.yaw = driving.yaw;
      driving.speed = 0; driving = null; character.root.visible = true; weapon.cooldown = .3;
      player.vx = player.vz = player.speed = 0; player.jumpPhase = '';
      hud.notify(!weapon.enabled ? 'Back on foot.' : input.touch ? 'Weapon ready. Aim with the right side; tap the crosshair to fire.' : 'Back on foot. Left click to fire. Right click to aim.', 3);
    } else {
      if (nearLift()) { openElevator(); return; }
      const target = mode?.interactable?.(player);
      if (target) { target.use(); return; }
      nearestCar = findNearestCar();
      // A traffic car waiting beside you (at a red light, in a queue) can be taken.
      const stopped = nearestCar ? null : traffic.hijackable(player);
      if (stopped) nearestCar = traffic.takeOver(stopped);
      if (!nearestCar) {
        const nearTraffic = traffic.cars.some(car => Math.abs(player.y - car.y) < 2 && Math.hypot(player.x - car.x, player.z - car.z) < 9);
        hud.notify(nearTraffic ? `Step up to a car while it waits at a light, then press E${weapon.enabled ? ', or hit it three times to stop it' : ''}.` : mode?.interactHint?.() ?? 'Approach a door, an elevator or a stopped vehicle. E to interact.', 3);
        return;
      }
      resetTraversal();
      driving = nearestCar; driving.speed = 0; player.x = driving.x; player.z = driving.z; player.y = driving.y; player.velocityY = 0;
      player.vx = player.vz = player.speed = 0; player.jumpPhase = '';
      cameraYaw = driving.yaw; cameraPitch = .22; character.root.visible = false;
      hud.notify('ARCHER GT // WASD to drive. Space to handbrake. E to exit.', 3);
    }
    input.firing = false; input.aiming = false;
  }
  function findNearestCar() {
    if (player.climb || player.parachute) return null;
    let best = null, distance = 4.5;
    for (const car of owned) { const d = Math.hypot(player.x - car.x, player.z - car.z); if (Math.abs(player.y - car.y) < 1.6 && d < distance) { best = car; distance = d; } }
    return best;
  }
  function jump() {
    if (driving || !state.started || state.paused) return;
    if (player.climb) { dropClimb(player, true); return; }
    if (!grabWall(true)) beginJump(player);
  }
  function grabWall(requireFacing = false) {
    const boxes = climbColliders();
    if (!startClimb(player, findClimbFace(player, boxes, cameraYaw, requireFacing), boxes)) return false;
    cameraYaw = player.yaw; cameraPitch = .05;
    input.firing = input.aiming = false; weapon.cancel();
    return true;
  }
  function toggleClimb() {
    if (driving || !state.started || state.paused) return;
    if (player.climb) dropClimb(player);
    else if (!grabWall()) hud.notify('Move within arm’s reach of a building wall to climb.', 2);
  }
  function resetTraversal() {
    player.climb = player.climbCandidate = player.interior = null; player.groundY = player.pushTime = 0;
    resetFall(player);
    if (parachute) updateParachute(parachute, player, 0);
  }

  // --- Per-frame simulation ------------------------------------------------------
  function updatePlayer(dt) {
    const axes = input.axes(), look = input.look();
    updateInterior();
    const indoors = !!player.interior?.inside;
    cameraYaw -= look.x; cameraPitch = clamp(cameraPitch + look.y, -.65, indoors ? .6 : 1.03);
    if (driving) {
      const delta = stepVehicle(driving, axes.y, axes.x, input.keys.has('Space'), dt);
      const previousSpeed = driving.speed;
      const colliders = nearbyColliders(driving.x, driving.z, 6, driving);
      const collision = moveWithCollisions(driving, delta.x, delta.z, 1.6, colliders, world.limit);
      const floor = groundAt(driving.x, driving.z, driving.y + .75);
      if (floor >= driving.y - .8) { driving.y = floor; driving.velocityY = 0; }
      else { driving.velocityY = (driving.velocityY ?? 0) - dt * 22; driving.y = Math.max(floor, driving.y + driving.velocityY * dt); }
      if (collision) {
        driving.speed *= -.14;
        mode?.onVehicleImpact?.(previousSpeed);
        // A fatal impact can move the player out of the car.
        if (!driving) return;
      }
      driving.root.position.set(driving.x, driving.y + .04 + Math.sin(state.time * 35) * Math.abs(driving.speed) * .0005, driving.z);
      const frontY = groundAt(driving.x - Math.sin(driving.yaw) * 1.5, driving.z - Math.cos(driving.yaw) * 1.5, driving.y + 1);
      const rearY = groundAt(driving.x + Math.sin(driving.yaw) * 1.5, driving.z + Math.cos(driving.yaw) * 1.5, driving.y + 1);
      const rightY = groundAt(driving.x + Math.cos(driving.yaw), driving.z - Math.sin(driving.yaw), driving.y + 1);
      const leftY = groundAt(driving.x - Math.cos(driving.yaw), driving.z + Math.sin(driving.yaw), driving.y + 1);
      driving.root.rotation.set(clamp(Math.atan2(frontY - rearY, 3), -.3, .3), driving.yaw, clamp(Math.atan2(rightY - leftY, 2), -.15, .15), 'YXZ');
      for (const wheel of driving.wheels) wheel.rotation.x -= driving.speed * dt / .44;
      player.x = driving.x; player.y = driving.y; player.z = driving.z; player.yaw = driving.yaw; player.groundY = floor;
      if (Math.abs(look.x) < .001 && Math.abs(driving.speed) > 1.8) cameraYaw += angleDelta(cameraYaw, driving.yaw) * (1 - Math.exp(-2.1 * dt));
      audio.update(driving.speed, !state.paused);
    } else {
      const amount = Math.hypot(axes.x, axes.y);
      // Indoors stays at a jog so stairs keep their footing at low frame rates.
      const sprint = !indoors && (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') || (input.touch && amount > .9));
      const colliders = nearbyColliders(player.x, player.z, 3);
      if (player.climb) {
        const result = stepClimb(player, axes, dt, colliders, sprint);
        if (result === 'roof') { hud.notify('ROOFTOP // Keep exploring. Space to jump; C to grab another wall.', 3); save(); }
      } else {
        const walk = input.keys.has('AltLeft') || input.keys.has('AltRight');
        const aiming = weapon.enabled && !player.parachute && input.aiming, firing = weapon.enabled && !player.parachute && input.firing;
        const delta = footVelocity(player, axes, cameraYaw, dt, { sprint, walk, aiming, sprintSpeed: mode?.sprintSpeed?.() ?? MOVEMENT.sprint });
        if (player.pushTime > 0) { player.pushTime -= dt; delta.x = player.pushVX * dt; delta.z = player.pushVZ * dt; }
        const beforeX = player.x, beforeZ = player.z;
        moveWithCollisions(player, delta.x, delta.z, .43, colliders, world.limit);
        player.speed = Math.hypot(player.x - beforeX, player.z - beforeZ) / dt;
        if (amount > .08 && !aiming && !firing) player.yaw += angleDelta(player.yaw, Math.atan2(-delta.x, -delta.z)) * (1 - Math.exp(-MOVEMENT.turn * dt));
        if (aiming || firing) player.yaw += angleDelta(player.yaw, cameraYaw) * (1 - Math.exp(-MOVEMENT.turn * dt));
        const groundY = groundAt(player.x, player.z, player.y + .35);
        const wasGliding = !!player.parachute;
        stepJump(player, dt, groundY);
        if (player.parachute && !wasGliding) {
          input.firing = input.aiming = false; weapon.cancel();
          hud.notify(input.touch ? 'PARACHUTE OPEN // Use the stick to steer toward a roof or the street.' : 'PARACHUTE OPEN // WASD to steer toward a roof or the street.', 4);
        }
      }
      updateInterior();
      player.climbCandidate = player.climb ? null : findClimbFace(player, climbColliders());
      updateCharacter(dt); audio.update(0, false);
      if (input.firing) weapon.fire();
      nearestCar = findNearestCar();
    }
    if (state.time - lastSavedAt > 12) save();
  }
  function updateCharacter(dt) {
    character.root.position.set(player.x, player.y + .05, player.z); character.root.rotation.y = player.yaw;
    const height = Math.max(0, player.y - player.groundY);
    animateCharacter(character, weapon?.enabled && (input?.aiming || input?.firing), dt, { speed: player.speed, climb: player.climb, parachute: player.parachute, jumpPhase: player.jumpPhase, jumpTime: player.jumpTime, height, groundHeight: player.groundY, verticalSpeed: player.velocityY, pitch: cameraPitch, reloading: weapon?.reloading ?? 0 });
    updateParachute(parachute, player, dt);
  }
  function updateContactShadows() {
    const items = [];
    for (const car of owned) if (car.root.visible && car.root.parent) {
      items.push({ x: car.x, z: car.z, y: car.y + .055, yaw: car.yaw, pitch: car.root.rotation.x, roll: car.root.rotation.z, width: 3.2, length: 6 });
    }
    for (const car of traffic.cars) items.push({ x: car.x, z: car.z, y: car.y + .055, yaw: car.yaw, pitch: car.pitch, roll: car.roll, width: 3.2, length: 6 });
    if (!driving && !player.climb) {
      const height = Math.max(0, player.y - player.groundY);
      items.push({ x: player.x, z: player.z, y: player.groundY + .055, width: 1.8, length: 1.8, opacity: 1 / (1 + height * .5) });
    }
    for (const { root } of traffic.pedestrians.people) if (root.visible && root.parent) {
      items.push({ x: root.position.x, z: root.position.z, y: Math.max(.055, root.position.y + .015), width: 1.6, length: 1.6 });
    }
    for (const source of contactSourcesRef) source(items);
    contactShadows.update(items);
  }
  function updateCamera(dt, snap = false) {
    const glide = player.parachute?.openness ?? 0, indoors = !driving && !!player.interior?.inside;
    const aiming = weapon?.enabled && !driving && !player.climb && !player.parachute && input?.aiming;
    const recoil = weapon?.recoil ?? 0;
    // Leave room for the full canopy even in a narrow portrait viewport.
    const glideDistance = Math.max(9.4, 4 / (Math.tan(THREE.MathUtils.degToRad(33)) * camera.aspect));
    const distance = driving ? 10.4 : aiming ? (indoors ? 2.2 : 3.3) : indoors ? 2.6 : 5.9 + glide * (glideDistance - 5.9);
    const targetHeight = driving ? 1.45 : 1.35 + glide * 1.25;
    cameraTarget.set(player.x, player.y + targetHeight, player.z);
    const shoulder = driving ? .35 : aiming ? (indoors ? .55 : .8) : indoors ? .4 : .68 * (1 - glide * .7);
    cameraTarget.x += Math.cos(cameraYaw) * shoulder; cameraTarget.z -= Math.sin(cameraYaw) * shoulder;
    desiredCamera.set(cameraTarget.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * distance, cameraTarget.y + Math.sin(cameraPitch) * distance + .5, cameraTarget.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * distance);
    // Prevent the follow camera from clipping through nearby buildings.
    direction.subVectors(desiredCamera, cameraTarget); const length = direction.length(); direction.normalize();
    let obstruction = length;
    const pad = indoors ? .12 : .25;
    for (const box of scenery().along(cameraTarget, direction, length)) {
      if (box.faces) { obstruction = Math.min(obstruction, rayBoxDistance(cameraTarget, direction, box, length)); continue; }
      obstruction = Math.min(obstruction, rayBoxDistance(cameraTarget, direction, { ...box, w: box.w === undefined ? undefined : box.w + pad * 2, d: box.d === undefined ? undefined : box.d + pad * 2, minX: box.minX - pad, maxX: box.maxX + pad, minZ: box.minZ - pad, maxZ: box.maxZ + pad }, length));
    }
    if (obstruction < length) desiredCamera.copy(cameraTarget).addScaledVector(direction, Math.max(indoors ? .35 : .6, obstruction - (indoors ? .2 : .35)));
    // In a tight room, look from the head rather than from inside the jacket.
    // Hysteresis keeps the head camera from flickering where a wall is about
    // 1.15 m behind the player.
    headCam = indoors && !aiming && obstruction < (headCam ? 1.45 : 1.15);
    const close = headCam;
    if (close) desiredCamera.set(player.x, player.y + 1.62, player.z);
    if (snap) camera.position.copy(desiredCamera); else camera.position.lerp(desiredCamera, 1 - Math.exp(-12 * dt));
    const groundCorrection = Math.max(0, terrainHeight(camera.position.x, camera.position.z) + .55 - camera.position.y);
    camera.position.y += groundCorrection;
    // Blend between looking ahead from the head and looking at the player, so
    // leaving the head camera turns the view rather than whipping it.
    headLook = snap ? +close : damp(headLook, +close, 10, dt);
    lookPoint.set(camera.position.x - direction.x * 5, camera.position.y - direction.y * 5, camera.position.z - direction.z * 5)
      .lerp(desiredLook.set(cameraTarget.x, cameraTarget.y + groundCorrection, cameraTarget.z), 1 - headLook);
    camera.lookAt(lookPoint.x, lookPoint.y + recoil * .045, lookPoint.z);
    camera.fov = damp(camera.fov, aiming ? 48 : driving ? 66 + Math.abs(driving.speed) * .16 : 62 + glide * 4, 8, dt); camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    character.root.visible = !driving && !close && camera.position.distanceTo(character.root.position) > (indoors ? .8 : 1.5);
  }
  function drawMaps(expandedOnly = false) {
    const goal = mode?.objective?.() ?? null;
    const layers = { objective: goal, cars: owned, districtKnown: id => mode?.districtKnown?.(id) ?? true };
    if (!expandedOnly) hud.drawMap(player, cameraYaw, { ...layers, markers: mode?.mapMarkers?.({ player, expanded: false }) ?? [] });
    if (state.mapOpen) hud.drawMap(player, cameraYaw, { ...layers, markers: mode?.mapMarkers?.({ player, expanded: true }) ?? [] }, true);
  }

  function frame(now) {
    animationId = requestAnimationFrame(frame);
    if (document.hidden) { lastFrame = now; return; }
    const updateStart = performance.now();
    const rawDt = (now - lastFrame) / 1000; const dt = Math.min(Math.max(rawDt, .001), .05); lastFrame = now;
    fps = damp(fps, Math.min(144, 1 / Math.max(rawDt, .001)), 2, dt);
    if (!state.paused) {
      state.time += dt;
      traffic.update(dt, { player, vehicle: driving, camera, range: RENDER_PROFILES[quality].actors });
      if (state.started) updatePlayer(dt); else updateCharacter(dt);
      updateCamera(dt); weapon.update(dt); effects.update(dt, state.time);
      if (mode) mode.update?.(dt, { now: now / 1000, time: state.time, player, driving, camera });
    }
    world.update({ camera, focus: player, interior: player.interior, now: now / 1000, dt, paused: state.paused, driving: !!driving });
    // Retire distant abandoned takeovers only after they are outside the visible
    // car range. Nearby cars and the vehicle being driven never disappear.
    if (owned.length > 8) for (const car of [...owned]) {
      if (owned.length <= 8) break;
      if (car !== driving && Math.hypot(player.x - car.x, player.z - car.z) > 180) removeDrivableCar(car);
    }
    for (const car of owned) {
      car.root.visible = car === driving || Math.hypot(player.x - car.x, player.z - car.z) < 135;
      if (car.root.visible && !car.root.parent) scene.add(car.root);
      if (!car.root.visible && car.root.parent) scene.remove(car.root);
    }
    updateContactShadows();
    shadows.update(now / 1000, player, state.paused, world.stream.stats.builds);
    const goal = state.started ? mode?.objective?.() ?? null : null;
    hud.waypoint(camera, goal, player, vector, state.started && !state.paused);
    $('crosshair').classList.toggle('aim', !!input.aiming);
    if (now - lastUI > 85) {
      hud.update({ state, player, driving, nearestCar, fps, prompt: liftPrompt() ?? (state.started ? mode?.interactable?.(player) ?? hijackPrompt() : null), weapon, label: mode?.label ?? definition?.title?.toUpperCase() ?? 'AFTERLIGHT' });
      if (state.started) mode?.hud?.({ player, goal, time: state.time });
      drawMaps();
      const minute = 48 + Math.floor(state.time / 45); $('game-time').textContent = `${String((23 + Math.floor(minute / 60)) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      lastUI = now;
    }
    renderer.info.reset();
    frameCosts.updateMs = damp(frameCosts.updateMs, performance.now() - updateStart, 3, dt);
    const renderStart = performance.now();
    if (quality === 'high') composer.render(); else renderer.render(scene, camera);
    frameCosts.renderMs = damp(frameCosts.renderMs, performance.now() - renderStart, 3, dt);
    if (!state.paused && document.hasFocus() && !world.stream.stats.queued && resolution.sample(rawDt, RENDER_PROFILES[quality].minScale)) applyResolution();
  }

  // --- Diagnostics -----------------------------------------------------------------
  function snapshot() {
    return {
      mode: definition?.id ?? null, started: state.started, paused: state.paused, modal: state.modal, time: state.time,
      ammo: weapon.ammo, reloading: weapon.reloading, armed: weapon.enabled,
      sound: { enabled: audio.enabled, state: audio.context?.state ?? 'idle' }, crowdArchetypes: traffic.pedestrians.archetypes,
      position: { x: player.x, y: player.y, z: player.z }, driving: driving ? { x: driving.x, y: driving.y, z: driving.z, speed: driving.speed, yaw: driving.yaw } : null,
      traversal: { groundY: player.groundY, verticalSpeed: player.velocityY, parachute: player.parachute && { ...player.parachute }, climb: player.climb && { mode: player.climb.mode, roofY: player.climb.roofY, phase: player.climb.phase, blocked: player.climb.blocked }, candidate: player.climbCandidate, nearby: nearbyColliders(player.x, player.z, 3) },
      yaw: cameraYaw, pitch: cameraPitch, fps, quality, touch: input.touch, drawCalls: renderer.info.render.calls,
      rendering: { triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, pixelRatio: renderer.getPixelRatio() },
      performance: { ...frameCosts, scale: resolution.scale, activeCrowd: traffic.pedestrians.active, streaming: { ...world.stream.stats }, blueprints: world.metropolis.blocks.size }, population: traffic.pedestrians.snapshot(),
      shadows: { ...shadows.snapshot(), contacts: contactShadows.snapshot() }, traffic: traffic.snapshot(),
      city: { span: world.limit * 2, areaKm2: (world.limit * 2 / 1000) ** 2, districts: world.districts.length, roads: world.plan.roads.length, vertical: true },
      character: { bones: character.bones.size, animations: Object.keys(character.clips), activeAnimation: character.animation, jumpPhase: player.jumpPhase, speed: player.speed, combatWeight: character.combatWeight, crowdCount: traffic.pedestrians.count, crowdDrawCalls: traffic.pedestrians.drawCalls, muzzle: character.muzzle.getWorldPosition(new THREE.Vector3()).toArray() },
      camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: camera.fov, aspect: camera.aspect },
      cars: owned.map(c => ({ x: c.x, y: c.y, z: c.z, trafficId: c.trafficId })),
      interior: player.interior && { building: player.interior.id, level: player.interior.level, levels: player.interior.plan.levels, inside: player.interior.inside, layout: player.interior.plan.layout,
        room: player.interior.inside ? roomAt(player.interior.plan, player.interior.level, player.interior.local.x, player.interior.local.z)?.id ?? null : null, lift: nearLift() },
      interiors: world.interiors.snapshot(), objective: mode?.objective?.() ?? null, renderer: renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL',
      ...(mode?.snapshot?.() ?? {}),
    };
  }
  // --- Boot ---------------------------------------------------------------
  async function boot() {
    const mobile = matchMedia('(pointer: coarse)').matches;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: mobile ? 'default' : 'high-performance' });
    renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.info.autoReset = false;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .12, 760);
    // Wait briefly for the local UI font before drawing the permanent sign textures.
    await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1000))]);
    $('loading-text').textContent = 'BUILDING AFTERLIGHT / STREETS, SKYWAYS & STORIES...';
    assets = await loadCharacterAssets();
    world = createWorld({ scene, renderer });
    character = createCharacter(assets.player); scene.add(character.root);
    parachute = createParachute(); character.root.add(parachute.root);
    traffic = createTraffic({ scene, world, assets });
    shadows = createShadows(renderer, scene, world.atmosphere.moon, { dynamicRoots: [traffic.root, character.root, ...traffic.pedestrians.people.map(p => p.root)] });
    contactShadows = createContactShadows(scene);
    effects = createEffects(scene);
    hud = new HUD(world);
    input = new Input(canvas, {
      interact, jump, climb: toggleClimb, map: toggleMap, pause: () => ui.togglePause(),
      reload: () => weapon.reload(), fire: () => weapon.fire(),
      journal: () => mode?.onAction?.('journal'), medkit: () => mode?.onAction?.('medkit'),
      blur: () => { mode?.onMenu?.(); if (state.started && !state.paused) ui.setPause(true); }, audio: () => audio.init(),
    });
    ui = createUI({ state, input, audio, onMenu: id => { mode?.onMenu?.(id); if (id && state.started) save(); } });
    owned = traffic.owned;
    weapon = createWeapon({ camera, character, audio, effects, hud, input, traffic }, {
      canAct: () => state.started && !state.paused && !driving && !player.climb && !player.parachute,
      scenery, ownedCars: () => owned, allCars, shot: () => characterShot(character),
    });
    attachMapControls({ view: world.mapView, canvas: $('full-map'), position: () => player, onPick: (x, y) => mode?.mapPick?.(x, y) });
    quality = input.touch ? 'low' : 'high'; $('quality').value = quality;
    setQuality(quality);
    setupUI();
    placeAt(world.spawn, { cameraYaw: world.spawn.yaw, cameraPitch: world.spawn.pitch });
    traffic.update(0, { player, vehicle: driving, camera, range: RENDER_PROFILES[quality].actors });
    renderPicker();
    renderer.compile(scene, camera);
    $('loading').style.opacity = '0'; setTimeout(() => $('loading').classList.add('hidden'), 500);
    lastFrame = performance.now(); frame(lastFrame);
    document.addEventListener('visibilitychange', () => { if (document.hidden) mode?.onMenu?.(); });
    window.addEventListener('pagehide', () => { mode?.onMenu?.(); save(); if (animationId) cancelAnimationFrame(animationId); });
    window.addEventListener('pageshow', event => { if (event.persisted) { lastFrame = performance.now(); frame(lastFrame); } });
  }

  await boot();
  return { activate, deactivate, snapshot, teleport: placeAt, get mode() { return definition?.id ?? null; } };
}
