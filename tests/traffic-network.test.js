import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, samplePath, laneLayout } from '../src/traffic/network.js';
import { signalPlan, signalState, walkState, SIGNAL_TIMING } from '../src/traffic/signals.js';
import { createMasterPlan } from '../src/world/master-plan.js';
import { gridPlan, streetPlan } from './helpers/street-grid.js';

const plan = createMasterPlan();
const started = performance.now(), network = buildNetwork(plan), buildTime = performance.now() - started;
const near = (a, b, tolerance = 1e-6) => Math.hypot(a.x - b.x, a.z - b.z) < tolerance && Math.abs(a.y - b.y) < tolerance;

test('the city road network builds junctions, lanes and walkways quickly and deterministically', () => {
  // About 200 ms on its own; the ceiling only guards against regressions while test files run in parallel.
  assert.ok(buildTime < 2500, `network build took ${buildTime.toFixed(0)} ms`);
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
  for (const node of network.nodes) for (const a of node.approaches) {
    assert.ok(Math.abs(a.edge.line[a.end === 'from' ? 0 : a.edge.line.length - 1].y - node.y) < 1, `${node.id} joins ${a.edge.road.id} across levels`);
  }
  const overpass = streetPlan([
    { id: 'street', width: 10, points: [{ x: -150, z: 0 }, { x: 150, z: 0 }] },
    { id: 'bridge', width: 10, class: 'expressway', points: [{ x: 0, y: 18, z: -150 }, { x: 0, y: 18, z: 150 }] },
  ]);
  assert.ok(buildNetwork(overpass).nodes.every(n => n.kind === 'end'), 'a bridge over a street is not a junction');
});

test('turn connectors join the end of one lane to the start of the right lane in every junction', () => {
  const sample = network.nodes.filter(n => n.kind === 'junction').slice(0, 300);
  let turns = { left: 0, right: 0, straight: 0 };
  for (const node of sample) for (const c of network.connectorsAt(node)) {
    assert.ok(near(c.path.points[0], c.from.path.points.at(-1)), `${c.id} starts where its lane ends`);
    assert.ok(near(c.path.points.at(-1), c.to.path.points[0]), `${c.id} ends where its exit lane starts`);
    assert.equal(c.from.end, node); assert.equal(c.to.start, node);
    assert.notEqual(c.turn, 'uturn', 'no U-turns inside junctions');
    if (c.from.count > 1 && c.turn === 'right') assert.equal(c.from.index, c.from.count - 1, 'right turns leave from the kerb lane');
    if (c.from.count > 1 && c.turn === 'left') assert.equal(c.from.index, 0, 'left turns leave from the inner lane');
    if (c.turn === 'right') assert.equal(c.to.index, c.to.count - 1);
    turns[c.turn]++;
  }
  assert.ok(turns.left > 100 && turns.right > 100 && turns.straight > 100);
  for (const lane of network.lanes.slice(0, 2000)) assert.ok(lane.next.length > 0, `${lane.id} has a way out`);
  const end = network.nodes.find(n => n.kind === 'end'), uturns = network.connectorsAt(end);
  assert.ok(uturns.length && uturns.every(c => c.turn === 'uturn'), 'dead ends turn traffic around');
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

test('signal phases never show conflicting greens and always include a clearance interval', () => {
  for (const node of network.nodes.filter(n => n.signalized).slice(0, 200)) {
    const { cycle, phase, green } = signalPlan(node);
    assert.ok(green.every(g => g >= SIGNAL_TIMING.minGreen && g <= SIGNAL_TIMING.maxGreen));
    assert.equal(cycle, green[0] + green[1] + 2 * (SIGNAL_TIMING.amber + SIGNAL_TIMING.allRed));
    let allRed = 0;
    for (let t = 0; t < cycle; t += .25) {
      const states = node.approaches.map(a => [a, signalState(node, a, t)]);
      const moving = states.filter(([, s]) => s.color !== 'red').map(([a]) => phase.get(a));
      assert.ok(new Set(moving).size <= 1, `${node.id} gives conflicting phases right of way at ${t}`);
      if (!moving.length) allRed++;
      for (const [a, s] of states) {
        const walk = walkState(node, a, t);
        if (walk.walk) assert.equal(s.color, 'red', 'people only cross a street while its own traffic is held');
      }
    }
    assert.ok(allRed > 0);
  }
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
