import * as THREE from 'three';
import { createCar } from './models.js';
import { carCollider, circleHitsBox, overlapsHeight, seededRandom, clamp, surfaceHeightAt } from './physics.js';
import { streetPoint } from './metropolis.js';
import { WORLD_LIMIT } from './world-config.js';
import { populationFor } from './population.js';

export const TRAFFIC_PROFILES = {
  high: { count: 12, radius: 190 },
  low: { count: 6, radius: 150 },
};
const MAX_CARS = TRAFFIC_PROFILES.high.count;
export const TRAFFIC_TAKEOVER_HITS = 3;
const FLEET_PAINTS = [0x9aaea5, 0xbb7c73, 0x648a99, 0xc1ac7f, 0x7e819c, 0x657d71];
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t, z: a.z + (b.z - a.z) * t,
  roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * t });
const wrap = (v, length) => (v % length + length) % length;

// Rounded centerlines keep wheels on the intersection during a turn. Regional
// corners are sampled from the very same deformed street grid as the road mesh.
function roundLoop(points, radius) {
  const result = [], count = points.length;
  for (let i = 0; i < count; i++) {
    const a = points[(i + count - 1) % count], b = points[i], c = points[(i + 1) % count];
    const before = distance(a, b), after = distance(b, c);
    const dot = ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) / (before * after);
    if (dot > .94) { result.push(b); continue; }
    const trim = Math.min(radius, before * .35, after * .35), start = mix(b, a, trim / before), end = mix(b, c, trim / after);
    for (let j = 0; j <= 12; j++) {
      const t = j / 12;
      result.push(mix(mix(start, b, t), mix(b, end, t), t));
    }
  }
  return result;
}

export function createLaneRoute(centerline, { id = 'route', width = 14, reverse = false, corners = false, closed = true } = {}) {
  let center = centerline.map(p => ({ x: p.x, y: p.y ?? 0, z: p.z }));
  if (closed && distance(center[0], center.at(-1)) < .01) center.pop();
  if (reverse) center.reverse();
  if (corners && closed) {
    // Authored straight roads contain dense mesh samples. Remove their collinear
    // interior points so a real corner gets an eight-metre turn, not a tiny kink.
    center = center.filter((p, i, points) => {
      const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length];
      const cross = (p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x);
      const dot = (p.x - a.x) * (b.x - p.x) + (p.z - a.z) * (b.z - p.z);
      const before = distance(a, p), after = distance(p, b);
      const slopeChange = Math.abs((p.y - a.y) / before - (b.y - p.y) / after);
      return Math.abs(cross) > 1e-7 || dot <= 0 || slopeChange > 1e-7;
    });
    center = roundLoop(center, 8);
  }
  const lane = Math.min(3.15, width * .23);
  const points = center.map((p, i) => {
    const a = center[closed ? (i + center.length - 1) % center.length : Math.max(0, i - 1)];
    const b = center[closed ? (i + 1) % center.length : Math.min(center.length - 1, i + 1)];
    const length = distance(a, b), tx = (b.x - a.x) / length, tz = (b.z - a.z) / length;
    return { x: p.x - tz * lane, y: p.y, z: p.z + tx * lane };
  });
  if (closed) points.push({ ...points[0] });
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative.at(-1) + distance(points[i - 1], points[i]));
  return { id, points, cumulative, length: cumulative.at(-1), width, closed, speed: width < 12 ? 7 : 9 };
}

export function sampleTrafficRoute(route, along) {
  const s = route.closed === false ? clamp(along, 0, route.length) : wrap(along, route.length), lengths = route.cumulative;
  let lo = 0, hi = lengths.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lengths[mid] <= s) lo = mid; else hi = mid; }
  const a = route.points[lo], b = route.points[hi], length = lengths[hi] - lengths[lo];
  return { ...mix(a, b, (s - lengths[lo]) / length), yaw: Math.atan2(a.x - b.x, a.z - b.z), pitch: Math.atan2((b.y ?? 0) - (a.y ?? 0), length) };
}

