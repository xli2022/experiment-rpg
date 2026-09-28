import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMasterPlan, MASTER_DISTRICTS, SHOWCASE, TERRAIN_GRID, WATER_LEVEL,
  fromMap, fromReference, districtAt, terrainHeight, coastX, nearestOnSegment,
} from '../src/master-plan.js';
import { circleHitsBox, overlapsHeight, supportHeight, surfaceHeightAt } from '../src/physics.js';
import { VerticalMetropolis } from '../src/vertical-city.js';

const plan = createMasterPlan();

test('master map has thirteen named districts and a coherent 11 km coordinate system', () => {
  assert.equal(MASTER_DISTRICTS.length, 13);
  assert.equal(new Set(MASTER_DISTRICTS.map(d => d.id)).size, 13);
  assert.deepEqual({ x: MASTER_DISTRICTS[0].x, z: MASTER_DISTRICTS[0].z }, fromReference(458, 553));
  assert.deepEqual(fromMap(0, 0), { x: -5500, z: -5500 });
  assert.deepEqual(fromMap(11, 11), { x: 5500, z: 5500 });
  for (const district of MASTER_DISTRICTS) assert.equal(districtAt(district.x, district.z).id, district.id);
  assert.equal(plan.interchanges.length, 10);
  assert.equal(new Set(plan.interchanges.map(i => i.name)).size, 10);
});

test('terrain heights exactly interpolate the resident ground triangles and descend to Blackwater Bay', () => {
  const size = TERRAIN_GRID, x = 640, z = -1280;
  const a = terrainHeight(x, z), b = terrainHeight(x + size, z), c = terrainHeight(x, z + size), d = terrainHeight(x + size, z + size);
  assert.ok(Math.abs(terrainHeight(x + size * .2, z + size * .3) - (a + .2 * (b - a) + .3 * (c - a))) < 1e-10);
  assert.ok(Math.abs(terrainHeight(x + size * .8, z + size * .7) - (d + .2 * (c - d) + .3 * (b - d))) < 1e-10);
  assert.ok(terrainHeight(-4200, -4200) > terrainHeight(4000, 4200) + 60);
  for (let z = -5000; z <= 5000; z += 500) assert.ok(terrainHeight(coastX(z) + 150, z) < WATER_LEVEL);
});

test('roads retain finite heights, with dry streets and raised bridges over the bay', () => {
  // Covering all 11 km of the city needs more resident road metadata; visual
  // chunks still stream independently. Keep the expanded index bounded.
  assert.ok(plan.roadIndex.size < 25000);
  for (const road of plan.roads) {
    assert.ok(road.points.length >= 2, road.id);
    for (const point of road.points) {
      assert.ok([point.x, point.y, point.z].every(Number.isFinite), road.id);
      assert.ok(Math.abs(point.x) <= 5500.01 && Math.abs(point.z) <= 5500.01, road.id);
      assert.ok(terrainHeight(point.x, point.z) >= 0 || road.bridge && point.y > WATER_LEVEL + 5, `${road.id} enters water without a raised bridge`);
      if (road.level === 0) assert.ok(Math.abs(point.y - terrainHeight(point.x, point.z) - .07) < 1e-7, `${road.id} leaves its ground surface`);
    }
  }
});

test('every vehicle access ramp joins real road surfaces at both ends with driveable grades', () => {
  for (const ramp of plan.roads.filter(road => road.kind === 'ramp')) {
    for (const point of [ramp.points[0], ramp.points.at(-1)]) {
      const joins = plan.roadIndex.near(point.x, point.z, 1).filter(s => s.road !== ramp);
      assert.ok(joins.some(s => {
        const hit = nearestOnSegment(point.x, point.z, s.a, s.b);
        return hit.distance < .05 && Math.abs(hit.y - point.y) < .05;
      }), `${ramp.name} has an unconnected endpoint`);
    }
    for (let i = 1; i < ramp.points.length; i++) {
      const a = ramp.points[i - 1], b = ramp.points[i];
      assert.ok(Math.abs(b.y - a.y) / Math.hypot(b.x - a.x, b.z - a.z) < .12, `${ramp.name} has an abrupt grade`);
    }
  }
});

