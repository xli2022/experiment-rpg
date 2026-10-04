import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTraffic, createLaneRoute, sampleTrafficRoute, TRAFFIC_PROFILES } from '../src/traffic.js';
import { createCrowd, pedestrianPaths, samplePedestrianPath } from '../src/crowd.js';
import { createMasterPlan, SHOWCASE } from '../src/master-plan.js';
import { VerticalMetropolis } from '../src/vertical-city.js';
import { orientedBox, circleHitsBox, overlapsHeight, surfaceHeightAt } from '../src/physics.js';
import { populationFor } from '../src/population.js';
import { CROWD_PROFILES } from '../src/npc-profiles.js';
import { VISITOR_PROFILES } from '../src/npc-visitors.js';

test('new-city traffic uses real roads and is present on both Eastpoint street and viaduct levels', () => {
  const plan = createMasterPlan(), metropolis = new VerticalMetropolis(plan);
  const traffic = createTraffic(new THREE.Scene(), { masterPlan: plan, cars: [], spatial: { near: (x, z, r) => metropolis.collidersIn(x - r, z - r, x + r, z + r) } });
  traffic.update(0, plan.spawn, null, null);
  assert.equal(traffic.cars.length, populationFor({ masterPlan: plan }, plan.spawn).cars);
  assert.ok(traffic.cars.every(car => car.route.id.startsWith('master:')));
  assert.ok(traffic.cars.some(car => car.route.sourceRoad.id === 'meridian'));
  assert.ok(traffic.cars.some(car => car.route.sourceRoad.id === 'neon-spine'));
  assert.ok(traffic.cars.every(car => Math.hypot(car.x - SHOWCASE.spawn.x, car.z - SHOWCASE.spawn.z) < TRAFFIC_PROFILES.high.radius));
  assert.ok(traffic.cars.some(car => car.y - plan.terrainHeight(car.x, car.z) > 10), 'Traffic occupies the elevated trunk road');
  assert.ok(traffic.cars.some(car => Math.abs(car.y - plan.terrainHeight(car.x, car.z)) < .3), 'Traffic also occupies the surface streets');
  const before = new Map(traffic.cars.map(car => [car.id, car.along]));
  for (let i = 0; i < 120; i++) traffic.update(1 / 60, plan.spawn, null, null);
  assert.ok(traffic.cars.some(car => car.route.sourceRoad.id === 'meridian' && car.along > before.get(car.id) + 5));
  for (const car of traffic.cars) {
    assert.ok(car.y >= plan.terrainHeight(car.x, car.z) - .2);
    assert.ok(Math.abs(car.root.position.y - car.y - .04) < 1e-8);
    assert.ok(Number.isFinite(car.pitch));
    const samples = plan.roadIndex.near(car.x, car.z, 2).map(s => surfaceHeightAt(car.x, car.z, s)).filter(y => y !== null);
    assert.ok(samples.some(y => Math.abs(y - car.y) < .2), `Vehicle is not on its physical road: ${car.route.id}`);
  }
  traffic.dispose();
});

test('open elevated routes interpolate height and pitch without wrapping to their beginning', () => {
  const route = createLaneRoute([{ x: 0, y: 4, z: 0 }, { x: 0, y: 14, z: 100 }], { closed: false });
  assert.equal(sampleTrafficRoute(route, 50).y, 9);
  assert.ok(Math.abs(sampleTrafficRoute(route, 50).pitch - Math.atan(.1)) < 1e-8);
  assert.equal(sampleTrafficRoute(route, 200).z, 100);
  assert.equal(sampleTrafficRoute(route, -20).z, 0);
  const reversed = createLaneRoute([{ x: 0, y: 4, z: 0 }, { x: 0, y: 14, z: 100 }], { closed: false, reverse: true });
  assert.ok(sampleTrafficRoute(reversed, 50).pitch < 0);
  assert.equal(sampleTrafficRoute(reversed, 200).y, 4);
});

