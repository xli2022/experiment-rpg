import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { populationFor } from '../src/traffic/population.js';
import { createTraffic, sampleTrafficRoute, TRAFFIC_PROFILES, TRAFFIC_TAKEOVER_HITS } from '../src/traffic/traffic.js';
import { MASTER_DISTRICTS } from '../src/world/master-plan.js';

const player = { x: 0, y: 0, z: 0 };
const road = (id, x, length = 1000) => ({ id, class: 'local', width: 12, closed: false,
  points: [{ x, y: 0, z: -length / 2 }, { x, y: 0, z: length / 2 }] });
const world = (district = 'core', roads = [-90, -30, 30, 90].map((x, i) => road(`street-${i}`, x))) => ({
  district, cars: [], colliders: [], masterPlan: { roads, districtAt() { return { id: district }; } },
});
const advance = (traffic, seconds, at = player) => {
  for (let i = 0; i < seconds * 30; i++) traffic.update(1 / 30, at, null, null);
};

test('district population balances busy neighborhoods against freight areas within fixed quality budgets', () => {
  const urban = populationFor(world('core'), player), freight = populationFor(world('void-port'), player);
  assert.ok(urban.pedestrians > freight.pedestrians, 'commercial streets should be busier on foot than freight yards');
  assert.ok(freight.cars / freight.pedestrians > urban.cars / urban.pedestrians, 'freight districts should retain proportionally more traffic');
  assert.ok(freight.pedestrianSpacing > urban.pedestrianSpacing, 'freight workers should not form a dense shopping crowd');
  assert.ok(populationFor(world('cut'), player).cars < urban.cars, 'small informal streets need lighter traffic');
  for (const id of [...MASTER_DISTRICTS.map(d => d.id), 'unknown']) {
    const high = populationFor(world(id), player), low = populationFor(world(id), player, 'low');
    assert.ok(high.pedestrians > 0 && high.pedestrians <= 26 && high.cars > 0 && high.cars <= 12);
    assert.ok(low.pedestrians > 0 && low.pedestrians < high.pedestrians);
    assert.ok(low.cars > 0 && low.cars < high.cars);
    assert.ok(high.pedestrianSpacing >= 6 && high.carSpacing >= 25);
  }
});

test('traffic distributes a local budget across available streets and both lane directions', () => {
  const city = world(), traffic = createTraffic(new THREE.Scene(), city);
  try {
    traffic.update(0, player, null, null);
    assert.equal(traffic.cars.length, populationFor(city, player).cars);
    const occupancy = new Map();
    for (const car of traffic.cars) occupancy.set(car.route.sourceRoad.id, (occupancy.get(car.route.sourceRoad.id) ?? 0) + 1);
    assert.ok(occupancy.size >= 3, 'a usable neighboring street should not be empty while another holds the entire fleet');
    assert.ok(Math.max(...occupancy.values()) <= Math.ceil(traffic.cars.length / 2), 'the fleet must not clump onto one equally usable street');
    assert.ok(traffic.cars.some(car => Math.cos(car.yaw) > .9) && traffic.cars.some(car => Math.cos(car.yaw) < -.9));
    const spacing = populationFor(city, player).carSpacing;
    for (const car of traffic.cars) for (const other of traffic.cars) if (car.id < other.id) {
      assert.ok(Math.hypot(car.x - other.x, car.z - other.z) >= spacing, 'fresh traffic should retain its local spacing');
    }
    assert.ok(traffic.root.children.length < 25);
    assert.ok(traffic.root.children.every(mesh => mesh.isInstancedMesh && mesh.count === traffic.cars.length));
  } finally { traffic.dispose(); }
});

test('short streets limit traffic to usable lane space instead of forcing a full district fleet', () => {
  for (const length of [20, 80]) {
    const traffic = createTraffic(new THREE.Scene(), world('core', [road('short-service-street', 60, length)]));
    try {
      traffic.update(0, player, null, null);
      const snapshot = traffic.snapshot();
      assert.ok(snapshot.target <= 2 && snapshot.active <= snapshot.target);
      if (length === 20) assert.equal(snapshot.active, 0, 'a tiny street cannot provide a safe moving-car slot');
      else assert.ok(snapshot.active > 0, 'a usable short street should still have some traffic');
    } finally { traffic.dispose(); }
  }
});

