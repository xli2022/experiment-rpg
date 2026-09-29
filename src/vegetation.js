import { seededRandom, orientedBox, circleHitsBox } from './physics.js';
import { districtAt, terrainHeight, isWater, WATER_LEVEL } from './master-plan.js';
import { infrastructureIntersections } from './infrastructure-clearance.js';
import { WORLD_LIMIT } from './world-config.js';

const hash = text => {
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  n = Math.imul(n ^ n >>> 16, 0x85ebca6b); n = Math.imul(n ^ n >>> 13, 0xc2b2ae35);
  return (n ^ n >>> 16) >>> 0;
};
const greens = [0x537d58, 0x648766, 0x718957, 0x476e5e, 0x7d965d];
const palettes = {
  southward: { density: .94, evergreen: .12 },
  'ember-heights': { density: .88, evergreen: .4 },
  stacks: { density: .84, evergreen: .2 },
  'west-end': { density: .78, evergreen: .28 },
  'east-reach': { density: .8, evergreen: .2 },
  citadel: { density: .66, evergreen: .5 },
  core: { density: .58, evergreen: .4 },
  shadowmarket: { density: .68, evergreen: .2 },
  cut: { density: .7, evergreen: .45 },
  'north-ridge': { density: .6, evergreen: .6 },
  foundry: { density: .36, evergreen: .6 },
  'void-port': { density: .32, evergreen: .55 },
  'silver-delta': { density: .48, evergreen: .3 },
};

// Geometry scales match World's radius-one crown/cone/trunk primitives. All
// species reuse the city material and existing instanced geometry batches.
export function treeParts(p) {
  const s = p.size, yard = p.source !== 'pocket', tint = p.tint ?? greens[hash(p.id ?? `${p.x}:${p.z}`) % greens.length];
  const parts = [], add = (x, y, z, w, h, d, color, shape, detail = false) =>
    parts.push({ x: p.x + x * s, y: p.y + y * s, z: p.z + z * s, w: w * s, h: h * s, d: d * s, tint: color, shape, detail });
  add(0, 2.5, 0, .24, 5, .24, 0x736653, 'trunk');
  if (p.type === 'cypress') {
    add(0, 5.0, 0, 1.05, 5.8, 1.05, tint, 'cone');
    add(0, 7.0, 0, .72, 4.1, .72, tint, 'cone');
  } else if (yard) {
    add(0, 5.1, 0, 1.5, 1.9, 1.5, tint, 'crown');
  } else {
    add(0, 5.8, 0, 2.25, 2.45, 2.05, tint, 'crown');
    add(-.85, 4.7, .28, 1.9, 1.65, 1.75, tint, 'crown');
    add(.95, 4.95, -.35, 1.85, 1.8, 1.7, tint, 'crown');
  }
  if (yard) parts.push({ x: p.x, y: p.y + .22, z: p.z, w: 3.4, h: .4, d: 3.4, tint: 0x667d7d, shape: 'box', detail: true });
  return parts;
}

export function shrubParts(p) {
  const s = p.size, parts = [], add = (x, y, z, w, h, d, tint, shape = 'crown', detail = false) =>
    parts.push({ x: p.x + x * s, y: p.y + y * s, z: p.z + z * s, w: w * s, h: h * s, d: d * s, tint, shape, detail });
  add(0, .5, 0, 1.1, .58, .85, p.tint);
  add(.6, .48, -.25, .7, .56, .65, p.tint);
  if (p.flowering) for (const [x, z] of [[-.42, .15], [.18, -.16], [.57, .2]]) add(x, 1, z, .14, .11, .14, 0xb998bd, 'crown', true);
  // Small grass/reed tufts are near details; the main shrub survives at distance.
  for (const side of [-1, 1]) add(side * .83, .38, .38, .15, .76, .15, 0x929b64, 'cone', true);
  return parts;
}

export function treeCollider(p) {
  return orientedBox(p.x, p.z, .48 * p.size, .48 * p.size, 0, p.y + 5 * p.size, p.y,
    { id: p.id, kind: 'tree', walkable: false });
}

