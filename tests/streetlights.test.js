import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VerticalMetropolis } from '../src/vertical-city.js';
import { createMasterPlan, terrainHeight } from '../src/master-plan.js';
import { WORLD_OBJECTS } from '../src/content.js';
import { infrastructureIntersections } from '../src/infrastructure-clearance.js';

test('streetlights across the entire city rest on terrain or a real bridge shoulder and clear surrounding structures', () => {
  const metro = new VerticalMetropolis(createMasterPlan(), WORLD_OBJECTS);
  let count = 0, elevated = 0, sloped = 0;
  for (let x = -15; x < 15; x++) for (let z = -15; z < 15; z++) {
    for (const lamp of metro.block(x, z).props.filter(p => p.kind === 'lamp')) {
      count++;
      const label = `lamp at ${lamp.x.toFixed(2)}, ${lamp.z.toFixed(2)}`;
      if (Math.abs(lamp.y - terrainHeight(lamp.x, lamp.z)) > .01) {
        elevated++;
        const support = metro.infrastructureIndex.near(lamp.x, lamp.z, 1).find(obstacle => {
          if (obstacle.kind !== 'road-deck') return false;
          const local = new THREE.Vector3(lamp.x, lamp.y, lamp.z).sub(obstacle.obb.center)
            .applyMatrix3(obstacle.obb.rotation.clone().transpose());
          return Math.abs(local.x) < obstacle.w / 2 - .1 && Math.abs(local.z) < obstacle.d / 2 - .1 &&
            Math.abs(local.y - obstacle.h / 2) < 1e-7;
        });
        assert.ok(support, `${label} mounts on the rendered shoulder top, including its slope and banking`);
        if (Math.abs(support.pitch) > .005) sloped++;
      }
      // Leave just the short foot attachment out of the clearance check.
      // Full pole and head extents must clear other decks, piers and rails.
      for (const part of [
        { ...lamp, y: lamp.y + 4.36, w: .18, h: 8.48, d: .18 },
        { ...lamp, y: lamp.y + 8.4, w: .32, h: .24, d: 2.1 },
      ]) {
        assert.deepEqual(infrastructureIntersections(part, metro.infrastructureIndex).map(p => p.id ?? p.kind), [], `${label} intersects infrastructure`);
      }
    }
  }
  assert.ok(count > 7000, 'All districts contribute their actual generated lamps');
  assert.ok(elevated > 400, 'Elevated roads keep their supported streetlights');
  assert.ok(sloped > 20, 'The audit includes sloped ramps and hills');
});
