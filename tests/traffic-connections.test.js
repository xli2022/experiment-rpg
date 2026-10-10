import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTraffic, createLaneRoute, sampleTrafficRoute } from '../src/traffic/traffic.js';
import { circleHitsBox, carCollider } from '../src/core/physics.js';

function harness(elevated = false) {
  const corners = [[-90, -90], [90, -90], [90, 90], [-90, 90]];
  const roads = corners.map(([x, z], i) => ({ id: `edge-${i}`, width: 12, class: 'local', closed: false,
    points: [{ x, y: 0, z }, { x: corners[(i + 1) % 4][0], y: 0, z: corners[(i + 1) % 4][1] }] }));
  if (elevated) roads.push({ ...roads[0], id: 'overpass', points: roads[0].points.map(p => ({ ...p, y: 18 })) });
  const traffic = createTraffic(new THREE.Scene(), { masterPlan: { roads }, cars: [], colliders: [] });
  // Keep every junction visible: off-screen recycling must not hide a frozen
  // fleet or make a teleport look like successful route continuation.
  const camera = new THREE.OrthographicCamera(-180, 180, 180, -180, .1, 1000);
  camera.position.set(0, 160, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  const player = { x: 0, y: 0, z: 0 };
  traffic.update(0, player, null, camera);
  return { traffic, camera, player };
}

test('visible traffic continues around connected open streets without teleporting or stopping at their endpoints', () => {
  const { traffic, camera, player } = harness();
  try {
    const ids = traffic.cars.map(car => car.id), turned = new Set();
    assert.ok(ids.length >= 8, 'exercise normal simultaneous traffic in both directions');
    for (let frame = 0; frame < 3600; frame++) {
      const before = new Map(traffic.cars.map(car => [car.id, { x: car.x, y: car.y, z: car.z }]));
      traffic.update(1 / 30, player, null, camera);
      for (const car of traffic.cars) {
        const old = before.get(car.id);
        assert.ok(old, 'visible cars retain their identity across street boundaries');
        assert.ok(Math.hypot(car.x - old.x, car.y - old.y, car.z - old.z) < .5, 'junction movement remains continuous at 30 FPS');
        if (car.route.next) turned.add(car.id);
        assert.ok(Math.min(Math.abs(Math.abs(car.x) - 90), Math.abs(Math.abs(car.z) - 90)) < 5.1, 'turns remain on the intersection asphalt');
        if (frame % 15 === 0) for (const other of traffic.cars) if (car.id < other.id) {
          assert.equal(circleHitsBox(car.x, car.z, 1.15, carCollider(other)), false, 'opposing turns and queued cars retain clearance');
        }
      }
    }
    assert.deepEqual(traffic.cars.map(car => car.id), ids);
    assert.equal(turned.size, ids.length, 'every original car actually traverses a junction');
    assert.ok(traffic.cars.filter(car => car.speed > 1).length >= ids.length - 2, 'watching an intersection for two minutes must not freeze the fleet');
  } finally { traffic.dispose(); }
});

test('road continuation never connects an overpass to coincident streets at another height', () => {
  const { traffic, camera, player } = harness(true);
  try {
    const floors = new Map(traffic.cars.map(car => [car.id, car.y]));
    assert.ok([...floors.values()].some(y => y > 10) && [...floors.values()].some(y => y === 0));
    for (let frame = 0; frame < 1800; frame++) {
      traffic.update(1 / 30, player, null, camera);
      for (const car of traffic.cars) assert.ok(Math.abs(car.y - floors.get(car.id)) < .01, 'a 2D road intersection cannot change vehicle floors');
    }
    assert.ok(traffic.cars.filter(car => car.y === 0 && car.speed > 1).length >= 3, 'connected ground streets continue normally');
    assert.ok(traffic.cars.filter(car => car.y > 10).every(car => car.speed < .1), 'the actual unconnected overpass ends still stop traffic safely');
  } finally { traffic.dispose(); }
});

test('four simultaneous approaches clear a master-road crossing without deadlock or false overpass yielding', () => {
  for (const upperHeight of [0, 18]) {
    const roads = [
      { id: 'east-west', width: 12, points: [{ x: -150, y: 0, z: 0 }, { x: 150, y: 0, z: 0 }] },
      { id: 'north-south', width: 12, points: [{ x: 0, y: upperHeight, z: -150 }, { x: 0, y: upperHeight, z: 150 }] },
    ];
    const traffic = createTraffic(new THREE.Scene(), { masterPlan: { roads }, cars: [], colliders: [] });
    const camera = new THREE.OrthographicCamera(-260, 260, 260, -260, .1, 1000);
    camera.position.set(0, 250, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    const player = { x: 70, y: 0, z: 70 };
    try {
      traffic.update(0, player, null, camera);
      assert.ok(traffic.cars.length >= 4);
      traffic.cars.splice(4);
      // Arrange four equal arrival times; bumper-only braking would stop all
      // four cars permanently where their paths cross in the intersection.
      for (const [i, car] of traffic.cars.entries()) {
        const road = roads[Math.floor(i / 2)];
        const route = createLaneRoute(road.points, { width: 12, closed: false, reverse: i % 2 === 1 });
        route.sourceRoad = road;
        Object.assign(car, sampleTrafficRoute(route, 115), { route, along: 115, speed: 8, cruise: 8 });
      }
      const ids = traffic.cars.map(car => car.id);
      for (let frame = 0; frame < 900; frame++) {
        traffic.update(1 / 30, player, null, camera);
        assert.deepEqual(traffic.cars.map(car => car.id), ids, 'the visible cars cannot be recycled to conceal a queue');
        for (const car of traffic.cars) {
          assert.ok(Math.abs(car.y - car.route.sourceRoad.points[0].y) < .01);
          if (upperHeight && frame < 240) assert.ok(car.speed > 7.9, 'grade-separated crossings need no shared reservation');
          for (const other of traffic.cars) if (car.id < other.id && Math.abs(car.y - other.y) < 3) {
            assert.equal(circleHitsBox(car.x, car.z, 1.15, carCollider(other)), false, 'crossing priority preserves vehicle clearance');
          }
        }
      }
      assert.ok(traffic.cars.every(car => car.along > 165), 'all four approaches pass the intersection within thirty seconds');
    } finally { traffic.dispose(); }
  }
});
