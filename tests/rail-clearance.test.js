import test from 'node:test';
import assert from 'node:assert/strict';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { createMasterPlan } from '../src/world/master-plan.js';
import { AFTERLIGHT_LANDMARKS as LANDMARKS } from '../src/world/landmarks.js';
import { createInfrastructureIndex, infrastructureIntersections } from '../src/world/infrastructure-clearance.js';

test('railings throughout the city clear rendered slabs at highway merges and curved ramp joins', () => {
  const plan = createMasterPlan(), metro = new VerticalMetropolis(plan, LANDMARKS), slabs = createInfrastructureIndex(plan);
  let count = 0;
  for (let x = -15; x < 15; x++) for (let z = -15; z < 15; z++) {
    for (const rail of metro.block(x, z).infrastructure.filter(p => p.kind === 'rail')) {
      count++;
      const hits = infrastructureIntersections({ ...rail, h: .95, d: rail.length }, slabs);
      assert.deepEqual(hits.map(p => `${p.id}:${p.kind}`), [], `Rail at ${rail.x}, ${rail.z} cuts into a slab`);
    }
  }
  assert.ok(count > 2500, 'Valid guardrails remain throughout the road and pedestrian networks');
});