test('vehicles do not brake for pedestrians or supports on the street below a viaduct', () => {
  const road = { id: 'viaduct', class: 'expressway', width: 18, closed: false, points: [{ x: 0, y: 20, z: -500 }, { x: 0, y: 20, z: 500 }] };
  const world = () => ({ masterPlan: { roads: [road] }, cars: [], colliders: [orientedBox(0, 0, 18, 1000, 0, 20, 0, { supportOnly: true })] });
  const control = createTraffic(new THREE.Scene(), world()), traffic = createTraffic(new THREE.Scene(), world()), player = { x: 20, y: 20, z: 0 };
  control.update(0, player, null, null); traffic.update(0, player, null, null);
  const front = sampleTrafficRoute(traffic.cars[0].route, traffic.cars[0].along + 18), below = { ...front, y: 0 };
  for (let i = 0; i < 180; i++) {
    control.update(1 / 60, player, null, null);
    traffic.update(1 / 60, player, null, null, [below]);
  }
  assert.deepEqual(traffic.snapshot(), control.snapshot());
  const car = traffic.cars[0], crossing = { ...sampleTrafficRoute(car.route, car.along + 3), y: 20 }, before = car.along;
  car.speed = 9; traffic.update(.1, player, null, null, [crossing]);
  assert.equal(car.speed, 0); assert.equal(car.along, before);
  control.dispose(); traffic.dispose();
});

test('pedestrian paths follow ground shoulders and explicit elevated supports while avoiding buildings and traffic lanes', () => {
  const plan = createMasterPlan(), city = { masterPlan: plan, colliders: [] };
  const paths = pedestrianPaths(city, SHOWCASE.spawn);
  assert.ok(paths.some(path => path.id.startsWith('deck:')));
  assert.ok(paths.some(path => path.id.startsWith('walk-ramp:')));
  assert.ok(paths.some(path => path.id.startsWith('sidewalk:')));
  for (const path of paths) for (let s = 0; s < path.length; s += 2) {
    const p = samplePedestrianPath(path, s, city);
    if (path.terrain) assert.ok(Math.abs(p.y - plan.terrainHeight(p.x, p.z) - .08) < 1e-8);
    for (const road of plan.roadIndex.near(p.x, p.z, 1)) {
      const y = surfaceHeightAt(p.x, p.z, road);
      assert.ok(y === null || Math.abs(y - p.y) >= 2, `Pedestrian enters a traffic lane: ${path.id}`);
    }
  }
  const block = orientedBox(SHOWCASE.spawn.x, SHOWCASE.spawn.z, 200, 200, 0, 100, 0);
  city.colliders.push(block);
  for (const path of pedestrianPaths(city, SHOWCASE.spawn)) for (let s = 0; s < path.length; s += 2) {
    const p = samplePedestrianPath(path, s, city);
    assert.equal(overlapsHeight(block, p.y) && circleHitsBox(p.x, p.z, .45, block), false);
  }
});

test('the fixed pedestrian pool walks at actual path heights and turns at endpoints without teleporting', () => {
  const plan = createMasterPlan(), city = { masterPlan: plan, colliders: [] }, scene = new THREE.Scene();
  const asset = { scene: new THREE.Group(), animations: ['Idle', 'Walk', 'WalkFormal'].map(name => new THREE.AnimationClip(name, 1, [])) };
  const crowd = createCrowd(scene, asset, city);
  crowd.update(0, plan.spawn, null, 150);
  assert.equal(crowd.people.length, CROWD_PROFILES.length + VISITOR_PROFILES.length);
  assert.ok(crowd.people.filter(person => person.path).length >= 20);
  assert.ok(crowd.people.filter(person => person.path && Math.abs(person.root.position.y - plan.spawn.y) < 3).length >= 20,
    'Nearby ground paths take priority over forcing a fixed group onto the upper deck');
  for (let i = 0; i < 600; i++) {
    const before = crowd.people.map(person => ({ path: person.path, position: person.root.position.clone() }));
    crowd.update(1 / 60, plan.spawn, null, 150);
    for (const [j, person] of crowd.people.entries()) if (person.path) {
      if (person.path === before[j].path) assert.ok(person.root.position.distanceTo(before[j].position) < .03, 'Path reversal must not jump to its other end');
      const expected = samplePedestrianPath(person.path, person.along, city);
      assert.ok(Math.abs(person.root.position.y - expected.y) < 1e-8);
    }
  }
  assert.equal(crowd.people.length, CROWD_PROFILES.length + VISITOR_PROFILES.length);
});
