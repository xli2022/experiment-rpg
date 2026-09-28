import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { terrainHeight } from './master-plan.js';
import { SpatialGrid } from './spatial-grid.js';

// Use the same YXZ rotation order as WorldStream's rendered box instances.
// A ramp's tall broad-phase bounds do not describe the space below its slab.
export function geometryVolume(p, clearance = 0) {
  const rotation = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0, 'YXZ')));
  const half = new THREE.Vector3(p.w / 2 + clearance, p.h / 2 + clearance, p.d / 2 + clearance);
  const obb = new OBB(new THREE.Vector3(p.x, p.y, p.z), half, rotation), r = rotation.elements;
  const rx = Math.abs(r[0]) * half.x + Math.abs(r[3]) * half.y + Math.abs(r[6]) * half.z;
  const rz = Math.abs(r[2]) * half.x + Math.abs(r[5]) * half.y + Math.abs(r[8]) * half.z;
  return { ...p, obb, minX: p.x - rx, maxX: p.x + rx, minZ: p.z - rz, maxZ: p.z + rz };
}

function frame(s) {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, dz = s.b.z - s.a.z, flat = Math.hypot(dx, dz);
  return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2, z: (s.a.z + s.b.z) / 2,
    yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, flat), flat, length: Math.hypot(flat, dy) };
}

export function roadSolidRecipes(s) {
  const f = frame(s); if (f.flat < .01) return [];
  const h = f.y - terrainHeight(f.x, f.z) > 3.5 ? 1.1 : .32;
  const d = f.length + 2 * (s.supportOverlap ?? .12) * f.length / f.flat, roll = -Math.atan(s.crossSlope ?? 0);
  return [
    { ...f, id: s.id, kind: 'road-deck', y: f.y - h / 2 - .12, w: s.width + 3.4, h, d: d + .04, roll },
    { ...f, id: s.id, kind: 'road-surface', y: f.y - .055, w: s.width, h: .11, d, roll },
  ];
}

export function supportSolidRecipe(s) {
  if (!s.a) return { ...s, kind: s.kind ?? 'deck', y: s.y - .325, w: s.width, h: .65, d: s.depth };
  const f = frame(s);
  return { ...f, id: s.id, kind: s.kind ?? 'support', y: f.y - .325, w: s.width, h: .65, d: f.length + .14 };
}

/** Exact solid recipes for the rendered road/support slabs and supplied furniture. */
export function createInfrastructureIndex(plan, parts = []) {
  const volumes = [], add = p => volumes.push(geometryVolume(p));
  const segments = new Set();
  for (const entries of plan.roadIndex.cells.values()) for (const segment of entries) segments.add(segment);
  for (const s of segments) for (const recipe of roadSolidRecipes(s)) add(recipe);
  for (const s of plan.supports ?? []) {
    add(supportSolidRecipe(s));
  }
  for (const p of parts) {
    if (p.kind === 'rail') add({ ...p, h: .95, d: p.length });
    else if (p.kind === 'pier') {
      add(p);
      if (p.w > 1) add({ ...p, kind: 'pier-cap', y: p.maxY + .1, w: 9, h: .6, d: 2.4 });
    } else if (p.kind === 'planter') {
      add({ ...p, h: .7 });
      add({ ...p, kind: 'planting', y: p.maxY + .35, w: p.w - .4, h: .85, d: p.d - .4 });
    } else if (p.kind === 'kiosk') {
      add({ ...p, h: 3.2 });
      add({ ...p, kind: 'kiosk-canopy', x: p.x - .5, y: p.maxY + .16, w: p.w + 2, h: .28, d: p.d + .6 });
    }
  }
  return new SpatialGrid(volumes);
}

export function infrastructureIntersections(volume, index, clearance = 0) {
  const candidate = geometryVolume(volume, clearance);
  return index.query(candidate.minX, candidate.minZ, candidate.maxX, candidate.maxZ)
    .filter(obstacle => candidate.obb.intersectsOBB(obstacle.obb));
}
