import * as THREE from 'three';
import { createAvatarPool } from './pedestrians.js';
import { floorOccupants } from '../world/interior-plan.js';
import { toWorld } from '../world/interior-physics.js';
import { seededRandom } from '../core/physics.js';
import { requestResidentAction, stepResidentAction, residentActionContext } from './resident-actions.js';

// People inside buildings. Each floor's plan says who is where (see
// floorOccupants): someone on the sofa or at the counter in a lit flat, a
// few people working late, a clerk in every shop and lobby. A small pool of
// avatars takes the places nearest the player on the floors standing now,
// so nobody is shown without a room round them. They hold their pose, sit or
// stand, browse, type, talk or read a phone, look up at the player passing
// close by, and stand their ground: the player walks round them.

export const OCCUPANTS = Object.freeze({
  high: Object.freeze({ count: 10, range: 30 }),
  low: Object.freeze({ count: 6, range: 22 }),
  pool: 10,
  // A floor above or below counts as this many metres further away.
  storey: 12,
  rescan: .4,
  glance: 3.5,
});

const twist = new THREE.Quaternion(), euler = new THREE.Euler();
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const mix = text => [...text].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const UP = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3(), side = new THREE.Vector3(), face = new THREE.Vector3(), headAt = new THREE.Vector3(), eyes = new THREE.Vector3();
const chain = new THREE.Quaternion(), turnQ = new THREE.Quaternion(), rootAt = new THREE.Vector3();
// A bone's rotation in its character's own space: everything between the root and it.
function rotationUnder(bone, root, out = chain) {
  out.identity();
  for (let o = bone; o && o !== root; o = o.parent) out.premultiply(o.quaternion);
  return out;
}
/**
 * Turn `bone` by `yaw` about the character's own vertical, then bow it by
 * `pitch` about the level axis across its face (its local +Z). Both are true
 * to the character however the pose already tilts the bone, so a bowed head
 * or leaning chest turns and nods without rolling sideways.
 */
export function turnBone(bone, root, yaw, pitch = 0) {
  if (yaw) {
    axis.copy(UP).applyQuaternion(rotationUnder(bone, root).invert());
    bone.quaternion.multiply(turnQ.setFromAxisAngle(axis, yaw));
  }
  if (pitch) {
    const q = rotationUnder(bone, root);
    axis.crossVectors(UP, side.set(0, 0, 1).applyQuaternion(q));
    if (axis.lengthSq() < 1e-6) return;
    bone.quaternion.multiply(turnQ.setFromAxisAngle(axis.normalize().applyQuaternion(q.invert()), pitch));
  }
}
/**
 * Turn a head toward `eyes` (a world point) by `weight` from wherever it
 * faces now: the chest takes a share of the turn, the neck the rest, as far
 * as a neck reaches from the body's facing, and the head tips up or down to
 * meet them. The rig's head faces along its local +Z, its character along -Z.
 */
export function glanceToward({ head, chest, root }, eyes, weight, { reach = 1.2, chestShare = .3 } = {}) {
  if (!head || weight <= 0) return;
  root.updateMatrixWorld(true);
  face.set(0, 0, 1).applyQuaternion(rotationUnder(head, root));
  rootAt.copy(eyes); root.worldToLocal(rootAt);
  head.getWorldPosition(headAt); root.worldToLocal(headAt);
  const facing = Math.atan2(face.x, face.z), wanted = Math.atan2(rootAt.x - headAt.x, rootAt.z - headAt.z);
  // As far round as the neck reaches from straight ahead (-Z).
  const ahead = Math.PI, offset = Math.atan2(Math.sin(wanted - ahead), Math.cos(wanted - ahead));
  const target = ahead + THREE.MathUtils.clamp(offset, -reach, reach), turn = Math.atan2(Math.sin(target - facing), Math.cos(target - facing)) * weight;
  const across = Math.hypot(rootAt.x - headAt.x, rootAt.z - headAt.z), bow = Math.asin(THREE.MathUtils.clamp(-face.y / face.length(), -1, 1));
  const nod = THREE.MathUtils.clamp(Math.atan2(headAt.y - rootAt.y, across) - bow, -1, 1) * weight;
  if (chest) turnBone(chest, root, turn * chestShare);
  turnBone(head, root, turn * (chest ? 1 - chestShare : 1), nod);
}

