import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { MASTER_DISTRICTS as DISTRICTS } from '../src/world/master-plan.js';
import { interiorPlan, floorPlan, floorOccupants, templateSpots, levelY } from '../src/world/interior-plan.js';
import { pointInConvex } from '../src/world/building-footprints.js';
import { floorColliders, toWorld } from '../src/world/interior-physics.js';
import { createOccupants, glanceToward, turnBone, OCCUPANTS } from '../src/traffic/occupants.js';
import { crowdAsset, visitorAsset } from './helpers/street-grid.js';

const metropolis = new VerticalMetropolis();
const blueprints = [...new Map(DISTRICTS.flatMap(d => metropolis.area(d.x - 70, d.z - 70, d.x + 70, d.z + 70))
  .flatMap(block => block.buildings).map(p => [p.id, p])).values()];
const plans = blueprints.map(p => ({ p, plan: interiorPlan(p) })).filter(e => e.plan).filter((_, i) => i % 4 === 0);
const corners = b => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => ({
  x: b.x + i * b.w / 2 * Math.cos(b.yaw) + k * b.d / 2 * Math.sin(b.yaw), z: b.z - i * b.w / 2 * Math.sin(b.yaw) + k * b.d / 2 * Math.cos(b.yaw) }));

// Whether two rotated rectangles overlap, by separating axes.
function overlap(a, b) {
  const ca = corners(a), cb = corners(b);
  return [a, b].every(r => [[Math.cos(r.yaw), -Math.sin(r.yaw)], [Math.sin(r.yaw), Math.cos(r.yaw)]].every(([ax, az]) => {
    const p = ca.map(c => c.x * ax + c.z * az), q = cb.map(c => c.x * ax + c.z * az);
    return Math.max(...p) > Math.min(...q) + 1e-6 && Math.max(...q) > Math.min(...p) + 1e-6;
  }));
}

test('people inside have a place of their own: in the room, clear of the furniture, seated only where there is a seat', () => {
  const kinds = new Set();
  for (const { plan } of plans) for (const t of plan.templates) {
    const zones = new Map(t.zones.map(z => [z.id, z])), spots = templateSpots(plan, t);
    assert.equal(templateSpots(plan, t), spots, 'made once per layout');
    for (const s of spots) {
      kinds.add(s.kind);
      assert.ok(corners(s.body).every(c => pointInConvex(zones.get(s.zone).polygon, c.x, c.z, 0)), `${plan.id} ${s.kind}: inside its room`);
      // Only the piece they sit at or face may touch them.
      for (const f of t.furniture.filter(f => f.zone === s.zone && f.id !== s.piece)) assert.ok(!overlap(s.body, f), `${plan.id} ${s.kind} stands in a ${f.item}`);
      if (s.pose === 'sit') assert.ok(['sofa', 'bench', 'desk'].includes(s.kind), `${plan.id}: nobody sits on air (${s.kind})`);
    }
  }
  for (const kind of ['sofa', 'desk', 'counter', 'clerk', 'shelf', 'lift']) assert.ok(kinds.has(kind), `someone ${kind}`);
});

test('who is in is the same on every visit: someone home only while a flat is lit, at most two to a flat', () => {
  let people = 0, homes = 0;
  for (const { p, plan } of plans) for (const level of new Set([0, 1, plan.levels - 1])) {
    if (level >= plan.levels) continue;
    const list = floorOccupants(plan, level), rooms = new Map(floorPlan(plan, level).rooms.map(r => [r.id, r]));
    assert.deepEqual(floorOccupants(interiorPlan(structuredClone(p)), level), list, `${plan.id} level ${level}`);
    const perUnit = new Map();
    for (const o of list) {
      people++;
      assert.ok(rooms.get(o.room)?.lit, `${o.id}: in a dark room`);
      assert.equal(o.y, levelY(plan, level));
      if (o.unit) { homes++; perUnit.set(o.unit, (perUnit.get(o.unit) ?? 0) + 1); }
    }
    for (const [unit, n] of perUnit) assert.ok(n <= 2, `${unit}: ${n} people`);
    // Someone working at a desk has a chair, solid like the rest of the furniture.
    const chairs = new Set(floorColliders(plan, level).filter(b => b.furniture === 'chair').map(b => b.id.split(':chair:')[1]));
    for (const o of list) if (o.chair) assert.ok(chairs.has(o.spot), `${o.id}: a chair`);
    assert.equal(chairs.size, list.filter(o => o.chair).length, 'no empty chairs added');
  }
  assert.ok(people > 300 && homes > 100, `${people} people, ${homes} at home`);
});

function scene(assets) {
  const stage = new THREE.Scene(), occupants = createOccupants({ scene: stage, assets });
  return { stage, occupants };
}

