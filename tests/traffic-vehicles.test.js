import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTraffic, populationFor, signalState, IDM } from '../src/traffic/index.js';
import { buildNetwork, samplePath } from '../src/traffic/network.js';
import { createVehicles } from '../src/traffic/vehicles.js';
import { createMasterPlan, MASTER_DISTRICTS } from '../src/world/master-plan.js';
import { surfaceHeightAt, seededRandom } from '../src/core/physics.js';
import { gridPlan, streetPlan, crowdAsset } from './helpers/street-grid.js';

const plan = createMasterPlan();

// Separating-axis overlap of two car bodies.
function overlap(a, b) {
  const axes = [a.yaw, b.yaw].flatMap(yaw => [[-Math.sin(yaw), -Math.cos(yaw)], [Math.cos(yaw), -Math.sin(yaw)]]);
  const extent = (car, [x, z]) => {
    const f = [-Math.sin(car.yaw), -Math.cos(car.yaw)], r = [-f[1], f[0]];
    return Math.abs(f[0] * x + f[1] * z) * car.half + Math.abs(r[0] * x + r[1] * z) * 1.1 * car.body.scale[0];
  };
  return axes.every(axis => Math.abs((b.x - a.x) * axis[0] + (b.z - a.z) * axis[1]) < extent(a, axis) + extent(b, axis));
}

test('district population balances busy neighborhoods against freight areas within fixed quality budgets', () => {
  const city = id => ({ masterPlan: { districtAt: () => ({ id }) } }), at = { x: 0, z: 0 };
  const urban = populationFor(city('core'), at), freight = populationFor(city('void-port'), at);
  assert.ok(urban.pedestrians > freight.pedestrians);
  assert.ok(freight.cars / freight.pedestrians > urban.cars / urban.pedestrians);
  assert.ok(freight.pedestrianSpacing > urban.pedestrianSpacing);
  assert.ok(populationFor(city('cut'), at).cars < urban.cars);
  for (const id of [...MASTER_DISTRICTS.map(d => d.id), 'unknown']) {
    const high = populationFor(city(id), at), low = populationFor(city(id), at, 'low');
    assert.ok(high.pedestrians > 0 && high.pedestrians <= 26 && high.cars > 0 && high.cars <= 12);
    assert.ok(low.pedestrians > 0 && low.pedestrians < high.pedestrians && low.cars > 0 && low.cars < high.cars);
  }
});

