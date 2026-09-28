import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTraffic, createLaneRoute, regionalTrafficRoutes, sampleTrafficRoute, trafficSpeedForGap, TRAFFIC_PROFILES } from '../src/traffic.js';
import { Metropolis } from '../src/metropolis.js';
import { orientedBox, circleHitsBox, carCollider } from '../src/physics.js';

const start = { x: -2.5, y: 0, z: 30 };
const city = () => ({ cars: [], colliders: [] });
const advance = (traffic, seconds, player = start, driving = null) => {
  for (let i = 0; i < seconds * 60; i++) traffic.update(1 / 60, player, driving, null);
};

test('traffic follows distinct right-hand lanes and joins its loop without snapping', () => {
  const points = [{ x: 0, z: 0 }, { x: 64, z: 0 }, { x: 64, z: 64 }, { x: 0, z: 64 }];
  const clockwise = createLaneRoute(points, { corners: true, width: 16 });
  const opposite = createLaneRoute(points, { corners: true, width: 16, reverse: true });
  // Interior points on the long straight are sampled by arc distance.
  for (const route of [clockwise, opposite]) {
    for (let s = 0; s < route.length; s += .5) {
      const a = sampleTrafficRoute(route, s), b = sampleTrafficRoute(route, s + .5);
      assert.ok(Math.hypot(b.x - a.x, b.z - a.z) <= .501);
    }
    const before = sampleTrafficRoute(route, route.length - .01), after = sampleTrafficRoute(route, .01);
    assert.ok(Math.hypot(before.x - after.x, before.z - after.z) < .021);
  }
  const straight = route => Array.from({ length: Math.ceil(route.length) }, (_, s) => sampleTrafficRoute(route, s)).find(p => p.x > 31 && p.x < 33 && p.z < 10);
  assert.ok(straight(clockwise).z > 2.5);
  assert.ok(straight(opposite).z < -2.5);
  assert.ok(trafficSpeedForGap(5) < trafficSpeedForGap(14));
  assert.equal(trafficSpeedForGap(4), 0);
  assert.equal(trafficSpeedForGap(Infinity), 9);
});

test('regional traffic stays on the actual deformed road network, outside its central cut-out', () => {
  const metro = new Metropolis();
  for (const p of [{ x: 2220, z: -2150 }, { x: -3100, z: 3650 }, { x: 0, z: 800 }]) {
    const routes = regionalTrafficRoutes(p);
    assert.ok(routes.length > 0);
    for (const route of routes) for (let s = 0; s < route.length; s += 5) {
      const point = sampleTrafficRoute(route, s);
      assert.ok(Math.max(Math.abs(point.x), Math.abs(point.z)) > 758);
      assert.ok(metro.onRoad(orientedBox(point.x, point.z, 2.34, 4.74, point.yaw), 0), route.id);
    }
  }
});

test('traffic has bounded instanced render cost in both quality modes', () => {
  for (const quality of ['high', 'low']) {
    const scene = new THREE.Scene(), world = city(), traffic = createTraffic(scene, world);
    traffic.setQuality(quality); traffic.update(0, start, null, null);
    assert.equal(traffic.cars.length, TRAFFIC_PROFILES[quality].count);
    assert.equal(world.cars.length, 0, 'NPC cars must not become enterable parked cars');
    assert.ok(traffic.root.children.length < 25, 'draw calls are shared by the whole fleet');
    assert.ok(traffic.root.children.every(mesh => mesh.isInstancedMesh && mesh.count === traffic.cars.length));
    assert.ok(traffic.cars.every(c => Math.hypot(c.x - start.x, c.z - start.z) >= 34));
    const before = traffic.snapshot().cars;
    advance(traffic, 2);
    assert.ok(traffic.cars.filter(c => Math.hypot(c.x - before.find(b => b.id === c.id).x, c.z - before.find(b => b.id === c.id).z) > 5).length >= 4);
    traffic.dispose(); assert.equal(scene.children.length, 0);
  }
});

test('traffic brakes for a pedestrian, leaves bumper clearance, and resumes when they leave', () => {
  const traffic = createTraffic(new THREE.Scene(), city()); traffic.update(0, start, null, null);
  const car = traffic.cars[0], pedestrian = { ...sampleTrafficRoute(car.route, car.along + 24), y: 0 };
  advance(traffic, 4, pedestrian);
  assert.equal(car.speed, 0);
  assert.ok(Math.hypot(car.x - pedestrian.x, car.z - pedestrian.z) > 4);
  assert.equal(circleHitsBox(pedestrian.x, pedestrian.z, .65, carCollider(car)), false);
  advance(traffic, 2, { ...pedestrian, y: 12 });
  assert.ok(car.speed > 1, 'a player on a rooftop should not block street traffic');
  traffic.dispose();
});

test('traffic stops for a drivable parked car and cannot sweep through a suddenly crossing player', () => {
  const world = city(), traffic = createTraffic(new THREE.Scene(), world); traffic.update(0, start, null, null);
  const car = traffic.cars[0], obstacle = sampleTrafficRoute(car.route, car.along + 25);
  world.cars.push({ ...obstacle, speed: 0 });
  advance(traffic, 5);
  assert.equal(car.speed, 0);
  assert.ok(Math.hypot(car.x - obstacle.x, car.z - obstacle.z) > 6);
  world.cars.length = 0;
  const pedestrian = { ...sampleTrafficRoute(car.route, car.along + 3), y: 0 }, original = car.along;
  car.speed = 9; traffic.update(.1, pedestrian, null, null);
  assert.equal(car.speed, 0); assert.equal(car.along, original);
  traffic.dispose();
});

test('traffic avoids obstructed spawns and recycles its fixed pool after regional travel', () => {
  const world = city(), scene = new THREE.Scene(), traffic = createTraffic(scene, world);
  world.colliders.push(orientedBox(0, 0, 600, 600, 0, 5));
  traffic.update(0, start, null, null); assert.equal(traffic.cars.length, 0);
  world.colliders.length = 0; advance(traffic, 5);
  assert.ok(traffic.cars.length > 0);
  const meshCount = traffic.root.children.length;
  advance(traffic, 5, { x: 2220, y: 0, z: -2100 });
  assert.ok(traffic.cars.length > 0 && traffic.cars.length <= 12);
  assert.ok(traffic.cars.every(c => c.route.id.startsWith('regional:')));
  assert.equal(traffic.root.children.length, meshCount);
  assert.equal(scene.children.length, 1);
  traffic.reset(); assert.equal(traffic.cars.length, 0);
  assert.ok(traffic.root.children.every(mesh => mesh.count === 0));
  traffic.dispose();
});

test('intersection yielding keeps cars moving without overlapping through a minute of traffic', () => {
  const traffic = createTraffic(new THREE.Scene(), city());
  traffic.update(0, { x: 20, y: 0, z: 20 }, null, null);
  for (let i = 0; i < 3600; i++) {
    traffic.update(1 / 60, { x: 20, y: 0, z: 20 }, null, null);
    if (i % 10) continue;
    for (const car of traffic.cars) for (const other of traffic.cars) if (car !== other) {
      assert.equal(circleHitsBox(car.x, car.z, 1.15, carCollider(other)), false, `overlapping traffic ${car.id} / ${other.id}`);
    }
  }
  assert.ok(traffic.cars.filter(c => c.speed > 1).length >= 6, 'intersection priority must not deadlock the fleet');
  traffic.dispose();
});
