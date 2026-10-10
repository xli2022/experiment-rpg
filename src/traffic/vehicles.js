import * as THREE from 'three';
import { createCar } from './car-model.js';
import { samplePath, curvatureAhead } from './network.js';
import { signalState } from './signals.js';
import { clamp, seededRandom } from '../core/physics.js';

// Car agents on the lane graph. Longitudinal control is the Intelligent Driver
// Model against whatever is ahead on the planned path (cars, people, the
// player); junctions add a stop line until the car has permission to enter.

export const VEHICLE_PROFILES = { high: { count: 14, radius: 210 }, low: { count: 8, radius: 160 } };
export const TAKEOVER_HITS = 3;
export const IDM = { accel: 1.6, brake: 2.5, gap: 2.5, headway: 1.4, emergency: 8 };
export const BODIES = [{ id: 'compact', scale: [.95, .96, .86] }, { id: 'sedan', scale: [1, 1, 1] }, { id: 'van', scale: [1.05, 1.18, 1.1] }];
const PAINTS = [0x9aaea5, 0xbb7c73, 0x648a99, 0xc1ac7f, 0x7e819c, 0x657d71, 0x2c3a44, 0xd6d9d2, 0x8c3b3f, 0x3f6f5c];
const TURN_WEIGHT = { straight: 6, right: 2.5, left: 1.5, uturn: .02 };
const LATERAL = 2.6, COMFORT = 1.8, HALF_LENGTH = 2.34, HALF_WIDTH = 1.1, WHEELBASE = 2.91, STEP = 1.5, MAX_CARS = 16;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Braking for a fixed mark `d` metres ahead of the bumper (a stop line): the
 * IDM approach, softened to the steady deceleration that stops right at the
 * mark, and exact over the last few decimetres so cars never roll past it.
 */
export function stopAt(v, v0, d) {
  const idm = idmAcceleration(v, v0, Math.max(.05, d) + IDM.gap, v), needed = v * v / (2 * Math.max(.05, d));
  return d < .3 ? Math.min(idm, -needed) : Math.max(idm, -1.25 * needed);
}

/** Acceleration from the Intelligent Driver Model; gap is bumper to obstacle, dv is closing speed. */
export function idmAcceleration(v, v0, gap = Infinity, dv = 0) {
  const free = 1 - (v / Math.max(v0, .1)) ** 4;
  if (gap === Infinity) return IDM.accel * free;
  const desired = IDM.gap + Math.max(0, v * IDM.headway + v * dv / (2 * Math.sqrt(IDM.accel * IDM.brake)));
  return IDM.accel * (free - (desired / Math.max(gap, .05)) ** 2);
}

