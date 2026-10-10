import * as THREE from 'three';
import { Campaign, freshProgress, readSave, writeSave, WORLD_REVISION } from './campaign.js';
import { WORLD_OBJECTS, ENCOUNTERS, QUESTS, districtAt, placeById } from './content.js';
import { createWorldLife, COLORS, SYMBOLS } from './world-life.js';
import { RPGUI } from './rpg-ui.js';
import { DialogueVoice } from './voice.js';
import { createDrone } from './drones.js';
import { createStoryHud } from './hud.js';
import { createNPCPortraits } from '../../actors/npc-appearance.js';
import { damp, moveWithCollisions, rayObstructionDistance } from '../../core/physics.js';
import { terrainHeight } from '../../world/master-plan.js';

const PROMPTS = { contact: 'Talk', cache: 'Search supplies', memory: 'Recover memory', terminal: 'Access terminal', transit: 'Open transit map', rest: 'Rest & recover', board: 'Browse local jobs' };
const TERMINAL_REPLIES = {
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
  'freight-manifest': 'MANIFEST RECOVERED // These “abandoned” crates belong to residents of the East Reach. Return the records to Rook.',
};

export function chapterSummary(progress) {
  const story = QUESTS.filter(q => q.kind === 'story'), minutes = Math.round((progress.elapsed ?? 0) / 60);
  const played = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  if (progress.ending) return `Epilogue · ${played}`;
  const active = story.find(q => progress.quests[q.id]?.status === 'active') ?? story[0];
  return `Chapter ${active.chapter} · ${active.title} · ${played}`;
}

/** The Last Signal: the original RPG campaign, packaged as a game mode. */
export default {
  id: 'story',
  title: 'The Last Signal',
  tagline: 'STORY / SIX CHAPTERS',
  description: 'A city forgot 8,412 people. Trace the blackout with Mara, Sable, Jun and Orrin, fight rogue drones and decide who controls Afterlight.',
  accent: '#deff7a',
  saveSummary(storage) { const save = readSave(storage); return save.loaded ? chapterSummary(save.progress) : null; },
  async create(host, { fresh = false } = {}) {
    await import('./npc.css'); // Speaker portraits and people cards load with the mode.
    return createStory(host, fresh);
  },
};