test('only the nearest people on standing floors are shown, and none outlast their floor', () => {
  const assets = { citizen: crowdAsset(['Idle', 'Walk', 'WalkFormal', 'Jog', 'Driving']), visitors: { 'robot-scout': visitorAsset(), 'alien-scout': visitorAsset() } };
  const { stage, occupants } = scene(assets);
  const { plan } = plans.find(e => e.plan.levels > 2 && floorOccupants(e.plan, 1).length >= 4);
  const floors = [0, 1, 2].map(level => ({ plan, level })), people = floorOccupants(plan, 1);
  const first = toWorld(plan, people[0].x, people[0].z), player = { x: first.x + .8, y: levelY(plan, 1), z: first.z };
  occupants.update(.016, { player, camera: null, floors, time: 0 });
  const snap = occupants.snapshot();
  assert.ok(snap.assigned > 0 && snap.assigned <= OCCUPANTS.high.count, `${snap.assigned} shown`);
  for (const person of occupants.avatars.filter(a => a.occupant)) {
    const o = person.occupant;
    assert.ok(stage.children.includes(person.root) && person.root.visible);
    assert.ok(Math.abs(person.root.position.x - o.x) < 1e-9 && Math.abs(person.root.position.y - o.y) < 1e-9 && Math.abs(person.root.position.z - o.z) < 1e-9, 'stands at their place');
    if (o.pose === 'sit') assert.equal(person.species, 'human', 'only humans sit');
  }
  // The one standing nearest is among them, and the floor the player is on comes first.
  assert.ok(snap.people.some(p => p.id === people[0].id));
  const sameFloor = snap.people.filter(p => Math.abs(p.y - player.y) < 1).length;
  assert.ok(sameFloor >= Math.min(people.length, snap.assigned) * .5, `${sameFloor} of ${snap.assigned} on the player's floor`);
  // The floor goes: so do its people.
  occupants.update(.016, { player, camera: null, floors: [], time: 1 });
  assert.equal(occupants.snapshot().assigned, 0);
  assert.ok(occupants.avatars.every(a => !a.root.parent && !a.root.visible));
  occupants.dispose();
});

// A rig like the characters': the character faces -Z; its head faces along
// its own +Z with +X to its left, and the pose leans the chest and bows the
// head, the way a seated reader's does.
function rig(yaw) {
  const root = new THREE.Group(), body = new THREE.Group(), hips = new THREE.Bone(), chest = new THREE.Bone(), head = new THREE.Bone();
  root.position.set(3, 1, -2); root.rotation.y = yaw; root.scale.set(1.03, .95, .97);
  hips.position.y = 1; hips.quaternion.setFromEuler(new THREE.Euler(.08, Math.PI, 0));
  chest.position.y = .3; chest.quaternion.setFromEuler(new THREE.Euler(.25, .06, 0));
  head.position.y = .4; head.quaternion.setFromEuler(new THREE.Euler(.5, -.04, 0));
  root.add(body); body.add(hips); hips.add(chest); chest.add(head);
  root.updateMatrixWorld(true);
  return { root, chest, head };
}
// Where the head faces (local +Z) and how far it rolls (its left, local +X, off
// level), turned with the character but without its slight squash and stretch.
function headPose(head) {
  const q = new THREE.Quaternion();
  for (let o = head; o; o = o.parent) q.premultiply(o.quaternion);
  const faceDir = new THREE.Vector3(0, 0, 1).applyQuaternion(q), left = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  head.updateWorldMatrix(true, false);
  return { yaw: Math.atan2(faceDir.x, faceDir.z), pitch: Math.asin(faceDir.y), roll: Math.asin(left.y), at: head.getWorldPosition(new THREE.Vector3()) };
}
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), degrees = r => (r * 180 / Math.PI).toFixed(1);

test('a bowed, leaning head turns about the true vertical: turning never rolls it', () => {
  for (const yaw of [0, 1.2, -2.5]) for (const angle of [-1, -.4, .5, 1.1]) {
    const { root, chest, head } = rig(yaw), before = headPose(head);
    turnBone(chest, root, angle * .3); turnBone(head, root, angle * .7);
    const after = headPose(head);
    assert.ok(Math.abs(after.roll - before.roll) < .01, `turned ${angle}: rolled ${degrees(after.roll - before.roll)}°`);
    assert.ok(Math.abs(wrap(after.yaw - before.yaw - angle)) < .01, `turned ${degrees(wrap(after.yaw - before.yaw))}° of ${degrees(angle)}°`);
    assert.ok(Math.abs(after.pitch - before.pitch) < .01, 'and keeps its bow');
  }
});

test('people glancing at the player look them in the eye, upright, as far as a neck turns', () => {
  for (const yaw of [0, .9, -2.2]) for (const round of [-2.4, -1, -.3, 0, .6, 1.1, 2.6]) {
    const { root, chest, head } = rig(yaw), start = headPose(head);
    // The player's eyes, 2 m away and `round` radians round from where the character faces.
    const facing = yaw + Math.PI, eyes = new THREE.Vector3(start.at.x + Math.sin(facing + round) * 2, start.at.y + .3, start.at.z + Math.cos(facing + round) * 2);
    glanceToward({ head, chest, root }, eyes, 1);
    const pose = headPose(head), toward = Math.atan2(eyes.x - pose.at.x, eyes.z - pose.at.z);
    assert.ok(Math.abs(pose.roll) < Math.abs(start.roll) + .02, `${degrees(round)}° round: head rolled ${degrees(pose.roll)}°`);
    const reach = Math.abs(round) <= 1.15;
    // Within the neck's reach they face the player; beyond it they turn as far as it goes, never the long way round.
    if (reach) assert.ok(Math.abs(wrap(toward - pose.yaw)) < .05, `${degrees(round)}° round: looks ${degrees(wrap(toward - pose.yaw))}° off`);
    else assert.ok(Math.abs(wrap(pose.yaw - facing)) <= 1.21 && Math.sign(wrap(pose.yaw - facing)) === Math.sign(round), `${degrees(round)}° round: faces ${degrees(wrap(pose.yaw - facing))}°`);
    // Lifted from the bow to meet the player's eyes.
    const level = Math.atan2(eyes.y - pose.at.y, Math.hypot(eyes.x - pose.at.x, eyes.z - pose.at.z));
    if (reach) assert.ok(Math.abs(pose.pitch - level) < .05, `${degrees(round)}° round: looks ${degrees(pose.pitch - level)}° off their eyes`);
  }
});
