import { addCityInfill } from './infill-plan.js';

// Local streets grow out of existing avenues. Their uneven blocks and partial
// cross-streets describe different settlement patterns without drawing a road
// around an abstract district boundary.
const FABRICS = {
  core: { x: [-.96, -.77, -.54, -.3, -.06, .17, .42, .68, .94], z: [-.91, -.71, -.48, -.25, -.04, .2, .44, .69, .93], angle: .025, bend: 22, seed: 3 },
  citadel: { x: [-.96, -.62, -.22, .17, .54, .96], z: [-.95, -.59, -.18, .23, .59, .95], angle: -.025, bend: 8, seed: 7 },
  'east-reach': { x: [-.96, -.46, .05, .57, .98], z: [-.97, -.69, -.34, .06, .38, .66, .94], angle: 0, bend: 18, seed: 11, coast: true },
  'void-port': { x: [-.94, -.52, -.06, .46, .94], z: [-.94, -.66, -.29, .14, .51, .95], angle: -.035, bend: 12, seed: 17, coast: true },
  stacks: { x: [-.94, -.71, -.49, -.25, -.03, .22, .46, .7, .96], z: [-.94, -.69, -.4, -.12, .15, .41, .69, .94], angle: -.035, bend: 44, seed: 23 },
  'north-ridge': { x: [-.97, -.74, -.48, -.23, .03, .26, .5, .74, .96], z: [-.93, -.62, -.29, .05, .35, .65, .96], angle: -.16, bend: 135, seed: 29 },
  'ember-heights': { x: [-.93, -.68, -.39, -.12, .18, .43, .69, .93], z: [-.96, -.69, -.4, -.12, .14, .41, .69, .95], angle: .1, bend: 125, seed: 31 },
  'west-end': { x: [-.95, -.56, -.14, .24, .61, .96], z: [-.95, -.64, -.23, .09, .48, .94], angle: .025, bend: 36, seed: 37 },
  shadowmarket: { x: [-.96, -.75, -.54, -.33, -.12, .1, .3, .53, .75, .96], z: [-.94, -.7, -.45, -.22, .01, .24, .49, .71, .93], angle: -.17, bend: 115, seed: 41 },
  cut: { x: [-.96, -.73, -.49, -.23, .02, .25, .49, .72, .96], z: [-.93, -.67, -.39, -.13, .14, .41, .67, .93], angle: -.12, bend: 150, seed: 43 },
  southward: { x: [-.95, -.61, -.24, .19, .58, .95], z: [-.95, -.68, -.29, .11, .48, .93], angle: .055, bend: 31, seed: 47 },
  foundry: { x: [-.94, -.51, -.06, .41, .95], z: [-.96, -.66, -.26, .19, .58, .95], angle: -.035, bend: 9, seed: 53 },
  'silver-delta': { x: [-.96, -.48, .04, .56, .97], z: [-.95, -.6, -.25, .16, .55, .95], angle: .035, bend: 16, seed: 59, coast: true },
};

const hash = (x, z, seed) => {
  let n = Math.imul(x + 17, 374761393) ^ Math.imul(z + 31, 668265263) ^ Math.imul(seed, 1274126177);
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
};

function touchesBox(a, b, box, pad = 12) {
  let lo = 0, hi = 1;
  for (const key of ['x', 'z']) {
    const delta = b[key] - a[key], min = box[`min${key.toUpperCase()}`] - pad, max = box[`max${key.toUpperCase()}`] + pad;
    if (Math.abs(delta) < 1e-8) { if (a[key] < min || a[key] > max) return false; continue; }
    const p = (min - a[key]) / delta, q = (max - a[key]) / delta;
    lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q));
    if (lo > hi) return false;
  }
  return true;
}

