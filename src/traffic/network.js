import { SpatialGrid } from '../core/spatial-grid.js';
import { clamp } from '../core/physics.js';

// The road network as traffic sees it, derived once from the world's road plan:
// junction nodes, edges between them, right-hand lanes, turn connectors,
// crosswalks and a sidewalk graph. Topology is built eagerly and cheaply; the
// detailed lane and connector geometry is built on first use, so only the
// streets near the player ever pay for it.

export const LANE_SPEED = { local: 9, secondary: 11, primary: 12.5, expressway: 17, ramp: 11 };
const NODE_MERGE = 6, GRADE = .7, CROSSWALK = 2.4, ELEVATED = 1.5, SIDEWALK = 2;

const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpPoint = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y ?? 0, b.y ?? 0, t), z: lerp(a.z, b.z, t) });
const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; };
/** Right of travel for a heading (x, z), which is also counter-clockwise in atan2(z, x). */
export const rightOf = d => ({ x: -d.z, z: d.x });
function lazy(target, key, build) {
  Object.defineProperty(target, key, { configurable: true, enumerable: false, get() {
    const value = build(); Object.defineProperty(target, key, { value, enumerable: false }); return value;
  } });
}

function cumulative(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + dist(points[i - 1], points[i]));
  return out;
}
function locate(cum, s) {
  let lo = 1, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < s) lo = mid + 1; else hi = mid; }
  return lo;
}
function pointAt(points, cum, s) {
  s = clamp(s, 0, cum.at(-1));
  const i = locate(cum, s), span = cum[i] - cum[i - 1];
  return lerpPoint(points[i - 1], points[i], span > 1e-9 ? (s - cum[i - 1]) / span : 0);
}
function slice(points, cum, s0, s1) {
  const out = [pointAt(points, cum, s0)];
  for (let i = 0; i < points.length; i++) if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6) out.push({ ...points[i] });
  out.push(pointAt(points, cum, s1));
  return out;
}
// Even spacing then a few relaxation passes: polyline corners become arcs of a
// few metres radius, and the ends (and their headings) stay where they were.
function smooth(points, step = 2, passes = 8) {
  const cum = cumulative(points), length = cum.at(-1), count = Math.max(2, Math.ceil(length / step));
  let out = Array.from({ length: count + 1 }, (_, i) => pointAt(points, cum, length * i / count));
  for (let pass = 0; pass < passes && out.length > 4; pass++) {
    out = out.map((p, i) => i < 2 || i > out.length - 3 ? p : {
      x: (out[i - 1].x + 2 * p.x + out[i + 1].x) / 4, y: (out[i - 1].y + 2 * p.y + out[i + 1].y) / 4, z: (out[i - 1].z + 2 * p.z + out[i + 1].z) / 4 });
  }
  return out;
}
function offset(points, amount) {
  const out = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], r = rightOf(unit(b.x - a.x, b.z - a.z));
    return { x: p.x + r.x * amount, y: p.y, z: p.z + r.z * amount };
  });
  // Inside a bend tighter than the offset the line folds back; drop the fold.
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = points[i - 1], b = points[i + 1], q = out[i - 1], r = out[i + 1];
    return (r.x - q.x) * (b.x - a.x) + (r.z - q.z) * (b.z - a.z) > 0;
  });
}
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z };
}