test('traffic adapts to quality and available roads without reallocating its fleet', () => {
  const scene = new THREE.Scene(), city = world('unknown'), traffic = createTraffic(scene, city);
  try {
    traffic.update(0, player, null, null);
    const meshes = [...traffic.root.children];
    assert.equal(traffic.cars.length, TRAFFIC_PROFILES.high.count);
    traffic.setQuality('low'); traffic.update(0, player, null, null);
    assert.ok(traffic.cars.length <= TRAFFIC_PROFILES.low.count, 'the fallback district must also respect the Low render cap');
    assert.ok(traffic.snapshot().target <= TRAFFIC_PROFILES.low.count);
    advance(traffic, 1, { x: 1000, y: 0, z: 0 });
    assert.equal(traffic.cars.length, 0, 'leaving every road releases the active cars');
    traffic.setQuality('high'); advance(traffic, 5);
    assert.equal(traffic.cars.length, TRAFFIC_PROFILES.high.count, 'the fleet repopulates when nearby road space returns');
    assert.deepEqual(traffic.root.children, meshes, 'travel and quality changes reuse the same instanced draw objects');
    assert.equal(city.cars.length, 0, 'NPC vehicles do not enter the drivable parked-car collection');
    assert.equal(scene.children.length, 1);
  } finally { traffic.dispose(); }
});

test('unassigned pedestrian pool entries do not block traffic while assigned people still do', () => {
  const city = world(), control = createTraffic(new THREE.Scene(), city), traffic = createTraffic(new THREE.Scene(), city);
  try {
    control.update(0, player, null, null);
    const unassigned = control.cars.map(car => {
      const root = new THREE.Group(); root.position.set(car.x, car.y, car.z); return { root, path: null };
    });
    traffic.update(0, player, null, null, unassigned);
    assert.deepEqual(traffic.snapshot(), control.snapshot(), 'pooled but unplaced avatars must not affect spawn selection');
    const car = traffic.cars[0], ahead = sampleTrafficRoute(car.route, car.along + 3), root = new THREE.Group();
    root.position.set(ahead.x, ahead.y, ahead.z);
    const before = car.along; car.speed = 9;
    traffic.update(.1, player, null, null, [{ root, path: {} }]);
    assert.equal(car.along, before); assert.equal(car.speed, 0, 'a real pedestrian still receives emergency braking');
  } finally { control.dispose(); traffic.dispose(); }
});

test('repeated takeovers share the local vehicle budget until their acquired cars leave the area', () => {
  const scene = new THREE.Scene(), city = world(), traffic = createTraffic(scene, city);
  try {
    traffic.update(0, player, null, null);
    const budget = populationFor(city, player).cars, acquired = [];
    for (let taken = 1; taken <= 4; taken++) {
      const npc = traffic.cars[0]; assert.ok(npc, 'remaining moving cars can still be taken over');
      let result;
      for (let hit = 0; hit < TRAFFIC_TAKEOVER_HITS; hit++) result = traffic.hitCar(npc);
      assert.ok(result.car, 'budget enforcement does not deny a takeover');
      city.cars.push(result.car); scene.add(result.car.root); acquired.push(result.car);
      advance(traffic, 1);
      assert.equal(traffic.snapshot().target, budget - taken, 'the new parked model reserves its former traffic slot');
      assert.ok(traffic.cars.length + city.cars.length <= budget, 'replacement NPCs must not grow the nearby vehicle population');
      assert.ok(acquired.every(car => city.cars.includes(car) && car.root.parent === scene), 'nearby acquired cars remain available');
    }
    const poses = acquired.map(car => ({ x: car.x, y: car.y, z: car.z }));
    // Travel along the same usable roads beyond the acquired cars' local area.
    advance(traffic, 5, { x: 0, y: 0, z: 450 });
    assert.equal(traffic.snapshot().target, budget, 'distant acquired cars do not make another neighborhood empty');
    assert.equal(traffic.cars.length, budget);
    assert.deepEqual(acquired.map(car => ({ x: car.x, y: car.y, z: car.z })), poses, 'traffic replenishment does not move or delete acquired cars');
    traffic.reset(); traffic.update(0, player, null, null);
    assert.equal(traffic.snapshot().target, budget - acquired.length, 'resetting the NPC pool preserves nearby acquired reservations');
    assert.ok(traffic.cars.length + acquired.length <= budget);
  } finally {
    traffic.dispose();
    for (const car of city.cars) {
      car.root.removeFromParent();
      const geometries = new Set(); car.root.traverse(mesh => { if (mesh.isMesh) geometries.add(mesh.geometry); });
      for (const geometry of geometries) geometry.dispose();
    }
  }
});
