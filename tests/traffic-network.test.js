import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, samplePath, laneLayout, HEADROOM } from '../src/traffic/network.js';
import { signalPlan, signalState, walkState, SIGNAL_TIMING } from '../src/traffic/signals.js';
import { createMasterPlan, nearestOnSegment } from '../src/world/master-plan.js';
import { roadSlabDepth, SUPPORT_SLAB_DEPTH } from '../src/world/infrastructure-clearance.js';
import { ROAD_SHOULDER } from '../src/world/world-scale.js';
import { SpatialGrid } from '../src/core/spatial-grid.js';
import { gridPlan, streetPlan } from './helpers/street-grid.js';

const plan = createMasterPlan(), network = buildNetwork(plan);
const near = (a, b, tolerance = 1e-6) => Math.hypot(a.x - b.x, a.z - b.z) < tolerance && Math.abs(a.y - b.y) < tolerance;

test('the city road network builds junctions, lanes and walkways quickly and deterministically', () => {
  // About 200 ms on its own. The best of three builds, with a generous ceiling,
  // keeps this a regression guard rather than a measure of a busy machine.
  let fastest = Infinity;
  for (let i = 0; i < 3; i++) { const started = performance.now(); buildNetwork(plan); fastest = Math.min(fastest, performance.now() - started); }
  assert.ok(fastest < 2500, `network build took ${fastest.toFixed(0)} ms`);
  const junctions = network.nodes.filter(n => n.kind === 'junction');
  assert.ok(junctions.length > 1000 && network.nodes.filter(n => n.signalized).length > 400);
  assert.ok(network.nodes.some(n => n.kind === 'junction' && !n.signalized && n.ground), 'quiet T-junctions are give-way, not signalized');
  assert.ok(network.edges.every(e => e.from.approaches.includes(e.fromApproach) && e.to.approaches.includes(e.toApproach)));
  assert.ok(network.walk.edges.some(e => e.kind === 'crossing') && network.walk.edges.some(e => e.kind === 'deck') && network.walk.edges.some(e => e.kind === 'ramp'));
  const again = buildNetwork(plan);
  assert.deepEqual(again.nodes.map(n => [n.id, n.kind, n.signalized, n.approaches.length]), network.nodes.map(n => [n.id, n.kind, n.signalized, n.approaches.length]));
  assert.equal(laneLayout(6).length, 1); assert.ok(Math.abs(laneLayout(6)[0] - 1.5) < 1e-9, 'a narrow street keeps cars in the middle of their half');
  assert.deepEqual(laneLayout(20), [1.75, 5.25], 'wide roads carry two lanes each way');
});

test('junctions only join roads at the same grade', () => {
  for (const node of network.nodes) {
    const ends = node.approaches.map(a => a.edge.line[a.end === 'from' ? 0 : a.edge.line.length - 1].y);
    for (const [i, a] of node.approaches.entries()) assert.ok(Math.abs(ends[i] - node.y) < 1, `${node.id} joins ${a.edge.road.id} across levels`);
    // A raised road coming down to a street meets it without a step higher than a kerb.
    if (ends.length) assert.ok(Math.max(...ends) - Math.min(...ends) <= .3, `${node.id} has a ${(Math.max(...ends) - Math.min(...ends)).toFixed(2)} m step`);
  }
  const overpass = streetPlan([
    { id: 'street', width: 10, points: [{ x: -150, z: 0 }, { x: 150, z: 0 }] },
    { id: 'bridge', width: 10, class: 'expressway', points: [{ x: 0, y: 18, z: -150 }, { x: 0, y: 18, z: 150 }] },
  ]);
  assert.ok(buildNetwork(overpass).nodes.every(n => n.kind === 'end'), 'a bridge over a street is not a junction');
});

// A slab's top and underside at (x, z), shoulders included, or null outside it.
function slabOver(slab, x, z) {
  if (!slab.a) return x < slab.minX || x > slab.maxX || z < slab.minZ || z > slab.maxZ ? null : { top: slab.maxY, under: slab.maxY - SUPPORT_SLAB_DEPTH };
  const hit = nearestOnSegment(x, z, slab.a, slab.b), length = Math.hypot(slab.b.x - slab.a.x, slab.b.z - slab.a.z);
  const along = hit.t * length + (hit.t === 0 || hit.t === 1 ? Math.hypot(x - hit.x, z - hit.z) - hit.distance : 0);
  if (hit.distance > slab.width / 2 + (slab.road ? ROAD_SHOULDER : 0) || along < -.2 || along > length + .2) return null;
  return { top: hit.y, under: hit.y - (slab.road ? roadSlabDepth(slab, plan.terrainHeight) : SUPPORT_SLAB_DEPTH) };
}