test('local streets meet real streets at both ends without artificial district circuits', () => {
  assert.equal(plan.roads.some(r => r.district && (r.closed || /perimeter|circuit/i.test(`${r.id} ${r.name}`))), false);
  let tJunctions = 0;
  for (const road of plan.roads.filter(r => r.class === 'local')) {
    for (const point of [road.points[0], road.points.at(-1)]) {
      const joins = plan.roadIndex.near(point.x, point.z, 1).filter(s => s.road !== road && nearestOnSegment(point.x, point.z, s.a, s.b).distance < .001);
      assert.ok(joins.length, `${road.id} has a loose street end`);
      if (joins.some(s => Math.hypot(point.x - s.road.points[0].x, point.z - s.road.points[0].z) > 40
        && Math.hypot(point.x - s.road.points.at(-1).x, point.z - s.road.points.at(-1).z) > 40)) tJunctions++;
    }
  }
  assert.ok(tJunctions > 100, 'partial cross-streets should create real T-junctions instead of a complete repeated grid');
});

test('neighborhood streets vary their block rhythm and continue into the surrounding network', () => {
  for (const district of MASTER_DISTRICTS) {
    const roads = plan.roads.filter(r => r.district === district.id), lengths = roads.map(r => r.points.slice(1).reduce((total, p, i) => total + Math.hypot(p.x - r.points[i].x, p.z - r.points[i].z), 0));
    assert.ok(roads.length >= 8, `${district.id} needs a usable street fabric`);
    assert.ok(Math.max(...lengths) / Math.min(...lengths) > 2, `${district.id} repeats equal-length streets`);
    const outward = roads.filter(r => [r.points[0], r.points.at(-1)].some(p => plan.roadIndex.near(p.x, p.z, 1)
      .some(s => s.road !== r && s.road.district !== district.id && nearestOnSegment(p.x, p.z, s.a, s.b).distance < .001)));
    assert.ok(outward.length >= 2, `${district.id} should continue onto surrounding streets in more than one place`);
  }
  for (const id of ['north-ridge', 'ember-heights', 'shadowmarket', 'cut']) {
    const bends = plan.roads.filter(r => r.district === id).map(r => {
      const a = r.points[0], b = r.points.at(-1);
      return Math.max(...r.points.map(p => nearestOnSegment(p.x, p.z, a, b).distance));
    });
    assert.ok(Math.max(...bends) > 30, `${id} should follow its hills with visibly bent local streets`);
  }
});

function landStreetCoverage() {
  const ground = new Set([...new Set([...plan.roadIndex.cells.values()].flat())].filter(s =>
    [s.a, s.b].every(p => p.y - terrainHeight(p.x, p.z) < .3)));
  const cells = new Map(), samples = [];
  const cellAt = (x, z) => {
    const key = `${Math.floor((x + 5500) / 1000)},${Math.floor((z + 5500) / 1000)}`;
    if (!cells.has(key)) cells.set(key, { key, samples: 0, length: 0 });
    return cells.get(key);
  };
  // Sample beyond district centres, including the former empty outer strips.
  // A 150 m map margin and the sloping 90 m shoreline are not urban blocks.
  for (let z = -5350; z <= 5350; z += 100) for (let x = -5350; x <= 5350; x += 100) {
    if (x > coastX(z) - 90 || terrainHeight(x, z) < 0) continue;
    let distance = Infinity;
    for (const s of plan.roadIndex.near(x, z, 450)) if (ground.has(s)) {
      distance = Math.min(distance, nearestOnSegment(x, z, s.a, s.b).distance);
    }
    samples.push({ x, z, distance });
    cellAt(x, z).samples++;
  }
  // Clip each segment at kilometre-cell boundaries so a road on a boundary
  // cannot make its neighbour look empty through midpoint-only assignment.
  for (const s of ground) {
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, length = Math.hypot(dx, dz), splits = [0, 1];
    for (const [a, b, delta] of [[s.a.x, s.b.x, dx], [s.a.z, s.b.z, dz]]) {
      if (Math.abs(delta) < 1e-8) continue;
      const first = Math.floor((Math.min(a, b) + 5500) / 1000) + 1;
      for (let line = first * 1000 - 5500; line < Math.max(a, b); line += 1000) splits.push((line - a) / delta);
    }
    splits.sort((a, b) => a - b);
    for (let i = 1; i < splits.length; i++) {
      const t = (splits[i - 1] + splits[i]) / 2;
      cellAt(s.a.x + dx * t, s.a.z + dz * t).length += length * (splits[i] - splits[i - 1]);
    }
  }
  return { samples, cells: [...cells.values()].filter(c => c.samples >= 75) };
}

const landCoverage = landStreetCoverage();