/** A sampled path: positions, cumulative length and curvature for speed limits. */
export function createPath(points) {
  const clean = points.filter((p, i) => i === 0 || dist(points[i - 1], p) > 1e-3);
  if (clean.length === 1) clean.push({ ...clean[0], x: clean[0].x + 1e-2 });
  const cum = cumulative(clean), curvature = clean.map((p, i) => {
    if (i === 0 || i === clean.length - 1) return 0;
    const a = clean[i - 1], b = clean[i + 1], d0 = unit(p.x - a.x, p.z - a.z), d1 = unit(b.x - p.x, b.z - p.z);
    return Math.acos(clamp(d0.x * d1.x + d0.z * d1.z, -1, 1)) / Math.max(.75, (dist(a, p) + dist(p, b)) / 2);
  });
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of clean) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  return { points: clean, cum, length: cum.at(-1), curvature, minX, maxX, minZ, maxZ };
}
/** Position, heading and grade at distance s along a path. */
export function samplePath(path, s) {
  const { points, cum } = path;
  s = clamp(s, 0, path.length);
  const i = locate(cum, s), a = points[i - 1], b = points[i], span = cum[i] - cum[i - 1], t = span > 1e-9 ? (s - cum[i - 1]) / span : 0;
  const dx = b.x - a.x, dz = b.z - a.z, flat = Math.hypot(dx, dz) || 1e-9;
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), dx: dx / flat, dz: dz / flat,
    yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(b.y - a.y, flat), roll: lerp(a.roll ?? 0, b.roll ?? 0, t) };
}
/** The tightest curvature within [s, s + ahead]. */
export function curvatureAhead(path, s, ahead = 0) {
  const from = locate(path.cum, clamp(s, 0, path.length)) - 1, to = locate(path.cum, clamp(s + ahead, 0, path.length));
  let k = 0;
  for (let i = Math.max(0, from); i <= to; i++) k = Math.max(k, path.curvature[i] ?? 0);
  return k;
}
/** Nearest station on a path to a point (for spawning and takeovers). */
export function projectOnPath(path, point) {
  let best = { distance: Infinity, s: 0 };
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
    const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / l2, 0, 1), d = Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t);
    if (d < best.distance) best = { distance: d, s: path.cum[i - 1] + t * (path.cum[i] - path.cum[i - 1]) };
  }
  return best;
}

// Height of one road's driving surface at a point, including its crossfall.
function roadSurface(plan, road, p) {
  let best = Infinity, y = p.y, roll = 0;
  for (const s of plan.roadIndex.near(p.x, p.z, 2)) {
    if (s.road !== road) continue;
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, length = Math.hypot(dx, dz) || 1e-9;
    const t = clamp(((p.x - s.a.x) * dx + (p.z - s.a.z) * dz) / (length * length), 0, 1);
    const d = Math.hypot(p.x - s.a.x - dx * t, p.z - s.a.z - dz * t);
    if (d >= best) continue;
    best = d;
    const across = (-(p.x - s.a.x) * dz + (p.z - s.a.z) * dx) / length;
    y = s.a.y + (s.b.y - s.a.y) * t + (s.crossSlope ?? 0) * across; roll = Math.atan(s.crossSlope ?? 0);
  }
  return { y, roll };
}
function segmentIntersection(a, b, c, d) {
  const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z, denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / denom, u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / denom;
  return t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? { t: clamp(t, 0, 1), u: clamp(u, 0, 1) } : null;
}
// Where two lines (origin + direction) meet, or null when nearly parallel.
function meet(p, d, q, e) {
  const det = -d.x * e.z + d.z * e.x;
  if (Math.abs(det) < .17) return null;
  const rx = q.x - p.x, rz = q.z - p.z, t = (-rx * e.z + rz * e.x) / det;
  return { x: p.x + d.x * t, z: p.z + d.z * t };
}

/** Lane offsets from the centreline for one direction of a road. */
export function laneLayout(width) {
  if (width < 19) return [Math.min(3.15, width * .25)];
  const lane = Math.min(3.5, width / 4);
  return [lane / 2, lane * 1.5];
}

