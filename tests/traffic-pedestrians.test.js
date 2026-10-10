import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildNetwork, samplePath } from '../src/traffic/network.js';
import { createPedestrians, createAvatarPool, rosterBases } from '../src/traffic/pedestrians.js';
import { walkState } from '../src/traffic/signals.js';
import { populationFor } from '../src/traffic/population.js';
import { surfaceHeightAt, orientedBox, circleHitsBox } from '../src/core/physics.js';
import { SpatialGrid } from '../src/core/spatial-grid.js';
import { VISITOR_PROFILES } from '../src/actors/npc-visitors.js';
import { CROWD_PROFILES, HUMAN_BASE_MODELS } from '../src/actors/npc-profiles.js';
import { gridPlan, streetPlan, crowdAsset, visitorAsset } from './helpers/street-grid.js';

const poolSize = CROWD_PROFILES.length + VISITOR_PROFILES.length;
const player = { x: 30, y: 0, z: 30, yaw: 0, speed: 0 };
function crowd({ plan = gridPlan(), assets = { citizen: crowdAsset() }, quality = 'high', spatial = null } = {}) {
  const network = buildNetwork(plan), pedestrians = createPedestrians({ scene: new THREE.Scene(), network, plan, spatial, assets });
  pedestrians.setQuality(quality);
  const step = (dt, at = player, extra = {}) => pedestrians.update(dt, { player: at, radius: 65, population: populationFor({ masterPlan: plan }, at, quality), ...extra });
  return { plan, network, pedestrians, step };
}
const walkers = pedestrians => pedestrians.people.filter(p => p.mode);

test('pedestrian density follows district and quality budgets with the fixed avatar pool', () => {
  for (const district of ['core', 'southward', 'foundry']) for (const quality of ['high', 'low']) {
    const { plan, pedestrians, step } = crowd({ plan: gridPlan({ district }), quality });
    step(0);
    const expected = populationFor({ masterPlan: plan }, player, quality), snapshot = pedestrians.snapshot();
    assert.equal(pedestrians.people.length, poolSize);
    assert.equal(snapshot.target, expected.pedestrians);
    assert.equal(snapshot.assigned, expected.pedestrians);
    assert.equal(snapshot.district, district);
    const people = walkers(pedestrians).filter(p => !p.leader && !p.group);
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      assert.ok(Math.hypot(people[i].x - people[j].x, people[i].z - people[j].z) >= expected.pedestrianSpacing - 1e-6, 'arrivals keep the district spacing');
    }
    assert.ok(pedestrians.people.filter(p => !p.mode).every(p => !p.root.visible && !p.root.parent));
  }
});

test('robots and aliens share the crowd budget, and missing models fall back to people', () => {
  const visitors = Object.fromEntries(VISITOR_PROFILES.map(profile => [profile.id, visitorAsset()]));
  const { pedestrians, step } = crowd({ assets: { citizen: crowdAsset(), visitors } });
  step(0);
  assert.deepEqual(new Set(pedestrians.people.map(p => p.model)), new Set([...CROWD_PROFILES, ...VISITOR_PROFILES].map(p => p.id)));
  const { species } = pedestrians.snapshot();
  assert.ok(species.robot + species.alien > 0 && species.human > species.robot + species.alien, 'visitors mix into a mostly human city');
  for (const p of walkers(pedestrians).filter(p => p.species !== 'human')) assert.ok(p.pace >= 1.05 && p.pace <= 1.9, 'visitors walk at their own gait');
  for (let i = 0; i < 120; i++) step(1 / 60);
  for (const source of Object.values(visitors)) assert.deepEqual(source.scene.getObjectByName('VisitorRoot').quaternion.toArray(), [0, 0, 0, 1], 'source rigs stay untouched');
  const partial = createAvatarPool({ citizen: crowdAsset(), visitors: { [VISITOR_PROFILES[0].id]: visitorAsset() } });
  assert.equal(partial.length, poolSize, 'missing optional downloads never shrink the pool');
  assert.ok(partial.every(p => p.species === 'human' || p.model === VISITOR_PROFILES[0].id));
});