function createStory(host, fresh) {
  const { scene, world, storage, assets, audio, effects, weapon, ui } = host, you = host.player;
  const saved = fresh ? { progress: freshProgress(), position: null, loaded: false } : readSave(storage);
  const campaign = new Campaign(saved.progress), vitals = { health: 100, armor: campaign.maxArmor, damageAt: -100 };
  const voice = new DialogueVoice({ storage }), drones = [], direction = new THREE.Vector3(), point = new THREE.Vector3();
  let savedRevision = -1, saveWarningShown = false;
  host.clock.time = campaign.data.elapsed;

  const worldLife = createWorldLife(scene, assets.citizen, campaign, assets.humanBases);
  for (const avatar of Object.values(worldLife.avatars)) host.shadows.addDynamic(avatar.root);
  for (const object of worldLife.objects) host.shadows.addCasters(object.root);
  const portraits = createNPCPortraits(host.renderer, worldLife.avatars);
  ENCOUNTERS.forEach(encounter => encounter.positions.forEach(([x, z], i) => {
    const homeY = encounter.heights?.[i] ?? terrainHeight(x, z);
    const model = createDrone(); model.root.position.set(x, homeY + 3.1, z); scene.add(model.root); host.shadows.addDynamic(model.root);
    const id = `${encounter.id}-${i}`, dead = campaign.data.kills.includes(id); model.root.visible = !dead;
    drones.push({ ...model, id, group: encounter.id, homeX: x, homeY, homeZ: z, health: dead ? 0 : 100, dead, phase: i * 2.3, fireTimer: 2 + i * .5, engaged: false });
  }));

  const rpgUI = new RPGUI(campaign, {
    voice, portraits, mapView: world.mapView, position: () => you.state,
    open: id => ui.open(id, id === 'service' ? action => rpgUI.action(action) : undefined), close: () => ui.close(),
    notify: text => host.hud.notify(text), changed, medkit: useMedkit, health: () => vitals.health,
    upgraded: () => { vitals.armor = campaign.maxArmor; }, travel: fastTravel, newStory,
  });
  ui.register('journal', 'KeyJ'); ui.register('dialogue');
  const storyHud = createStoryHud(host, { journal: toggleJournal, medkit: useMedkit });
  const settings = document.createElement('div');
  settings.innerHTML = `<div class="setting-row"><label for="voice-enabled">Spoken NPC dialogue</label><input id="voice-enabled" type="checkbox" checked /></div>
    <div class="setting-row voice-volume-row"><label for="voice-volume">Voice volume <output id="voice-volume-value" for="voice-volume">80%</output></label><input id="voice-volume" type="range" min="0" max="100" step="5" value="80" /></div>
    <p id="voice-settings-note" class="menu-note"></p>
    <p class="menu-note">J — journal · Q — medkit · E — talk to contacts and use terminals. Shoot rogue drones; hit a traffic car three times to stop it and drive.</p>`;
  settings.querySelector('#voice-enabled').addEventListener('change', e => voice.setEnabled(e.target.checked));
  settings.querySelector('#voice-volume').addEventListener('input', e => voice.setVolume(Number(e.target.value) / 100));
  const unsubscribeVoice = voice.subscribe(state => {
    settings.querySelector('#voice-enabled').checked = state.enabled; settings.querySelector('#voice-enabled').disabled = !state.supported;
    settings.querySelector('#voice-volume').value = Math.round(state.volume * 100); settings.querySelector('#voice-volume').disabled = !state.supported;
    settings.querySelector('#voice-volume-value').textContent = `${Math.round(state.volume * 100)}%`;
    settings.querySelector('#voice-settings-note').textContent = state.supported ? 'Spoken dialogue uses your browser’s voices. Subtitles stay on. Sound effects have a separate speaker button.' : 'This browser has no speech service. All dialogue remains available as subtitles.';
  });
  ui.menu([
    { label: 'Return to your last refuge', action: () => { respawn(); ui.close(); } },
    { label: 'Start a new story…', action: () => rpgUI.confirmNewStory() },
  ], settings);
  ui.legend('<span><i class="legend-drone"></i> ROGUE DRONE</span><span>● CONTACT</span><span>T TRANSIT</span><span>◈ MEMORY</span>');
  ui.controls('<span><kbd>J</kbd> JOURNAL</span>');
  weapon.enable({ damage: () => campaign.damage, targets: () => drones.filter(d => !d.dead && d.root.visible).map(d => ({ position: d.root.position, radius: 1.02, hit: amount => damageDrone(d, amount) })) });
  host.contactShadows.add(items => {
    for (const { root } of Object.values(worldLife.avatars)) if (root.visible && root.parent?.visible && root.parent.parent === scene) {
      root.getWorldPosition(point);
      items.push({ x: point.x, z: point.z, y: root.parent.position.y + .015, width: 1.6, length: 1.6 });
    }
  });

  // --- Story rules -----------------------------------------------------------
  function refugeSpot(place) { return place ? you.spawnNear(place, place.arrivalOffset ?? { x: 0, z: -2 }) : null; }
  function objective() {
    const p = you.state, goal = campaign.objective(p), ramp = goal.approach;
    if (ramp && p.y < goal.y - 2 && Math.hypot(p.x - goal.x, p.z - goal.z) < 250) {
      const ascending = p.y > terrainHeight(p.x, p.z) + .8 || Math.hypot(p.x - ramp.a.x, p.z - ramp.a.z) < 9;
      const length = Math.hypot(ramp.b.x - ramp.a.x, ramp.b.z - ramp.a.z);
      // Approach from beyond the low end, instead of aiming through its side rail.
      const entry = { x: ramp.a.x + (ramp.a.x - ramp.b.x) / length * 8, z: ramp.a.z + (ramp.a.z - ramp.b.z) / length * 8 };
      const target = ascending ? ramp.b : { ...entry, y: terrainHeight(entry.x, entry.z) };
      return { ...goal, ...target, label: ramp.name, text: `${ascending ? 'Follow the ramp up' : 'Reach the pedestrian ramp'} → ${goal.label}` };
    }
    return goal;
  }
  function changed() {
    const messages = campaign.messages.splice(0);
    if (messages.length) { host.hud.notify(messages.slice(-2).join('  /  '), 5); if (messages.some(m => m.startsWith('COMPLETED'))) audio.reward(); }
    if (savedRevision !== campaign.revision) host.save();
  }
  function useMedkit() {
    const health = campaign.useMedkit(vitals.health);
    if (!health) { host.hud.notify(vitals.health >= 100 ? 'Your health is already full.' : 'No medkits. Visit Imani, Orrin or Rook for supplies.', 3); return; }
    vitals.health += health; audio.reward(); changed();
  }
  function toggleJournal() { if (host.state.modal === 'journal') ui.close(); else rpgUI.openJournal(); }
  function resetDrones(revive = false) {
    for (const drone of drones) {
      if (revive) { drone.dead = false; drone.health = 100; drone.root.visible = true; drone.fireTimer = 2; }
      drone.engaged = false; drone.root.position.set(drone.homeX, drone.homeY + 3, drone.homeZ);
    }
  }
  function respawn() {
    const refuge = placeById(campaign.data.rest), spot = refugeSpot(refuge) ?? refugeSpot(placeById('home'));
    if (!spot) { host.hud.notify('The refuge approach is blocked. Clear a space before recovering here.', 4); return; }
    you.teleport(spot, { cameraYaw: -Math.PI / 2, cameraPitch: .12, playerYaw: -Math.PI / 2 });
    vitals.health = 100; vitals.armor = campaign.maxArmor; vitals.damageAt = -100; weapon.refill(); weapon.cooldown = .5;
    resetDrones();
    host.hud.notify(`BACK ON YOUR FEET // ${refuge.name}. Your story progress is safe.`, 4); host.save();
  }
  function newStory() {
    campaign.data = freshProgress(); campaign.pin = null; campaign.messages = []; campaign.changed();
    you.releaseVehicles(); resetDrones(true);
    host.clock.time = 0; vitals.damageAt = -100;
    respawn(); ui.close();
    rpgUI.selectedQuest = 'dead-air'; rpgUI.tab = 'quests'; host.save();
    host.hud.notify('A NEW SIGNAL // Mara is waiting on the Upper Market. Your story starts here.', 6);
  }
  function fastTravel(id) {
    if (!campaign.data.transit.includes(id)) return 'Discover this platform first.';
    if (you.driving) return 'Exit your vehicle before taking the tram.';
    const p = you.state;
    if (host.clock.time - vitals.damageAt < 10 || drones.some(d => !d.dead && d.engaged && Math.hypot(d.root.position.x - p.x, d.root.position.z - p.z) < 30)) return 'Lose the patrols and stay clear of combat for 10 seconds.';
    const stop = placeById(id), arrival = you.spawnNear(stop, { x: 0, z: 2 });
    if (!arrival) return 'The destination platform is blocked. Try another station or clear its arrival area.';
    you.teleport(arrival, { cameraYaw: 0 }); host.clock.time += 90;
    host.hud.notify(`NIGHT TRAM // ${stop.name}`, 4); host.save(); return true;
  }
  function useWorldObject(place) {
    if (campaign.pin === place.id) campaign.pin = null;
    if (place.type === 'contact') rpgUI.openContact(place.id);
    else if (place.type === 'cache' || place.type === 'memory') {
      if (campaign.collect(place.id) && place.type === 'memory') rpgUI.openMemory(place.id);
    } else if (place.type === 'transit') { campaign.unlockTransit(place.id); rpgUI.selectedPlace = place.id; ui.openMap(); }
    else if (place.type === 'rest') { campaign.data.rest = place.id; campaign.changed(); vitals.health = 100; vitals.armor = campaign.maxArmor; weapon.refill(); host.hud.notify('REFUGE // Health, armor and ammo restored. Progress saved.', 5); }
    else if (place.type === 'board') { campaign.event('interact', 'board'); rpgUI.openBoard(); }
    else if (place.id === 'uplink' && campaign.current('before-dawn')?.type === 'choice') rpgUI.openEnding();
    else {
      const relevant = campaign.activeSteps().some(({ step }) => step.type === 'interact' && step.target === place.id);
      if (relevant) { campaign.event('interact', place.id); audio.reward(); }
      rpgUI.showTerminal(place, relevant ? TERMINAL_REPLIES[place.id] ?? 'Data recovered. Your journal has been updated.' : `${place.description}\n\nNo active task requires this terminal. Speak to local contacts or check your journal.`);
    }
    changed();
  }
  function damageDrone(drone, amount) {
    drone.health -= amount; drone.engaged = true; effects.hitMarker(); audio.hit();
    effects.sparks(drone.root.position, 0xffb37f, 6);
    if (drone.health <= 0 && !drone.dead) {
      drone.dead = true; drone.root.visible = false; audio.explosion();
      effects.sparks(drone.root.position, 0xff8c6f, 28); campaign.recordKill(drone.id, drone.group); changed();
    }
  }
  function damagePlayer(amount) {
    vitals.damageAt = host.clock.time;
    const absorbed = Math.min(vitals.armor, amount); vitals.armor -= absorbed; vitals.health = Math.max(0, vitals.health - (amount - absorbed));
    effects.damageFlash(); audio.tone(100, .09, 'triangle', .24, 40);
    if (vitals.health <= 0) { respawn(); host.hud.notify('SIGNAL RECOVERED // You were brought back to your last refuge.', 5); }
  }
  function updateDrones(dt) {
    const p = you.state, driving = you.driving, target = new THREE.Vector3(p.x, p.y + (driving ? 1.1 : 1.4), p.z);
    for (const drone of drones) {
      if (drone.dead) continue;
      drone.phase += dt; const pos = drone.root.position;
      const distance = pos.distanceTo(target), awake = campaign.data.ending !== 'order' && distance < 24;
      drone.root.visible = distance < host.actorRange() + 30;
      if (!drone.root.visible) { drone.engaged = false; continue; }
      // Patrols defend their own streets; they cannot follow a runner across the entire city.
      if (Math.hypot(p.x - drone.homeX, p.z - drone.homeZ) > 42 || campaign.data.ending === 'order') drone.engaged = false;
      const targetX = awake && drone.engaged ? p.x + Math.sin(drone.phase * .7) * 9 : drone.homeX + Math.sin(drone.phase * .35) * 2.6;
      const targetZ = awake && drone.engaged ? p.z - 10 + Math.cos(drone.phase * .6) * 3 : drone.homeZ + Math.cos(drone.phase * .32) * 2.7;
      moveWithCollisions(pos, damp(pos.x, targetX, .55, dt) - pos.x, damp(pos.z, targetZ, .55, dt) - pos.z, .9, world.spatial, world.limit);
      pos.y = drone.homeY + 2.9 + Math.sin(drone.phase * 1.8) * .35;
      drone.root.rotation.y = awake ? Math.atan2(-(p.x - pos.x), -(p.z - pos.z)) : drone.phase * .3;
      drone.root.rotation.z = Math.sin(drone.phase * 1.2) * .045;
      for (const rotor of drone.rotors) rotor.rotation.y += dt * 42;
      if (driving && distance < 3.5 && Math.abs(driving.speed) > 9) { damageDrone(drone, 100); continue; }
      if (awake) {
        drone.fireTimer -= dt;
        if (drone.fireTimer <= 0) {
          drone.fireTimer = 2.1 + Math.random() * .6;
          direction.subVectors(target, pos).normalize();
          const visible = rayObstructionDistance(pos, direction, distance, you.scenery(), you.allCars(), driving) === Infinity;
          if (visible) { drone.engaged = true; effects.tracer(pos, target, 0xff4967, .13); damagePlayer(driving ? 3 : 6); }
        }
      }
    }
  }

  // --- Mode interface ----------------------------------------------------------
  return {
    label: 'STORY',
    spawn() {
      const resume = saved.loaded && saved.worldRevision === WORLD_REVISION ? saved.position : null;
      if (resume && you.canStandAt(resume)) return { ...resume, cameraYaw: world.spawn.yaw, cameraPitch: world.spawn.pitch };
      const spot = refugeSpot(placeById(campaign.data.rest)) ?? refugeSpot(placeById('home'));
      if (!spot) throw new Error('No clear refuge arrival is available.');
      return { ...spot, cameraYaw: world.spawn.yaw, cameraPitch: world.spawn.pitch };
    },
    welcome() {
      if (fresh) return 'A NEW SIGNAL // Mara is waiting on the Upper Market. Your story starts here.';
      if (saved.loaded && saved.worldRevision !== WORLD_REVISION) return 'AFTERLIGHT COMPACTED // Your story is preserved. You have returned to your refuge in the smaller city.';
      return saved.warning ?? (saved.loaded ? 'WELCOME BACK // Your story continues. J for your field journal.' : 'MARA: Vex. Upper Market, one level up. We need to talk. // E to interact · J for your journal');
    },
    update(dt, { camera }) {
      updateDrones(dt);
      worldLife.update(dt, host.clock.time, you.state, host.actorRange(), camera);
      if (host.clock.time - vitals.damageAt > 7) {
        vitals.armor = Math.min(campaign.maxArmor, vitals.armor + dt * 5); vitals.health = Math.min(100, vitals.health + dt * 1.8);
      }
      const p = you.state, district = districtAt(p.x, p.z);
      if (campaign.discover(district.id)) rpgUI.announceDistrict(district);
      if (!you.driving) for (const place of WORLD_OBJECTS) if (place.type === 'transit' && Math.abs(p.y - place.y) < 2 && Math.hypot(p.x - place.x, p.z - place.z) < 6) campaign.unlockTransit(place.id);
      changed();
    },
    interactable(p) {
      const place = worldLife.nearest(p);
      return place ? { id: place.id, caption: place.name.toUpperCase(), label: PROMPTS[place.type], use: () => useWorldObject(place) } : null;
    },
    interactHint: () => 'Approach a person, glowing terminal, cache or stopped vehicle. E to interact.',
    objective,
    mapMarkers({ player: p }) {
      const goal = objective(), markers = [];
      for (const place of WORLD_OBJECTS) {
        if (campaign.data.collected.includes(place.id)) continue;
        if (['cache', 'memory'].includes(place.type) && Math.hypot(p.x - place.x, p.z - place.z) > 38 && place.id !== goal.id) continue;
        if (place.type === 'terminal' && place.id !== goal.id) continue;
        markers.push({ x: place.x, z: place.z, color: COLORS[place.type], symbol: SYMBOLS[place.type], radius: place.type === 'contact' ? 4.5 : 3, dim: place.type === 'transit' && !campaign.data.transit.includes(place.id) });
      }
      for (const drone of drones) if (!drone.dead) markers.push({ x: drone.root.position.x, z: drone.root.position.z, color: '#ff647e', radius: 3.5 });
      return markers;
    },
    districtKnown: id => campaign.data.discovered.includes(id),
    mapOpened: () => rpgUI.renderMap(),
    mapPick: (x, y) => rpgUI.pickMapPlace(x, y),
    onAction(action) { if (!host.state.started) return; if (action === 'journal') toggleJournal(); if (action === 'medkit') useMedkit(); },
    onMenu: () => voice.stop(),
    onVehicleImpact(speed) { if (Math.abs(speed) > 14 && host.clock.time - vitals.damageAt > .7) damagePlayer(Math.min(16, Math.abs(speed) * .3)); },
    sprintSpeed: () => campaign.sprintSpeed,
    hud({ player: p }) { storyHud.update({ campaign, vitals, player: p, objective: objective() }); },
    safeSpot: () => placeById(campaign.data.rest),
    save({ position, time }) {
      campaign.data.elapsed = time;
      const success = writeSave(storage, campaign.data, position);
      const status = document.getElementById('save-status');
      if (status) status.textContent = success ? 'PROGRESS SAVED / THIS BROWSER' : 'SAVE UNAVAILABLE / THIS SESSION ONLY';
      if (!success && !saveWarningShown) { host.hud.notify('Browser storage is unavailable. Progress will last for this session only.', 7); saveWarningShown = true; }
      savedRevision = campaign.revision;
    },
    snapshot() {
      return {
        health: vitals.health, armor: vitals.armor, voice: voice.snapshot(), cast: Object.keys(worldLife.avatars),
        castBases: Object.fromEntries(Object.entries(worldLife.avatars).map(([id, avatar]) => [id, avatar.root.userData.baseModel])),
        drones: drones.map(d => ({ x: d.root.position.x, y: d.root.position.y, z: d.root.position.z, health: d.health, dead: d.dead })),
        campaign: structuredClone(campaign.data), interaction: worldLife.nearest(you.state)?.id ?? null,
      };
    },
    dispose() {
      voice.stop(); unsubscribeVoice(); rpgUI.dispose(); storyHud.dispose();
      for (const object of worldLife.objects) {
        scene.remove(object.root);
        object.root.traverse(o => { if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); } });
      }
      for (const avatar of Object.values(worldLife.avatars)) avatar.dispose?.();
      for (const drone of drones) scene.remove(drone.root);
    },
  };
}
