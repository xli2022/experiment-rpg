import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_OBJECTS } from '../src/modes/story/content.js';
import { WORLD_LABEL_LAYOUT } from '../src/modes/story/world-life.js';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { createMasterPlan } from '../src/world/master-plan.js';
import { geometryVolume, infrastructureIntersections } from '../src/world/infrastructure-clearance.js';

function labelVolume(place, yaw = 0, pitch = 0) {
  return { x: place.x, y: (place.y ?? 0) + WORLD_LABEL_LAYOUT.rootOffsetY + (place.labelHeight ?? WORLD_LABEL_LAYOUT.offsetY), z: place.z,
    w: WORLD_LABEL_LAYOUT.width, h: WORLD_LABEL_LAYOUT.height, d: 1e-6, yaw, pitch };
}

test('all interactable labels clear city infrastructure while facing the camera', () => {
  const metro = new VerticalMetropolis(createMasterPlan(), WORLD_OBJECTS), index = metro.infrastructureIndex;
  assert.equal(WORLD_OBJECTS.length, 63);
  for (const place of WORLD_OBJECTS) {
    const volume = labelVolume(place), radius = Math.hypot(volume.w, volume.h) / 2;
    // With no camera roll, this envelope contains every yaw and pitch.
    // Only labels near a slab need the more precise orientation sweep.
    const nearby = index.near(place.x, place.z, radius).filter(obstacle => {
      const r = obstacle.obb.rotation.elements, half = obstacle.obb.halfSize;
      const extentY = Math.abs(r[1]) * half.x + Math.abs(r[4]) * half.y + Math.abs(r[7]) * half.z;
      return obstacle.y + extentY >= volume.y - volume.h / 2 && obstacle.y - extentY <= volume.y + volume.h / 2;
    });
    if (!nearby.length) continue;
    // The camera's normal pitch range is narrower than these +/-75 degrees.
    for (let yaw = 0; yaw < 360; yaw += 2) for (let pitch = -75; pitch <= 75; pitch += 3) {
      const label = geometryVolume(labelVolume(place, yaw * Math.PI / 180, pitch * Math.PI / 180));
      assert.deepEqual(nearby.filter(obstacle => label.obb.intersectsOBB(obstacle.obb)).map(obstacle => obstacle.id ?? obstacle.kind), [],
        `${place.name} intersects infrastructure at camera yaw ${yaw}, pitch ${pitch}`);
    }
  }
  const station = WORLD_OBJECTS.find(place => place.id === 'metro-neon');
  assert.ok(infrastructureIntersections(labelVolume({ ...station, labelHeight: 3 }), index).some(obstacle => obstacle.id === 'eastpoint-concourse'),
    'The previous default label height intersects the concourse underside at an ordinary level view');
  const slab = [...new Set([...index.cells.values()].flat())].find(obstacle => obstacle.id === 'eastpoint-concourse');
  const top = labelVolume(station).y + WORLD_LABEL_LAYOUT.height / 2;
  assert.ok(slab.y - slab.h / 2 - top > .15, 'The corrected station label has clearance even when fully upright');
});
