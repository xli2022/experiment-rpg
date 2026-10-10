import { terrainHeight } from './master-plan.js';
import { atEastpoint } from './world-scale.js';
import { infrastructureIntersections } from './infrastructure-clearance.js';

export const WAYFINDING_SIGNS = [
  { id: 'eastpoint', ...atEastpoint(2483, 638), title: 'EASTPOINT', subtitle: 'STREET 00  //  SKYWAY +04  //  EXPRESS +12.5', yaw: Math.PI / 2, w: 8, h: 2.7 },
  { id: 'neon-spine', ...atEastpoint(2485, 692), title: 'NEON SPINE', subtitle: 'AFTERLIGHT CORE  ←  //  BLACKWATER BAY  →', yaw: 0, w: 8, h: 2.7 },
];

// Keep the full, readable board near its authored location. Check both printed
// faces and a safety gap against the actual bridge solids, including shoulders.
// A vertical-only adjustment cannot fit NEON SPINE between its two stacked decks.
export function placeWayfindingSign(sign, infrastructure) {
  const y = sign.y ?? terrainHeight(sign.x, sign.z) + 5.8;
  const offsets = [0];
  for (let offset = .5; offset <= 10; offset += .5) offsets.push(offset, -offset);
  for (const offset of offsets) {
    const candidate = { ...sign, x: sign.x + Math.cos(sign.yaw) * offset, z: sign.z - Math.sin(sign.yaw) * offset, y, d: .06 };
    if (!infrastructureIntersections(candidate, infrastructure, .2).length) return candidate;
  }
  return null;
}

export function wayfindingSigns(infrastructure) {
  return WAYFINDING_SIGNS.map(sign => placeWayfindingSign(sign, infrastructure)).filter(Boolean);
}