export function createOccupants({ scene, assets, residentNavigation = null, random = seededRandom(5150) }) {
  const avatars = createAvatarPool(assets, random, { start: 5, count: OCCUPANTS.pool }).map(person => ({ ...person, occupant: null }));
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
  const floorsSeen = new Map();
  let profile = OCCUPANTS.high, scan = 0, floorKey = '', shown = [], planned = 0;

  // A floor's people in world space, made once per standing floor.
  function peopleOn({ plan, level }) {
    const key = `${plan.id}#${level}`;
    if (!floorsSeen.has(key)) floorsSeen.set(key, floorOccupants(plan, level).map(o => {
      const p = toWorld(plan, o.x, o.z), yaw = plan.origin.yaw + o.yaw;
      // Half the people on sofas look down at a phone in their lap; the rest sit back.
      const activity = o.activity === 'rest' && mix(o.id) % 2 ? 'read' : o.activity;
      return { ...o, activity, x: p.x, z: p.z, yaw, level, plan };
    }));
    return floorsSeen.get(key);
  }

  function release(person) {
    person.occupant.avatar = null; person.occupant = null;
    person.root.visible = false;
    if (person.root.parent) scene.remove(person.root);
  }
  function assign(person, occupant, time) {
    person.occupant = occupant; occupant.avatar = person;
    person.life = (person.life ?? 0) + 1;
    person.avatar.setGait?.(person.gait);
    const seated = occupant.pose === 'sit' && person.avatar.setRest?.(occupant.chair ? 'Driving' : 'Seated');
    if (!seated) person.avatar.setRest?.('Idle');
    person.avatar.setAnimation(seated ? person.avatar.rest : 'Idle');
    person.avatar.action.time = (person.id * 1.37 + time) % person.avatar.action.getClip().duration;
    person.root.position.set(occupant.x, occupant.y, occupant.z); person.root.rotation.y = occupant.yaw;
    person.glance = 0; person.elapsed = 0;
    person.avatar.update(0, 0);
  }

  // The nearest people on the standing floors get avatars; those that drop
  // out give theirs back. Only humans have a seated pose.
  function choose(player, floors, time) {
    const candidates = floors.flatMap(peopleOn), y = player.y ?? 0;
    planned = candidates.length;
    const score = o => dist(o, player) + Math.abs(o.y - y) / 3.6 * OCCUPANTS.storey;
    const pinned = avatars.filter(p => p.occupant?.residentAction || p.occupant?.talking).map(p => p.occupant);
    const wanted = [...pinned, ...candidates.filter(o => !pinned.includes(o) && dist(o, player) < profile.range && Math.abs(o.y - y) < 9).sort((a, b) => score(a) - score(b)).slice(0, Math.max(0, profile.count - pinned.length))];
    const keep = new Set(wanted);
    for (const person of avatars) if (person.occupant && (!keep.has(person.occupant) || !floorsSeen.has(`${person.occupant.plan.id}#${person.occupant.level}`))) release(person);
    for (const occupant of wanted) {
      if (occupant.avatar) continue;
      const free = avatars.filter(p => !p.occupant && (occupant.pose !== 'sit' || p.species === 'human'));
      if (!free.length) continue;
      assign(free[mix(occupant.id) % free.length], occupant, time);
    }
    shown = avatars.filter(p => p.occupant);
  }

  // Poses layered on the clip: browsing a shelf, typing, talking, a phone,
  // looking round, and a glance at the player passing close by. Head and
  // chest turn about the character's true vertical, never about a bone the
  // pose already tilts, which rolled the face over. While they look at the
  // player, what they were doing with their head eases out: someone reading
  // looks up from their lap.
  function gesture(person, time, player) {
    const bones = person.avatar.bones;
    if (!bones) return;
    const o = person.occupant, t = time + person.id * 1.9, root = person.root, head = bones.get('Head'), chest = bones.get('Chest');
    if (o.residentAction && o.pose !== 'sit') return;
    const rotate = (name, x, y, z) => { const bone = bones.get(name); if (bone) bone.quaternion.multiply(twist.setFromEuler(euler.set(x, y, z))); };
    const dx = player.x - o.x, dz = player.z - o.z, near = Math.hypot(dx, dz) < OCCUPANTS.glance && Math.abs((player.y ?? 0) - o.y) < 1.5;
    const toward = Math.atan2(-dx, -dz) - o.yaw, angle = Math.atan2(Math.sin(toward), Math.cos(toward));
    person.glance = THREE.MathUtils.damp(person.glance, near && Math.abs(angle) < 1.9 ? 1 : 0, 4, person.step);
    let nod = 0, turn = 0, lean = 0;
    switch (o.activity) {
      case 'browse': nod = .22 + Math.sin(t * .4) * .06; turn = Math.sin(t * .5) * .35; break;
      case 'cook': case 'look': nod = .35; turn = Math.sin(t * .3) * .15; lean = .08; break;
      case 'type': nod = .12; turn = Math.sin(t * .23) * .1; rotate('HandL', Math.sin(t * 9) * .05, 0, 0); rotate('HandR', Math.sin(t * 8 + 1) * .05, 0, 0); break;
      case 'talk': {
        const speaking = Math.sin(t * .55) > 0;
        nod = Math.sin(t * 3.1) * (speaking ? .07 : .02); turn = Math.sin(t * .7) * .12;
        if (speaking) rotate('UpperArmR', 0, 0, (Math.sin(t * 2.2) * .5 + .5) * -.35);
        break;
      }
      case 'read': nod = .5 + Math.sin(t * .25) * .05; turn = Math.sin(t * .13) * .08; lean = .12; break;
      case 'wait': nod = .38; rotate('UpperArmR', -.25, 0, -.55); rotate('ForearmR', 0, -1.35, 0); break;
      default: turn = Math.sin(t * .35) * .4;
    }
    const rest = 1 - person.glance;
    if (chest && lean) turnBone(chest, root, 0, lean * rest);
    if (head) turnBone(head, root, turn * rest, nod * rest);
    if (person.glance > .01) glanceToward({ head, chest, root }, eyes.set(player.x, (player.y ?? 0) + 1.6, player.z), person.glance);
  }

  return {
    avatars,
    get visible() { return shown.filter(p => p.root.visible); },
    actionContext(person) { return residentNavigation && person.occupant ? residentActionContext(person.occupant, residentNavigation(person.occupant)) : null; },
    command(person, action, player) {
      if (!residentNavigation || !person?.occupant) return { ok: false, reply: 'I cannot do that here.' };
      return requestResidentAction(person.occupant, action, player, residentNavigation(person.occupant));
    },
    setQuality(value) { profile = OCCUPANTS[value] ?? OCCUPANTS.high; scan = 0; },
    /** `floors` are the interior floors standing now ({ plan, level }); call after the world updates them. */
    update(dt, { player, camera, floors, time = 0 }) {
      const key = floors.map(f => `${f.plan.id}#${f.level}`).join('|');
      if (key !== floorKey) {
        // Forget floors that are gone; their people go with them.
        const live = new Set(floors.map(f => `${f.plan.id}#${f.level}`));
        for (const [k, people] of floorsSeen) if (!live.has(k) && !people.some(o => o.residentAction || o.talking)) floorsSeen.delete(k);
        floorKey = key; scan = 0;
      }
      scan -= dt;
      if (scan <= 0) { scan = OCCUPANTS.rescan; choose(player, floors, time); }
      if (camera) { camera.updateMatrixWorld(); matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(matrix); }
      for (const person of shown) {
        const o = person.occupant;
        if (o.residentAction) {
          const before = { pose: o.pose, sitting: !!o.residentAction.sitProgress };
          stepResidentAction(o, dt, player, residentNavigation(o));
          if (before.pose !== o.pose || before.sitting !== !!o.residentAction?.sitProgress) person.avatar.setRest?.(o.pose === 'sit' ? o.chair ? 'Driving' : 'Seated' : 'Idle', .4);
          // Followers catching up jog where the rig has a Jog clip.
          person.avatar.setGait?.(o.residentAction?.jog ? 'Jog' : person.gait);
          person.root.position.set(o.x, o.y, o.z); person.root.rotation.y = o.yaw;
        }
        sphere.center.set(o.x, o.y + .9, o.z);
        const floorVisible = residentNavigation?.(o).visible?.() ?? floors.some(f => f.plan.id === o.plan.id && f.level === o.level);
        const show = floorVisible && dist(o, player) < profile.range && (!camera || frustum.intersectsSphere(sphere));
        person.root.visible = show;
        if (!show) { if (person.root.parent) scene.remove(person.root); continue; }
        if (!person.root.parent) scene.add(person.root);
        // Close by, every frame; further off, a few times a second.
        person.elapsed += dt;
        if (dist(o, player) > 14 && person.elapsed < .12) continue;
        person.step = person.elapsed; person.elapsed = 0;
        person.avatar.update(person.step, o.residentAction ? o.speed ?? 0 : 0, o.residentAction?.transition || o.talking && !o.residentAction?.sitProgress ? null : o.residentAction);
        gesture(person, time, player);
      }
    },
    /** Contact shadows under the people standing in view. */
    shadows(items) { for (const p of shown) if (p.root.visible && p.occupant.pose === 'stand') items.push({ x: p.occupant.x, z: p.occupant.z, y: p.occupant.y + .055, width: 1.4, length: 1.4 }); },
    reset() { for (const person of avatars) if (person.occupant) release(person); floorsSeen.clear(); floorKey = ''; shown = []; scan = 0; },
    snapshot() {
      const activities = {};
      for (const p of shown) activities[p.occupant.activity] = (activities[p.occupant.activity] ?? 0) + 1;
      return { capacity: profile.count, pool: avatars.length, planned, assigned: shown.length, visible: shown.filter(p => p.root.visible).length, activities,
        people: shown.map(p => ({ id: p.occupant.id, kind: p.occupant.kind, pose: p.occupant.pose, activity: p.occupant.activity, species: p.species, x: p.occupant.x, y: p.occupant.y, z: p.occupant.z,
          action: p.occupant.residentAction?.kind ?? null, status: p.occupant.residentAction?.status ?? null })) };
    },
    dispose() { for (const person of avatars) { if (person.occupant) release(person); person.avatar.dispose?.(); } },
  };
}