test('ground streets cover usable land without the old kilometre-wide gaps', () => {
  const samples = landCoverage.samples;
  assert.ok(samples.length > 10000, 'audit the whole land area, not only district centres');
  const covered = samples.filter(p => p.distance <= 250).length / samples.length;
  assert.ok(covered >= .95, `only ${(covered * 100).toFixed(1)}% of usable land is within 250 m of a ground street`);
  const gaps = samples.filter(p => p.distance > 450);
  assert.equal(gaps.length, 0, `land still has a large road gap near ${gaps[0]?.x},${gaps[0]?.z}`);
});

test('kilometre-scale road density stays balanced while allowing different neighborhood patterns', () => {
  const densities = landCoverage.cells.map(c => c.length / (c.samples * 10000) * 1000).sort((a, b) => a - b);
  assert.ok(densities.length >= 100, 'compare every predominantly land cell across the city');
  const mean = densities.reduce((sum, density) => sum + density, 0) / densities.length;
  const variation = Math.sqrt(densities.reduce((sum, density) => sum + (density - mean) ** 2, 0) / densities.length) / mean;
  assert.ok(variation < .35, `road density varies too much between city cells (${variation.toFixed(3)})`);
  assert.ok(densities[Math.floor(densities.length * .1)] >= 2.5, 'sparsest neighborhoods need a connected local street fabric');
});

test('infill cross streets divide long strips into walkable blocks at real ground-level junctions', () => {
  const roads = plan.roads.filter(r => r.id.includes('-infill-')), spans = [];
  for (const road of roads) {
    const cuts = [0], pieces = [];
    let total = 0;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
      pieces.push({ a, b, start: total, length });
      for (const other of plan.roadIndex.query(Math.min(a.x, b.x) - .01, Math.min(a.z, b.z) - .01, Math.max(a.x, b.x) + .01, Math.max(a.z, b.z) + .01)) {
        if (other.road === road) continue;
        const join = crossing(a, b, other.a, other.b);
        if (join?.gap < .1) cuts.push(total + join.t * length);
        // Endpoint projections also include T-junctions landing on a sampled
        // segment boundary. Elevated crossings do not shorten a city block.
        for (const point of [other.a, other.b]) {
          const hit = nearestOnSegment(point.x, point.z, a, b);
          if (hit.distance < .01 && Math.abs(hit.y - point.y) < .1) cuts.push(total + hit.t * length);
        }
      }
      total += length;
    }
    cuts.push(total); cuts.sort((a, b) => a - b);
    const unique = cuts.filter((cut, i) => !i || cut - cuts[i - 1] > .05);
    for (let i = 1; i < unique.length; i++) {
      const length = unique[i] - unique[i - 1], middle = (unique[i] + unique[i - 1]) / 2;
      const piece = pieces.find(p => p.start + p.length >= middle), t = (middle - piece.start) / piece.length;
      const x = piece.a.x + (piece.b.x - piece.a.x) * t, z = piece.a.z + (piece.b.z - piece.a.z) * t;
      // Streets returning along the map boundary have no outboard blocks to
      // subdivide. Keep those bends bounded while limiting interior block size.
      const boundary = Math.abs(x) > 5200 || Math.abs(z) > 5200;
      assert.ok(length <= (boundary ? 1200 : 650), `${road.id} has an uninterrupted ${length.toFixed(0)} m block near ${x},${z}`);
      spans.push(length);
    }
  }
  assert.ok(spans.length > roads.length * 2, 'connecting streets should have internal junctions, not only end connections');
  assert.ok(spans.filter(length => length <= 500).length / spans.length >= .95, 'at least 95% of new blocks should have a crossing within 500 m');
});

test('neighboring fabrics and their continuations do not form narrow duplicate parallel streets', () => {
  let checked = 0;
  const segments = new Set([...plan.roadIndex.cells.values()].flat());
  for (const segment of segments) {
    if (!segment.road.district) continue;
    const dx = segment.b.x - segment.a.x, dz = segment.b.z - segment.a.z, length = Math.hypot(dx, dz);
    const x = (segment.a.x + segment.b.x) / 2, z = (segment.a.z + segment.b.z) / 2, y = (segment.a.y + segment.b.y) / 2;
    for (const neighbor of plan.roadIndex.near(x, z, 250)) {
      if (neighbor.road === segment.road || neighbor.road.kind === 'ramp') continue;
      const nx = neighbor.b.x - neighbor.a.x, nz = neighbor.b.z - neighbor.a.z;
      if (Math.abs(dx * nx + dz * nz) / (length * Math.hypot(nx, nz)) < .98) continue;
      const hit = nearestOnSegment(x, z, neighbor.a, neighbor.b);
      // End-to-end continuations and grade-separated crossings are legitimate;
      // close side-by-side street sections consume a whole block's frontage.
      if (hit.t <= .05 || hit.t >= .95 || Math.abs(hit.y - y) > .5) continue;
      checked++;
      assert.ok(hit.distance >= 55, `${segment.road.id} crowds ${neighbor.road.id} at ${x}, ${z}`);
    }
  }
  assert.ok(checked > 0, 'inspect actual nearby parallel streets');
});