export function addNeighborhoodStreets({ districts, roads, addRoad, coastX, terrainHeight, nearestOnSegment, showcase }) {
  const feeds = roads.flatMap(road => road.points.slice(1).map((b, i) => ({ a: road.points[i], b, road })))
    .filter(s => [s.a, s.b].every(p => p.y - terrainHeight(p.x, p.z) < .3));
  const spacingSources = [...feeds];
  // Keep the existing public decks, their access ramps and the opening scene
  // clear. These are public squares within the street fabric, not street plots.
  const reserved = [
    { minX: 1118, maxX: 1368, minZ: -1074, maxZ: -925 },
    { minX: -468, maxX: -313, minZ: -3784, maxZ: -3618 },
    { minX: showcase.x - 99, maxX: showcase.x + 96, minZ: showcase.z + 21, maxZ: showcase.z + 193 },
  ];
  const clear = (a, b) => {
    if (reserved.some(box => touchesBox(a, b, box))) return false;
    const length = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.ceil(length / 40);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      if (Math.abs(x) > 5460 || Math.abs(z) > 5460 || x > coastX(z) - 65) return false;
    }
    return true;
  };
  const closestFeed = p => {
    let best;
    for (const s of feeds) {
      const hit = nearestOnSegment(p.x, p.z, s.a, s.b);
      if (!best || hit.distance < best.distance) best = { ...hit, road: s.road };
    }
    return best;
  };
  const crowdsStreet = (a, b, sources) => {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(length / 35));
    for (const s of sources) {
      const ex = s.b.x - s.a.x, ez = s.b.z - s.a.z;
      if (Math.abs(dx * ex + dz * ez) / (length * Math.hypot(ex, ez)) < .94) continue;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const hit = nearestOnSegment(a.x + dx * t, a.z + dz * t, s.a, s.b);
        // Adjoining collinear sections are one continuous street; a projected
        // point inside another section exposes an actual parallel overlap.
        if (hit.t > .01 && hit.t < .99 && hit.distance < 76) return true;
      }
    }
    return false;
  };
  const intersection = (a, b, c, d) => {
    const dx = b.x - a.x, dz = b.z - a.z, ex = d.x - c.x, ez = d.z - c.z, determinant = dx * ez - dz * ex;
    if (Math.abs(determinant) < 1e-8) return null;
    const cx = c.x - a.x, cz = c.z - a.z, t = (cx * ez - cz * ex) / determinant, u = (cx * dz - cz * dx) / determinant;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + dx * t, z: a.z + dz * t, elevation: 0, t } : null;
  };

  for (const district of districts) {
    const fabric = FABRICS[district.id], cols = fabric.x.length, rows = fabric.z.length;
    const depth = Math.min(district.radiusZ * .98, 1140), width = Math.min(district.radiusX * 1.02, 1280);
    const coastalWidth = Math.min(width, ...fabric.z.map(v => coastX(district.z + v * depth) - district.x - 90));
    const cos = Math.cos(fabric.angle), sin = Math.sin(fabric.angle);
    const nodes = [];
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const u = fabric.x[col], v = fabric.z[row];
      const x = u * coastalWidth + fabric.bend * Math.sin(v * 2.1 + .4) + (hash(col, row, fabric.seed) - .5) * fabric.bend * .35;
      const z = v * depth + fabric.bend * Math.sin(u * 1.8 - .3) * .65;
      // Waterfront streets follow the quay in shallow bends instead of cutting
      // across the bay or forcing a circular coastal district boundary.
      const shore = fabric.coast ? (coastX(district.z + v * depth) - coastX(district.z)) * .5 : 0;
      nodes.push({ x: district.x + x * cos - z * sin + shore, z: district.z + x * sin + z * cos, elevation: 0, col, row, edges: [] });
    }
    const edges = [];
    for (const a of nodes) for (const axis of [0, 1]) {
      const col = a.col + (axis === 0 ? 1 : 0), row = a.row + (axis === 1 ? 1 : 0);
      if (col >= cols || row >= rows) continue;
      const b = nodes[row * cols + col];
      const boundary = axis === 0 ? a.row === 0 || a.row === rows - 1 : a.col === 0 || a.col === cols - 1;
      // Break the boundary first: the city has no peripheral circuit around
      // every neighborhood. Interior omissions create staggered T-junctions.
      if (hash(a.col, a.row, fabric.seed + axis * 97) < (boundary ? .47 : .17)) continue;
      if (!clear(a, b) || crowdsStreet(a, b, spacingSources)) continue;
      const edge = { a, b, axis, active: true };
      edges.push(edge); a.edges.push(edge); b.edges.push(edge);
    }
    // A trimmed grid edge is never left hanging in empty ground. Prune loose
    // tails, leaving walkable blocks connected by streets at both ends.
    const pending = nodes.filter(n => n.edges.length < 2);
    while (pending.length) {
      const node = pending.pop();
      for (const edge of node.edges.filter(e => e.active)) {
        edge.active = false;
        const other = edge.a === node ? edge.b : edge.a;
        if (other.edges.filter(e => e.active).length < 2) pending.push(other);
      }
    }
    const components = [], seen = new Set();
    for (const start of nodes) {
      if (seen.has(start) || !start.edges.some(e => e.active)) continue;
      const group = [], queue = [start]; seen.add(start);
      while (queue.length) {
        const n = queue.pop(); group.push(n);
        for (const e of n.edges.filter(e => e.active)) {
          const next = e.a === n ? e.b : e.a;
          if (!seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      components.push(group);
    }
    for (const [componentIndex, group] of components.entries()) {
      if (group.some(n => n.edges.some(e => e.active && feeds.some(s => intersection(e.a, e.b, s.a, s.b))))) continue;
      const candidates = group.map(node => ({ node, hit: closestFeed(node) }))
        .filter(({ node, hit }) => hit && clear(node, hit)).sort((a, b) => a.hit.distance - b.hit.distance);
      // A district island without an unobstructed avenue connection is left as
      // undeveloped land, rather than emitting disconnected local roads.
      if (!candidates.length) { for (const n of group) for (const e of n.edges) e.active = false; continue; }
      const links = [candidates[0]];
      const second = candidates.find(c => Math.hypot(c.node.x - links[0].node.x, c.node.z - links[0].node.z) > 420 && c.hit.distance < 700);
      if (second) links.push(second);
      for (const [index, { node, hit }] of links.entries()) {
        if (hit.distance < .5) continue;
        addRoad(`${district.id}-approach-${componentIndex}-${index}`, `${district.name} Approach`, [node, hit], 12, 'local', { curved: false, district: district.id });
      }
    }
    // Join consecutive edges into single streets, retaining every shared node
    // as a control point so neighboring streets meet at exactly the same place.
    for (const axis of [0, 1]) {
      const lines = axis === 0 ? rows : cols;
      for (let line = 0; line < lines; line++) {
        const ordered = edges.filter(e => e.active && e.axis === axis && (axis === 0 ? e.a.row : e.a.col) === line)
          .sort((a, b) => (axis === 0 ? a.a.col - b.a.col : a.a.row - b.a.row));
        let controls = [], run = 0;
        const flush = () => {
          if (controls.length < 2) return;
          addRoad(`${district.id}-${axis ? 'lane' : 'street'}-${line}-${run++}`, `${district.name} ${axis ? 'Lane' : 'Street'} ${line + 1}`,
            controls, axis ? 10 : 12, 'local', { curved: false, district: district.id });
          controls = [];
        };
        for (const edge of ordered) {
          if (controls.length && controls.at(-1) !== edge.a) flush();
          if (!controls.length) controls.push(edge.a);
          controls.push(edge.b);
        }
        flush();
      }
    }
    for (const road of roads.filter(r => r.district === district.id)) for (let i = 1; i < road.points.length; i++) {
      spacingSources.push({ a: road.points[i - 1], b: road.points[i], road });
    }
  }

  // Continue selected streets beyond a district's initial blocks to a real
  // neighboring street or avenue. These are ordinary street extensions, not
  // spokes running from a district centre to an artificial perimeter.
  const surfaceSegments = roads.filter(r => r.level === 0 || r.class === 'primary')
    .flatMap(road => road.points.slice(1).map((b, i) => ({ a: road.points[i], b, road })))
    .filter(s => [s.a, s.b].every(p => p.y - terrainHeight(p.x, p.z) < .3));
  for (const district of districts) {
    const candidates = [];
    for (const road of roads.filter(r => r.district === district.id)) for (const end of [0, 1]) {
      const p = end ? road.points.at(-1) : road.points[0], q = end ? road.points.at(-2) : road.points[1];
      const length = Math.hypot(p.x - q.x, p.z - q.z), dx = (p.x - q.x) / length, dz = (p.z - q.z) / length;
      const far = { x: p.x + dx * 1750, z: p.z + dz * 1750 };
      let best;
      for (const s of surfaceSegments) {
        if (s.road === road) continue;
        const hit = intersection(p, far, s.a, s.b);
        if (!hit || hit.t < .004) continue;
        if (!best || hit.t < best.hit.t) best = { hit, target: s.road };
      }
      if (!best || best.target.district === district.id || best.hit.t < .055 || !clear(p, best.hit)) continue;
      candidates.push({ start: p, ...best, distance: best.hit.t * 1750 });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const chosen = [];
    for (const candidate of candidates) {
      if (crowdsStreet(candidate.start, candidate.hit, surfaceSegments)) continue;
      if (chosen.some(c => Math.hypot(c.start.x - candidate.start.x, c.start.z - candidate.start.z) < 430)) continue;
      if (chosen.length < 2 && chosen.some(c => c.target.id === candidate.target.id)) continue;
      const street = addRoad(`${district.id}-continuation-${chosen.length}`, `${district.name} Link`, [candidate.start, candidate.hit], 12, 'local', { curved: false, district: district.id });
      for (let i = 1; i < street.points.length; i++) surfaceSegments.push({ a: street.points[i - 1], b: street.points[i], road: street });
      chosen.push(candidate);
      if (chosen.length === 3) break;
    }
  }
  // The opening scene is already served by its authored frontage streets. Keep
  // its tower group as well as the concourse clear of later infill connections.
  const openingBlock = { minX: showcase.x - 250, maxX: showcase.x + 140, minZ: showcase.z - 88, maxZ: showcase.z + 200 };
  const infillClear = (a, b) => {
    if (!clear(a, b) || touchesBox(a, b, openingBlock)) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 32));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      // Leave room for the 64 m ground triangles above the sloped quay edge.
      if (x > coastX(z) - 135) return false;
    }
    return true;
  };
  addCityInfill({ districts, fabrics: FABRICS, roads, addRoad, terrainHeight, nearestOnSegment, clear: infillClear });
}