test('streets pass beneath a slab only with headroom, and are closed short of a lower one', () => {
  // A walkway deck 1.8 m over one street, a road bridge 18 m over another, and
  // a cross street a little higher than the street it meets at a junction.
  const deck = { id: 'low-deck', kind: 'deck', x: 0, z: 0, y: 1.87, width: 60, depth: 8, minX: -30, maxX: 30, minZ: -4, maxZ: 4, minY: 1.22, maxY: 1.87 };
  const plan = streetPlan([
    { id: 'under-deck', width: 10, points: [{ x: 0, z: -150 }, { x: 0, z: 150 }] },
    { id: 'under-bridge', width: 10, points: [{ x: 100, z: -150 }, { x: 100, z: 150 }] },
    { id: 'bridge', width: 10, class: 'expressway', points: [{ x: 60, y: 18, z: 0 }, { x: 140, y: 18, z: 0 }] },
    { id: 'raised-cross', width: 10, points: [{ x: -50, y: .5, z: 100 }, { x: 50, y: .5, z: 100 }] },
  ], { supports: [deck] });
  const city = buildNetwork(plan);
  assert.deepEqual(city.closures.map(c => c.road.id), ['under-deck'], 'only the street under the deck closes; junctions never close their own streets');
  assert.equal(city.edges.filter(e => e.road.id === 'under-bridge').length, 1, 'the street under the bridge stays open end to end');
  const beneath = p => Math.abs(p.x) < 30 && Math.abs(p.z) < 4 + 2.5;
  assert.ok(city.lanes.every(lane => !lane.path.points.some(beneath)), 'no lane passes beneath the deck');
  assert.ok(city.nodes.filter(n => n.kind === 'end' && Math.abs(n.x) < 1 && Math.abs(n.z) < 20).length === 2, 'the street ends on both sides of the deck');
  for (const node of city.nodes.filter(n => n.kind === 'end' && Math.abs(n.x) < 1 && Math.abs(n.z) < 20)) {
    assert.ok(city.connectorsAt(node).length && city.connectorsAt(node).every(c => c.turn === 'uturn' && !c.path.points.some(beneath)), 'cars turn round short of the deck');
  }
  assert.ok(city.walk.edges.filter(e => e.terrain).every(e => !e.path.points.some(beneath)), 'people walk round the end of the street, not beneath the deck');
});