function fleetMeshes(scene) {
  const template = createCar(0xffffff), root = new THREE.Group(); root.name = 'NPC traffic';
  const pieces = [], wheelSet = new Set(template.wheels);
  template.root.updateMatrixWorld(true);
  const paintMaterial = template.root.children.find(m => m.isMesh && m.material.color?.getHex() === 0xffffff)?.material;
  template.root.traverse(source => {
    if (!source.isMesh) return;
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, MAX_CARS);
    mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
    root.add(mesh);
    const wheel = wheelSet.has(source.parent) ? source.parent : null;
    pieces.push({ mesh, local: source.matrixWorld.clone(), wheel, painted: source.material === paintMaterial });
  });
  // Brake and indicator lamps are separate quads shown only while lit.
  const lampMesh = (color, count) => {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide }), count);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = false; root.add(mesh); return mesh;
  };
  const brakes = lampMesh(new THREE.Color(3.4, .18, .25), MAX_CARS * 3), indicators = lampMesh(new THREE.Color(3, 1.25, .1), MAX_CARS * 4);
  const BRAKE_LAMPS = [[-.56, .86, 2.35, .6, .075], [.56, .86, 2.35, .6, .075], [0, 1.245, 2.13, 1.1, .035]];
  const INDICATORS = { left: [[-.86, .8, -2.35, .16, .07], [-.97, .86, 2.35, .14, .075]], right: [[.86, .8, -2.35, .16, .07], [.97, .86, 2.35, .14, .075]] };
  const body = new THREE.Matrix4(), pose = new THREE.Matrix4(), local = new THREE.Matrix4(), turn = new THREE.Matrix4(), spin = new THREE.Matrix4(), shape = new THREE.Matrix4();
  const orientation = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ'), unit = new THREE.Vector3(1, 1, 1), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const colors = PAINTS.map(c => new THREE.Color(c));
  scene.add(root);
  const lamp = (mesh, index, [x, y, z, w, h], s) => {
    local.compose(position.set(x * s[0], y * s[1], z * s[2]), orientation.identity(), scale.set(w * s[0], h * s[1], 1));
    mesh.setMatrixAt(index, pose.multiplyMatrices(body, local));
  };
  return {
    root,
    sync(cars, time) {
      let brake = 0, indicator = 0;
      for (const [i, car] of cars.entries()) {
        const s = car.body.scale;
        body.compose(position.set(car.x, car.y + .04, car.z), orientation.setFromEuler(euler.set(car.pitch, car.yaw, car.roll, 'YXZ')), unit);
        shape.makeScale(...s);
        for (const piece of pieces) {
          if (piece.wheel) {
            const p = piece.wheel.position;
            local.makeTranslation(p.x * s[0], p.y, p.z * s[2]);
            if (p.z < 0) local.multiply(turn.makeRotationY(car.steer));
            local.multiply(spin.makeRotationX(car.spin));
          } else local.multiplyMatrices(shape, piece.local);
          piece.mesh.setMatrixAt(i, pose.multiplyMatrices(body, local));
          if (piece.painted) piece.mesh.setColorAt(i, colors[car.paint]);
        }
        if (car.brake) for (const spec of BRAKE_LAMPS) lamp(brakes, brake++, spec, s);
        if (car.signal && (time + car.id * .13) % .8 < .45) for (const spec of INDICATORS[car.signal]) lamp(indicators, indicator++, spec, s);
      }
      for (const piece of pieces) {
        piece.mesh.count = cars.length; piece.mesh.instanceMatrix.needsUpdate = true;
        if (piece.mesh.instanceColor) piece.mesh.instanceColor.needsUpdate = true;
      }
      brakes.count = brake; indicators.count = indicator;
      brakes.instanceMatrix.needsUpdate = indicators.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(root);
      for (const { mesh } of pieces) mesh.dispose();
      for (const mesh of [brakes, indicators]) { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); }
      // Car geometry and materials are cached by the model and shared with acquired cars.
    },
  };
}

// Distance along a car's planned path, from its centre, as a piece and station.
function locate(car, d) {
  let piece = car.piece, s = car.s + d;
  if (s < 0) return car.prev ? { piece: car.prev, s: Math.max(0, car.prev.path.length + s) } : { piece, s: 0 };
  for (let i = 0; s > piece.path.length && i < car.route.length; i++) { s -= piece.path.length; piece = car.route[i]; }
  return { piece, s: Math.min(s, piece.path.length) };
}
const at = (car, d) => { const { piece, s } = locate(car, d); return samplePath(piece.path, s); };

