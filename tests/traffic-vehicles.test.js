import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTraffic, populationFor, signalState, IDM, VEHICLE_PROFILES } from '../src/traffic/index.js';
import { buildNetwork, samplePath, projectOnPath } from '../src/traffic/network.js';
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

// A car's footprint (plus a margin) contains a point.
function touching(car, p, margin = .1) {
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), dx = p.x - car.x, dz = p.z - car.z;
  return Math.abs(dx * fx + dz * fz) < car.half + margin && Math.abs(-dx * fz + dz * fx) < 1.1 * car.body.scale[0] + margin && Math.abs(p.y - car.y) < 2;
}

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
          // Reserving a turn is entering it. Junctions too close to wait between
          // are entered together, on the first one's light.
          const [entered] = car.boxes.map(b => b.connector).filter(c => !before.reserved.includes(c));
          if (entered?.node.signalized) {
            assert.notEqual(signalState(entered.node, entered.inApproach, traffic.time).color, 'red', `car ${car.id} enters ${entered.node.id} on red`);
          }
          if (car.piece !== before.piece && car.piece.kind === 'connector') turns[car.piece.turn]++;
        }
        // Waiting at a red light means waiting behind the line.
        const next = car.route[0];
        if (car.piece.kind === 'lane' && car.speed < .05 && next?.kind === 'connector' && next.node.signalized && !car.boxes.some(b => b.connector === next) &&
          signalState(next.node, next.inApproach, traffic.time).color === 'red' && car.piece.path.length - car.s < 12) {
          held++;
          assert.ok(car.s + car.half <= car.piece.path.length + .05, `stopped before the stop line: ${JSON.stringify({ id: car.id, s: car.s, half: car.half, length: car.piece.path.length, cause: car.cause, denied: car.denied, box: car.box?.id, next: next.id, prev: car.prev?.id, piece: car.piece.id, t: traffic.time })}`);
        }
        assert.ok(car.speed >= 0 && Number.isFinite(car.x) && Number.isFinite(car.y));
        last.set(car.id, { speed: car.speed, reserved: car.boxes.map(b => b.connector), piece: car.piece });
      }
      for (const car of cars) for (const p of traffic.pedestrians.walkers) {
        assert.ok(!touching(car, p), `car ${car.id} (${car.piece.id}, ${car.speed.toFixed(1)} m/s) touches walker ${p.id} on a ${p.edge?.kind}`);
      }
      for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
        const ref = cars[i].box?.node ?? cars[j].box?.node ?? { x: 0, z: 0 };
        const info = c => ({ id: c.id, piece: c.piece.id, s: +c.s.toFixed(2), len: +c.piece.path.length.toFixed(2), half: c.half, v: +c.speed.toFixed(2), cause: c.cause, box: c.box?.id, x: +(c.x - ref.x).toFixed(2), z: +(c.z - ref.z).toFixed(2), yaw: +c.yaw.toFixed(2), route: c.route.map(p => p.id).join(' ') });
        if (Math.abs(cars[i].y - cars[j].y) < 2) assert.ok(!overlap(cars[i], cars[j]), `cars collide: ${JSON.stringify([info(cars[i]), info(cars[j])])}`);
      }
      if (frame % 30 === 0) for (const car of cars) {
        // On the road surface wherever there is one; only a turn may clip a kerb.
        const surfaces = plan.roadIndex.near(car.x, car.z, 2).map(s => surfaceHeightAt(car.x, car.z, s)).filter(y => y !== null);
        if (surfaces.length) assert.ok(surfaces.some(y => Math.abs(y - car.y) < .25), `car ${car.id} rides on its road surface`);
        else assert.equal(car.piece.kind, 'connector', `car ${car.id} is off the road on ${car.piece.id}`);
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

test('junctions too close to wait between are crossed as one: no car is caught on the short link', () => {
  // Two T junctions 9 m apart: the main-road lanes between them hold no car.
  const grid = streetPlan([
    { id: 'main', width: 6, points: [{ x: 0, z: -200 }, { x: 0, z: 200 }] },
    { id: 'west', width: 6, points: [{ x: 0, z: 0 }, { x: -200, z: 0 }] },
    { id: 'east', width: 6, points: [{ x: 0, z: 9 }, { x: 200, z: 9 }] },
  ]);
  const network = buildNetwork(grid), [first, second] = network.nodes.filter(n => n.kind === 'junction').sort((a, b) => a.z - b.z);
  const link = network.edges.find(e => e.from === first && e.to === second || e.from === second && e.to === first);
  assert.ok(link.lanes.forward.every(lane => lane.path.length < 7));
  // One car runs up the main road and turns left at the second junction; another
  // turns right out of the side road there, towards the first.
  const mainIn = first.approaches.find(a => a.edge !== link && a.edge.road.id === 'main').arriving[0];
  const through = network.connectorsAt(first).find(c => c.from === mainIn && c.to.edge === link);
  const left = network.connectorsAt(second).find(c => c.from === through.to && c.to.edge.road.id === 'east');
  const sideIn = second.approaches.find(a => a.edge.road.id === 'east').arriving[0];
  const right = network.connectorsAt(second).find(c => c.from === sideIn && c.to.edge === link);
  for (const mainOut of [20, 32, 44, 56]) for (const sideOut of [8, 16, 24, 32]) for (const speed of [5, 8]) {
    const vehicles = createVehicles({ scene: new THREE.Scene(), network, plan: grid, random: seededRandom(11) });
    const a = vehicles.spawn(mainIn, mainIn.path.length - mainOut, speed), b = vehicles.spawn(sideIn, sideIn.path.length - sideOut, speed);
    a.route = [through, through.to, left, left.to]; b.route = [right, right.to];
    const reached = new Set();
    for (let i = 0; i < 20 * 30; i++) {
      const bodies = vehicles.cars.map(car => ({ x: car.x, y: car.y, z: car.z, fx: -Math.sin(car.yaw), fz: -Math.cos(car.yaw), half: car.half, width: 1.1 * car.body.scale[0], speed: car.speed, ref: car, kind: 'car' }));
      vehicles.update(1 / 30, { time: i / 30, bodies, walkers: [], crossings: new Set() });
      assert.ok(!overlap(a, b), `cars collide starting ${mainOut} m and ${sideOut} m out at ${speed} m/s`);
      reached.add(a.piece).add(b.piece);
    }
    assert.ok(reached.has(left.to) && reached.has(right.to), 'both cars get through');
  }
});

test('signalized junctions too close to wait between go on the first light, even where their greens never meet', () => {
  const network = buildNetwork(plan);
  // Chains whose straight-through greens never coincide: waiting for both would be waiting for ever.
  const opposite = (node, approach) => node.approaches.find(a => a.dir.x * approach.dir.x + a.dir.z * approach.dir.z < -.9);
  const never = network.lanes.filter(lane => {
    if (!(lane.path.length < 7 && lane.start.signalized && lane.end.signalized)) return false;
    const into = opposite(lane.start, lane.start.approaches.find(a => a.leaving.includes(lane))), onward = lane.end.approaches.find(a => a.arriving.includes(lane));
    if (!into) return false;
    for (let t = 0; t < 300; t += .5) if (signalState(lane.start, into, t).color === 'green' && signalState(lane.end, onward, t).color === 'green') return false;
    return true;
  });
  assert.ok(never.length > 0);
  for (const lane of never) for (const first of network.connectorsAt(lane.start).filter(c => c.to === lane)) for (const second of network.connectorsAt(lane.end).filter(c => c.from === lane)) {
    const vehicles = createVehicles({ scene: new THREE.Scene(), network, plan, random: seededRandom(3) });
    const car = vehicles.spawn(first.from, Math.max(0, first.from.path.length - 40), 6);
    car.route = [first, lane, second, second.to];
    let time = 7;
    for (; time < 100 && car.piece !== second.to; time += 1 / 30) {
      const before = car.boxes.length;
      vehicles.update(1 / 30, { time, bodies: [], walkers: [], crossings: new Set() });
      if (!before && car.boxes.length) assert.notEqual(signalState(lane.start, first.inApproach, time).color, 'red', 'enters the first junction on its light');
    }
    assert.equal(car.piece, second.to, `${first.id} then ${second.id} gets through`);
  }
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
  // Measured along the lane from the front bumper to the person.
  const short = projectOnPath(lane.path, onDeck).s - car.s - car.half;
  assert.equal(car.piece, lane);
  assert.ok(car.speed < .05 && short > 2 && short < 6, `stops a safe distance short (${short.toFixed(2)} m at ${car.speed.toFixed(2)} m/s)`);
});

// A long straight street with one dead end at each end, and traffic on it.
function straightStreet() {
  const grid = streetPlan([{ id: 'avenue', width: 6, points: [{ x: 0, z: -320 }, { x: 0, z: 320 }] }]);
  return createTraffic({ scene: new THREE.Scene(), world: { masterPlan: grid, spatial: null }, assets: { citizen: crowdAsset() } });
}

test('traffic stops for the player standing in the lane and for the player\'s car', () => {
  const traffic = straightStreet();
  // Northbound traffic keeps right: its lane is at x = -1.5.
  const player = { x: -1.5, y: 0, z: 40, yaw: 0, speed: 0 };
  let queued = null;
  for (let frame = 0; frame < 120 * 30 && !queued; frame++) {
    traffic.update(1 / 30, { player });
    for (const car of traffic.cars) assert.ok(!touching(car, player, .45), `car ${car.id} runs into the player`);
    queued = traffic.cars.find(car => car.speed < .05 && car.z < player.z && car.z > player.z - 12 && Math.abs(car.x - player.x) < .5) ?? null;
  }
  assert.ok(queued, 'a car waits behind the player');
  assert.ok(player.z - queued.z - queued.half > 2, 'with a gap in front of it');
  // Take that car and leave it there; the player walks off the road.
  const parked = traffic.takeOver(queued), aside = { x: 8, y: 0, z: 40, yaw: 0, speed: 0 };
  let behind = null;
  for (let frame = 0; frame < 120 * 30 && !behind; frame++) {
    traffic.update(1 / 30, { player: aside, vehicle: parked });
    for (const car of traffic.cars) {
      const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), d = Math.hypot(car.x - parked.x, car.z - parked.z);
      assert.ok(d > 4.7 || Math.abs((parked.x - car.x) * -fz + (parked.z - car.z) * fx) > 2.2, `car ${car.id} runs into the parked car`);
    }
    behind = traffic.cars.find(car => car.speed < .05 && car.z < parked.z && car.z > parked.z - 14 && Math.abs(car.x - parked.x) < .5) ?? null;
  }
  assert.ok(behind, 'traffic queues behind the player\'s car');
  traffic.dispose();
});

test('graphics quality caps the fleet and the crowd', () => {
  const traffic = createTraffic({ scene: new THREE.Scene(), world: { masterPlan: plan, spatial: null }, assets: { citizen: crowdAsset() } });
  const player = { x: plan.spawn.x, y: plan.spawn.y, z: plan.spawn.z, yaw: 0, speed: 0 };
  for (const [quality, profile] of [['high', VEHICLE_PROFILES.high], ['low', VEHICLE_PROFILES.low]]) {
    traffic.setQuality(quality); traffic.reset();
    for (let i = 0; i < 90; i++) traffic.update(1 / 30, { player, range: quality === 'low' ? 42 : 65 });
    const expected = populationFor({ masterPlan: plan }, player, quality);
    assert.equal(traffic.snapshot().target, Math.min(profile.count, expected.cars));
    assert.ok(traffic.cars.length <= profile.count && traffic.cars.length === traffic.snapshot().target);
    assert.equal(traffic.pedestrians.snapshot().quality, quality);
    assert.ok(traffic.pedestrians.walkers.length <= expected.pedestrians);
  }
  traffic.dispose();
});
