import * as THREE from 'three';
import { buildNetwork } from './network.js';
import { createSignalProps, signalState, walkState } from './signals.js';
import { createVehicles, VEHICLE_PROFILES, TAKEOVER_HITS } from './vehicles.js';
import { createPedestrians } from './pedestrians.js';
import { populationFor } from './population.js';
import { carCollider, clamp, seededRandom } from '../core/physics.js';

export { buildNetwork } from './network.js';
export { signalState, walkState } from './signals.js';
export { VEHICLE_PROFILES, TAKEOVER_HITS, IDM, idmAcceleration } from './vehicles.js';
export { populationFor } from './population.js';

const networks = new WeakMap();
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Living streets for a world: cars that follow lanes, signals and each other,
 * and pedestrians that walk the sidewalks and cross at junctions.
 * `assets` are the character assets ({ citizen, visitors, humanBases }).
 */
export function createTraffic({ scene, world, assets, quality = 'high' }) {
  const plan = world.masterPlan;
  if (!networks.has(plan)) networks.set(plan, buildNetwork(plan));
  const network = networks.get(plan), random = seededRandom(49123);
  const root = new THREE.Group(); root.name = 'Traffic';
  const vehicles = createVehicles({ scene: root, network, plan, random });
  const pedestrians = createPedestrians({ scene, network, plan, spatial: world.spatial, assets, random: seededRandom(707) });
  const props = createSignalProps(root, network, plan);
  scene.add(root);
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 4);
  let profile = VEHICLE_PROFILES[quality] ?? VEHICLE_PROFILES.high, level = quality, time = 0, scanTime = 0, first = true, target = 0, edges = [];
  let population = populationFor(world, { x: 0, z: 0 }, quality);
  const visible = (p, camera) => { if (!camera) return false; sphere.center.set(p.x, p.y + 1, p.z); return frustum.intersectsSphere(sphere); };
  const { cars, owned } = vehicles;

  function populate(player, camera) {
    population = populationFor(world, player, level);
    edges = network.edgesNear(player.x, player.z, profile.radius);
    // Cars the player took over still count toward the street's budget.
    const acquired = owned.filter(car => car.trafficId !== undefined && dist(car, player) <= profile.radius + 45).length;
    target = Math.max(0, Math.min(profile.count, population.cars) - acquired);
    for (const car of [...cars]) {
      const d = dist(car, player), seen = visible(car, camera);
      if (d > profile.radius + 45 && (!seen || d > 420) || cars.length > target && !seen && d > 60 || (car.ended || car.stuck > 40) && !seen) vehicles.remove(car);
    }
    const gap = Math.max(14, population.carSpacing * .6);
    for (let added = 0, attempt = 0; cars.length < target && added < (first ? target : 2) && attempt < 60 && edges.length; attempt++) {
      const edge = edges[Math.floor(random() * edges.length)], lanes = [...edge.lanes.forward, ...edge.lanes.backward];
      const lane = lanes[Math.floor(random() * lanes.length)], s = random() * lane.path.length;
      const p = lane.path.points[Math.min(lane.path.points.length - 1, Math.floor(s / lane.path.length * (lane.path.points.length - 1)))];
      const d = dist(p, player);
      if (d < (first ? 30 : 55) || d > profile.radius - 10 || Math.abs(p.y - (player.y ?? 0)) > 45) continue;
      if (!first && visible(p, camera)) continue;
      if (cars.some(c => Math.abs(c.y - p.y) < 3 && dist(c, p) < gap) || owned.some(c => dist(c, p) < 10)) continue;
      // Start no faster than the car could comfortably stop before the line ahead.
      const line = lane.path.length - s - 2.4;
      if (line < 6) continue;
      vehicles.spawn(lane, s, Math.min(lane.speed * .7, 7, Math.sqrt(2 * 1.5 * (line - 4))));
      added++;
    }
  }
  function bodies(player, vehicle) {
    const list = cars.map(car => ({ x: car.x, y: car.y, z: car.z, fx: -Math.sin(car.yaw), fz: -Math.cos(car.yaw), half: car.half, width: 1.1 * car.body.scale[0], speed: car.speed, ref: car, kind: 'car' }));
    for (const car of owned) if (dist(car, player) < profile.radius + 20) {
      list.push({ x: car.x, y: car.y, z: car.z, fx: -Math.sin(car.yaw), fz: -Math.cos(car.yaw), half: 2.4, width: 1.15, speed: Math.max(0, car.speed ?? 0), ref: car, kind: car === vehicle ? 'player' : 'car' });
    }
    return list;
  }
  function people(player, vehicle) {
    // Someone stepping onto or crossing a crosswalk claims more of the street ahead of cars.
    // People waiting at the kerb, or held back and walking up to it (and a
    // companion with them), hold back for cars.
    const holds = p => p.mode === 'wait' || p.mode === 'walk' && p.holding;
    const list = pedestrians.walkers.map(p => ({ x: p.x, y: p.y, z: p.z, r: p.claim ? 1 : .35, size: .35, kind: 'walker',
      waiting: holds(p) || p.mode === 'follow' && !!p.leader && holds(p.leader) }));
    if (!vehicle) list.push({ x: player.x, y: player.y, z: player.z, r: .45, size: .45, kind: 'player' });
    return list;
  }
  function takeOver(car) {
    if (!cars.includes(car)) return null;
    const model = vehicles.drivable(car);
    vehicles.remove(car); owned.push(model); scene.add(model.root);
    vehicles.sync(time);
    return model;
  }

  return {
    root, network, cars, vehicles: cars, owned, pedestrians,
    get time() { return time; },
    signals: { state: (node, approach) => signalState(node, approach, time), walk: (node, approach) => walkState(node, approach, time) },
    /** Advance traffic. `vehicle` is the car the player drives (if any); `range` is the visible actor range. */
    update(dt, { player, vehicle = null, camera = null, range = 65 }) {
      dt = clamp(dt, 0, .1); time += dt;
      if (camera) { camera.updateMatrixWorld(); projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection); }
      scanTime -= dt;
      if (scanTime <= 0 || first) { scanTime = .7; populate(player, camera); }
      vehicles.update(dt, { time, bodies: bodies(player, vehicle), walkers: people(player, vehicle), crossings: pedestrians.crossings() });
      pedestrians.update(dt, { player, onFoot: !vehicle, camera, radius: range, time, cars: owned.length ? [...cars, ...owned] : cars, population });
      props.update(time, player);
      vehicles.sync(time);
      first = false;
    },
    /** A slow or stopped traffic car within reach of `point`, for an E-press hijack. */
    hijackable(point, reach = 3.6) {
      let best = null, distance = reach;
      for (const car of cars) {
        const d = dist(car, point);
        if (d < distance && Math.abs(car.y - point.y) < 2 && car.speed < 2.5) { best = car; distance = d; }
      }
      return best;
    },
    takeOver,
    /** A shot hits a traffic car: it brakes hard, and the third hit hands it to the player. */
    hit(car) {
      if (!cars.includes(car)) return { hit: false, hitsRemaining: 0, car: null };
      car.hits++; car.panic = 2.5;
      const hitsRemaining = Math.max(0, TAKEOVER_HITS - car.hits);
      return { hit: true, hitsRemaining, car: hitsRemaining ? null : takeOver(car) };
    },
    colliders(x, z, radius = 8) { return cars.filter(c => Math.hypot(c.x - x, c.z - z) < radius + 4).map(carCollider); },
    setQuality(value) { level = value; profile = VEHICLE_PROFILES[value] ?? VEHICLE_PROFILES.high; pedestrians.setQuality(value); scanTime = 0; },
    /** A scene cut: everything respawns around the new position, and may appear in view. */
    reset() { vehicles.clear(); pedestrians.reset(); props.invalidate(); first = true; scanTime = 0; vehicles.sync(time); },
    snapshot() {
      return { capacity: profile.count, target, active: cars.length, district: population.district, time, drawCalls: root.children.length,
        signals: props.snapshot(), owned: owned.length,
        network: { nodes: network.nodes.length, signalized: network.nodes.filter(n => n.signalized).length, lanes: network.lanes.length, walkways: network.walk.edges.length },
        cars: cars.map(c => ({ id: c.id, x: c.x, y: c.y, z: c.z, speed: c.speed, accel: c.accel, yaw: c.yaw, pitch: c.pitch, roll: c.roll, piece: c.piece.id,
          turn: c.piece.turn ?? c.route[0]?.turn ?? null, brake: c.brake, signal: c.signal, cause: c.cause, waitingFor: c.denied, body: c.body.id, damageHits: c.hits, hitsRemaining: TAKEOVER_HITS - c.hits })) };
    },
    dispose() { vehicles.dispose(); pedestrians.dispose(); props.dispose(); scene.remove(root); },
  };
}
