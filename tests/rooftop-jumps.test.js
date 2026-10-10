import test from 'node:test';
import assert from 'node:assert/strict';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { createMasterPlan, MASTER_DISTRICTS } from '../src/world/master-plan.js';
import { WORLD_LIMIT } from '../src/world/world-config.js';
import { AFTERLIGHT_LANDMARKS as LANDMARKS } from '../src/world/landmarks.js';
import { orientedBox } from '../src/core/physics.js';
import { findRepeatableJump, nearestRoofPairs, roofGap, traversalSpatial } from './helpers/rooftop-traversal.js';

test('roof-gap measurement follows rotated footprint edges', () => {
  const yaw = .65, distance = 20;
  const a = orientedBox(0, 0, 12, 12, yaw, 30);
  const b = orientedBox(Math.cos(yaw) * distance, -Math.sin(yaw) * distance, 12, 12, yaw, 20);
  assert.ok(Math.abs(roofGap(a, b) - 8) < 1e-9);
  assert.ok(Math.abs(roofGap(b, a) - 8) < 1e-9);
});

test('each compact district supports a jump to a nearest lower roof at 30–120 FPS', async t => {
  const plan = createMasterPlan(), metro = new VerticalMetropolis(plan, LANDMARKS), scale = WORLD_LIMIT / 5500;
  const radius = 260 * scale, routes = [];
  for (const district of MASTER_DISTRICTS) await t.test(district.name, () => {
    const blocks = metro.area(district.x - radius, district.z - radius, district.x + radius, district.z + radius);
    const buildings = blocks.flatMap(block => block.buildings).filter(p => !p.anchor);
    const pairs = nearestRoofPairs(buildings), distances = pairs.map(pair => pair.gap).sort((a, b) => a - b);
    assert.ok(pairs.length >= 10, `${district.id} has enough real frontage roofs to assess`);
    const median = distances[Math.floor(distances.length / 2)];
    assert.ok(median <= 12, `${district.id} median nearest roof gap is ${median.toFixed(2)}m; compact streets should provide close neighbors`);
    const candidates = pairs.filter(pair => pair.drop >= .5 && pair.gap >= 2 && pair.gap <= 12)
      .sort((a, b) => Math.abs(a.gap - 8) - Math.abs(b.gap - 8));
    const route = findRepeatableJump(candidates, traversalSpatial(blocks, plan));
    assert.ok(route, `${district.id} needs a nearest lower roof reachable with actual collision, air control and landing support at every tested frame rate`);
    routes.push(route);
    t.diagnostic(`${district.id}: median ${median.toFixed(2)}m; jump ${route.gap.toFixed(2)}m gap, ${route.drop.toFixed(2)}m drop; ${route.source.id} -> ${route.target.id}`);
  });
  assert.equal(routes.length, MASTER_DISTRICTS.length);
  assert.ok(routes.some(route => route.gap >= 6 && route.gap <= 10), 'a representative 6–10m gap remains genuinely jumpable');
  assert.ok(routes.some(route => Math.abs(Math.sin(route.source.yaw * 2)) > .2), 'a rotated generated roof pair is traversable');
  assert.ok(routes.some(route => route.drop > 10), 'routes preserve the varied skyline and use real downward drops');
});