test('ground vehicles can pass beneath Eastpoint while its upper deck remains independently walkable', () => {
  const { x, z } = SHOWCASE, base = terrainHeight(x, z);
  assert.ok(Math.abs(plan.surfaceHeight(x, z, base + .5) - (base + .07)) < .03);
  assert.ok(Math.abs(plan.surfaceHeight(x, z) - (base + 25.07)) < .03);
  const deck = plan.supports.find(s => s.id === 'eastpoint-concourse');
  assert.ok(plan.surfaceHeight(deck.x, deck.z, deck.y - 1) < deck.y - 7);
  assert.equal(plan.surfaceHeight(deck.x, deck.z, deck.y + .1), deck.y);
  const start = plan.spawn;
  assert.ok(plan.surfaceHeight(start.x, start.z) < terrainHeight(start.x, start.z) + .2, 'spawn should stand beside the upper concourse');
});

test('pedestrian ramps connect terrain to usable decks and reserve clear building footprints', () => {
  for (const ramp of plan.supports.filter(s => s.pedestrian)) {
    assert.ok(Math.abs(ramp.a.y - terrainHeight(ramp.a.x, ramp.a.z) - .07) < 1e-7);
    assert.ok(Math.abs(ramp.b.y - ramp.a.y) / Math.hypot(ramp.b.x - ramp.a.x, ramp.b.z - ramp.a.z) < .19);
    assert.ok(plan.supports.some(deck => deck.kind === 'deck' && ramp.b.x >= deck.minX && ramp.b.x <= deck.maxX && ramp.b.z >= deck.minZ && ramp.b.z <= deck.maxZ && Math.abs(ramp.b.y - deck.y) < 1e-7));
    assert.ok(plan.reserveBox({ minX: ramp.b.x - 2, maxX: ramp.b.x + 2, minZ: ramp.b.z - 2, maxZ: ramp.b.z + 2 }));
  }
  const nearest = plan.nearestSurfacePoint(SHOWCASE.x, SHOWCASE.z, 60);
  assert.ok(nearest && nearest.y < terrainHeight(nearest.x, nearest.z) + .3, 'content placement should select the lower street');
});

function crossing(a, b, c, d) {
  const dx = b.x - a.x, dz = b.z - a.z, ex = d.x - c.x, ez = d.z - c.z, determinant = dx * ez - dz * ex;
  if (Math.abs(determinant) < 1e-6) return null;
  const cx = c.x - a.x, cz = c.z - a.z, t = (cx * ez - cz * ex) / determinant, u = (cx * dz - cz * dx) / determinant;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { gap: Math.abs(a.y + (b.y - a.y) * t - c.y - (d.y - c.y) * u), t };
}

test('every local, arterial and elevated road belongs to one network through joins at matching heights', () => {
  const ids = new Map(plan.roads.map((road, i) => [road, i])), parents = plan.roads.map((_, i) => i);
  const root = i => parents[i] === i ? i : (parents[i] = root(parents[i]));
  for (const road of plan.roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], half = road.width / 2;
    const neighbors = plan.roadIndex.query(Math.min(a.x, b.x) - half, Math.min(a.z, b.z) - half, Math.max(a.x, b.x) + half, Math.max(a.z, b.z) + half);
    for (const segment of neighbors) {
      const here = root(ids.get(road)), there = root(ids.get(segment.road));
      if (here === there) continue;
      let connected = (crossing(a, b, segment.a, segment.b)?.gap ?? Infinity) < .25;
      if (!connected) for (const [p, q, r] of [[a, segment.a, segment.b], [b, segment.a, segment.b], [segment.a, a, b], [segment.b, a, b]]) {
        const hit = nearestOnSegment(p.x, p.z, q, r);
        if (hit.distance < half + segment.width / 2 - 2 && Math.abs(hit.y - p.y) < .25) connected = true;
      }
      if (connected) parents[here] = there;
    }
  }
  assert.equal(new Set(plan.roads.map((_, i) => root(i))).size, 1, 'a route should not be isolated above the connected ground network');
});