export function buildNetwork(plan) {
  const roads = plan.roads.filter(r => r.points.length >= 2 && r.width >= 6 && (r.kind === 'road' || r.kind === 'ramp'));
  const order = new Map(roads.map((r, i) => [r, i]));
  const elevated = p => p.y - plan.terrainHeight(p.x, p.z) > ELEVATED;
  const info = new Map(roads.map(road => {
    const points = road.points.map(p => ({ x: p.x, y: p.y ?? 0, z: p.z }));
    return [road, { points, cum: cumulative(points), closed: road.closed ?? dist(points[0], points.at(-1)) < .1 }];
  }));

  // 1. Junction points: at-grade crossings, and road ends touching another road.
  const segments = new SpatialGrid([], 48), all = [];
  for (const road of roads) {
    const { points, cum } = info.get(road);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], s = { road, a, b, s0: cum[i - 1], length: cum[i] - cum[i - 1],
        minX: Math.min(a.x, b.x) - .5, maxX: Math.max(a.x, b.x) + .5, minZ: Math.min(a.z, b.z) - .5, maxZ: Math.max(a.z, b.z) + .5 };
      segments.add(s); all.push(s);
    }
  }
  const hits = [];
  for (const s of all) for (const other of segments.query(s.minX, s.minZ, s.maxX, s.maxZ)) {
    if (order.get(other.road) <= order.get(s.road)) continue;
    const hit = segmentIntersection(s.a, s.b, other.a, other.b);
    if (!hit) continue;
    const y1 = lerp(s.a.y, s.b.y, hit.t), y2 = lerp(other.a.y, other.b.y, hit.u);
    if (Math.abs(y1 - y2) > GRADE) continue;
    hits.push({ x: lerp(s.a.x, s.b.x, hit.t), z: lerp(s.a.z, s.b.z, hit.t), y: (y1 + y2) / 2,
      members: [[s.road, s.s0 + hit.t * s.length], [other.road, other.s0 + hit.u * other.length]] });
  }
  for (const road of roads) {
    const { points, cum, closed } = info.get(road);
    if (closed) continue;
    for (const [p, station] of [[points[0], 0], [points.at(-1), cum.at(-1)]]) {
      for (const other of segments.query(p.x - 1.5, p.z - 1.5, p.x + 1.5, p.z + 1.5)) {
        if (other.road === road) continue;
        const dx = other.b.x - other.a.x, dz = other.b.z - other.a.z, t = clamp(((p.x - other.a.x) * dx + (p.z - other.a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        const q = { x: other.a.x + dx * t, z: other.a.z + dz * t, y: lerp(other.a.y, other.b.y, t) };
        if (dist(p, q) > 1.2 || Math.abs(q.y - p.y) > GRADE) continue;
        hits.push({ x: q.x, z: q.z, y: q.y, members: [[road, station], [other.road, other.s0 + t * other.length]] });
      }
    }
  }

  // 2. Merge nearby points into nodes.
  const nodes = [], nodeGrid = new SpatialGrid([], 24);
  const newNode = (p, members = []) => {
    const node = { id: `n${nodes.length}`, x: p.x, y: p.y, z: p.z, count: 0, members, minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z };
    nodes.push(node); return node;
  };
  for (const hit of hits.sort((a, b) => a.x - b.x || a.z - b.z)) {
    let node = nodeGrid.query(hit.x - NODE_MERGE, hit.z - NODE_MERGE, hit.x + NODE_MERGE, hit.z + NODE_MERGE)
      .find(n => dist(n, hit) < NODE_MERGE && Math.abs(n.y - hit.y) < GRADE);
    if (!node) { node = newNode(hit); nodeGrid.add(node); }
    node.x = (node.x * node.count + hit.x) / (node.count + 1); node.z = (node.z * node.count + hit.z) / (node.count + 1);
    node.y = (node.y * node.count + hit.y) / (node.count + 1); node.count++;
    for (const [road, station] of hit.members) if (!node.members.some(m => m.road === road && Math.abs(m.station - station) < 2 * NODE_MERGE)) node.members.push({ road, station });
  }

  // 3. Split roads at their nodes into edges. Open ends become dead-end nodes.
  const edges = [], stationsOf = new Map(roads.map(r => [r, []]));
  for (const node of nodes) for (const m of node.members) stationsOf.get(m.road).push({ station: m.station, node });
  for (const road of roads) {
    const { points, cum, closed } = info.get(road), length = cum.at(-1), list = stationsOf.get(road);
    if (!closed) for (const [p, station] of [[points[0], 0], [points.at(-1), length]]) {
      if (!list.some(s => Math.abs(s.station - station) < 1.5)) list.push({ station, node: newNode(p, [{ road, station }]) });
    }
    if (closed && !list.length) list.push({ station: 0, node: newNode(points[0], [{ road, station: 0 }]) });
    list.sort((a, b) => a.station - b.station);
    const pairs = list.slice(1).map((b, i) => [list[i], b]);
    if (closed) pairs.push([list.at(-1), { ...list[0], station: list[0].station + length }]);
    for (const [a, b] of pairs) {
      if (b.station - a.station < .5 || a.node === b.node && b.station - a.station < 20) continue;
      const line = b.station <= length + 1e-6 ? slice(points, cum, a.station, b.station)
        : [...slice(points, cum, a.station, length), ...slice(points, cum, 0, b.station - length).slice(1)];
      edges.push({ id: `e${edges.length}`, road, from: a.node, to: b.node, line, length: b.station - a.station, width: road.width,
        class: road.class, speed: LANE_SPEED[road.class] ?? 9, elevated: line.some(elevated) });
    }
  }

  // 4. Approaches around each node, sorted counter-clockwise, with clearances.
  for (const node of nodes) node.approaches = [];
  for (const edge of edges) for (const end of ['from', 'to']) {
    const node = edge[end], line = end === 'from' ? edge.line : [...edge.line].reverse(), cum = cumulative(line);
    const ahead = pointAt(line, cum, Math.min(5, cum.at(-1))), dir = unit(ahead.x - line[0].x, ahead.z - line[0].z);
    node.approaches.push({ edge, end, dir, angle: Math.atan2(dir.z, dir.x), width: edge.width });
  }
  for (const node of nodes) {
    const list = node.approaches.sort((a, b) => a.angle - b.angle), count = list.length;
    list.forEach((a, i) => { a.index = i; a.node = node; a.partner = list.find(b => b !== a && b.edge.road === a.edge.road) ?? null; });
    node.kind = count >= 3 ? 'junction' : count === 2 ? 'continuation' : 'end';
    node.ground = !elevated(node) && list.every(a => a.edge.class !== 'expressway' && a.edge.class !== 'ramp');
    // Through roads keep priority; the widest road wins when nothing continues.
    const through = list.filter(a => a.partner), widest = Math.max(...list.map(a => a.width));
    const majors = through.length ? through.filter(a => a.width === Math.max(...through.map(b => b.width))) : list.filter(a => a.width === widest).slice(0, 2);
    for (const a of list) a.major = majors.includes(a);
    node.axis = (majors[0] ?? list[0]).dir;
    node.signalized = node.kind === 'junction' && node.ground && (count >= 4 || list.some(a => a.edge.class !== 'local'));
    for (const a of list) {
      if (node.kind === 'junction') {
        // How far along this approach its kerbs clear every other street.
        let clear = 0;
        for (const b of list) {
          if (b === a) continue;
          const cos = a.dir.x * b.dir.x + a.dir.z * b.dir.z, sin = Math.sqrt(Math.max(0, 1 - cos * cos));
          if (sin < .26) continue;
          clear = Math.max(clear, (b.width / 2 + a.width / 2 * Math.abs(cos)) / sin);
        }
        a.clear = Math.min(22, Math.max(clear, widest / 2) + 1);
        a.crosswalk = node.ground ? a.clear + CROSSWALK / 2 : null;
        // Traffic leaves at the junction's edge; arriving traffic waits behind the
        // crosswalk, a little further back on narrow streets so turns clear it.
        a.leave = a.clear;
        a.stop = a.clear + (node.ground ? CROSSWALK + .4 + (a.width < 9 ? 1.2 : 0) : 0);
      } else if (node.kind === 'continuation') {
        const other = list.find(b => b !== a), cos = -(a.dir.x * other.dir.x + a.dir.z * other.dir.z);
        a.clear = a.stop = a.leave = clamp(7 * Math.tan(Math.acos(clamp(cos, -1, 1)) / 2), .5, 10); a.crosswalk = null;
      } else { a.clear = 0; a.stop = a.leave = 8; a.crosswalk = null; }
    }
    node.radius = Math.max(...list.map(a => a.clear));
  }

  // 5. Lanes. Geometry is built per edge on first access.
  const lanes = [];
  for (const edge of edges) {
    const offsets = laneLayout(edge.width), fromApproach = edge.from.approaches.find(a => a.edge === edge && a.end === 'from');
    const toApproach = edge.to.approaches.find(a => a.edge === edge && a.end === 'to');
    Object.assign(edge, { fromApproach, toApproach, lanes: { forward: [], backward: [] } });
    // The shared centreline runs between the two junction edges; each lane then
    // stops short at its own stop line (scaled down on very short blocks).
    lazy(edge, 'center', () => {
      const cum = cumulative(edge.line), length = cum.at(-1);
      let a = fromApproach.leave, b = toApproach.leave;
      const k = a + b > length - 1.5 ? Math.max(0, length - 1.5) / (a + b) : 1;
      return { points: smooth(slice(edge.line, cum, a * k, length - b * k)), scale: k };
    });
    for (const direction of ['forward', 'backward']) for (const [index, amount] of offsets.entries()) {
      const forward = direction === 'forward', lane = { id: `${edge.id}${forward ? 'f' : 'b'}${index}`, kind: 'lane', edge, direction, index,
        count: offsets.length, offset: amount, speed: edge.speed, start: forward ? edge.from : edge.to, end: forward ? edge.to : edge.from,
        startApproach: forward ? fromApproach : toApproach, endApproach: forward ? toApproach : fromApproach };
      lazy(lane, 'path', () => {
        const center = forward ? edge.center.points : [...edge.center.points].reverse(), line = offset(center, amount), cum = cumulative(line);
        const holdBack = Math.min((lane.endApproach.stop - lane.endApproach.leave) * edge.center.scale, Math.max(0, cum.at(-1) - 1));
        const sign = forward ? 1 : -1;
        return createPath(slice(line, cum, 0, cum.at(-1) - holdBack).map(p => { const surface = roadSurface(plan, edge.road, p); return { ...p, y: surface.y, roll: surface.roll * sign }; }));
      });
      lazy(lane, 'next', () => connectorsAt(lane.end).filter(c => c.from === lane));
      lanes.push(lane); edge.lanes[direction].push(lane);
    }
  }
  for (const node of nodes) for (const a of node.approaches) {
    a.arriving = a.edge.lanes[a.end === 'to' ? 'forward' : 'backward'];
    a.leaving = a.edge.lanes[a.end === 'from' ? 'forward' : 'backward'];
  }

  // 6. Turn connectors inside a node, built the first time a lane reaches it.
  const connectorCache = new Map();
  function connectorsAt(node) {
    if (connectorCache.has(node)) return connectorCache.get(node);
    const list = [];
    connectorCache.set(node, list);
    for (const a of node.approaches) for (const inLane of a.arriving) for (const b of node.approaches) {
      const uturn = b === a;
      if (uturn && node.kind !== 'end') continue;
      const outs = b.leaving, end = samplePath(inLane.path, inLane.path.length), first = samplePath(outs[0].path, 0);
      const d0 = { x: end.dx, z: end.dz }, d1 = { x: first.dx, z: first.dz }, dot = d0.x * d1.x + d0.z * d1.z, side = d1.x * -d0.z + d1.z * d0.x;
      const turn = uturn ? 'uturn' : dot > .7 ? 'straight' : side > 0 ? 'right' : 'left';
      if (!uturn && dot < -.8) continue;
      // Turns go from and to the matching kerb-side lane; straight keeps its lane.
      if (inLane.count > 1 && (turn === 'right' && inLane.index !== inLane.count - 1 || (turn === 'left' || turn === 'uturn') && inLane.index !== 0)) continue;
      const outLane = outs[turn === 'right' ? outs.length - 1 : turn === 'straight' ? Math.min(inLane.index, outs.length - 1) : 0];
      const p0 = { ...inLane.path.points.at(-1) }, p3 = { ...outLane.path.points[0] }, gap = dist(p0, p3);
      const reach = uturn ? Math.max(5, gap) : Math.max(1, gap * .42);
      const p1 = { x: p0.x + d0.x * reach, y: p0.y, z: p0.z + d0.z * reach }, p2 = { x: p3.x - d1.x * reach, y: p3.y, z: p3.z - d1.z * reach };
      const steps = Math.max(6, Math.ceil(gap / 1.2)), points = [];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, p = bezier(p0, p1, p2, p3, t), y = lerp(p0.y, p3.y, t);
        p.y = k === 0 || k === steps ? y : plan.surfaceHeight(p.x, p.z, y + .8);
        if (!(Math.abs(p.y - y) < .8)) p.y = y;
        p.roll = lerp(p0.roll ?? 0, p3.roll ?? 0, t);
        points.push(p);
      }
      list.push({ id: `${inLane.id}>${outLane.id}`, kind: 'connector', node, from: inLane, to: outLane, turn, path: createPath(points),
        speed: turn === 'straight' ? inLane.speed : Math.min(inLane.speed, 7), inApproach: a, outApproach: b, next: [outLane] });
    }
    return list;
  }

  const walk = buildWalkGraph(plan, nodes, edges);
  const edgeGrid = new SpatialGrid(edges.map(edge => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of edge.line) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    return { minX, maxX, minZ, maxZ, edge };
  }), 64);
  const nodesGrid = new SpatialGrid(nodes.map(n => ({ minX: n.x, maxX: n.x, minZ: n.z, maxZ: n.z, node: n })), 64);
  return {
    nodes, edges, lanes, walk, connectorsAt,
    edgesNear(x, z, radius) { return edgeGrid.query(x - radius, z - radius, x + radius, z + radius).map(e => e.edge); },
    nodesNear(x, z, radius) { return nodesGrid.query(x - radius, z - radius, x + radius, z + radius).map(e => e.node).filter(n => Math.hypot(n.x - x, n.z - z) <= radius); },
  };
}

