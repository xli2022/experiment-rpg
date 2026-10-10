import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildNetwork } from '../src/traffic/network.js';
import { createPedestrians, createAvatarPool, rosterBases } from '../src/traffic/pedestrians.js';
import { walkState } from '../src/traffic/signals.js';
import { populationFor } from '../src/traffic/population.js';
import { surfaceHeightAt } from '../src/core/physics.js';
import { VISITOR_PROFILES } from '../src/actors/npc-visitors.js';
import { CROWD_PROFILES, HUMAN_BASE_MODELS } from '../src/actors/npc-profiles.js';
import { gridPlan, streetPlan, crowdAsset, visitorAsset } from './helpers/street-grid.js';

const poolSize = CROWD_PROFILES.length + VISITOR_PROFILES.length;
const player = { x: 30, y: 0, z: 30, yaw: 0, speed: 0 };
function crowd({ plan = gridPlan(), assets = { citizen: crowdAsset() }, quality = 'high' } = {}) {
  const network = buildNetwork(plan), pedestrians = createPedestrians({ scene: new THREE.Scene(), network, plan, assets });
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
  const travelled = new Map(), behaviours = new Set(), last = new Map();
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