test('human profiles use their own base models and fall back to the citizen', () => {
  const citizen = crowdAsset(); citizen.scene.name = 'CitizenSource';
  const humanBases = Object.fromEntries(HUMAN_BASE_MODELS.map(base => { const source = crowdAsset(undefined, base.id); source.scene.name = `${base.id}Source`; return [base.id, source]; }));
  const people = createAvatarPool({ citizen, humanBases });
  for (const base of HUMAN_BASE_MODELS) {
    const assigned = people.filter(p => p.avatar.profile.baseModel === base.id);
    assert.ok(assigned.length && assigned.every(p => p.avatar.body.name === `${base.id}Source` && p.root.userData.baseModel === base.id));
  }
  assert.ok(createAvatarPool({ citizen }).every(p => p.avatar.body.name === 'CitizenSource' && p.root.userData.baseModel === 'citizen'));
  assert.deepEqual(Object.keys(rosterBases(people)).sort(), [...HUMAN_BASE_MODELS.map(b => b.id), 'citizen'].sort());
});

test('three minutes on foot: sidewalks, kerbs, walk signals and everyday behaviour', () => {
  const { plan, network, pedestrians, step } = crowd();
  const junctions = new Map(network.nodes.map(n => [n.id, n])), degree = id => network.walk.adjacency.get(id).length;
  const travelled = new Map(), behaviours = new Set(), last = new Map(), onCrossing = new Map();
  let time = 0, crossings = 0;
  for (let frame = 0; frame < 180 * 30; frame++) {
    time += 1 / 30; step(1 / 30, player, { time });
    for (const p of walkers(pedestrians)) {
      const before = last.get(p);
      behaviours.add(p.mode); if (p.jog) behaviours.add('jog');
      if (before && before.life === p.life && p.mode !== 'follow' && p.mode !== 'chat') {
        if (p.edge !== before.edge && p.edge.kind === 'crossing') {
          crossings++;
          const node = junctions.get(p.edge.junction);
          assert.ok(!node.signalized || walkState(node, node.approaches[p.edge.approach], time).walk, 'people only step off on the walk signal');
        }
        if (p.edge === before.edge && p.forward !== before.forward) {
          const end = before.forward ? p.edge.b : p.edge.a;
          assert.equal(degree(end), 1, 'walkers only turn back at a dead end');
        }
        travelled.set(p, (travelled.get(p) ?? 0) + Math.hypot(p.x - before.x, p.z - before.z));
        assert.ok(Math.hypot(p.x - before.x, p.z - before.z) < (p.jog ? .15 : .08), `no teleporting: ${p.model} ${p.mode} ${Math.hypot(p.x - before.x, p.z - before.z).toFixed(3)} pace ${p.pace}`);
      }
      // A crossing, once started, is finished promptly: nobody circles at the far kerb.
      if (p.edge.kind === 'crossing' && p.mode !== 'follow') {
        const since = onCrossing.get(p)?.edge === p.edge ? onCrossing.get(p).since : time;
        onCrossing.set(p, { edge: p.edge, since });
        // Queues behind slower people are fine; circling at the kerb is not.
        assert.ok(time - since < p.edge.path.length / .5 + 10, `${p.model} is stuck on a crossing`);
      } else onCrossing.delete(p);
      if (p.edge.kind !== 'crossing' && p.mode !== 'chat' && p.mode !== 'follow') {
        const onRoad = plan.roadIndex.near(p.x, p.z, 0).some(s => surfaceHeightAt(p.x, p.z, { ...s, width: s.width - .4 }) !== null);
        assert.ok(!onRoad, `${p.model} walks in the road on a ${p.edge.kind} at ${p.x.toFixed(2)},${p.z.toFixed(2)} offset ${p.offset.toFixed(2)} s ${p.s.toFixed(2)}/${p.edge.path.length.toFixed(2)} ${JSON.stringify(p.edge.path.points.map(q => [+q.x.toFixed(1), +q.z.toFixed(1)]))}`);
      }
      assert.ok(Math.abs(p.root.position.y - plan.terrainHeight(p.x, p.z)) < 1e-6 || !p.edge.terrain, 'feet on the ground');
      last.set(p, { x: p.x, z: p.z, edge: p.edge, forward: p.forward, life: p.life });
    }
  }
  assert.ok(crossings > 10, 'people cross the streets');
  assert.ok([...travelled.values()].some(d => d > 100), 'walkers cover real distances');
  for (const mode of ['walk', 'wait', 'pause', 'chat', 'follow', 'jog']) assert.ok(behaviours.has(mode), `${mode} happens`);
});