// Sidewalks along both sides of every street at street level, corners where
// they meet, crosswalks on every at-grade junction, and paths across the raised
// public decks with their access ramps.
function buildWalkGraph(plan, nodes, edges) {
  const walkNodes = [], walkEdges = [], adjacency = new Map();
  const addNode = (p, kind, extra = {}) => {
    const node = { id: `w${walkNodes.length}`, x: p.x, y: p.y ?? plan.terrainHeight(p.x, p.z), z: p.z, kind, ...extra };
    walkNodes.push(node); adjacency.set(node.id, []); return node;
  };
  const addEdge = (a, b, kind, extra = {}, points = null) => {
    if (!a || !b || a === b) return null;
    const edge = { id: `s${walkEdges.length}`, a: a.id, b: b.id, path: createPath(points ?? [a, b]), kind, terrain: kind !== 'deck' && kind !== 'ramp', ...extra };
    walkEdges.push(edge); adjacency.get(a.id).push(edge); adjacency.get(b.id).push(edge);
    return edge;
  };
  const ground = p => ({ x: p.x, y: plan.terrainHeight(p.x, p.z), z: p.z });
  const walkable = edge => !edge.elevated && edge.class !== 'expressway' && edge.class !== 'ramp';
  const reach = edge => edge.width / 2 + SIDEWALK;
  // Sidewalk ends per node, approach and side. 'ccw' is the right-hand side when walking out of the node.
  const ends = new Map(), key = (approach, side) => `${approach.node.id}:${approach.index}:${side}`;
  const trimOf = a => a.node.kind === 'junction' ? (a.crosswalk ?? a.clear) + CROSSWALK / 2 + .3 : a.node.kind === 'continuation' ? a.stop * reach(a.edge) / 7 : 0;
  for (const edge of edges) {
    if (!walkable(edge)) continue;
    const cum = cumulative(edge.line), length = cum.at(-1), t0 = trimOf(edge.fromApproach), t1 = trimOf(edge.toApproach);
    if (t0 + t1 > length - 1) continue;
    const center = slice(edge.line, cum, t0, length - t1);
    for (const side of [1, -1]) {
      const points = offset(center, side * reach(edge)).map(ground);
      const a = addNode(points[0], 'sidewalk'), b = addNode(points.at(-1), 'sidewalk');
      ends.set(key(edge.fromApproach, side > 0 ? 'ccw' : 'cw'), a);
      ends.set(key(edge.toApproach, side > 0 ? 'cw' : 'ccw'), b);
      addEdge(a, b, 'sidewalk', { street: edge.id }, points);
    }
  }
  for (const node of nodes) {
    const list = node.approaches.filter(a => ends.has(key(a, 'ccw')) || ends.has(key(a, 'cw')));
    if (!list.length) continue;
    const curbs = new Map();
    if (node.kind === 'junction' && node.ground) for (const a of list) {
      const r = rightOf(a.dir), across = a.width / 2 + .4;
      const at = side => ground({ x: node.x + a.dir.x * a.crosswalk + r.x * side * across, z: node.z + a.dir.z * a.crosswalk + r.z * side * across });
      const ccw = addNode(at(1), 'curb', { junction: node.id }), cw = addNode(at(-1), 'curb', { junction: node.id });
      curbs.set(a, { ccw, cw });
      const points = [cw, ccw].map(p => ({ x: p.x, z: p.z, y: plan.surfaceHeight(p.x, p.z, p.y + 1) }));
      addEdge(cw, ccw, 'crossing', { junction: node.id, approach: a.index, terrain: false }, points);
      addEdge(ends.get(key(a, 'ccw')), ccw, 'link'); addEdge(ends.get(key(a, 'cw')), cw, 'link');
    }
    if (node.kind === 'end') {
      // Round the end of a dead-end street rather than across its last metre.
      const a = list[0], endA = ends.get(key(a, 'ccw')), endB = ends.get(key(a, 'cw')), beyond = p => ground({ x: p.x - a.dir.x * 2.5, z: p.z - a.dir.z * 2.5 });
      if (endA && endB) addEdge(endA, endB, 'link', {}, [endA, beyond(endA), beyond(endB), endB]);
      continue;
    }
    for (let i = 0; i < list.length; i++) {
      const a = list[i], b = list[(i + 1) % list.length], endA = ends.get(key(a, 'ccw')), endB = ends.get(key(b, 'cw'));
      if (!endA && !endB || a === b) continue;
      // The corner is where the two kerb lines meet, unless the streets are almost parallel.
      const ra = rightOf(a.dir), rb = rightOf(b.dir), anchors = [endA, endB].filter(Boolean);
      let corner = meet({ x: node.x + ra.x * reach(a.edge), z: node.z + ra.z * reach(a.edge) }, a.dir,
        { x: node.x - rb.x * reach(b.edge), z: node.z - rb.z * reach(b.edge) }, b.dir);
      if (!corner || dist(corner, node) > 30) {
        corner = { x: anchors.reduce((s, p) => s + p.x, 0) / anchors.length, z: anchors.reduce((s, p) => s + p.z, 0) / anchors.length };
      }
      const point = addNode(ground(corner), 'corner', { junction: node.id });
      addEdge(endA, point, 'link'); addEdge(point, endB, 'link');
      if (curbs.has(a)) addEdge(curbs.get(a).ccw, point, 'link');
      if (curbs.has(b)) addEdge(point, curbs.get(b).cw, 'link');
    }
  }
  // Raised decks: a loop around each deck, short bridges between touching decks, and the access ramps.
  const decks = [];
  for (const s of plan.supports ?? []) if (s.kind === 'deck') {
    const inset = Math.min(2.5, Math.min(s.width, s.depth) / 2 - .5), x0 = s.minX + inset, x1 = s.maxX - inset, z0 = s.minZ + inset, z1 = s.maxZ - inset;
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => addNode({ x, y: s.y, z }, 'deck', { deck: s.id }));
    corners.forEach((c, i) => addEdge(c, corners[(i + 1) % 4], 'deck', { deck: s.id }));
    decks.push({ support: s, corners });
  }
  const nearestNode = (p, list, max, height = 1.5) => {
    let best = null, d = max;
    for (const n of list) { const gap = dist(n, p); if (gap < d && Math.abs(n.y - p.y) < height) { best = n; d = gap; } }
    return best;
  };
  for (const deck of decks) for (const other of decks) if (deck.support.id < other.support.id) {
    for (const c of deck.corners) { const n = nearestNode(c, other.corners, 14); if (n) addEdge(c, n, 'deck', { deck: deck.support.id }); }
  }
  const deckCorners = decks.flatMap(d => d.corners), streetNodes = walkNodes.filter(n => n.kind === 'sidewalk' || n.kind === 'corner');
  for (const s of plan.supports ?? []) if (s.pedestrian && s.a && s.b) {
    const bottom = addNode(s.a, 'ramp'), top = addNode(s.b, 'ramp');
    addEdge(bottom, top, 'ramp', { terrain: false });
    addEdge(top, nearestNode(top, deckCorners, 60), 'deck');
    addEdge(nearestNode(bottom, streetNodes, 40), bottom, 'link');
  }
  const grid = new SpatialGrid(walkEdges.map(edge => ({ minX: edge.path.minX, maxX: edge.path.maxX, minZ: edge.path.minZ, maxZ: edge.path.maxZ, edge })), 48);
  return {
    nodes: walkNodes, edges: walkEdges, adjacency, byId: new Map(walkNodes.map(n => [n.id, n])),
    edgesNear(x, z, radius) { return grid.query(x - radius, z - radius, x + radius, z + radius).map(e => e.edge); },
  };
}