test('ground intersections agree in height without a kerb-sized discontinuity', () => {
  let checked = 0;
  for (const road of plan.roads.filter(r => r.level === 0)) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i];
    for (const s of plan.roadIndex.query(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z))) {
      if (s.road === road || s.road.level !== 0) continue;
      const join = crossing(a, b, s.a, s.b);
      if (!join) continue;
      checked++;
      assert.ok(join.gap < .05, `${road.id}/${s.road.id} steps by ${join.gap} m`);
    }
  }
  assert.ok(checked > 1500);
});

test('the runtime support query climbs every pedestrian ramp continuously onto its deck', () => {
  for (const ramp of plan.supports.filter(s => s.pedestrian)) {
    let y = ramp.a.y;
    const dx = ramp.b.x - ramp.a.x, dz = ramp.b.z - ramp.a.z, length = Math.hypot(dx, dz), steps = Math.ceil(length / .4);
    for (let i = 0; i <= steps + 3; i++) {
      const t = Math.min(1 + .8 / length, i / steps), x = ramp.a.x + dx * t, z = ramp.a.z + dz * t;
      const boxes = plan.roadIndex.near(x, z, 2).concat(plan.supportIndex.near(x, z, 2));
      const next = supportHeight(x, z, boxes, y + .35, terrainHeight(x, z));
      assert.ok(next >= y - .08 && next <= y + .35, `${ramp.id} loses continuous support at ${i}/${steps}`);
      y = next;
    }
    assert.ok(Math.abs(y - ramp.b.y) < .01, `${ramp.id} failed to reach the deck`);
  }
});

test('road crossfall keeps every road edge above the hills instead of intersecting the ground', () => {
  const seen = new Set();
  for (const cell of plan.roadIndex.cells.values()) for (const s of cell) {
    if (seen.has(s)) continue;
    seen.add(s);
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, length = Math.hypot(dx, dz);
    for (const t of [0, .5, 1]) for (const side of [-1, 1]) {
      const across = s.width / 2 * side;
      const x = s.a.x + dx * t - dz / length * across, z = s.a.z + dz * t + dx / length * across;
      const y = s.a.y + (s.b.y - s.a.y) * t + s.crossSlope * across;
      assert.ok(y - terrainHeight(x, z) > .04, `${s.id} road edge intersects the hillside`);
    }
  }
});

test('access ramps are clear of generated buildings, guardrails, planters and bridge piers', () => {
  const city = new VerticalMetropolis(plan);
  const ramps = [...plan.roads.filter(r => r.kind === 'ramp'), ...plan.supports.filter(s => s.pedestrian)];
  for (const ramp of ramps) {
    const points = ramp.points ?? [ramp.a, ramp.b], radius = ramp.pedestrian ? .43 : 1.6;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], count = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
      for (let step = 0; step <= count; step++) {
        const t = step / count, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
        const collision = city.collidersIn(x - 3, z - 3, x + 3, z + 3).find(box => !box.supportOnly && overlapsHeight(box, y) && circleHitsBox(x, z, radius, box));
        assert.equal(collision, undefined, `${ramp.id} is blocked by ${collision?.kind ?? collision?.id} at ${x},${z}`);
      }
    }
  }
});