test('crowds favour the player\'s floor and fill new space with a bounded budget', () => {
  const deck = { id: 'market', kind: 'deck', x: 0, z: 0, y: 12, width: 160, depth: 14, minX: -80, maxX: 80, minZ: -7, maxZ: 7, minY: 11.4, maxY: 12 };
  const plan = streetPlan([{ id: 'street', width: 6, points: [{ x: -200, z: 40 }, { x: 200, z: 40 }] }], { supports: [deck] });
  const { pedestrians, step } = crowd({ plan });
  const upstairs = { x: 0, y: 12, z: 0 };
  step(0, upstairs);
  assert.ok(walkers(pedestrians).length > 0);
  assert.ok(walkers(pedestrians).every(p => Math.abs(p.y - 12) < .5), 'everyone placed on the deck with the player');
  const fresh = crowd({ plan: gridPlan() }), far = { x: 5000, y: 0, z: 5000 };
  fresh.step(0, far);
  assert.equal(fresh.pedestrians.snapshot().target, 0, 'no sidewalks, no people');
  fresh.step(2.1, player);
  assert.ok(walkers(fresh.pedestrians).length <= 3, 'arrivals trickle in instead of popping in');
  for (let i = 0; i < 40; i++) fresh.step(.35, player);
  assert.equal(walkers(fresh.pedestrians).length, fresh.pedestrians.snapshot().target);
});

test('a reset clears the street and the next update repopulates around the new spot', () => {
  const { pedestrians, step } = crowd();
  step(0);
  assert.equal(walkers(pedestrians).length, pedestrians.snapshot().target);
  pedestrians.reset();
  assert.equal(walkers(pedestrians).length, 0);
  assert.ok(pedestrians.people.every(p => !p.root.parent));
  step(0);
  assert.equal(walkers(pedestrians).length, pedestrians.snapshot().target);
});

