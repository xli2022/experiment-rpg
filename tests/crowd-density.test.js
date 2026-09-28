import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCrowd } from '../src/crowd.js';
import { populationFor } from '../src/population.js';
import { SpatialGrid } from '../src/spatial-grid.js';

const asset = () => ({ scene: new THREE.Group(), animations: ['Idle', 'Walk', 'WalkFormal'].map(name => new THREE.AnimationClip(name, 1, [])) });
function districtCity(id, streets = true) {
  const roadIndex = new SpatialGrid(), supportIndex = new SpatialGrid();
  const city = { colliders: [], masterPlan: { terrainHeight: () => 0, districtAt: () => ({ id }), roadIndex, supportIndex } };
  city.addStreets = () => {
    for (const [i, x] of [-45, -25, -5, 15, 35].entries()) {
      const a = { x, y: .07, z: -120 }, b = { x, y: .07, z: 120 }, road = { class: 'local' };
      roadIndex.add({ id: `street:${i}`, road, a, b, width: 8, minX: x - 4, maxX: x + 4, minZ: -120, maxZ: 120, minY: 0, maxY: .07 });
    }
  };
  city.addDeck = (width = 180, depth = 14) => supportIndex.add({ id: 'market-deck', kind: 'deck', x: 0, z: 0, y: 12, width, depth,
    minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2, minY: 11.5, maxY: 12 });
  if (streets) city.addStreets();
  return city;
}
const assigned = crowd => crowd.people.filter(person => person.path);

test('pedestrian density follows district and quality budgets while preserving the fixed avatar pool', () => {
  const player = { x: 0, y: 0, z: 0 };
  for (const district of ['core', 'southward', 'foundry']) for (const quality of ['high', 'low']) {
    const city = districtCity(district), crowd = createCrowd(new THREE.Scene(), asset(), city);
    crowd.setQuality(quality); crowd.update(0, player, null, quality === 'low' ? 42 : 65);
    const expected = populationFor(city, player, quality), snapshot = crowd.snapshot();
    assert.equal(crowd.people.length, 26);
    assert.equal(snapshot.target, expected.pedestrians);
    assert.equal(snapshot.assigned, expected.pedestrians);
    assert.equal(snapshot.district, district);
    assert.equal(snapshot.quality, quality);
    const people = assigned(crowd);
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      assert.ok(people[i].root.position.distanceTo(people[j].root.position) >= expected.pedestrianSpacing - 1e-6,
        'Neighboring sidewalks share the district spacing instead of spawning independent clusters');
    }
    assert.ok(crowd.people.filter(person => !person.path).every(person => !person.root.visible && !person.root.parent));
  }
});

test('street and upper-market crowds prioritize the player floor without a fixed deck quota', () => {
  const city = districtCity('core'); city.addDeck();
  for (const y of [0, 12]) {
    const crowd = createCrowd(new THREE.Scene(), asset(), city), player = { x: 0, y, z: 0 };
    crowd.update(0, player, null, 90);
    assert.equal(assigned(crowd).length, 24);
    assert.equal(assigned(crowd).filter(person => Math.abs(person.root.position.y - y) < 3).length, 24);
  }
});

test('short walking platforms limit population to real available space', () => {
  const city = districtCity('core', false); city.addDeck(16, 4);
  const crowd = createCrowd(new THREE.Scene(), asset(), city);
  crowd.update(0, { x: 0, y: 12, z: -8 }, null, 65);
  assert.ok(crowd.snapshot().target > 0 && crowd.snapshot().target <= 2);
  assert.equal(assigned(crowd).length, crowd.snapshot().target);
});

test('newly available walking space fills with a bounded placement budget', () => {
  const city = districtCity('core', false), crowd = createCrowd(new THREE.Scene(), asset(), city), player = { x: 0, y: 0, z: 0 };
  crowd.update(0, player, null, 65);
  assert.equal(crowd.snapshot().target, 0);
  city.addStreets(); crowd.update(2.1, player, null, 65);
  assert.equal(assigned(crowd).length, 2);
  crowd.update(.1, player, null, 65);
  assert.equal(assigned(crowd).length, 2);
  crowd.update(.3, player, null, 65);
  assert.equal(assigned(crowd).length, 4);
});

test('lower density retires unseen actors while visible walkers remain continuous', () => {
  const city = districtCity('core'), crowd = createCrowd(new THREE.Scene(), asset(), city), player = { x: 0, y: 0, z: 0 };
  const camera = new THREE.PerspectiveCamera(90, 1, .1, 500);
  camera.position.set(0, 200, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  crowd.update(0, player, camera, 150);
  assert.equal(assigned(crowd).length, 24);
  const before = new Map(assigned(crowd).map(person => [person, person.root.position.clone()]));
  crowd.setQuality('low'); crowd.update(1 / 60, player, camera, 150);
  assert.equal(crowd.snapshot().target, 16);
  assert.equal(assigned(crowd).length, 24, 'Actors in view do not vanish when the target changes');
  for (const person of assigned(crowd)) assert.ok(person.root.position.distanceTo(before.get(person)) < .03);
  camera.position.set(1000, 200, 1000); camera.lookAt(1000, 0, 1000); camera.updateMatrixWorld();
  crowd.update(.1, player, camera, 150);
  assert.equal(assigned(crowd).length, 16);
  crowd.update(.1, { x: 2000, y: 0, z: 2000 }, camera, 65);
  assert.equal(assigned(crowd).length, 0);
  assert.equal(crowd.active, 0);
});