function groundcover(x, z, radius, id, tint) {
  const y = terrainHeight(x, z), dx = terrainHeight(x + .4, z) - terrainHeight(x - .4, z), dz = terrainHeight(x, z + .4) - terrainHeight(x, z - .4);
  const slopeX = dx / .8, slopeZ = dz / .8, pitch = -Math.atan(slopeZ), roll = Math.atan(slopeX * Math.cos(pitch));
  // Only lay a thin grass bed where one terrain plane supports its whole area.
  // Groves crossing terrain triangle edges still get trees and undergrowth.
  for (let i = 0; i < 16; i++) {
    const px = Math.cos(i * Math.PI / 8) * radius, pz = Math.sin(i * Math.PI / 8) * radius;
    if (Math.abs(terrainHeight(x + px, z + pz) - y - slopeX * px - slopeZ * pz) > .025) return null;
  }
  return { id, x, z, y: y + .015, type: 'garden', w: radius * 2, d: radius * 2, h: .06, pitch, roll, tint, shape: 'circle' };
}

// A global jittered lattice makes open-space planting independent of block load
// order. Every pocket fits in its own cell, leaving paths between groves.
export function pocketVegetation({ minX, minZ, maxX, maxZ, plan, lots, anchors, reserved, infrastructure }) {
  const trees = [], shrubs = [], beds = [], spacing = 28;
  for (let gx = Math.floor(minX / spacing); gx <= Math.floor(maxX / spacing); gx++) for (let gz = Math.floor(minZ / spacing); gz <= Math.floor(maxZ / spacing); gz++) {
    const id = `grove:${gx}:${gz}`, random = seededRandom(hash(id));
    const x = (gx + .5 + (random() - .5) * .3) * spacing, z = (gz + .5 + (random() - .5) * .3) * spacing;
    if (x < minX || x >= maxX || z < minZ || z >= maxZ) continue;
    const profile = palettes[districtAt(x, z).id];
    if (random() > profile.density) continue;
    const compact = random() < .28, radius = compact ? 4 : 7.4;
    if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_LIMIT - radius - 12 || plan.onRoad(x, z, radius + 2.6)) continue;
    if (reserved.some(p => Math.hypot(x - p.x, z - p.z) < radius + 9)) continue;
    if (lots.near(x, z, radius).some(lot => circleHitsBox(x, z, radius, lot)) || anchors.some(p => circleHitsBox(x, z, radius + 2, p))) continue;
    const corners = [[0, 0], [-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]];
    if (corners.some(([dx, dz]) => isWater(x + dx, z + dz))) continue;
    const grades = corners.map(([dx, dz]) => terrainHeight(x + dx, z + dz));
    if (Math.min(...grades) < WATER_LEVEL + .7 || Math.max(...grades) - Math.min(...grades) > 2.2) continue;
    const volume = { x, z, y: (Math.min(...grades) + Math.max(...grades)) / 2 + 6, w: radius * 2, d: radius * 2, h: Math.max(...grades) - Math.min(...grades) + 12.2 };
    if (infrastructureIntersections(volume, infrastructure, .3).length) continue;
    const angle = random() * Math.PI * 2, count = compact ? 1 : 2 + (random() > .6 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const theta = angle + i * Math.PI * 2 / count, distance = compact ? 0 : 2.8 + random() * .4;
      const tx = x + Math.cos(theta) * distance, tz = z + Math.sin(theta) * distance;
      trees.push({ id: `${id}:tree:${i}`, x: tx, z: tz, y: terrainHeight(tx, tz), size: .86 + random() * .3,
        type: random() < profile.evergreen ? 'cypress' : 'broadleaf', tint: greens[Math.floor(random() * greens.length)], source: 'pocket', pocket: id });
    }
    const shrubCount = compact ? 2 : 4;
    for (let i = 0; i < shrubCount; i++) {
      const theta = angle + (i + .5) * Math.PI * 2 / shrubCount, distance = compact ? 2 : 4.5;
      const sx = x + Math.cos(theta) * distance, sz = z + Math.sin(theta) * distance;
      shrubs.push({ id: `${id}:shrub:${i}`, x: sx, z: sz, y: terrainHeight(sx, sz), size: .65 + random() * .35,
        tint: greens[Math.floor(random() * greens.length)], flowering: random() < .22, pocket: id });
    }
    const bed = groundcover(x, z, compact ? 3.3 : 6.2, `${id}:bed`, 0x496b45);
    if (bed) { bed.w *= .82 + random() * .18; bed.d *= .7 + random() * .25; beds.push(bed); }
  }
  return { trees, shrubs, beds };
}