test('five minutes of city traffic: no collisions, no red lights, smooth speeds and real turns', () => {
  const traffic = createTraffic({ scene: new THREE.Scene(), world: { masterPlan: plan, spatial: null }, assets: { citizen: crowdAsset() } });
  const turns = { left: 0, right: 0, straight: 0 }, dt = 1 / 30;
  let frames = 0, braking = 0, lit = 0, held = 0;
  for (const id of ['core', 'east-reach']) {
    const district = plan.districts.find(d => d.id === id);
    const junction = traffic.network.nodes.filter(n => n.signalized).sort((a, b) => Math.hypot(a.x - district.x, a.z - district.z) - Math.hypot(b.x - district.x, b.z - district.z))[0];
    const player = { x: junction.x + 12, y: junction.y, z: junction.z + 12, yaw: 0, speed: 0 };
    traffic.reset();
    const last = new Map();
    for (let frame = 0; frame < 150 * 30; frame++) {
      traffic.update(dt, { player, range: 65 });
      frames++;
      const cars = traffic.cars;
      assert.equal(cars.length, traffic.snapshot().target, 'the district budget is filled');
      for (const car of cars) {
        const before = last.get(car.id);
        if (before) {
          const a = (car.speed - before.speed) / dt;
          assert.ok(a >= -IDM.emergency - 1e-6 && a <= IDM.accel + 1e-6, `car ${car.id} accelerates at ${a.toFixed(1)} m/s²`);
          if (a < -2) { braking++; if (car.brake) lit++; }
          if (car.box && car.box !== before.box && car.box.node.signalized) {
            assert.notEqual(signalState(car.box.node, car.box.inApproach, traffic.time).color, 'red', `car ${car.id} enters ${car.box.node.id} on red`);
          }
          if (car.piece !== before.piece && car.piece.kind === 'connector') turns[car.piece.turn]++;
        }
        // Waiting at a red light means waiting behind the line.
        const next = car.route[0];
        if (car.piece.kind === 'lane' && car.speed < .05 && next?.kind === 'connector' && next.node.signalized && car.box !== next &&
          signalState(next.node, next.inApproach, traffic.time).color === 'red' && car.piece.path.length - car.s < 12) {
          held++;
          assert.ok(car.s + car.half <= car.piece.path.length + .05, `stopped before the stop line: ${JSON.stringify({ id: car.id, s: car.s, half: car.half, length: car.piece.path.length, cause: car.cause, denied: car.denied, box: car.box?.id, next: next.id, prev: car.prev?.id, piece: car.piece.id, t: traffic.time })}`);
        }
        assert.ok(car.speed >= 0 && Number.isFinite(car.x) && Number.isFinite(car.y));
        last.set(car.id, { speed: car.speed, box: car.box, piece: car.piece });
      }
      for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
        const ref = cars[i].box?.node ?? cars[j].box?.node ?? { x: 0, z: 0 };
        const info = c => ({ id: c.id, piece: c.piece.id, s: +c.s.toFixed(2), len: +c.piece.path.length.toFixed(2), half: c.half, v: +c.speed.toFixed(2), cause: c.cause, box: c.box?.id, x: +(c.x - ref.x).toFixed(2), z: +(c.z - ref.z).toFixed(2), yaw: +c.yaw.toFixed(2), route: c.route.map(p => p.id).join(' ') });
        if (Math.abs(cars[i].y - cars[j].y) < 2) assert.ok(!overlap(cars[i], cars[j]), `cars collide: ${JSON.stringify([info(cars[i]), info(cars[j])])}`);
      }
      if (frame % 300 === 0) for (const car of cars) {
        const surfaces = plan.roadIndex.near(car.x, car.z, 2).map(s => surfaceHeightAt(car.x, car.z, s)).filter(y => y !== null);
        assert.ok(surfaces.some(y => Math.abs(y - car.y) < .25), `car ${car.id} is on a road surface`);
      }
    }
  }
  assert.ok(turns.left > 5 && turns.right > 5 && turns.straight > 20, JSON.stringify(turns));
  assert.ok(held > 30, 'cars queue at red lights');
  assert.ok(lit / braking > .95, 'brake lights show while slowing');
  traffic.dispose();
});

// A single car aimed at a chosen turn on a test grid, with the light green.
function turning(turn, { crossings = new Set(), grid = gridPlan() } = {}) {
  const network = buildNetwork(grid), vehicles = createVehicles({ scene: new THREE.Scene(), network, plan: grid, random: seededRandom(3) });
  const node = network.nodes.find(n => n.kind === 'junction'), connector = network.connectorsAt(node).find(c => c.turn === turn);
  const car = vehicles.spawn(connector.from, Math.max(0, connector.from.path.length - 45), 6);
  car.route = [connector, connector.to];
  let time = 0;
  while (signalState(node, connector.inApproach, time).color !== 'green' || signalState(node, connector.inApproach, time).remaining < 12) time += .25;
  return { vehicles, car, connector, node, time, crossings };
}

