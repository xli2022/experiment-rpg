import * as THREE from 'three';
import { createNPC } from '../actors/npc-appearance.js';
import { CROWD_PROFILES } from '../actors/npc-profiles.js';
import { createVisitor, VISITOR_PROFILES } from '../actors/npc-visitors.js';
import { samplePath, projectOnPath } from './network.js';
import { walkState } from './signals.js';
import { angleDelta, circleHitsBox, clamp, overlapsHeight, seededRandom } from '../core/physics.js';

// Walkers on the sidewalk graph: they follow sidewalks around corners, wait
// at the kerb for the walk signal or a gap in traffic, keep right, pass
// slower people, and now and then stop to look around, check a phone, chat
// in small groups, walk in pairs or jog.

const SLOTS = [-1.1, -.55, 0, .55, 1.1], CHECK_STEP = .75, CARROT = 1.6, TURN_RATE = 2.6, SHOW_MARGIN = 6, PATIENCE = 1.5;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Whether b stands just ahead of a, within its walking line.
function inPath(a, b) {
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), rx = b.x - a.x, rz = b.z - a.z;
  return rx * fx + rz * fz > 0 && Math.abs(rx * -fz + rz * fx) < .75;
}

/** The fixed avatar pool: every human wardrobe interleaved with the visitors. */
export function createAvatarPool({ citizen, visitors = {}, humanBases = {} }, random = seededRandom(707)) {
  const roster = [];
  for (let i = 0; i < Math.max(CROWD_PROFILES.length, VISITOR_PROFILES.length * 2); i++) {
    if (CROWD_PROFILES[i]) roster.push({ human: CROWD_PROFILES[i] });
    if (i % 2 === 0 && VISITOR_PROFILES[i / 2]) roster.push({ visitor: VISITOR_PROFILES[i / 2] });
  }
  let fallback = 0;
  return roster.map(({ visitor, human }, i) => {
    const available = visitor && visitors[visitor.id];
    const profile = available ? visitor : human ?? CROWD_PROFILES[fallback++ % CROWD_PROFILES.length];
    const species = available ? visitor.species : 'human', humanAsset = humanBases[profile.baseModel] ?? citizen;
    const avatar = available ? createVisitor(available, profile, 'Walk') : createNPC(humanAsset, profile, i % 3 ? 'Walk' : 'WalkFormal');
    const { root } = avatar;
    root.userData.species = species; root.userData.model = profile.id; root.visible = false;
    if (!available) root.userData.baseModel = humanAsset === citizen ? 'citizen' : profile.baseModel;
    avatar.action.time = random() * avatar.action.getClip().duration;
    avatar.update(0, 0);
    // Visitors walk at the pace their gait was authored for; people vary.
    const pace = available ? clamp(visitor.walkSpeed * .78, 1.05, 1.9) : (i % 3 ? 1.18 : 1.08) + random() * .32;
    return { id: i, root, avatar, species, model: profile.id, pace, basePace: pace, gait: avatar.gait, mode: null, elapsed: 0, travelled: 0, x: 0, y: 0, z: 0, yaw: 0, speed: 0 };
  });
}

export function rosterBases(people) {
  return people.filter(p => p.species === 'human').reduce((counts, p) => {
    const base = p.root.userData.baseModel; counts[base] = (counts[base] ?? 0) + 1; return counts;
  }, {});
}

