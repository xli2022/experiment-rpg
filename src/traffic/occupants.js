import * as THREE from 'three';
import { createAvatarPool } from './pedestrians.js';
import { floorOccupants } from '../world/interior-plan.js';
import { toWorld } from '../world/interior-physics.js';
import { orientedBox, seededRandom } from '../core/physics.js';

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

export function createOccupants({ scene, assets, random = seededRandom(5150) }) {
  const avatars = createAvatarPool(assets, random, { start: 5, count: OCCUPANTS.pool }).map(person => ({ ...person, occupant: null }));
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
  const floorsSeen = new Map();
  let profile = OCCUPANTS.high, scan = 0, floorKey = '', shown = [], planned = 0;

  // A floor's people in world space, made once per standing floor.
  function peopleOn({ plan, level }) {
    const key = `${plan.id}#${level}`;
    if (!floorsSeen.has(key)) floorsSeen.set(key, floorOccupants(plan, level).map(o => {
      const p = toWorld(plan, o.x, o.z), body = toWorld(plan, o.body.x, o.body.z), yaw = plan.origin.yaw + o.yaw;
      // Half the people on sofas look down at a phone in their lap; the rest sit back.
      const activity = o.activity === 'rest' && mix(o.id) % 2 ? 'read' : o.activity;
      return { ...o, activity, x: p.x, z: p.z, yaw, level, plan,
        // What a body takes up, for the player to walk round; a chair stands in for a seated worker.
        collider: o.chair ? null : orientedBox(body.x, body.z, o.body.w, o.body.d, plan.origin.yaw + o.body.yaw, o.y + (o.pose === 'sit' ? .7 : 1.8), o.y, { id: `occupant:${o.id}`, occupant: true, climbable: false }) };
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
    const wanted = candidates.filter(o => dist(o, player) < profile.range && Math.abs(o.y - y) < 9).sort((a, b) => score(a) - score(b)).slice(0, profile.count);
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
  // looking round, and a glance at the player passing close by.
  function gesture(person, time, player) {
    const bones = person.avatar.bones;
    if (!bones) return;
    const o = person.occupant, t = time + person.id * 1.9;
    const rotate = (name, x, y, z) => { const bone = bones.get(name); if (bone) bone.quaternion.multiply(twist.setFromEuler(euler.set(x, y, z))); };
    switch (o.activity) {
      case 'browse': rotate('Head', .22 + Math.sin(t * .4) * .06, Math.sin(t * .5) * .35, 0); break;
      case 'cook': case 'look': rotate('Head', .35, Math.sin(t * .3) * .15, 0); rotate('Chest', .08, 0, 0); break;
      case 'type': rotate('Head', .12, Math.sin(t * .23) * .1, 0); rotate('HandL', Math.sin(t * 9) * .05, 0, 0); rotate('HandR', Math.sin(t * 8 + 1) * .05, 0, 0); break;
      case 'talk': {
        const speaking = Math.sin(t * .55) > 0;
        rotate('Head', Math.sin(t * 3.1) * (speaking ? .07 : .02), Math.sin(t * .7) * .12, 0);
        if (speaking) rotate('UpperArmR', 0, 0, (Math.sin(t * 2.2) * .5 + .5) * -.35);
        break;
      }
      case 'read': rotate('Head', .5 + Math.sin(t * .25) * .05, Math.sin(t * .13) * .08, 0); rotate('Chest', .12, 0, 0); break;
      case 'wait': rotate('Head', .38, 0, 0); rotate('UpperArmR', -.25, 0, -.55); rotate('ForearmR', 0, -1.35, 0); break;
      default: rotate('Head', 0, Math.sin(t * .35) * .4, 0);
    }
    // Look up at the player passing close by, within the neck's reach.
    const dx = player.x - o.x, dz = player.z - o.z, near = Math.hypot(dx, dz) < OCCUPANTS.glance && Math.abs((player.y ?? 0) - o.y) < 1.5;
    const turn = Math.atan2(-dx, -dz) - o.yaw, angle = Math.atan2(Math.sin(turn), Math.cos(turn));
    person.glance = THREE.MathUtils.damp(person.glance, near && Math.abs(angle) < 1.9 ? 1 : 0, 4, person.step);
    if (person.glance > .01) rotate('Head', -.2 * person.glance, THREE.MathUtils.clamp(angle, -1.1, 1.1) * person.glance, 0);
  }

  return {
    avatars,
    get visible() { return shown.filter(p => p.root.visible); },
    setQuality(value) { profile = OCCUPANTS[value] ?? OCCUPANTS.high; scan = 0; },
    /** `floors` are the interior floors standing now ({ plan, level }); call after the world updates them. */
    update(dt, { player, camera, floors, time = 0 }) {
      const key = floors.map(f => `${f.plan.id}#${f.level}`).join('|');
      if (key !== floorKey) {
        // Forget floors that are gone; their people go with them.
        const live = new Set(floors.map(f => `${f.plan.id}#${f.level}`));
        for (const k of [...floorsSeen.keys()]) if (!live.has(k)) floorsSeen.delete(k);
        floorKey = key; scan = 0;
      }
      scan -= dt;
      if (scan <= 0) { scan = OCCUPANTS.rescan; choose(player, floors, time); }
      if (camera) { camera.updateMatrixWorld(); matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(matrix); }
      for (const person of shown) {
        const o = person.occupant;
        sphere.center.set(o.x, o.y + .9, o.z);
        const show = !camera || frustum.intersectsSphere(sphere);
        person.root.visible = show;
        if (!show) { if (person.root.parent) scene.remove(person.root); continue; }
        if (!person.root.parent) scene.add(person.root);
        // Close by, every frame; further off, a few times a second.
        person.elapsed += dt;
        if (dist(o, player) > 14 && person.elapsed < .12) continue;
        person.step = person.elapsed; person.elapsed = 0;
        person.avatar.update(person.step, 0);
        gesture(person, time, player);
      }
    },
    /** The people near (x, z) as boxes, for the player to walk round. */
    colliders(x, z, radius = 8) { return shown.filter(p => p.occupant.collider && dist(p.occupant, { x, z }) < radius + 1).map(p => p.occupant.collider); },
    /** Contact shadows under the people standing in view. */
    shadows(items) { for (const p of shown) if (p.root.visible && p.occupant.pose === 'stand') items.push({ x: p.occupant.x, z: p.occupant.z, y: p.occupant.y + .055, width: 1.4, length: 1.4 }); },
    reset() { for (const person of avatars) if (person.occupant) release(person); floorsSeen.clear(); floorKey = ''; shown = []; scan = 0; },
    snapshot() {
      const activities = {};
      for (const p of shown) activities[p.occupant.activity] = (activities[p.occupant.activity] ?? 0) + 1;
      return { capacity: profile.count, pool: avatars.length, planned, assigned: shown.length, visible: shown.filter(p => p.root.visible).length, activities,
        people: shown.map(p => ({ id: p.occupant.id, kind: p.occupant.kind, pose: p.occupant.pose, activity: p.occupant.activity, species: p.species, x: p.occupant.x, y: p.occupant.y, z: p.occupant.z })) };
    },
    dispose() { for (const person of avatars) { if (person.occupant) release(person); person.avatar.dispose?.(); } },
  };
}