function nearestAlong(route, point) {
  let closest = Infinity, along = 0;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i], dx = b.x - a.x, dz = b.z - a.z;
    const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t);
    if (d < closest) { closest = d; along = route.cumulative[i - 1] + t * (route.cumulative[i] - route.cumulative[i - 1]); }
  }
  return { route, distance: closest, along };
}

function nearestCenter(points, point) {
  let nearest = { distance: Infinity };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z;
    const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
    const p = mix(a, b, t), gap = distance(p, point);
    if (gap < nearest.distance) nearest = { ...p, distance: gap };
  }
  return nearest;
}

// Junction previews use the same continuous curve as actual movement, including
// the target lane beyond it, so braking never mistakes a connection for a dead end.
function sampleJourney(car, along) {
  let route = car.route;
  if (car.continuation && along >= car.continuation.start) {
    along -= car.continuation.start; route = car.continuation;
  }
  if (route.next && along > route.length) return sampleTrafficRoute(route.next, route.nextAlong + along - route.length);
  return sampleTrafficRoute(route, along);
}

// Count the lane length actually inside the local population area, rather than
// treating a short service street like a long boulevard or counting a whole
// city-spanning route. Opposing lanes contribute their own usable space.
function localLaneLength(route, player, radius) {
  let length = 0;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i], dx = b.x - a.x, dz = b.z - a.z;
    const ox = a.x - player.x, oz = a.z - player.z, squared = dx * dx + dz * dz;
    if (squared < 1e-8) continue;
    const dot = ox * dx + oz * dz, discriminant = dot * dot - squared * (ox * ox + oz * oz - radius * radius);
    if (discriminant <= 0) continue;
    const root = Math.sqrt(discriminant), lo = Math.max(0, (-dot - root) / squared), hi = Math.min(1, (-dot + root) / squared);
    length += Math.max(0, hi - lo) * Math.sqrt(squared);
  }
  return length;
}

function routesForCity(city) {
  const routes = [];
  if (city.masterPlan) {
    for (const [i, road] of city.masterPlan.roads.entries()) {
      if (road.kind === 'pedestrian' || road.class === 'pedestrian' || road.width < 6 || road.points.length < 2) continue;
      const closed = road.closed ?? distance(road.points[0], road.points.at(-1)) < .1;
      for (const reverse of [false, true]) {
        const route = createLaneRoute(road.points, { id: `master:${road.id ?? road.name ?? i}:${reverse}`, width: road.width, reverse, closed });
        // Terrain-following road crossfall puts the two lanes at slightly
        // different heights. Sample that same plane once when building routes.
        for (const p of route.points) {
          let best = Infinity;
          for (const s of city.masterPlan.roadIndex?.near(p.x, p.z, road.width + 2) ?? []) {
            if (s.road !== road) continue;
            const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, length = Math.hypot(dx, dz);
            const t = clamp(((p.x - s.a.x) * dx + (p.z - s.a.z) * dz) / (length * length), 0, 1);
            const distance = Math.hypot(p.x - s.a.x - dx * t, p.z - s.a.z - dz * t);
            if (distance >= best) continue;
            best = distance;
            const across = (-(p.x - s.a.x) * dz + (p.z - s.a.z) * dx) / length;
            p.y = s.a.y + (s.b.y - s.a.y) * t + (s.crossSlope ?? 0) * across;
            p.roll = Math.atan(s.crossSlope ?? 0) * (reverse ? -1 : 1);
          }
        }
        route.sourceRoad = road;
        route.speed = road.class === 'expressway' || road.class === 'highway' ? 13 : road.width >= 20 ? 10 : 8;
        routes.push(route);
      }
    }
    return routes;
  }
  for (const x of [-128, -64, 0, 64]) for (const z of [-128, -64, 0, 64]) {
    const points = [{ x, z }, { x: x + 64, z }, { x: x + 64, z: z + 64 }, { x, z: z + 64 }];
    for (const reverse of [false, true]) routes.push(createLaneRoute(points, { id: `core:${x}:${z}:${reverse}`, width: 16, reverse, corners: true }));
  }
  for (const road of city.plan?.roads ?? []) {
    if (distance(road.points[0], road.points.at(-1)) > .1) continue;
    for (const reverse of [false, true]) routes.push(createLaneRoute(road.points, { id: `${road.name}:${reverse}`, width: road.width, reverse, corners: true }));
  }
  return routes;
}