export function createPedestrians({ scene, network, plan, spatial = null, assets, random = seededRandom(707) }) {
  const graph = network.walk, junctions = new Map(network.nodes.map(n => [n.id, n]));
  const people = createAvatarPool(assets, random);
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 2);
  let quality = 'high', target = 0, spacing = 7, district = null, spawnTime = 0, scanTime = 0, first = true, cursor = 0, visibleCount = 0, nearby = [];
  const scan = { x: Infinity, y: Infinity, z: Infinity };
  const inView = p => { sphere.center.set(p.x, (p.y ?? 0) + 1, p.z); return frustum.intersectsSphere(sphere); };
  let list = [];
  const walkers = () => people.filter(p => p.mode);

  // --- Graph helpers ------------------------------------------------------------
  const endOf = (edge, forward) => forward ? edge.b : edge.a;
  function sample(edge, forward, s) {
    const L = edge.path.length, p = samplePath(edge.path, forward ? s : L - s);
    if (!forward) { p.dx = -p.dx; p.dz = -p.dz; }
    if (edge.terrain) p.y = plan.terrainHeight(p.x, p.z);
    return p;
  }
  // Which lateral slots are clear of buildings, trees and props, per station.
  function clearance(edge) {
    if (edge.clearance) return edge.clearance;
    const result = { usable: true, free: null };
    if (spatial && (edge.kind === 'sidewalk' || edge.kind === 'link')) {
      const L = edge.path.length, steps = Math.max(1, Math.ceil(L / CHECK_STEP));
      result.free = [];
      for (let i = 0; i <= steps; i++) {
        const p = samplePath(edge.path, L * i / steps), y = plan.terrainHeight(p.x, p.z);
        const boxes = spatial.near(p.x, p.z, 1.8).filter(b => !b.supportOnly && overlapsHeight(b, y, 1.8));
        let mask = 0;
        SLOTS.forEach((o, k) => { if (!boxes.some(b => circleHitsBox(p.x - p.dz * o, p.z + p.dx * o, .34, b))) mask |= 1 << k; });
        result.free.push(mask);
        if (!mask) result.usable = false;
      }
    }
    edge.clearance = result;
    return result;
  }
  const usable = edge => clearance(edge).usable;
  // The free lateral offset (in the walker's own frame) closest to the one it wants.
  // The lateral offset closest to the wanted one that stays clear from a metre
  // behind (the walker's own body) to a few metres ahead. Where anything is in
  // the way, only the checked slot centres are safe.
  function laneOffset(edge, forward, s, wanted) {
    const { free } = clearance(edge);
    if (!free) return wanted;
    const L = edge.path.length, station = d => clamp(Math.round((forward ? d : L - d) / L * (free.length - 1)), 0, free.length - 1);
    let mask = 31;
    for (let d = s - 1; d <= s + 3; d += CHECK_STEP / 2) mask &= free[station(d)];
    if (!mask) mask = free[station(s + 1)];
    if (mask === 31) return wanted;
    let best = 0, gap = Infinity;
    SLOTS.forEach((o, k) => {
      const own = forward ? o : -o;
      if (mask >> k & 1 && Math.abs(own - wanted) < gap) { gap = Math.abs(own - wanted); best = own; }
    });
    return best;
  }
  function chooseNext(person) {
    const node = endOf(person.edge, person.forward), heading = sample(person.edge, person.forward, person.edge.path.length);
    const options = (graph.adjacency.get(node) ?? []).filter(e => e !== person.edge && usable(e));
    if (!options.length) return { edge: person.edge, forward: !person.forward };
    let total = 0;
    const weighted = options.map(edge => {
      const forward = edge.a === node, start = sample(edge, forward, Math.min(1.5, edge.path.length));
      const from = graph.byId.get(node), dx = start.x - from.x, dz = start.z - from.z, l = Math.hypot(dx, dz) || 1;
      const straight = (heading.dx * dx + heading.dz * dz) / l;
      let weight = .35 + Math.max(0, straight) * 1.6;
      if (edge.kind === 'crossing') weight *= person.crossBias;
      total += weight; return { edge, forward, weight };
    });
    let r = random() * total;
    for (const option of weighted) if ((r -= option.weight) <= 0) return option;
    return weighted.at(-1);
  }
  function mayCross(person, edge, time, cars) {
    const node = junctions.get(edge.junction), approach = node?.approaches[edge.approach];
    if (!node) return true;
    const duration = edge.path.length / (person.pace * 1.15) + 1;
    // Never step out in front of a car that is already at the crossing, nor
    // through one standing on it.
    const a = edge.path.points[0], b = edge.path.points.at(-1), dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, steps = Math.ceil(Math.sqrt(l2) / .5);
    for (const car of cars) {
      if (Math.abs(car.y - a.y) > 3) continue;
      const t = clamp(((car.x - a.x) * dx + (car.z - a.z) * dz) / l2, 0, 1);
      if (car.speed > 1.5 && Math.hypot(car.x - a.x - dx * t, car.z - a.z - dz * t) < 7) return false;
      const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), half = (car.half ?? 2.4) + .4, width = 1.1 * (car.body?.scale?.[0] ?? 1.05) + .4;
      for (let k = 0; k <= steps; k++) {
        const px = a.x + dx * k / steps - car.x, pz = a.z + dz * k / steps - car.z;
        if (Math.abs(px * fx + pz * fz) < half && Math.abs(-px * fz + pz * fx) < width) return false;
      }
    }
    if (node.signalized) {
      const state = walkState(node, approach, time);
      return state.walk && state.remaining > duration;
    }
    const mid = samplePath(edge.path, edge.path.length / 2);
    for (const car of cars) {
      const d = dist(car, mid);
      if (d > 45 || Math.abs(car.y - mid.y) > 3) continue;
      const closing = (-(mid.x - car.x) * Math.sin(car.yaw) - (mid.z - car.z) * Math.cos(car.yaw)) / Math.max(d, 1e-3);
      if (d < 7 && car.speed > .3 || closing > .3 && car.speed > .8 && d / car.speed < duration + 1.5) return false;
    }
    return true;
  }

  // --- Placement ----------------------------------------------------------------
  function place(person, edge, forward, s, offset) {
    const p = sample(edge, forward, s);
    Object.assign(person, { edge, forward, s, offset, wantOffset: offset, next: null, speed: 0, pace: person.basePace, x: p.x - p.dz * offset, z: p.z + p.dx * offset, y: p.y,
      yaw: Math.atan2(-p.dx, -p.dz), mode: 'walk', timer: 0, held: 0, leader: null, follower: null, group: null, jog: false, claim: false, pauseIn: 10 + random() * 40,
      crossBias: .4 + random() * 1.2, gesture: null, elapsed: 0, travelled: 0, shown: false, life: (person.life ?? 0) + 1 });
    person.root.position.set(person.x, person.y, person.z); person.root.rotation.y = person.yaw;
  }
  function retire(person) {
    if (person.follower) retire(person.follower);
    if (person.group) for (const member of person.group.members) if (member !== person) { member.group = null; member.mode = member.mode === 'chat' ? 'walk' : member.mode; }
    person.mode = null; person.leader = person.follower = person.group = null;
    person.root.visible = false; if (person.root.parent) scene.remove(person.root);
    if (person.jog) { person.avatar.setGait?.(person.gait); person.jog = false; }
  }
  const occupied = (p, gap) => walkers().some(o => Math.abs(o.y - p.y) < 3 && dist(o, p) < gap);
  function candidate(focus, radius) {
    for (let attempt = 0; attempt < 40 && nearby.length; attempt++) {
      const edge = nearby[Math.floor(random() * nearby.length)], L = edge.path.length, s = random() * L, forward = random() < .5;
      const p = sample(edge, forward, s), d = dist(p, focus);
      if (d < (first ? 4 : 10) || d > radius + 10 || Math.abs(p.y - (focus.y ?? 0)) > 3 && nearby.some(e => e.sameFloor)) continue;
      if (!first && inView(p) && d < radius + SHOW_MARGIN) continue;
      if (occupied(p, spacing)) continue;
      return { edge, forward, s, p };
    }
    return null;
  }
  function spawn(focus, radius, free, room) {
    const spot = candidate(focus, radius);
    if (!spot) return 0;
    const lead = free.shift(), roll = random();
    // Small groups chatting on a wide stretch of sidewalk.
    if (roll < .16 && free.length && room > 1 && spot.edge.kind === 'sidewalk') {
      const members = [lead, ...free.splice(0, Math.min(room - 1, random() < .5 ? 2 : 1))], center = sample(spot.edge, spot.forward, spot.s), out = .75;
      const group = { members, x: center.x - center.dz * out, z: center.z + center.dx * out, y: center.y };
      members.forEach((member, i) => {
        const angle = i / members.length * Math.PI * 2 + random() * .4, x = group.x + Math.cos(angle) * .78, z = group.z + Math.sin(angle) * .78;
        place(member, spot.edge, spot.forward, spot.s, out);
        Object.assign(member, { x, z, y: plan.terrainHeight(x, z), yaw: Math.atan2(-(group.x - x), -(group.z - z)), mode: 'chat', timer: 25 + random() * 45, group });
        member.root.position.set(member.x, member.y, member.z); member.root.rotation.y = member.yaw;
      });
      return members.length;
    }
    place(lead, spot.edge, spot.forward, spot.s, .35 + random() * .55);
    // Joggers use the Jog clip where the rig has one.
    if (roll > .92 && lead.species === 'human' && lead.avatar.setGait?.('Jog')) { lead.jog = true; lead.pace = 2.9 + random() * .5; }
    // Pairs walk side by side, the companion on the left.
    if (!lead.jog && roll > .74 && roll <= .92 && free.length && room > 1) {
      const partner = free.shift();
      place(partner, spot.edge, spot.forward, spot.s, lead.offset - .78);
      Object.assign(partner, { leader: lead, mode: 'follow' }); lead.follower = partner;
      lead.wantOffset = Math.max(lead.offset, .6); lead.pace = Math.min(lead.pace, partner.pace);
      return 2;
    }
    return 1;
  }

  // --- Behaviour ----------------------------------------------------------------
  function steer(person, dt, time, cars, player) {
    const edge = person.edge, L = edge.path.length;
    if (person.mode === 'pause') {
      person.timer -= dt; person.speed = Math.max(0, person.speed - 3 * dt); person.holding = false;
      if (person.timer <= 0) { person.mode = 'walk'; person.gesture = null; person.pauseIn = 15 + random() * 45; }
      return 0;
    }
    if (!person.next && L - person.s < 4) person.next = chooseNext(person);
    const gated = person.next?.edge.kind === 'crossing' && person.next.edge !== edge && !mayCross(person, person.next.edge, time, cars);
    // Held back for traffic: they stop at the kerb, so drivers treat them as waiting there.
    person.holding = gated;
    // About to step off the kerb, or already crossing: drivers should see the crossing as taken.
    person.claim = edge.kind === 'crossing' || !gated && person.next?.edge.kind === 'crossing' && L - person.s < 3;
    if (person.mode === 'wait' && !gated) person.mode = 'walk';
    let want = person.pace * (edge.kind === 'crossing' ? 1.15 : 1);
    if (gated) want = Math.min(want, Math.max(0, L - person.s - .25) * 1.4);
    // Look ahead for people and the player: pass the slower, step aside for the oncoming.
    const fx = -Math.sin(person.yaw), fz = -Math.cos(person.yaw);
    let lateral = person.wantOffset, held = false;
    for (const other of player ? [...list, player] : list) {
      if (other === person || other === person.follower || other === person.leader || Math.abs(other.y - person.y) > 2) continue;
      const rx = other.x - person.x, rz = other.z - person.z, ahead = rx * fx + rz * fz, side = rx * -fz + rz * fx;
      if (ahead <= -.3 || ahead > 2.6 || Math.abs(side) > 1.5) continue;
      const along = other.yaw === undefined ? 0 : -Math.sin(other.yaw) * fx - Math.cos(other.yaw) * fz, speed = (other.speed ?? 0) * along;
      const inWay = ahead > 0 && Math.abs(side) < .75;
      if (speed >= person.pace - .15) { if (inWay) want = Math.min(want, Math.max(0, ahead - .8) * 1.5); continue; }
      // Slower, standing or coming the other way: hold a line a metre to one side
      // of them (the nearer side) until past. Only someone slow or still, facing
      // the same way, means slowing down; people facing us step aside as we do.
      // Two people in each other's way, like one stepping onto a crossing as
      // another steps off it, never both wait: the lower id goes first. And
      // only a queue going the same way on is waited out: anyone else standing
      // in the path (someone at the kerb for another crossing, a chat, the
      // player) is squeezed past after a moment.
      lateral = person.offset + side + (side > 0 ? -1 : 1);
      if (!inWay || along <= -.5 || other.id > person.id && inPath(other, person)) continue;
      const queue = (other.mode === 'walk' || other.mode === 'wait') && along >= .5 && other.next?.edge === person.next?.edge;
      const passable = (other.speed ?? 0) < .2 && !queue;
      held ||= passable;
      want = Math.min(want, passable && person.held >= PATIENCE ? .7 : Math.max(0, ahead - .5) * 2);
    }
    person.held = held ? person.held + dt : 0;
    // Sidewalks leave room to pass; kerb links and crosswalks keep people in line.
    const room = edge.kind === 'sidewalk' || edge.kind === 'deck' ? 1.1 : edge.kind === 'crossing' ? .6 : .25;
    person.offset += clamp(laneOffset(edge, person.forward, person.s, clamp(lateral, -room, room)) - person.offset, -.9 * dt, .9 * dt);
    person.speed += clamp(want - person.speed, -2.6 * dt, 1.3 * dt);
    if (gated && L - person.s < .35 && person.speed < .15) {
      person.mode = 'wait'; person.speed = 0;
      // Face across the street while waiting.
      const across = sample(person.next.edge, person.next.forward, person.next.edge.path.length);
      person.yaw += clamp(angleDelta(person.yaw, Math.atan2(-(across.x - person.x), -(across.z - person.z))), -TURN_RATE * dt, TURN_RATE * dt);
      return 0;
    }
    // Pure pursuit of a point a stride ahead, with a capped turn rate.
    let ahead = person.s + CARROT, carrotEdge = edge, carrotForward = person.forward, offset = person.offset;
    // A crossing is walked to its far kerb before the next path pulls the walker round.
    if (ahead > L && person.next && !gated && edge.kind !== 'crossing') { ahead -= L; carrotEdge = person.next.edge; carrotForward = person.next.forward; }
    const c = sample(carrotEdge, carrotForward, Math.min(ahead, carrotEdge.path.length));
    const cx = c.x - c.dz * offset, cz = c.z + c.dx * offset, error = angleDelta(person.yaw, Math.atan2(-(cx - person.x), -(cz - person.z)));
    person.yaw += clamp(error, -TURN_RATE * dt * (person.jog ? 1.3 : 1), TURN_RATE * dt * (person.jog ? 1.3 : 1));
    const step = person.speed * Math.max(0, Math.cos(error)) * dt;
    person.x += -Math.sin(person.yaw) * step; person.z += -Math.cos(person.yaw) * step;
    // Progress is the walker's projection on its path.
    const projected = projectOnPath(edge.path, person), s = person.forward ? projected.s : L - projected.s;
    person.s = Math.max(person.s, Math.min(L, s));
    // Hand over to the next path once its carrot has pulled the walker round the corner.
    if (person.s >= L - (person.next && !gated && edge.kind !== 'crossing' ? 1 : .05)) {
      const next = person.next ?? chooseNext(person);
      if (!gated || next.edge === edge) {
        person.edge = next.edge; person.forward = next.forward; person.next = null;
        const enter = projectOnPath(next.edge.path, person);
        person.s = clamp(next.forward ? enter.s : next.edge.path.length - enter.s, 0, next.edge.path.length - .01);
      }
    }
    const ground = sample(person.edge, person.forward, person.s);
    person.y = person.edge.terrain ? plan.terrainHeight(person.x, person.z) : ground.y;
    // Now and then stop on a straight sidewalk to look around or check a phone.
    person.pauseIn -= dt;
    if (person.pauseIn <= 0 && !person.jog && !person.follower && person.edge.kind === 'sidewalk' && person.s > 4 && person.edge.path.length - person.s > 6) {
      person.mode = 'pause'; person.timer = 2.5 + random() * 5; person.gesture = random() < .45 ? 'phone' : 'look';
    }
    return step;
  }
  function follow(person, dt) {
    const lead = person.leader, rx = Math.cos(lead.yaw), rz = -Math.sin(lead.yaw), fx = -Math.sin(lead.yaw), fz = -Math.cos(lead.yaw);
    // Side by side on a sidewalk, single file over kerbs and crossings.
    const wide = lead.edge.kind === 'sidewalk' || lead.edge.kind === 'deck';
    const side = wide ? .78 : 0, back = wide ? .2 : 1.1;
    const tx = lead.x - rx * side - fx * back, tz = lead.z - rz * side - fz * back;
    Object.assign(person, { edge: lead.edge, forward: lead.forward, s: lead.s, claim: lead.claim });
    const before = { x: person.x, z: person.z }, k = 1 - Math.exp(-6 * dt);
    person.x += (tx - person.x) * k; person.z += (tz - person.z) * k; person.y = plan.terrainHeight(person.x, person.z);
    if (!lead.edge.terrain) person.y = lead.y;
    person.yaw += angleDelta(person.yaw, lead.yaw) * k;
    person.speed = lead.speed; person.gesture = lead.mode === 'pause' ? 'look' : null;
    return dist(before, person);
  }
  // Talking, looking around and phone poses layered on the authored idle.
  const twist = new THREE.Quaternion(), euler = new THREE.Euler();
  function gesture(person, time) {
    const bones = person.avatar.bones, kind = person.mode === 'chat' ? 'talk' : person.mode === 'pause' || person.mode === 'wait' ? person.gesture ?? 'look' : null;
    if (!bones || !kind) return;
    const t = time + person.id * 1.7, rotate = (name, x, y, z) => { const bone = bones.get(name); if (bone) bone.quaternion.multiply(twist.setFromEuler(euler.set(x, y, z))); };
    if (kind === 'talk') {
      const speaking = Math.sin(t * .55) > 0;
      rotate('Head', Math.sin(t * 3.1) * (speaking ? .07 : .02), Math.sin(t * .7) * .12, 0);
      rotate('Chest', 0, Math.sin(t * .9) * .05, Math.sin(t * 1.3) * .02);
      if (speaking) rotate('UpperArmR', 0, 0, (Math.sin(t * 2.2) * .5 + .5) * -.35);
    } else if (kind === 'phone') {
      rotate('Head', .38, 0, 0); rotate('UpperArmR', -.25, 0, -.55); rotate('ForearmR', 0, -1.35, 0);
    } else rotate('Head', 0, Math.sin(t * .8) * .5, 0);
  }
  function animate(person, near, time) {
    if (!near && person.elapsed <= .1) return;
    const speed = person.elapsed > 0 ? person.travelled / person.elapsed : 0;
    person.avatar.update(person.elapsed, speed);
    gesture(person, time);
    person.elapsed = person.travelled = 0;
  }

  return {
    people, count: people.length,
    archetypes: new Set(people.map(p => p.model)).size,
    drawCalls: people.reduce((sum, p) => { let n = 0; p.root.traverse(o => { if (o.isMesh) n++; }); return sum + n; }, 0),
    get active() { return visibleCount; },
    get walkers() { return walkers(); },
    /** Crossings in use, as "junction:approach" keys: drivers yield to these. */
    crossings() {
      const used = new Set();
      for (const p of walkers()) if (p.claim) {
        const edge = p.edge.kind === 'crossing' ? p.edge : p.next?.edge;
        if (edge?.kind === 'crossing') used.add(`${edge.junction}:${edge.approach}`);
      }
      return used;
    },
    setQuality(value) { quality = value === 'low' ? 'low' : 'high'; scanTime = spawnTime = 0; },
    reset() { for (const person of people) if (person.mode) retire(person); first = true; scanTime = spawnTime = 0; scan.x = Infinity; },
    /** Budget and spacing come from the caller (population.js); radius is the visible actor range. */
    update(dt, { player, onFoot = true, camera, radius = 65, time = 0, cars = [], population }) {
      if (camera) { camera.updateMatrixWorld(); matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(matrix); }
      const reach = Math.max(90, radius + 30);
      scanTime -= dt; spawnTime -= dt;
      if (scanTime <= 0 || dist(player, scan) > 32 || Math.abs((player.y ?? 0) - scan.y) > 3) {
        scanTime = 2; Object.assign(scan, { x: player.x, y: player.y ?? 0, z: player.z });
        spacing = population.pedestrianSpacing; district = population.district;
        nearby = graph.edgesNear(player.x, player.z, reach).filter(e => e.kind !== 'crossing' && usable(e));
        for (const e of nearby) e.sameFloor = Math.abs(samplePath(e.path, e.path.length / 2).y - (player.y ?? 0)) < 3;
        const length = nearby.reduce((sum, e) => sum + Math.min(e.path.length, reach), 0);
        target = Math.min(people.length, population.pedestrians, Math.floor(length / spacing));
      }
      const safe = p => !camera || !inView(p) || dist(p, player) > radius + SHOW_MARGIN;
      for (const person of walkers()) if (!person.leader && dist(person, player) > reach + 40 && safe(person)) retire(person);
      let count = walkers().length;
      for (const person of walkers().sort((a, b) => dist(b, player) - dist(a, player))) {
        if (count <= target) break;
        if (!person.leader && !person.group && safe(person)) { count -= person.follower ? 2 : 1; retire(person); }
      }
      // A first placement fills at once; later arrivals trickle in out of sight.
      if (spawnTime <= 0) {
        spawnTime = .35;
        const free = [];
        for (let i = 0; i < people.length; i++) { const p = people[(cursor + i) % people.length]; if (!p.mode) free.push(p); }
        cursor = (cursor + 1) % people.length;
        let budget = first ? people.length : 2, misses = 0;
        while (count < target && budget > 0 && free.length && misses < 3) {
          const added = spawn(player, reach, free, target - count);
          if (!added) { misses++; continue; }
          count += added; budget -= added;
        }
      }
      visibleCount = 0; list = walkers();
      for (const person of list) {
        let moved = 0;
        if (person.mode === 'follow') moved = person.leader?.mode ? follow(person, dt) : (person.mode = 'walk', 0);
        else if (person.mode === 'chat') {
          person.timer -= dt;
          if (person.timer <= 0) { person.mode = 'walk'; person.group = null; person.wantOffset = person.offset = .5; }
        } else moved = steer(person, dt, time, cars, onFoot ? player : null);
        person.root.position.set(person.x, person.y, person.z); person.root.rotation.y = person.yaw;
        person.elapsed += dt; person.travelled += moved;
        const d = dist(person, player), show = d < radius + (person.shown ? SHOW_MARGIN : 0) && (!camera || inView(person));
        person.shown = show; person.root.visible = show;
        if (!show) { if (person.root.parent) scene.remove(person.root); continue; }
        if (!person.root.parent) scene.add(person.root);
        visibleCount++;
        animate(person, d < 22, time);
      }
      first = false;
    },
    snapshot() {
      const assigned = walkers(), species = { human: 0, robot: 0, alien: 0 }, behaviors = { walking: 0, waiting: 0, crossing: 0, pausing: 0, chatting: 0, pairs: 0, jogging: 0 };
      for (const p of assigned) {
        species[p.species] = (species[p.species] ?? 0) + 1;
        if (p.mode === 'chat') behaviors.chatting++; else if (p.mode === 'pause') behaviors.pausing++; else if (p.mode === 'wait') behaviors.waiting++;
        else if (p.mode === 'follow') behaviors.pairs++; else if (p.edge?.kind === 'crossing') behaviors.crossing++; else behaviors.walking++;
        if (p.jog) behaviors.jogging++;
      }
      return { capacity: people.length, target, assigned: assigned.length, active: visibleCount, species, behaviors,
        humanBases: rosterBases(assigned), rosterHumanBases: rosterBases(people), spacing, district, quality, edges: nearby.length };
    },
    dispose() { for (const person of people) { retire(person); person.avatar.dispose?.(); } },
  };
}
