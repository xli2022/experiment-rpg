import { createNPC } from './npc-appearance.js';
import { CROWD_PROFILES } from './npc-profiles.js';
import { createVisitor, VISITOR_PROFILES } from './npc-visitors.js';
import { seededRandom, circleHitsBox, overlapsHeight, surfaceHeightAt, angleDelta, clamp } from './physics.js';
import * as THREE from 'three';
import { streetPoint } from './metropolis.js';
import { populationFor } from './population.js';

export function samplePedestrianPath(path, along, city) {
  const t = clamp(along / path.length, 0, 1), x = path.a.x + (path.b.x - path.a.x) * t, z = path.a.z + (path.b.z - path.a.z) * t;
  const y = path.terrain ? city.masterPlan.terrainHeight(x, z) + .08 : path.a.y + (path.b.y - path.a.y) * t;
  return { x, y, z };
}

// Derive sidewalks from the rendered roads and pedestrian decks. A short path
// can turn back at its end; it never wraps across a block or invents a highway crossing.
export function pedestrianPaths(city, player, radius = 170) {
  const plan = city.masterPlan, paths = [];
  if (!plan) return paths;
  const clear = p => {
    const boxes = city.spatial?.near(p.x, p.z, .6) ?? city.colliders ?? [];
    if (boxes.some(b => !b.supportOnly && overlapsHeight(b, p.y, 1.8) && circleHitsBox(p.x, p.z, .45, b))) return false;
    return !(plan.roadIndex?.near(p.x, p.z, 1) ?? []).some(s => {
      const top = surfaceHeightAt(p.x, p.z, s);
      return top !== null && Math.abs(top - p.y) < 2;
    });
  };
  const add = (id, a, b, terrain = false) => {
    const path = { id, a, b, terrain, length: Math.hypot(b.x - a.x, b.z - a.z) };
    if (path.length < 6) return;
    const steps = Math.ceil(path.length / 3);
    for (let i = 0; i <= steps; i++) if (!clear(samplePedestrianPath(path, path.length * i / steps, city))) return;
    paths.push(path);
  };
  for (const s of plan.roadIndex?.near(player.x, player.z, radius) ?? []) {
    if (s.road?.class === 'expressway' || s.road?.class === 'ramp' || s.kind === 'ramp') continue;
    if (Math.abs(s.a.y - plan.terrainHeight(s.a.x, s.a.z)) > 2 || Math.abs(s.b.y - plan.terrainHeight(s.b.x, s.b.z)) > 2) continue;
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, length = Math.hypot(dx, dz);
    if (length < 8) continue;
    for (const side of [-1, 1]) {
      const offset = side * (s.width / 2 + 2);
      const a = { x: s.a.x - dz / length * offset, z: s.a.z + dx / length * offset };
      const b = { x: s.b.x - dz / length * offset, z: s.b.z + dx / length * offset };
      add(`sidewalk:${s.id}:${side}`, a, b, true);
    }
  }
  for (const s of plan.supportIndex?.near(player.x, player.z, radius) ?? []) {
    if (s.a && s.pedestrian) {
      add(`walk-ramp:${s.id}`, s.a, s.b);
    } else if (s.kind === 'deck') {
      const horizontal = s.width >= s.depth;
      const half = (horizontal ? s.width : s.depth) / 2 - 2;
      const cross = Math.min(2, (horizontal ? s.depth : s.width) / 2 - 1.6);
      for (const side of [-1, 1]) add(`deck:${s.id}:${side}`,
        { x: s.x + (horizontal ? -half : side * cross), y: s.y, z: s.z + (horizontal ? side * cross : -half) },
        { x: s.x + (horizontal ? half : side * cross), y: s.y, z: s.z + (horizontal ? side * cross : half) });
    }
  }
  return paths.sort((a, b) => Math.hypot((a.a.x + a.b.x) / 2 - player.x, (a.a.z + a.b.z) / 2 - player.z) - Math.hypot((b.a.x + b.b.x) / 2 - player.x, (b.a.z + b.b.z) / 2 - player.z)).slice(0, 96);
}

const floorDistance = (position, player) => Math.abs(position.y - (player.y ?? 0));
const populationDistance = (position, player) => Math.hypot(position.x - player.x, position.z - player.z) * .15 +
  floorDistance(position, player) * 12 + (floorDistance(position, player) >= 3 ? 1000 : 0);