export function regionalTrafficRoutes(player) {
  const routes = [], bx = Math.floor(player.x / 192), bz = Math.floor(player.z / 192);
  for (let ix = bx - 1; ix <= bx + 1; ix++) for (let iz = bz - 1; iz <= bz + 1; iz++) {
    const x = ix * 192, z = iz * 192;
    if (x < 768 && x + 192 > -768 && z < 768 && z + 192 > -768) continue;
    if (Math.max(Math.abs(x), Math.abs(x + 192), Math.abs(z), Math.abs(z + 192)) > WORLD_LIMIT - 124) continue;
    const points = [];
    for (let t = 0; t < 192; t += 48) points.push(streetPoint(x + t, z));
    for (let t = 0; t < 192; t += 48) points.push(streetPoint(x + 192, z + t));
    for (let t = 0; t < 192; t += 48) points.push(streetPoint(x + 192 - t, z + 192));
    for (let t = 0; t < 192; t += 48) points.push(streetPoint(x, z + 192 - t));
    for (const reverse of [false, true]) routes.push(createLaneRoute(points, { id: `regional:${ix}:${iz}:${reverse}`, width: 11, reverse, corners: true }));
  }
  return routes;
}

// The stopping envelope includes the front bumper, a pedestrian's space, and
// actual stopping distance. Emergency clearance below is checked again before
// applying movement so a late crossing cannot be swept through at low FPS.
export function trafficSpeedForGap(gap, cruise = 9) {
  return Math.min(cruise, Math.sqrt(Math.max(0, gap - 4.4) * 7));
}

function nearestJunction(p, route) {
  if (route.id.startsWith('core:')) return { x: Math.round(p.x / 64) * 64, z: Math.round(p.z / 64) * 64 };
  if (route.id.startsWith('regional:')) {
    // Deformation can displace a junction by almost half a block. Check the
    // surrounding grid points instead of rounding its already-deformed x/z.
    let nearest = null, best = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const point = streetPoint((Math.round(p.x / 192) + dx) * 192, (Math.round(p.z / 192) + dz) * 192), d = distance(p, point);
      if (d < best) { best = d; nearest = point; }
    }
    return nearest;
  }
  return null;
}

function fleetMeshes(scene) {
  const template = createCar(0xffffff), root = new THREE.Group(); root.name = 'NPC traffic';
  const pieces = [], matrices = [], wheelSet = new Set(template.wheels);
  template.root.updateMatrixWorld(true);
  template.root.traverse(source => {
    if (!source.isMesh) return;
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, MAX_CARS);
    mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
    root.add(mesh);
    const wheel = wheelSet.has(source.parent) ? source.parent : null;
    const painted = source.material === template.root.children.find(m => m.isMesh && m.material.color.getHex() === 0xffffff)?.material;
    pieces.push({ mesh, local: source.matrixWorld.clone(), wheel, painted });
  });
  const pose = new THREE.Matrix4(), wheelRotation = new THREE.Matrix4(), translation = new THREE.Matrix4(), local = new THREE.Matrix4();
  const orientation = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ'), scale = new THREE.Vector3(1, 1, 1), position = new THREE.Vector3();
  const colors = FLEET_PAINTS.map(c => new THREE.Color(c));
  scene.add(root);
  return {
    root,
    sync(cars) {
      for (const [i, car] of cars.entries()) {
        position.set(car.x, (car.y ?? 0) + .04, car.z); orientation.setFromEuler(euler.set(car.pitch ?? 0, car.yaw, car.roll ?? 0, 'YXZ'));
        matrices[i] ??= new THREE.Matrix4(); matrices[i].compose(position, orientation, scale);
      }
      for (const piece of pieces) {
        for (const [i, car] of cars.entries()) {
          if (piece.wheel) {
            translation.makeTranslation(...piece.wheel.position.toArray());
            wheelRotation.makeRotationX(car.wheelAngle);
            local.multiplyMatrices(translation, wheelRotation);
          } else local.copy(piece.local);
          pose.multiplyMatrices(matrices[i], local); piece.mesh.setMatrixAt(i, pose);
          if (piece.painted) piece.mesh.setColorAt(i, colors[car.id % colors.length]);
        }
        piece.mesh.count = cars.length; piece.mesh.instanceMatrix.needsUpdate = true;
        if (piece.mesh.instanceColor) piece.mesh.instanceColor.needsUpdate = true;
      }
    },
    dispose() {
      scene.remove(root);
      const geometries = new Set();
      for (const { mesh } of pieces) { mesh.dispose(); geometries.add(mesh.geometry); }
      // Materials belong to the shared model cache and remain in use by acquired cars.
      for (const geometry of geometries) geometry.dispose();
    },
  };
}