export function createVehicles({ scene, network, plan, random = seededRandom(49123) }) {
  const fleet = fleetMeshes(scene), cars = [], owned = [], occupants = new Map(), conflictCache = new Map();
  let nextId = 0;

  function pick(options) {
    const total = options.reduce((sum, c) => sum + (TURN_WEIGHT[c.turn] ?? 1), 0);
    let r = random() * total;
    for (const c of options) if ((r -= TURN_WEIGHT[c.turn] ?? 1) <= 0) return c;
    return options.at(-1);
  }
  function extend(car, distance) {
    let total = car.piece.path.length - car.s;
    for (const p of car.route) total += p.path.length;
    while (total < distance) {
      const last = car.route.at(-1) ?? car.piece;
      const next = last.kind === 'lane' ? (last.next.length ? pick(last.next) : null) : last.to;
      if (!next) break;
      car.route.push(next); total += next.path.length;
    }
  }
  function spawn(lane, s, speed = 0) {
    const body = BODIES[Math.floor(random() * BODIES.length)];
    const car = { id: nextId++, piece: lane, s, prev: null, route: [], speed, accel: 0, cruise: .86 + random() * .2, body, half: HALF_LENGTH * body.scale[2],
      paint: Math.floor(random() * PAINTS.length), x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, steer: 0, spin: 0, brake: false, signal: null,
      box: null, boxNode: null, hits: 0, panic: 0, stuck: 0, waiting: 0, ended: false, cause: 'free', denied: null };
    extend(car, 80); pose(car, 0, true);
    cars.push(car); return car;
  }

  // --- Junction rules ---------------------------------------------------------
  function conflicts(a, b) {
    if (!a || !b || a === b || a.from === b.from) return false;
    if (a.to === b.to) return true;
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (!conflictCache.has(key)) {
      let hit = false;
      for (const p of a.path.points) { for (const q of b.path.points) if (Math.hypot(p.x - q.x, p.z - q.z) < 2.6) { hit = true; break; } if (hit) break; }
      if (conflictCache.size > 20000) conflictCache.clear();
      conflictCache.set(key, hit);
    }
    return conflictCache.get(key);
  }
  function yieldsTo(mine, theirs) {
    if (mine.turn === 'uturn') return true;
    if (mine.node.signalized) return mine.turn === 'left' && theirs.turn !== 'left';
    if (theirs.inApproach.major !== mine.inApproach.major) return theirs.inApproach.major;
    if (mine.turn === 'left' && theirs.turn !== 'left') return true;
    if (theirs.turn === 'left' && mine.turn !== 'left') return false;
    // Same standing: give way to the right.
    const a = mine.inApproach.dir, b = theirs.inApproach.dir;
    return b.x * a.z - b.z * a.x > .5;
  }
  // Deceleration needed to stop at the line; above ~3 m/s² an amber light means go.
  const stopping = (car, dStop) => car.speed * car.speed / (2 * Math.max(.05, dStop - .5));
  const goes = (car, connector, dStop, time) => {
    if (!connector.node.signalized) return true;
    const light = signalState(connector.node, connector.inApproach, time);
    return light.color === 'green' || light.color === 'amber' && stopping(car, dStop) > 3.2;
  };
  // Don't enter a junction whose exit is backed up: a queue reaching the far stop line.
  function roomAfter(connector, car) {
    const lane = connector.to;
    for (const other of cars) if (other !== car && other.piece === lane && other.speed < 2 && other.s - other.half < car.half * 2 + 2) return false;
    return true;
  }
  function permitted(car, connector, dStop, time, approaching) {
    const node = connector.node;
    if (node.kind === 'continuation') return true;
    if (!goes(car, connector, dStop, time)) return (car.denied = 'signal', false);
    for (const other of occupants.get(node) ?? []) if (other !== car && conflicts(connector, other.box)) return (car.denied = 'occupied', false);
    for (const entry of approaching.get(node) ?? []) {
      const other = entry.car;
      if (other === car || !conflicts(connector, entry.connector) || !yieldsTo(connector, entry.connector)) continue;
      if (!goes(other, entry.connector, entry.dStop, time)) continue;
      const eta = entry.dStop / Math.max(other.speed, .1);
      if (entry.dStop < 45 && (eta < 5 || entry.dStop < 4)) return (car.denied = 'priority', false);
    }
    if (!roomAfter(connector, car)) return (car.denied = 'room', false);
    car.denied = null;
    return true;
  }
  function enterBox(car, connector) {
    leaveBox(car);
    car.box = connector; car.boxNode = connector.node;
    if (!occupants.has(connector.node)) occupants.set(connector.node, new Set());
    occupants.get(connector.node).add(car);
  }
  function leaveBox(car) {
    if (car.boxNode) occupants.get(car.boxNode)?.delete(car);
    car.box = car.boxNode = null;
  }
  // Distance from the front bumper to the stop line the car must hold, or null.
  function junctionHold(car, time, approaching) {
    if (car.piece.kind !== 'lane') return null;
    const connector = car.route[0];
    if (!connector || connector.kind !== 'connector' || car.box === connector) return null;
    const dStop = car.piece.path.length - car.s - car.half;
    if (dStop > 70) return null;
    if (permitted(car, connector, dStop, time, approaching)) {
      // Once stopping would take a firm brake, the car is committed.
      if (stopping(car, dStop) > 2.2 || dStop < 1.5) enterBox(car, connector);
      return null;
    }
    return dStop;
  }
  // Lights further ahead (beyond a short block) are anticipated, not discovered at the line.
  function signalAhead(car, time, look) {
    let start = car.piece.path.length - car.s;
    for (let i = 0; i < car.route.length && start < look; start += car.route[i].path.length, i++) {
      const piece = car.route[i];
      if (i === 0 || piece.kind !== 'connector' || car.box === piece) continue;
      if (piece.node.signalized && !goes(car, piece, start - car.half, time)) return start - car.half;
    }
    return null;
  }
  // Turning across a crosswalk that someone is using means waiting before it.
  function crosswalkHold(car, crossings, look) {
    if (!crossings.size) return null;
    let start = -car.s;
    for (let i = -1; i < car.route.length && start < look; i++) {
      const piece = i < 0 ? car.piece : car.route[i];
      if (i >= 0) start += (i === 0 ? car.piece : car.route[i - 1]).path.length;
      if (piece.kind !== 'connector' || !piece.node.ground || piece.node.kind !== 'junction') continue;
      const key = approach => `${piece.node.id}:${approach.index}`;
      if (start > 0 && car.box !== piece && crossings.has(key(piece.inApproach))) return start - car.half - .5;
      // The exit crosswalk begins where the connector ends, at the junction's edge.
      const before = start + piece.path.length - .4 - car.half;
      if (before > -.5 && crossings.has(key(piece.outApproach))) return Math.max(.05, before);
    }
    return null;
  }
  // Give-way approaches slow down to look before the line.
  function yieldSpeed(car) {
    const connector = car.route[0];
    if (car.piece.kind !== 'lane' || connector?.kind !== 'connector' || car.box === connector) return Infinity;
    const node = connector.node;
    if (node.kind !== 'junction' || node.signalized || connector.inApproach.major && connector.turn !== 'left') return Infinity;
    return Math.sqrt(3.5 ** 2 + 2 * COMFORT * Math.max(0, car.piece.path.length - car.s - car.half));
  }

  // --- Perception ---------------------------------------------------------------
  function bodiesNear(car, look, bodies) {
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    return bodies.filter(b => b.ref !== car && Math.abs(b.x - car.x) < look + 8 && Math.abs(b.z - car.z) < look + 8 &&
      Math.abs(b.y - car.y) < 4 && (b.x - car.x) * fx + (b.z - car.z) * fz > 0);
  }
  function inside(b, p) {
    const dx = p.x - b.x, dz = p.z - b.z, along = dx * b.fx + dz * b.fz, across = dx * -b.fz + dz * b.fx;
    return Math.abs(along) < b.half + .3 && Math.abs(across) < b.width + HALF_WIDTH + .2 && Math.abs(p.y - b.y) < 2.5;
  }
  function touches(w, p) { return Math.hypot(p.x - w.x, p.z - w.z) < w.r + HALF_WIDTH + .45 && Math.abs(p.y - w.y) < 2.2; }
  // The nearest thing on the planned path ahead: { gap, speed }.
  function scan(car, look, bodies, walkers) {
    const others = bodiesNear(car, look, bodies), people = walkers.filter(w => Math.abs(w.x - car.x) < look + 4 && Math.abs(w.z - car.z) < look + 4);
    if (!others.length && !people.length) return null;
    const hitAt = p => others.find(b => inside(b, p)) ?? people.find(w => touches(w, p)) ?? null;
    for (let d = 0, before = 0; d <= look; before = d, d += STEP) {
      const found = hitAt(at(car, car.half + d));
      if (!found) continue;
      let lo = before, hi = d;
      if (d > 0) for (let k = 0; k < 4; k++) { const mid = (lo + hi) / 2; if (hitAt(at(car, car.half + mid))) hi = mid; else lo = mid; }
      const p = at(car, car.half + hi), speed = found.speed ? found.speed * Math.max(0, found.fx * p.dx + found.fz * p.dz) : 0;
      return { gap: hi, speed, what: found.kind };
    }
    return null;
  }
  // Highest comfortable speed now, given curves and slower pieces ahead.
  function speedLimit(car, look) {
    let limit = car.piece.speed * car.cruise, start = car.piece.path.length - car.s;
    for (let d = 0; d <= look; d += 2) {
      const { piece, s } = locate(car, d), k = curvatureAhead(piece.path, s, 2);
      if (k > 1e-3) limit = Math.min(limit, Math.sqrt((LATERAL / k) + 2 * COMFORT * Math.max(0, d - car.half)));
    }
    for (const piece of car.route) {
      if (start > look) break;
      limit = Math.min(limit, Math.sqrt((piece.speed * car.cruise) ** 2 + 2 * COMFORT * Math.max(0, start)));
      start += piece.path.length;
    }
    return Math.max(1.5, limit);
  }

  // --- Motion -----------------------------------------------------------------
  function advance(car, ds) {
    car.s += ds;
    while (car.s > car.piece.path.length && car.route.length) {
      car.s -= car.piece.path.length; car.prev = car.piece; car.piece = car.route.shift();
      if (car.piece.kind === 'connector' && car.box !== car.piece) enterBox(car, car.piece);
    }
    if (car.s >= car.piece.path.length) { car.s = car.piece.path.length; car.ended = !car.route.length; }
    // The junction is clear once the tail is a little way down the exit lane.
    if (car.piece.kind === 'lane' && car.box && car.box === car.prev && car.s > car.half + 1) leaveBox(car);
  }
  function pose(car, dt, snap = false) {
    const front = at(car, WHEELBASE / 2), rear = at(car, -WHEELBASE / 2), here = locate(car, 0), center = samplePath(here.piece.path, here.s);
    const dx = front.x - rear.x, dz = front.z - rear.z, flat = Math.hypot(dx, dz) || 1e-6;
    car.x = center.x; car.z = center.z; car.y = (front.y + rear.y) / 2;
    car.yaw = Math.atan2(-dx, -dz);
    // Signed steering from the path heading at the front axle: positive turns right.
    const turn = Math.asin(clamp((front.dx * -dz + front.dz * dx) / flat, -1, 1));
    const lateral = car.speed * car.speed * curvatureAhead(here.piece.path, here.s, 0);
    // Body pitch under braking and acceleration, and roll away from the turn.
    const pitch = Math.atan2(front.y - rear.y, flat) + clamp(car.accel * .009, -.035, .02);
    const roll = center.roll + Math.sign(turn) * clamp(lateral * .006, 0, .035);
    const k = snap ? 1 : 1 - Math.exp(-6 * dt);
    car.pitch += (pitch - car.pitch) * k; car.roll += (roll - car.roll) * k;
    car.steer += (clamp(-turn * 2.2, -.55, .55) - car.steer) * (snap ? 1 : 1 - Math.exp(-8 * dt));
  }
  function think(car, dt, time, bodies, walkers, approaching, crossings) {
    const v = car.speed, look = Math.min(110, Math.max(30, 1.5 * (IDM.gap + v * IDM.headway) + v * v / (2 * IDM.brake)));
    extend(car, look + 40);
    const v0 = Math.min(speedLimit(car, look), yieldSpeed(car));
    // Slowing for a curve or a slower street never needs more than a firm brake.
    let a = Math.max(-3.5, idmAcceleration(v, v0)), hard = false, cause = v0 < car.piece.speed * car.cruise - .1 ? 'curve' : 'free';
    const limit = (value, why) => { if (value < a) { a = value; cause = why; } };
    const lead = scan(car, look, bodies, walkers);
    if (lead) {
      limit(idmAcceleration(v, v0, lead.gap, v - lead.speed), lead.what);
      if (lead.gap < .1) hard = true;
    }
    const hold = junctionHold(car, time, approaching);
    // A stop line never needs more than the steady deceleration that stops right at it.
    if (hold !== null) limit(stopAt(v, v0, hold - .5), 'junction');
    const crosswalk = crosswalkHold(car, crossings, look);
    if (crosswalk !== null) limit(stopAt(v, v0, crosswalk), 'crosswalk');
    const later = signalAhead(car, time, look);
    if (later !== null) limit(stopAt(v, v0, later - .5), 'signal');
    const end = car.route.length ? null : car.piece.path.length - car.s - car.half;
    if (end !== null && end < look) limit(stopAt(v, v0, end - .5), 'end');
    if (car.panic > 0) { car.panic -= dt; limit(-6.5, 'hit'); }
    car.cause = cause;
    a = clamp(a, -IDM.emergency, IDM.accel);
    if (hard) { car.speed = 0; a = 0; }
    const next = Math.max(0, car.speed + a * dt);
    advance(car, (car.speed + next) / 2 * dt);
    car.accel += ((next - car.speed) / Math.max(dt, 1e-3) - car.accel) * Math.min(1, dt * 8);
    car.speed = next;
    car.brake = car.accel < -.7 || car.speed < .4;
    car.waiting = car.speed < .3 ? car.waiting + dt : 0;
    car.stuck = car.speed < .05 ? car.stuck + dt : 0;
    // Indicate a turn from 40 m out until it is complete.
    const turn = car.piece.kind === 'connector' ? car.piece : car.route[0]?.kind === 'connector' && car.piece.path.length - car.s < 40 ? car.route[0] : null;
    car.signal = turn?.turn === 'left' || turn?.turn === 'uturn' ? 'left' : turn?.turn === 'right' ? 'right' : null;
    pose(car, dt);
    car.spin -= car.speed * dt / .44;
  }

  return {
    cars, owned, root: fleet.root, occupants,
    spawn,
    update(dt, { time, bodies, walkers, crossings = new Set() }) {
      const approaching = new Map();
      for (const car of cars) {
        const connector = car.route[0];
        if (car.piece.kind !== 'lane' || connector?.kind !== 'connector' || car.box === connector) continue;
        const dStop = car.piece.path.length - car.s - car.half;
        if (dStop > 60) continue;
        if (!approaching.has(connector.node)) approaching.set(connector.node, []);
        approaching.get(connector.node).push({ car, connector, dStop });
      }
      for (const car of cars) think(car, dt, time, bodies, walkers, approaching, crossings);
    },
    remove(car) {
      const index = cars.indexOf(car);
      if (index < 0) return;
      leaveBox(car); cars.splice(index, 1);
    },
    sync(time) { fleet.sync(cars, time); },
    clear() { for (const car of [...cars]) leaveBox(car); cars.length = 0; occupants.clear(); },
    /** A complete drivable model of a traffic car, posed where it stands. */
    drivable(car) {
      const model = createCar(PAINTS[car.paint]), [sx, sy, sz] = car.body.scale, spot = { x: car.x, y: car.y, z: car.z, yaw: car.yaw, pitch: car.pitch, roll: car.roll };
      for (const child of model.root.children) {
        if (model.wheels.includes(child)) child.position.set(child.position.x * sx, child.position.y, child.position.z * sz);
        else child.scale.set(sx, sy, sz);
      }
      model.root.position.set(spot.x, spot.y + .04, spot.z);
      model.root.rotation.set(spot.pitch, spot.yaw, spot.roll, 'YXZ');
      model.root.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = false; mesh.receiveShadow = true; } });
      for (const wheel of model.wheels) wheel.rotation.x = car.spin;
      return { ...model, ...spot, speed: 0, spawn: spot, paint: PAINTS[car.paint], body: car.body.id, trafficId: car.id, damageHits: car.hits };
    },
    dispose() { cars.length = 0; occupants.clear(); fleet.dispose(); },
  };
}