const separated = (a, b, spacing) => Math.abs(a.y - b.y) >= 3 || Math.hypot(a.x - b.x, a.z - b.z) >= spacing;

// Capacity comes from actual nearby walking space. Slots on neighboring road
// segments or two close deck lanes share the same spacing, so splitting one
// sidewalk into more mesh segments never creates a denser crowd.
function pedestrianSlots(paths, city, player, radius, spacing) {
  const candidates = [], reach = radius + Math.min(24, radius * .35);
  for (const path of paths) {
    const dx = path.b.x - path.a.x, dz = path.b.z - path.a.z;
    const along = clamp(((player.x - path.a.x) * dx + (player.z - path.a.z) * dz) / path.length, 0, path.length);
    const closest = samplePedestrianPath(path, along, city), distance = Math.hypot(closest.x - player.x, closest.z - player.z);
    if (distance > reach) continue;
    const extent = Math.sqrt(Math.max(0, reach * reach - distance * distance));
    const start = Math.max(1.5, along - extent), end = Math.min(path.length - 1.5, along + extent);
    if (end < start) continue;
    const count = Math.min(40, Math.floor((end - start) / spacing) + 1), offset = (end - start - (count - 1) * spacing) / 2;
    for (let i = 0; i < count; i++) {
      const at = start + offset + i * spacing, position = samplePedestrianPath(path, at, city);
      const distance = Math.hypot(position.x - player.x, position.z - player.z);
      if (distance < 4) continue;
      candidates.push({ path, along: at, position, score: populationDistance(position, player) + Math.max(0, distance - radius) * 3 });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  const slots = [];
  for (const slot of candidates) {
    if (slots.some(other => !separated(slot.position, other.position, spacing))) continue;
    slots.push(slot);
    if (slots.length === 192) break;
  }
  return slots;
}

// Full authored skeletal motion, including the hands, torso and feet.
export function createCrowd(scene, asset, city = null, visitorAssets = {}, humanBases = {}) {
  // Each archetype gets a reusable slot. Interleave visitors with pairs of
  // humans so lower population budgets still show a representative mixture;
  // the district budget below continues to cap the active population.
  const roster = [];
  for (let i = 0; i < Math.max(CROWD_PROFILES.length, VISITOR_PROFILES.length * 2); i++) {
    if (CROWD_PROFILES[i]) roster.push({ human: CROWD_PROFILES[i] });
    if (i % 2 === 0 && VISITOR_PROFILES[i / 2]) roster.push({ visitor: VISITOR_PROFILES[i / 2] });
  }
  const count = roster.length, random = seededRandom(707);
  let drawCalls = 0, active = 0, quality = 'high', target = count, spacing = 7, district = null;
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 2);
  let paths = [], slots = [], scanTime = 0, spawnTime = 0, spawnCursor = 0, firstUpdate = true, scanX = Infinity, scanY = Infinity, scanZ = Infinity;
  const inView = p => { sphere.center.set(p.x, (p.y ?? 0) + 1, p.z); return frustum.intersectsSphere(sphere); };
  let fallbackIndex = 0;
  const people = roster.map(({ visitor, human }, i) => {
    const available = visitor && visitorAssets[visitor.id];
    const profile = available ? visitor : human ?? CROWD_PROFILES[fallbackIndex++ % CROWD_PROFILES.length];
    const species = available ? visitor.species : 'human', model = profile.id;
    const humanAsset = humanBases[profile.baseModel] ?? asset;
    const avatar = available ? createVisitor(available, profile, 'Walk') : createNPC(humanAsset, profile, i % 3 ? 'Walk' : 'WalkFormal');
    const { root, mixer, action } = avatar;
    root.userData.species = species; root.userData.model = model;
    if (!available) root.userData.baseModel = humanAsset === asset ? 'citizen' : profile.baseModel;
    const speed = (i % 2 ? 1 : -1) * (.85 + random() * .35);
    root.position.set((i < 14 ? 0 : i < 20 ? -64 : 64) + (i % 2 ? 10.5 : -10.5), .04, -120 + random() * 240);
    root.rotation.y = speed > 0 ? Math.PI : 0;
    root.traverseVisible(object => { if (object.isMesh) drawCalls++; });
    action.time = random() * action.getClip().duration;
    avatar.update(0, Math.abs(speed));
    if (!city?.masterPlan) scene.add(root); else root.visible = false;
    return { root, mixer, avatar, speed, species, model, elapsed: 0, travelled: 0, spawn: root.position.clone(), regional: false, lane: 0, along: 0, path: null };
  });
  function retire(person) {
    person.path = null; person.root.visible = false; person.elapsed = person.travelled = 0;
    if (person.root.parent) scene.remove(person.root);
  }
  function animate(person, distance) {
    if (distance >= 22 && person.elapsed <= .1) return;
    // Use the distance actually travelled, including slower turns and path
    // endpoints. Keep all elapsed time when an offscreen pedestrian reappears
    // so the skeletal cycle remains in step with its world movement.
    const speed = person.elapsed > 0 ? person.travelled / person.elapsed : Math.abs(person.speed);
    person.avatar.update(person.elapsed, speed);
    person.elapsed = person.travelled = 0;
  }
  function relocate(person, camera) {
    let best = null, score = Infinity;
    for (const slot of slots) {
      if (camera && !firstUpdate && inView(slot.position)) continue;
      if (people.some(other => other !== person && other.path && !separated(other.root.position, slot.position, spacing))) continue;
      const occupied = people.filter(other => other.path?.id === slot.path.id).length;
      const value = slot.score + occupied * spacing * 4;
      if (value < score) { best = slot; score = value; }
    }
    if (!best) return false;
    person.path = best.path; person.along = best.along; person.root.position.copy(best.position);
    person.root.rotation.y = Math.atan2((best.path.a.x - best.path.b.x) * Math.sign(person.speed), (best.path.a.z - best.path.b.z) * Math.sign(person.speed));
    return true;
  }
  return { count, drawCalls, people, get active() { return active; }, archetypes: new Set(people.map(person => person.model)).size,
    setQuality(value) { quality = value === 'low' ? 'low' : 'high'; scanTime = spawnTime = 0; },
    snapshot() {
      const assigned = people.filter(person => person.path), species = { human: 0, robot: 0, alien: 0 };
      for (const person of assigned) species[person.species] = (species[person.species] ?? 0) + 1;
      const countBases = list => list.filter(person => person.species === 'human').reduce((counts, person) => {
        const base = person.root.userData.baseModel; counts[base] = (counts[base] ?? 0) + 1; return counts;
      }, {});
      return { capacity: count, target, assigned: assigned.length, active, species,
        humanBases: countBases(assigned), rosterHumanBases: countBases(people),
        spacing, district, quality, paths: paths.length, slots: slots.length };
    },
    update(dt, player, camera, radius = 65) {
    if (camera) { camera.updateMatrixWorld(); matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(matrix); } active = 0;
    if (city?.masterPlan) {
      scanTime -= dt; spawnTime -= dt;
      if (scanTime <= 0 || Math.hypot(player.x - scanX, player.z - scanZ) > 32 || Math.abs((player.y ?? 0) - scanY) > 3) {
        scanTime = 2; scanX = player.x; scanY = player.y ?? 0; scanZ = player.z;
        const population = populationFor(city, player, quality);
        spacing = population.pedestrianSpacing; district = population.district;
        paths = pedestrianPaths(city, player, Math.max(120, radius + 65));
        slots = pedestrianSlots(paths, city, player, radius, spacing);
        target = Math.min(count, population.pedestrians, slots.length);
      }
      const sameFloorSupply = slots.filter(slot => floorDistance(slot.position, player) < 3).length;
      const safeToRecycle = person => !camera || !inView(person.root.position) || Math.hypot(person.root.position.x - player.x, person.root.position.z - player.z) >= radius;
      for (const person of people) if (person.path) {
        const oldDistance = Math.hypot(person.root.position.x - player.x, person.root.position.z - player.z);
        const otherFloor = floorDistance(person.root.position, player) > 4 && sameFloorSupply >= target;
        if ((oldDistance > radius + 40 || otherFloor) && safeToRecycle(person)) retire(person);
      }
      const assigned = people.filter(person => person.path).sort((a, b) => populationDistance(b.root.position, player) - populationDistance(a.root.position, player));
      let assignedCount = assigned.length;
      for (const person of assigned) if (assignedCount > target && safeToRecycle(person)) { retire(person); assignedCount--; }
      // Initial arrivals can fill immediately. Later population changes spend a
      // small fixed budget and wait for an unseen location instead of popping in.
      if (spawnTime <= 0) {
        spawnTime = .35;
        let attempts = firstUpdate ? count : 2;
        for (let examined = 0; examined < count && assignedCount < target && attempts > 0; examined++) {
          const person = people[spawnCursor++ % count];
          if (person.path) continue;
          attempts--;
          if (relocate(person, camera)) assignedCount++;
        }
      }
      for (const person of people) {
        if (!person.path) continue;
        const previousAlong = person.along;
        // Turn on the spot before stepping in the new direction, rather than
        // sliding backwards for half a second while the body catches up.
        if (person.speed !== 0) {
          const yaw = Math.atan2((person.path.a.x - person.path.b.x) * Math.sign(person.speed), (person.path.a.z - person.path.b.z) * Math.sign(person.speed));
          person.root.rotation.y += angleDelta(person.root.rotation.y, yaw) * (1 - Math.exp(-7 * dt));
        }
        const pathYaw = Math.atan2((person.path.a.x - person.path.b.x) * Math.sign(person.speed), (person.path.a.z - person.path.b.z) * Math.sign(person.speed));
        const forward = Math.max(0, Math.cos(angleDelta(person.root.rotation.y, pathYaw)));
        let next = person.along + person.speed * forward * dt;
        if (next < 0 || next > person.path.length) { next = clamp(next, 0, person.path.length); person.speed *= -1; }
        const ahead = samplePedestrianPath(person.path, next, city);
        if (people.some(other => other !== person && other.path && !separated(ahead, other.root.position, 1.5) &&
          Math.hypot(ahead.x - other.root.position.x, ahead.z - other.root.position.z) < Math.hypot(person.root.position.x - other.root.position.x, person.root.position.z - other.root.position.z))) {
          person.speed *= -1; next = person.along;
        }
        person.along = next;
        const p = samplePedestrianPath(person.path, person.along, city);
        person.root.position.set(p.x, p.y, p.z);
        const distance = Math.hypot(p.x - player.x, p.z - player.z);
        person.root.visible = distance < radius && (!camera || inView(p)); person.elapsed += dt;
        person.travelled += Math.abs(person.along - previousAlong);
        if (!person.root.visible) { if (person.root.parent) scene.remove(person.root); continue; }
        if (!person.root.parent) scene.add(person.root);
        active++;
        animate(person, distance);
      }
      firstUpdate = false;
      return;
    }
    const regional = Math.max(Math.abs(player.x), Math.abs(player.z)) > 950;
    for (const [i, person] of people.entries()) {
      let distance = Math.hypot(person.root.position.x - player.x, person.root.position.z - player.z);
      if (regional && (!person.regional || distance > 250)) {
        person.regional = true; person.lane = (Math.round(player.x / 192) + i % 3 - 1) * 192; person.along = player.z + (i - 13) * 13;
      } else if (!regional && person.regional) { person.regional = false; person.root.position.copy(person.spawn); }
      if (person.regional) {
        person.along += person.speed * dt;
        const point = streetPoint(person.lane, person.along), ahead = streetPoint(person.lane, person.along + Math.sign(person.speed));
        person.root.position.set(point.x + (i % 2 ? 11 : -11), .04, point.z);
        person.root.rotation.y = Math.atan2(point.x - ahead.x, point.z - ahead.z);
      } else {
        person.root.rotation.y = person.speed > 0 ? Math.PI : 0;
        person.root.position.z += person.speed * dt;
        if (person.root.position.z > 130) person.root.position.z = -130;
        if (person.root.position.z < -130) person.root.position.z = 130;
      }
      distance = Math.hypot(person.root.position.x - player.x, person.root.position.z - player.z);
      sphere.center.copy(person.root.position); sphere.center.y += 1;
      person.root.visible = distance < radius && (!camera || frustum.intersectsSphere(sphere));
      person.elapsed += dt; person.travelled += Math.abs(person.speed) * dt;
      if (!person.root.visible) { if (person.root.parent) scene.remove(person.root); continue; }
      if (!person.root.parent) scene.add(person.root);
      active++;
      animate(person, distance);
    }
  } };
}