export function createTraffic(scene, city) {
  const fleet = fleetMeshes(scene), cars = [], routes = routesForCity(city), random = seededRandom(49123);
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 4);
  let quality = 'high', profile = TRAFFIC_PROFILES.high, nearbyRoutes = [], regional = [], regionKey = '', scanTime = 0, firstUpdate = true, nextId = 0;
  let population = populationFor(city, { x: 0, z: 0 }), target = profile.count;
  const visible = p => { sphere.center.set(p.x, (p.y ?? 0) + 1, p.z); return frustum.intersectsSphere(sphere); };
  const staticBoxes = (p, radius) => (city.spatial?.near(p.x, p.z, radius) ?? city.colliders ?? []).filter(b => !b.supportOnly);
  const connections = new Map();
  const junctionCells = new Map(), reservations = new Map();
  function masterJunction(p, route, approaching = false) {
    if (!city.masterPlan) return nearestJunction(p, route);
    const cx = Math.floor(p.x / 64), cz = Math.floor(p.z / 64), key = `${cx}:${cz}`;
    if (!junctionCells.has(key)) {
      const x = cx * 64 + 32, z = cz * 64 + 32;
      const segments = city.masterPlan.roadIndex?.near(x, z, 80) ?? city.masterPlan.roads.flatMap(road =>
        road.points.slice(1).map((b, i) => ({ a: road.points[i], b, road })).filter(s =>
          Math.min(s.a.x, s.b.x) <= x + 80 && Math.max(s.a.x, s.b.x) >= x - 80 &&
          Math.min(s.a.z, s.b.z) <= z + 80 && Math.max(s.a.z, s.b.z) >= z - 80));
      const junctions = [];
      for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i], b = segments[j];
        if (a.road === b.road || a.road.width < 6 || b.road.width < 6) continue;
        const ax = a.b.x - a.a.x, az = a.b.z - a.a.z, bx = b.b.x - b.a.x, bz = b.b.z - b.a.z;
        const cross = ax * bz - az * bx;
        if (Math.abs(cross) < 1e-7) continue;
        const dx = b.a.x - a.a.x, dz = b.a.z - a.a.z;
        const t = (dx * bz - dz * bx) / cross, u = (dx * az - dz * ax) / cross;
        if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) continue;
        const point = mix(a.a, a.b, t), other = mix(b.a, b.b, u);
        if (Math.abs(point.y - other.y) > .7) continue;
        let junction = junctions.find(existing => distance(existing, point) < .5 && Math.abs(existing.y - point.y) < .7);
        if (!junction) { junction = { ...point, roads: new Set(), key: `${point.x.toFixed(1)}:${point.y.toFixed(0)}:${point.z.toFixed(1)}` }; junctions.push(junction); }
        junction.roads.add(a.road); junction.roads.add(b.road);
      }
      // Junction geometry is static, but visiting the entire city must not grow
      // this near-field cache without bound.
      if (junctionCells.size >= 128) junctionCells.delete(junctionCells.keys().next().value);
      junctionCells.set(key, junctions);
    }
    let nearest = null, best = 32;
    for (const junction of junctionCells.get(key)) {
      if (!junction.roads.has(route.sourceRoad) && !junction.roads.has(route.next?.sourceRoad)) continue;
      const d = distance(p, junction);
      if (d >= best || Math.abs(p.y - junction.y) > 3) continue;
      const ahead = -(junction.x - p.x) * Math.sin(p.yaw) - (junction.z - p.z) * Math.cos(p.yaw);
      if (approaching && ahead < 0 && d > 12) continue;
      best = d; nearest = junction;
    }
    return nearest;
  }
  function continuations(route) {
    if (connections.has(route)) return connections.get(route);
    const options = [], road = route.sourceRoad;
    if (!road || route.closed) return options;
    const laneEnd = route.points.at(-1), endpoint = distance(laneEnd, road.points[0]) < distance(laneEnd, road.points.at(-1)) ? road.points[0] : road.points.at(-1);
    const nearby = city.masterPlan?.roadIndex?.near(endpoint.x, endpoint.z, .2);
    const roads = nearby ? new Set(nearby.map(s => s.road)) : null;
    const start = Math.max(0, route.length - 8), a = sampleTrafficRoute(route, start), incoming = sampleTrafficRoute(route, route.length - .1);
    for (const next of routes) {
      if (!next.sourceRoad || next.sourceRoad === road || roads && !roads.has(next.sourceRoad)) continue;
      const center = nearestCenter(next.sourceRoad.points, endpoint);
      if (center.distance > .1 || Math.abs(center.y - endpoint.y) > .2) continue;
      const join = nearestAlong(next, endpoint), nextAlong = join.along + 8;
      if (!next.closed && nextAlong > next.length - 1) continue;
      const b = sampleTrafficRoute(next, nextAlong), outgoing = sampleTrafficRoute(next, join.along + .1);
      if (Math.cos(incoming.yaw - outgoing.yaw) < -.65) continue;
      const handle = Math.min(10, distance(a, b) * .55);
      const controlA = { x: a.x - Math.sin(incoming.yaw) * handle, z: a.z - Math.cos(incoming.yaw) * handle };
      const controlB = { x: b.x + Math.sin(outgoing.yaw) * handle, z: b.z + Math.cos(outgoing.yaw) * handle };
      const points = [], count = Math.max(12, Math.ceil(distance(a, b))), cumulative = [0];
      for (let i = 0; i <= count; i++) {
        const t = i / count, u = 1 - t, p = mix(a, b, t);
        p.x = u ** 3 * a.x + 3 * u * u * t * controlA.x + 3 * u * t * t * controlB.x + t ** 3 * b.x;
        p.z = u ** 3 * a.z + 3 * u * u * t * controlA.z + 3 * u * t * t * controlB.z + t ** 3 * b.z;
        const surfaces = city.masterPlan?.roadIndex?.near(p.x, p.z, 1);
        if (surfaces) {
          const heights = surfaces.filter(s => s.road === road || s.road === next.sourceRoad)
            .map(s => surfaceHeightAt(p.x, p.z, s)).filter(y => y !== null && Math.abs(y - p.y) < .6);
          if (!heights.length) break;
          if (i > 0 && i < count) p.y = heights.reduce((best, y) => Math.abs(y - p.y) < Math.abs(best - p.y) ? y : best);
        } else if (![road, next.sourceRoad].some(r => nearestCenter(r.points, p).distance <= r.width / 2 - 1.1)) break;
        if (staticBoxes(p, 2).some(box => overlapsHeight(box, p.y, 1.7) && circleHitsBox(p.x, p.z, 1.2, box))) break;
        if (i) cumulative.push(cumulative.at(-1) + distance(points.at(-1), p));
        points.push(p);
      }
      if (points.length !== count + 1) continue;
      options.push({ id: `junction:${route.id}:${next.id}`, sourceRoad: road, points, cumulative, length: cumulative.at(-1),
        width: Math.min(route.width, next.width), speed: Math.min(5.2, next.speed), closed: false, start, next, nextAlong });
    }
    connections.set(route, options); return options;
  }
  const obstacleBoxes = (car, driving) => [...(city.cars ?? []), ...cars].filter(other => other !== car && distance(other, car) < 40).map(carCollider)
    .concat(driving && !(city.cars ?? []).includes(driving) ? [carCollider(driving)] : []);
  const pedestrianPosition = pedestrian => pedestrian.root?.position ?? pedestrian.position ?? pedestrian;
  function blockedAt(p, boxes, people, clearance = 1.25) {
    return boxes.some(b => overlapsHeight(b, p.y ?? 0, 1.7) && circleHitsBox(p.x, p.z, clearance, b)) || people.some(person => {
      const q = pedestrianPosition(person);
      return (q.y ?? 0) < (p.y ?? 0) + 1.7 && (q.y ?? 0) + 1.8 > (p.y ?? 0) + .25 && distance(p, q) < clearance + .65;
    });
  }
  function spawn(player, driving, camera, people) {
    const streetOf = route => route.sourceRoad ?? route;
    const choices = nearbyRoutes.map(candidate => {
      const sameStreet = cars.filter(car => streetOf(car.route) === streetOf(candidate.route)).length;
      const laneCount = cars.filter(car => car.route === candidate.route).length;
      const streetCapacity = nearbyRoutes.filter(other => streetOf(other.route) === streetOf(candidate.route)).reduce((sum, other) => sum + other.capacity, 0);
      return { ...candidate, laneCount, load: sameStreet / Math.max(1, streetCapacity) + laneCount / Math.max(1, candidate.capacity) * .25 + random() * .025 };
    }).filter(candidate => candidate.laneCount < candidate.capacity).sort((a, b) => a.load - b.load);
    for (let attempt = 0; attempt < 45 && choices.length; attempt++) {
      const candidate = choices[attempt % choices.length], route = candidate.route;
      const offset = candidate.along + (random() - .5) * profile.radius * 1.7;
      const along = route.closed === false ? offset : wrap(offset, route.length);
      if (route.closed === false && (along < 8 || along > route.length - 12)) continue;
      const p = sampleTrafficRoute(route, along), d = distance(p, player);
      if (d < 34 || d > profile.radius - 12 || (camera && !firstUpdate && visible(p))) continue;
      const junction = masterJunction(p, route);
      if (junction && distance(p, junction) < 17) continue;
      const boxes = staticBoxes(p, 8).concat(obstacleBoxes(p, driving));
      if (blockedAt(p, boxes, people, 3.6) || cars.some(c => Math.abs((c.y ?? 0) - p.y) < 3 && distance(c, p) < population.carSpacing)) continue;
      const root = new THREE.Group(); root.name = 'Traffic vehicle'; root.position.set(p.x, p.y + .04, p.z); root.rotation.set(p.pitch, p.yaw, p.roll ?? 0, 'YXZ');
      const id = nextId++;
      cars.push({ id, root, ...p, route, along, paint: FLEET_PAINTS[id % FLEET_PAINTS.length], damageHits: 0, speed: 4 + random() * 2, cruise: route.speed * (.82 + random() * .18), wheelAngle: 0, obstacles: [], obstacleTime: 0 });
      return;
    }
  }
  function hitCar(npc) {
    const index = cars.indexOf(npc);
    if (index < 0) return { hit: false, hitsRemaining: 0, car: null };
    npc.damageHits++;
    const hitsRemaining = Math.max(0, TRAFFIC_TAKEOVER_HITS - npc.damageHits);
    if (hitsRemaining) return { hit: true, hitsRemaining, car: null };

    // Only a disabled car leaves the instanced fleet. Give the player a complete
    // model with the exact same paint and pose, without touching shared fleet
    // geometry or materials. Its subsequent movement belongs to player driving.
    const model = createCar(npc.paint), spawn = { x: npc.x, y: npc.y, z: npc.z, yaw: npc.yaw, pitch: npc.pitch ?? 0, roll: npc.roll ?? 0 };
    model.root.position.set(spawn.x, spawn.y + .04, spawn.z);
    model.root.rotation.set(spawn.pitch, spawn.yaw, spawn.roll, 'YXZ');
    model.root.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = false; mesh.receiveShadow = true; } });
    for (const wheel of model.wheels) wheel.rotation.x = npc.wheelAngle;
    const car = { ...model, ...spawn, speed: 0, spawn, paint: npc.paint, trafficId: npc.id, damageHits: npc.damageHits };
    cars.splice(index, 1); npc.speed = 0;
    fleet.sync(cars);
    // Normal population scans replace it off screen, retaining the same budget.
    return { hit: true, hitsRemaining: 0, car };
  }
  function update(dt, player, driving, camera, pedestrians = []) {
    dt = clamp(dt, 0, .1);
    if (camera) { camera.updateMatrixWorld(); projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection); }
    const assigned = pedestrians.filter(person => !city.masterPlan || !person.root || person.path);
    const people = driving ? assigned : [player, ...assigned];
    scanTime -= dt;
    if (scanTime <= 0 || firstUpdate) {
      scanTime = .7;
      const key = `${Math.floor(player.x / 192)}:${Math.floor(player.z / 192)}`;
      if (key !== regionKey) { regionKey = key; regional = city.masterPlan ? [] : regionalTrafficRoutes(player); }
      population = populationFor(city, player, quality);
      nearbyRoutes = [...routes, ...regional].map(route => nearestAlong(route, player)).filter(r => r.distance < profile.radius - 20).sort((a, b) => a.distance - b.distance).slice(0, 24)
        .map(candidate => ({ ...candidate, capacity: Math.floor(localLaneLength(candidate.route, player, profile.radius - 12) / (population.carSpacing * 2)) })).filter(candidate => candidate.capacity > 0);
      // Taking over an NPC changes its owner, not the local vehicle budget.
      // Keep nearby acquired cars in that budget so repeatedly stopping traffic
      // cannot create an unbounded collection of full models beside the player.
      const acquired = (city.cars ?? []).filter(car => car.trafficId !== undefined && distance(car, player) <= profile.radius + 45).length;
      target = Math.max(0, Math.min(profile.count, population.cars, nearbyRoutes.reduce((sum, candidate) => sum + candidate.capacity, 0)) - acquired);
      for (let i = cars.length - 1; i >= 0; i--) {
        const d = distance(cars[i], player);
        const ended = cars[i].route.closed === false && !cars[i].route.next && !cars[i].continuation && cars[i].route.length - cars[i].along < 6 && cars[i].speed < .2;
        if ((d > profile.radius + 45 || cars.length > target || ended) && (!camera || !visible(cars[i]) || d > 420)) cars.splice(i, 1);
      }
      const missing = target - cars.length;
      for (let i = 0; i < Math.min(firstUpdate ? target : 2, missing); i++) spawn(player, driving, camera, people);
      firstUpdate = false;
    }
    // Reserve a crossing before cars enter it. Pure bumper avoidance can leave
    // four approaches permanently waiting for one another in the intersection.
    const junctions = new Map(cars.map(car => [car, masterJunction(car, car.route, true)]));
    if (city.masterPlan) {
      const groups = new Map();
      for (const [car, junction] of junctions) if (junction) {
        if (!groups.has(junction.key)) groups.set(junction.key, []);
        groups.get(junction.key).push(car);
      }
      for (const key of reservations.keys()) if (!groups.has(key)) reservations.delete(key);
      for (const [key, candidates] of groups) {
        if (!candidates.includes(reservations.get(key))) {
          candidates.sort((a, b) => distance(a, junctions.get(a)) - distance(b, junctions.get(b)) || a.id - b.id);
          reservations.set(key, candidates[0]);
        }
      }
    }
    for (const car of cars) {
      if (!car.route.closed && !car.route.next && !car.continuation && car.route.length - car.along < 36) {
        const options = continuations(car.route);
        car.continuation = options.length ? options[Math.floor(random() * options.length)] : null;
      }
      car.obstacleTime -= dt;
      if (car.obstacleTime <= 0) { car.obstacleTime = .45; car.obstacles = staticBoxes(car, 34); }
      const boxes = car.obstacles.concat(obstacleBoxes(car, driving));
      const horizon = Math.max(12, 5 + car.speed * car.speed / 7), spacing = 1.3;
      const junction = junctions.get(car);
      const yielding = junction && distance(car, junction) >= 14 && (city.masterPlan ? reservations.get(junction.key) !== car :
        cars.some(other => other !== car && distance(other, junction) < 14));
      let gap = car.route.closed === false && !car.route.next && !car.continuation ? car.route.length - car.along : Infinity;
      for (let ahead = 0; ahead < horizon; ahead += spacing) {
        const p = sampleJourney(car, car.along + ahead);
        const occupiedJunction = yielding && distance(p, junction) < 14;
        if (occupiedJunction || blockedAt(p, boxes, people)) { gap = ahead; break; }
      }
      const future = sampleJourney(car, car.along + 8), bend = Math.abs(Math.atan2(Math.sin(future.yaw - car.yaw), Math.cos(future.yaw - car.yaw)));
      const target = trafficSpeedForGap(gap, Math.min(car.cruise, bend > .25 ? 5.2 : car.cruise));
      car.speed = target < car.speed ? Math.max(target, car.speed - 7 * dt) : Math.min(target, car.speed + 2 * dt);
      let step = car.speed * dt;
      // A second bumper check gives deterministic yielding even after teleporting
      // or when the pedestrian changes direction inside the normal brake envelope.
      for (let ahead = 0; ahead <= step + 2.4; ahead += .6) {
        const p = sampleJourney(car, car.along + ahead);
        const occupiedJunction = yielding && distance(p, junction) < 14;
        if (occupiedJunction || blockedAt(p, boxes, people, 1.28)) { step = 0; car.speed = 0; break; }
      }
      car.along = car.route.closed === false ? car.along + step : wrap(car.along + step, car.route.length);
      if (car.continuation && car.along >= car.continuation.start) {
        car.along -= car.continuation.start; car.route = car.continuation; car.continuation = null;
      }
      if (car.route.next && car.along >= car.route.length) {
        car.along = car.route.nextAlong + car.along - car.route.length; car.route = car.route.next;
        car.cruise = car.route.speed * (.82 + random() * .18);
      }
      if (!car.route.closed && !car.route.next) car.along = Math.min(car.along, car.route.length);
      const p = sampleJourney(car, car.along), ahead = sampleJourney(car, car.along + .7), behind = sampleJourney(car, car.along - .7);
      car.x = p.x; car.y = p.y; car.z = p.z; car.roll = p.roll; car.yaw = Math.atan2(behind.x - ahead.x, behind.z - ahead.z);
      car.pitch = Math.atan2(ahead.y - behind.y, distance(behind, ahead));
      car.root.position.set(car.x, car.y + .04, car.z); car.root.rotation.set(car.pitch, car.yaw, car.roll ?? 0, 'YXZ'); car.wheelAngle -= step / .44;
    }
    fleet.sync(cars);
  }
  return {
    cars, root: fleet.root, update, hitCar,
    setQuality(value) { quality = value; profile = TRAFFIC_PROFILES[value] ?? TRAFFIC_PROFILES.high; scanTime = 0; },
    nearbyColliders(x, z, radius = 8) { return cars.filter(c => Math.hypot(c.x - x, c.z - z) < radius + 4).map(carCollider); },
    snapshot() { return { capacity: profile.count, target, district: population.district, active: cars.length, drawCalls: fleet.root.children.length, cars: cars.map(c => ({ id: c.id, x: c.x, y: c.y, z: c.z, speed: c.speed, yaw: c.yaw, pitch: c.pitch, roll: c.roll, route: c.route.id, damageHits: c.damageHits, hitsRemaining: TRAFFIC_TAKEOVER_HITS - c.damageHits })) }; },
    reset() { cars.length = 0; reservations.clear(); scanTime = 0; firstUpdate = true; fleet.sync(cars); },
    dispose() { cars.length = 0; fleet.dispose(); },
  };
}