test('no lane, turn or walkway in the city passes beneath a slab without headroom', () => {
  // Only slabs raised off the ground can be over anything. Every path near one is
  // measured across a car's width against the rendered slab. Roads meeting at a
  // junction share its surface, so they are not over each other there.
  const raised = [...new Set([...plan.roadIndex.cells.values()].flat()), ...plan.supports]
    .filter(s => (s.a ? [s.a, s.b] : [{ x: s.x, y: s.maxY, z: s.z }]).some(p => p.y - plan.terrainHeight(p.x, p.z) > .3));
  const grid = new SpatialGrid(raised.map(slab => ({ minX: slab.minX - 3, maxX: slab.maxX + 3, minZ: slab.minZ - 3, maxZ: slab.maxZ + 3, slab })), 48);
  const problems = new Map();
  let measured = 0;
  const check = (label, path, roads, width) => {
    if (!grid.query(path.minX, path.minZ, path.maxX, path.maxZ).length) return;
    measured++;
    for (let s = 0; s <= path.length; s += .5) {
      const p = samplePath(path, s), meeting = new Set([...roads, ...network.nodesNear(p.x, p.z, 25).flatMap(n => n.approaches.map(a => a.edge.road))]);
      for (const offset of width ? [-width, 0, width] : [0]) {
        const x = p.x - p.dz * offset, z = p.z + p.dx * offset;
        for (const { slab } of grid.query(x, z, x, z)) {
          const over = !meeting.has(slab.road) && slabOver(slab, x, z);
          const key = `${label} under ${slab.road?.id ?? slab.id}`;
          if (over && over.top - p.y > .3 && over.under - p.y < HEADROOM - 1e-6 && !problems.has(key)) problems.set(key, `${key} at ${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
    }
  };
  for (const lane of network.lanes) check(lane.id, lane.path, [lane.edge.road], 1.1);
  for (const node of network.nodes) {
    if (!grid.query(node.x - 30, node.z - 30, node.x + 30, node.z + 30).length) continue;
    for (const c of network.connectorsAt(node)) check(c.id, c.path, [c.from.edge.road, c.to.edge.road], 1.1);
  }
  for (const edge of network.walk.edges) check(`${edge.kind} ${edge.id}`, edge.path, [], 0);
  assert.ok(measured > 500, 'paths beside and beneath raised slabs are measured');
  assert.deepEqual([...problems.values()], []);
});

test('turn connectors join the end of one lane to the start of the right lane in every junction', () => {
  let turns = { left: 0, right: 0, straight: 0 };
  for (const node of network.nodes.filter(n => n.kind === 'junction')) for (const c of network.connectorsAt(node)) {
    assert.ok(near(c.path.points[0], c.from.path.points.at(-1)), `${c.id} starts where its lane ends`);
    assert.ok(near(c.path.points.at(-1), c.to.path.points[0]), `${c.id} ends where its exit lane starts`);
    assert.equal(c.from.end, node); assert.equal(c.to.start, node);
    assert.notEqual(c.turn, 'uturn', 'no U-turns inside junctions');
    turns[c.turn]++;
  }
  assert.ok(turns.left > 1000 && turns.right > 1000 && turns.straight > 1000);
  // Every lane has a way out, except lanes into dead-end stubs too short to turn
  // round in, which no turn ever enters.
  const entered = new Set(network.nodes.flatMap(n => network.connectorsAt(n)).map(c => c.to));
  for (const lane of network.lanes) {
    if (lane.next.length) continue;
    const stub = lane.edge.length < 14 && (lane.edge.from.kind === 'end' || lane.edge.to.kind === 'end');
    assert.ok(stub && lane.end.kind === 'end' && !entered.has(lane), `${lane.id} has a way out`);
  }
  const end = network.nodes.find(n => n.kind === 'end' && network.connectorsAt(n).length), uturns = network.connectorsAt(end);
  assert.ok(uturns.every(c => c.turn === 'uturn'), 'dead ends turn traffic around');
});

test('on two-lane roads turns use the matching lane and every lane keeps a way out', () => {
  // The city's widest road is 16 m, so two-lane behaviour is checked on a wide test grid.
  const wide = buildNetwork(gridPlan({ width: 20 })), checked = { left: 0, right: 0, straight: 0, uturn: 0 };
  assert.ok(wide.lanes.every(lane => lane.count === 2));
  for (const node of wide.nodes) for (const c of wide.connectorsAt(node)) {
    checked[c.turn]++;
    if (c.turn === 'right') assert.ok(c.from.index === 1 && c.to.index === 1, `${c.id}: right turns run kerb lane to kerb lane`);
    if (c.turn === 'left') assert.ok(c.from.index === 0 && c.to.index === 0, `${c.id}: left turns run inner lane to inner lane`);
    if (c.turn === 'straight' || c.turn === 'uturn') assert.equal(c.to.index, c.from.index, `${c.id} keeps its lane`);
  }
  assert.ok(checked.left && checked.right && checked.straight && checked.uturn);
  for (const lane of wide.lanes) assert.ok(lane.next.length > 0, `${lane.id} has a way out`);
});

test('lanes and turns stay on the asphalt', () => {
  const offRoad = (p, roads) => {
    let best = Infinity;
    for (const s of plan.roadIndex.near(p.x, p.z, 4)) {
      if (!roads.includes(s.road)) continue;
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, length = Math.hypot(dx, dz) || 1e-9, overlap = s.supportOverlap ?? .12;
      const along = ((p.x - s.a.x) * dx + (p.z - s.a.z) * dz) / length, across = Math.abs((-(p.x - s.a.x) * dz + (p.z - s.a.z) * dx) / length);
      best = Math.min(best, Math.hypot(Math.max(0, -overlap - along, along - length - overlap), Math.max(0, across - s.width / 2)));
    }
    return best;
  };
  for (const lane of network.lanes) for (const p of lane.path.points) assert.ok(offRoad(p, [lane.edge.road]) < .25, `${lane.id} leaves ${lane.edge.road.id}`);
  let worst = 0;
  for (const node of network.nodes) for (const c of network.connectorsAt(node)) {
    if (c.turn === 'uturn') continue;
    for (const p of c.path.points) worst = Math.max(worst, offRoad(p, [c.from.edge.road, c.to.edge.road]));
  }
  assert.ok(worst < .5, `turns cut at most a kerb's width beyond the asphalt (${worst.toFixed(2)} m)`);
});

test('lanes keep right of the centreline and follow the road surface', () => {
  for (const lane of network.lanes.slice(0, 600)) {
    const p = samplePath(lane.path, lane.path.length / 2), road = lane.edge.road;
    assert.ok(plan.roadIndex.near(p.x, p.z, 1).some(s => s.road === road), `${lane.id} lies on ${road.id}`);
    assert.ok(Math.abs(plan.surfaceHeight(p.x, p.z, p.y + .3) - p.y) < .25, `${lane.id} sits on the deck or street surface`);
    // The road's centreline is on the driver's left: right of travel is (-dz, dx).
    const q = lane.edge.center.points.reduce((best, c) => Math.hypot(c.x - p.x, c.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z) ? c : best);
    const side = (q.x - p.x) * -p.dz + (q.z - p.z) * p.dx;
    assert.ok(side < -lane.offset * .8, `${lane.id} drives on the right`);
  }
});

test('signal phases never give crossing streets green together, and every crosswalk gets its walk', () => {
  let phases = 0;
  for (const node of network.nodes.filter(n => n.signalized)) {
    const { cycle, phase, green, starts } = signalPlan(node);
    assert.ok(green.every(g => g >= SIGNAL_TIMING.minGreen && g <= SIGNAL_TIMING.maxGreen));
    assert.equal(cycle, green.reduce((sum, g) => sum + g + SIGNAL_TIMING.amber + SIGNAL_TIMING.allRed, 0));
    assert.equal(new Set(phase.values()).size, green.length, `${node.id}: every phase has approaches`);
    for (const a of node.approaches) if (a.partner) assert.equal(phase.get(a), phase.get(a.partner), 'a road runs as one');
    phases = Math.max(phases, green.length);
    let allRed = 0;
    const walked = new Set(), greened = new Set();
    for (let t = 0; t < cycle; t += .25) {
      const moving = node.approaches.filter(a => signalState(node, a, t).color !== 'red');
      // Judged by geometry, not by the phase table under test.
      for (const a of moving) for (const b of moving) {
        if (a.edge.road !== b.edge.road) assert.ok(Math.abs(a.dir.x * b.dir.x + a.dir.z * b.dir.z) > .9, `${node.id}: crossing streets ${a.index} and ${b.index} share a green at ${t}`);
      }
      if (!moving.length) allRed++;
      for (const a of moving) if (signalState(node, a, t).color === 'green') greened.add(a);
      for (const a of node.approaches) {
        const walk = walkState(node, a, t);
        if (walk.walk) { walked.add(a); assert.equal(signalState(node, a, t).color, 'red', 'people only cross a street while its own traffic is held'); }
      }
    }
    assert.ok(allRed > 0, `${node.id} has a clearance interval`);
    assert.equal(greened.size, node.approaches.length, `${node.id}: every approach gets green`);
    assert.equal(walked.size, node.approaches.length, `${node.id}: every crosswalk gets its walk`);
    assert.ok(starts.every((start, p) => p === 0 || start > starts[p - 1]));
  }
  assert.ok(phases >= 3, 'a three-road junction runs three phases');
  const offsets = new Set(network.nodes.filter(n => n.signalized).slice(0, 50).map(n => signalPlan(n).offset.toFixed(2)));
  assert.ok(offsets.size > 40, 'junctions are not synchronized');
  const t = network.nodes.find(n => n.signalized && n.approaches.length === 3);
  if (t) {
    const { phase } = signalPlan(t), through = t.approaches.filter(a => a.partner);
    assert.ok(through.length === 2 && phase.get(through[0]) === phase.get(through[1]), 'a T-junction runs the main road together');
  }
});

test('every at-grade junction has a crossing on each street, joined to the sidewalks', () => {
  const grid = gridPlan(), city = buildNetwork(grid);
  const crossings = city.walk.edges.filter(e => e.kind === 'crossing');
  for (const node of city.nodes.filter(n => n.kind === 'junction')) {
    for (const a of node.approaches) assert.ok(crossings.some(e => e.junction === node.id && e.approach === a.index), `${node.id}:${a.index} has a crossing`);
  }
  // The sidewalk graph is one connected network.
  const seen = new Set([city.walk.nodes[0].id]), queue = [city.walk.nodes[0].id];
  while (queue.length) for (const e of city.walk.adjacency.get(queue.shift())) for (const id of [e.a, e.b]) if (!seen.has(id)) { seen.add(id); queue.push(id); }
  assert.equal(seen.size, city.walk.nodes.length);
  // Sidewalks stay off the carriageway.
  for (const edge of city.walk.edges.filter(e => e.kind === 'sidewalk')) for (const p of edge.path.points) {
    assert.ok(!grid.roadIndex.near(p.x, p.z, 0).some(s => Math.abs(s.a.x - s.b.x) < 1e-6 ? Math.abs(p.x - s.a.x) < s.width / 2 : Math.abs(p.z - s.a.z) < s.width / 2));
  }
  const cityLargest = (() => {
    const visited = new Set(); let best = 0;
    for (const start of network.walk.nodes) {
      if (visited.has(start.id)) continue;
      let size = 0; const queue = [start.id]; visited.add(start.id);
      while (queue.length) { size++; for (const e of network.walk.adjacency.get(queue.shift())) for (const id of [e.a, e.b]) if (!visited.has(id)) { visited.add(id); queue.push(id); } }
      best = Math.max(best, size);
    }
    return best;
  })();
  assert.ok(cityLargest > network.walk.nodes.length * .8, 'most of the city is one walkable network');
});