test('outside traffic lanes retain continuous road support across every angled segment joint', () => {
  let checked = 0;
  for (const road of plan.roads) {
    const last = road.points.length - 1;
    for (let i = road.closed ? 0 : 1; i < last; i++) {
      const a = road.points[i === 0 ? last - 1 : i - 1], p = road.points[i], b = road.points[i + 1];
      const al = Math.hypot(p.x - a.x, p.z - a.z), bl = Math.hypot(b.x - p.x, b.z - p.z);
      const tx = (p.x - a.x) / al + (b.x - p.x) / bl, tz = (p.z - a.z) / al + (b.z - p.z) / bl;
      const length = Math.hypot(tx, tz);
      assert.ok(length > .5, `${road.id} reverses direction at joint ${i}`);
      const nx = tz / length, nz = -tx / length, offset = road.width / 2 - 1.6;
      for (const side of [-1, 1]) for (const advance of [-.05, 0, .05]) {
        const x = p.x + nx * offset * side + tx / length * advance, z = p.z + nz * offset * side + tz / length * advance;
        const surfaces = plan.roadIndex.near(x, z, 1).filter(s => s.road === road);
        assert.ok(surfaces.some(s => {
          const y = surfaceHeightAt(x, z, s);
          return y !== null && Math.abs(y - p.y) < .6;
        }), `${road.id} loses its outside lane at joint ${i}, side ${side}, advance ${advance}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 50000, 'sample the outside lane on both sides of every road joint');
  const unique = new Set([...plan.roadIndex.cells.values()].flat());
  assert.ok([...unique].every(s => s.supportOverlap >= .14 && s.supportOverlap < 4), 'slab miters must remain small and local');
});

test('main corridors avoid duplicate parallel stretches while allowing the PNG shared junctions', () => {
  const main = road => road.width >= 21 || ['primary', 'expressway'].includes(road.class);
  const segments = new Set([...plan.roadIndex.cells.values()].flat()), alignment = Math.cos(20 * Math.PI / 180);
  const sharedNodes = new Map();
  const mainRoads = plan.roads.filter(main);
  for (const a of mainRoads) for (const b of mainRoads) {
    if (a.id >= b.id) continue;
    sharedNodes.set(`${a.id}/${b.id}`, a.points.filter(p => b.points.some(q => Math.hypot(p.x - q.x, p.z - q.z) < .01)));
  }
  let checked = 0;
  for (const s of segments) {
    if (!main(s.road)) continue;
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, length = Math.hypot(dx, dz);
    for (const t of [0, .5, 1]) {
      const x = s.a.x + dx * t, z = s.a.z + dz * t;
      for (const other of plan.roadIndex.near(x, z, 500)) {
        if (!main(other.road) || s.road.id >= other.road.id) continue;
        const ox = other.b.x - other.a.x, oz = other.b.z - other.a.z;
        if (Math.abs(dx * ox + dz * oz) / (length * Math.hypot(ox, oz)) < alignment) continue;
        const gap = nearestOnSegment(x, z, other.a, other.b).distance;
        const joins = sharedNodes.get(`${s.road.id}/${other.road.id}`) ?? [];
        if (joins.some(p => Math.hypot(p.x - x, p.z - z) < 400)) continue;
        assert.ok(gap >= 300, `${s.road.name} crowds ${other.road.name} at ${Math.round(x)},${Math.round(z)} (${gap.toFixed(1)} m)`);
        checked++;
      }
    }
  }
  assert.ok(checked > 0, 'the spacing audit must compare real neighboring main corridors');
  assert.equal(plan.roads.some(road => road.id === 'core-flyover'), false, 'Core Nexus should not duplicate Neon Spine');
});

test('the PNG road silhouette and all ten numbered interchanges share one reference transform', () => {
  assert.deepEqual(fromReference(45, 135), { x: -5500, z: -5500 });
  assert.deepEqual(fromReference(997, 1115), { x: 5500, z: 5500 });
  const mainIds = ['ring', 'meridian', 'neon-spine', 'north-freightway', 'north-gate-link', 'south-bypass', 'western-north', 'western-arterial'];
  for (const id of mainIds) {
    const road = plan.roads.find(r => r.id === id);
    assert.ok(road.reference.length >= 2);
    for (const p of road.reference) {
      const target = fromReference(p.px, p.py);
      assert.ok(road.points.some(q => Math.hypot(target.x - q.x, target.z - q.z) < .001), `${id} misses its traced control point`);
    }
  }
  const pins = [[306, 410], [98, 228], [607, 281], [715, 210], [278, 627], [445, 630], [762, 645], [634, 640], [218, 1042], [762, 1044]];
  for (const [index, pin] of pins.entries()) {
    const target = fromReference(...pin), junction = plan.interchanges[index];
    assert.ok(Math.hypot(target.x - junction.x, target.z - junction.z) < .001, `interchange ${index + 1} drifts from its reference pin`);
  }
  const westernSouth = plan.roads.find(r => r.id === 'western-arterial'), sharedExit = fromReference(358, 745);
  assert.ok(Math.hypot(westernSouth.points[0].x - sharedExit.x, westernSouth.points[0].z - sharedExit.z) < .001);
  assert.equal(plan.interchanges[4].name, 'West Spire');
  assert.ok(Math.hypot(SHOWCASE.x - fromReference(762, 645).x, SHOWCASE.z - fromReference(762, 645).z) < .001);
});
