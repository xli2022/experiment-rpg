import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasterPlan, terrainHeight } from '../src/master-plan.js';
import { VerticalMetropolis } from '../src/vertical-city.js';
import { WORLD_OBJECTS } from '../src/content.js';
import { WAYFINDING_SIGNS, placeWayfindingSign, wayfindingSigns } from '../src/wayfinding.js';
import { geometryVolume, infrastructureIntersections } from '../src/infrastructure-clearance.js';
import { SpatialGrid } from '../src/spatial-grid.js';

test('Eastpoint wayfinding signs stay clear of both decks, ramp shoulders and railings', () => {
  const metro = new VerticalMetropolis(createMasterPlan(), WORLD_OBJECTS), index = metro.infrastructureIndex;
  const original = WAYFINDING_SIGNS.map(p => ({ ...p, y: terrainHeight(p.x, p.z) + 5.8, d: .06 }));
  const neon = original.find(p => p.id === 'neon-spine');
  assert.ok(infrastructureIntersections(neon, index).some(p => p.id.startsWith('eastpoint-ramp:')), 'reproduce the sign cutting through the ramp');
  assert.ok(infrastructureIntersections(original.find(p => p.id === 'eastpoint'), index).some(p => p.kind === 'rail'), 'the Eastpoint board also crosses a concourse railing');
  const labels = wayfindingSigns(index);
  assert.equal(labels.length, original.length, 'both complete signs remain available');
  for (const label of labels) {
    const before = original.find(p => p.id === label.id);
    assert.equal(infrastructureIntersections(label, index, .2).length, 0, `${label.id} has 20 cm clearance on both printed faces`);
    assert.deepEqual([label.w, label.h, label.yaw, label.title, label.subtitle], [before.w, before.h, before.yaw, before.title, before.subtitle]);
    assert.ok(Math.hypot(label.x - before.x, label.z - before.z) <= 10, 'sign stays near its destination');
  }
  assert.deepEqual(wayfindingSigns(index), labels, 'regeneration keeps the same mounting positions');
});

test('wayfinding searches along rotated boards and leaves out a fully obstructed location', () => {
  const sign = { id: 'rotated', x: 0, y: 5, z: 0, w: 4, h: 2, yaw: Math.PI / 2 };
  assert.deepEqual(placeWayfindingSign(sign, new SpatialGrid()), { ...sign, d: .06 }, 'clear authored placements do not move');
  const obstacle = geometryVolume({ x: 0, y: 5, z: 0, w: 1, h: 3, d: 1 });
  const index = new SpatialGrid([obstacle]);
  const placed = placeWayfindingSign(sign, index);
  assert.ok(placed && Math.abs(placed.x) < 1e-8 && Math.abs(placed.z) > 2.5);
  assert.equal(infrastructureIntersections(placed, index, .2).length, 0);
  const blocked = new SpatialGrid([geometryVolume({ x: 0, y: 5, z: 0, w: 40, h: 20, d: 40 })]);
  assert.equal(placeWayfindingSign(sign, blocked), null);
});
