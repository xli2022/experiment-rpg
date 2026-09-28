import { circleHitsBox, overlapsHeight, WORLD_LIMIT } from './physics.js';

// Arrival positions need room for the first step, including when a parked car
// has moved over a refuge. Keep fallback searches close and on the same floor.
export function findSpawnPosition(preferred, collidersAt, floorAt, radius = .43) {
  if (![preferred.x, preferred.y, preferred.z].every(Number.isFinite)) return null;
  const clearance = radius + .5;
  const candidates = [[0, 0]];
  for (const distance of [2, 4, 6, 8]) {
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      candidates.push([Math.cos(angle) * distance, Math.sin(angle) * distance]);
    }
  }
  for (const [dx, dz] of candidates) {
    const x = preferred.x + dx, z = preferred.z + dz;
    if (Math.abs(x) > WORLD_LIMIT - clearance || Math.abs(z) > WORLD_LIMIT - clearance) continue;
    const y = floorAt(x, z, preferred.y + .6);
    if (!Number.isFinite(y) || Math.abs(y - preferred.y) > .6 + 1e-7) continue;
    const blocked = collidersAt(x, z, clearance).some(box =>
      !box.supportOnly && overlapsHeight(box, y) && circleHitsBox(x, z, clearance, box));
    if (!blocked) return { x, y, z };
  }
  return null;
}