test('walkers keep clear of buildings and props, passing round what they can and avoiding what blocks the way', () => {
  // A kiosk in the middle of one sidewalk, and a wall right across another.
  const kiosk = orientedBox(48, 0, 1.2, 1.2, 0, 3, 0), wall = orientedBox(62, 11, 5, 1, 0, 3, 0);
  const spatial = new SpatialGrid([kiosk, wall], 48);
  const { pedestrians, step } = crowd({ spatial });
  let time = 0, passedKiosk = 0;
  for (let frame = 0; frame < 120 * 30; frame++) {
    time += 1 / 30; step(1 / 30, player, { time });
    for (const p of walkers(pedestrians)) {
      if (p.mode === 'chat') continue;
      assert.ok(!circleHitsBox(p.x, p.z, .25, kiosk) && !circleHitsBox(p.x, p.z, .25, wall), `${p.model} walks into a box at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      if (Math.abs(p.x - 48) < 1.6 && Math.abs(p.z) < .7) passedKiosk++;
    }
  }
  assert.ok(passedKiosk > 0, 'people still use the sidewalk beside the kiosk');
});

test('nobody waits for good on someone in the way: people meeting at a corner, or the player on a kerb link', () => {
  // Streets meeting at 50°: the kerb links round the sharp corner leave no room to step aside.
  const skew = 50 * Math.PI / 180, plan = streetPlan([
    { id: 'main', width: 10, points: [{ x: -200, z: 0 }, { x: 200, z: 0 }] },
    { id: 'skew', width: 8, points: [{ x: -200 * Math.cos(skew), z: -200 * Math.sin(skew) }, { x: 200 * Math.cos(skew), z: 200 * Math.sin(skew) }] },
  ]);
  // The corner beside one crosswalk, its link from the kerb, and the two kerb links that meet there.
  function corner({ network: { walk, nodes } }) {
    const node = nodes.find(n => n.signalized), across = (edge, id) => walk.byId.get(edge.a === id ? edge.b : edge.a);
    const crossing = walk.edges.find(e => e.kind === 'crossing' && e.junction === node.id && e.approach === node.approaches[1].index);
    const link = walk.adjacency.get(crossing.b).find(e => e.kind === 'link' && across(e, crossing.b).kind === 'corner'), point = across(link, crossing.b);
    return { link, point, kerbLinks: walk.adjacency.get(point.id).filter(e => e.kind === 'link' && across(e, point.id).kind === 'curb') };
  }
  const put = (person, edge, toward, s) => {
    const forward = edge.b === toward, L = edge.path.length, p = samplePath(edge.path, forward ? s : L - s), dx = forward ? p.dx : -p.dx, dz = forward ? p.dz : -p.dz;
    Object.assign(person, { edge, forward, s, offset: 0, wantOffset: 0, next: null, speed: 0, pace: person.basePace, x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-dx, -dz),
      mode: 'walk', held: 0, leader: null, follower: null, group: null, pauseIn: Infinity });
  };
  const only = n => ({ population: { pedestrians: n, pedestrianSpacing: 3, district: 'core' } });
  // Two people reach the corner together, each heading where the other comes from.
  const meeting = crowd({ plan }), { point, kerbLinks: [l1, l2] } = corner(meeting), near = { x: point.x + 20, y: 0, z: point.z + 20, yaw: 0, speed: 0 };
  meeting.step(0, near, only(2));
  const [a, b] = walkers(meeting.pedestrians);
  put(a, l1, point.id, l1.path.length - .9); put(b, l2, point.id, l2.path.length - .9);
  a.next = { edge: l2, forward: l2.a === point.id }; b.next = { edge: l1, forward: l1.a === point.id };
  for (let t = 0; t < 5; t += 1 / 30) meeting.step(1 / 30, near, { ...only(2), time: t });
  const round = (p, from) => p.edge !== from && Math.hypot(p.x - point.x, p.z - point.z) > 1;
  assert.ok(round(a, l1) && round(b, l2), 'both get round the corner instead of waiting on each other');
  // The player stands across a kerb link that someone walks along.
  const passing = crowd({ plan }), { link, point: end } = corner(passing), mid = samplePath(link.path, link.path.length / 2);
  const still = { x: mid.x, y: mid.y, z: mid.z, yaw: Math.atan2(-mid.dx, -mid.dz) + Math.PI / 2, speed: 0 };
  passing.step(0, still, only(1));
  const [walker] = walkers(passing.pedestrians);
  put(walker, link, end.id, 0);
  let passed = false;
  for (let t = 0; t < 8 && !passed; t += 1 / 30) {
    passing.step(1 / 30, still, { ...only(1), time: t });
    passed = walker.edge !== link || walker.s > link.path.length / 2 + .6;
  }
  assert.ok(passed, 'the walker squeezes past the player');
});

test('walkers get past a player standing on the sidewalk, and joggers return to their own walk', () => {
  const { network, pedestrians, step } = crowd();
  // Stand in the middle of a sidewalk that people walk along.
  const sidewalk = network.walk.edges.find(e => e.kind === 'sidewalk' && Math.abs(e.path.points[0].x - 48) < .5);
  const stand = samplePath(sidewalk.path, sidewalk.path.length / 2), still = { x: stand.x, y: stand.y, z: stand.z, yaw: Math.PI / 2, speed: 0 };
  const blocked = new Map();
  let time = 0;
  for (let frame = 0; frame < 120 * 30; frame++) {
    time += 1 / 30; step(1 / 30, still, { time });
    for (const p of walkers(pedestrians)) {
      const d = Math.hypot(p.x - still.x, p.z - still.z), waiting = d < 1.6 && p.speed < .1 && p.mode === 'walk';
      blocked.set(p, waiting ? (blocked.get(p) ?? 0) + 1 / 30 : 0);
      assert.ok(blocked.get(p) < 6, `${p.model} is stuck behind the player`);
    }
  }
  const person = walkers(pedestrians).find(p => p.species === 'human');
  const own = person.gait;
  assert.ok(person.avatar.setGait('Jog')); person.jog = true;
  pedestrians.reset();
  assert.equal(person.avatar.gait, own, 'a jogger returns to their own walk');
});
