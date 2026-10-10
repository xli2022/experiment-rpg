import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld, AFTERLIGHT_LANDMARKS, WORLD_LIMIT } from '../src/world/index.js';

test('the world module builds the whole static city without any game mode', () => {
  const scene = new THREE.Scene(), world = createWorld({ scene, quality: 'low' });
  assert.equal(world.limit, WORLD_LIMIT);
  assert.equal(world.districts.length, 13);
  assert.equal(world.landmarks, AFTERLIGHT_LANDMARKS);
  assert.equal(new Set(AFTERLIGHT_LANDMARKS.map(p => p.id)).size, AFTERLIGHT_LANDMARKS.length);
  assert.ok(AFTERLIGHT_LANDMARKS.every(p => Object.isFrozen(p) && [p.x, p.y, p.z].every(Number.isFinite) && p.district));
  assert.equal(world.landmark('home').id, 'home');
  assert.equal(world.landmark('missing'), null);
  assert.ok(AFTERLIGHT_LANDMARKS.filter(p => p.station).length >= 19, 'every district and line terminus has a station');
  const { spawn } = world;
  assert.ok(Math.abs(spawn.y - world.terrainHeight(spawn.x, spawn.z)) < 1e-9 && Number.isFinite(spawn.yaw));
  assert.equal(scene.fog.density, .005, 'quality reaches the atmosphere');

  const camera = new THREE.PerspectiveCamera(62, 1.5, .12, 600);
  camera.position.set(spawn.x, spawn.y + 2, spawn.z + 6); camera.lookAt(spawn.x, spawn.y, spawn.z);
  world.update({ camera, focus: spawn, now: 1, dt: .016, force: true });
  assert.ok(world.snapshot().streaming.resident > 0, 'streams the neighborhood around the focus');
  assert.ok(world.buildingsNear(spawn.x, spawn.z, 60).length > 0);
  const tower = world.buildingsNear(spawn.x, spawn.z, 120).find(p => world.interiorContextAt(p.x, p.y + .2, p.z));
  assert.ok(tower, 'buildings near the spawn are enterable');
  assert.notEqual(world.spatialFor(world.interiorContextAt(tower.x, tower.y + .2, tower.z)), world.spatial);

  world.setQuality('high', { far: 720 });
  assert.equal(scene.fog.density, .0035);
  world.dispose();
  assert.equal(scene.fog, null);
  assert.equal(scene.environment, null);
  assert.ok(!scene.children.includes(world.atmosphere.sky));
  assert.ok(!scene.children.includes(world.ground) && !scene.children.includes(world.water), 'terrain and water leave with the world');
});