test('turning cars wait for people on the crosswalk, then go', () => {
  const setup = turning('right'), { vehicles, car, connector } = setup;
  setup.crossings.add(`${setup.node.id}:${connector.outApproach.index}`);
  const crosswalk = connector.path.length;
  // The signal clock stays inside the green phase throughout.
  for (let i = 0; i < 600; i++) {
    vehicles.update(1 / 30, { time: setup.time, bodies: [], walkers: [], crossings: setup.crossings });
    if (car.piece === connector) assert.ok(car.s + car.half < crosswalk + .2, 'the car stops short of the crosswalk');
  }
  assert.ok(car.speed < .05 && car.brake, 'held with brake lights on');
  setup.crossings.clear();
  for (let i = 0; i < 300; i++) vehicles.update(1 / 30, { time: setup.time, bodies: [], walkers: [], crossings: setup.crossings });
  assert.equal(car.piece, connector.to, 'continues once the crossing is clear');
  assert.notEqual(car.signal, 'right', 'the right indicator stops after the turn');
});

test('cars signal their turns and steer the front wheels', () => {
  const { vehicles, car, connector, time } = turning('left');
  let signalled = false, steered = 0;
  for (let i = 0; i < 400 && car.piece !== connector.to; i++) {
    vehicles.update(1 / 30, { time: time + i / 30, bodies: [], walkers: [], crossings: new Set() });
    if (car.signal === 'left') signalled = true;
    if (car.piece === connector) steered = Math.max(steered, car.steer);
  }
  assert.ok(signalled && steered > .1, `indicator and steering (${steered.toFixed(2)})`);
});

test('a give-way junction clears simultaneous arrivals without deadlock or contact', () => {
  const grid = streetPlan([
    { id: 'main', width: 10, points: [{ x: -200, z: 0 }, { x: 200, z: 0 }] },
    { id: 'side', width: 10, points: [{ x: 0, z: 0 }, { x: 0, z: 200 }] },
  ]);
  const network = buildNetwork(grid), vehicles = createVehicles({ scene: new THREE.Scene(), network, plan: grid, random: seededRandom(5) });
  const node = network.nodes.find(n => n.kind === 'junction');
  assert.equal(node.signalized, false);
  const cars = node.approaches.map(a => {
    const lane = a.arriving[0], left = network.connectorsAt(node).find(c => c.from === lane && c.turn === 'left') ?? network.connectorsAt(node).find(c => c.from === lane);
    const car = vehicles.spawn(lane, lane.path.length - 30, 6); car.route = [left, left.to]; return car;
  });
  for (let i = 0; i < 40 * 30; i++) {
    vehicles.update(1 / 30, { time: i / 30, bodies: [], walkers: [], crossings: new Set() });
    for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) assert.ok(!overlap(cars[a], cars[b]));
  }
  assert.ok(cars.every(car => car.piece.kind === 'lane' && car.prev?.kind === 'connector'), 'every car has turned through the junction');
});

test('a car on a bridge ignores people on the street below but stops for one in its lane', () => {
  const grid = streetPlan([{ id: 'bridge', width: 10, class: 'expressway', points: [{ x: 0, y: 18, z: -300 }, { x: 0, y: 18, z: 300 }] }]);
  const network = buildNetwork(grid), vehicles = createVehicles({ scene: new THREE.Scene(), network, plan: grid, random: seededRandom(9) });
  const lane = network.lanes[0], car = vehicles.spawn(lane, 40, 12);
  const ahead = samplePath(lane.path, 75), below = { x: ahead.x, y: 0, z: ahead.z, r: .35 };
  for (let i = 0; i < 30; i++) vehicles.update(1 / 30, { time: 0, bodies: [], walkers: [below], crossings: new Set() });
  assert.ok(car.speed > 11.9, 'no braking for the street underneath');
  const onDeck = { ...samplePath(lane.path, car.s + 30), r: .35 };
  for (let i = 0; i < 300; i++) vehicles.update(1 / 30, { time: 1, bodies: [], walkers: [onDeck], crossings: new Set() });
  assert.ok(car.speed < .05 && onDeck.z - car.z > car.half + 2 || car.z - onDeck.z > car.half + 2, 'stops a safe distance short');
});
