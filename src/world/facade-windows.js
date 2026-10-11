import { buildingDesign, buildingEntrances, buildingVolumes } from './building-design.js';
import { FOOTPRINT_VERTICES, polygonFaces } from './building-footprints.js';

// Facade windows as solid things. The facade atlas paints one pane per 2.7 m
// bay and 3.6 m storey; these are those panes in metres, so interiors can open
// exactly the windows the street sees and any of them can break. No Three.js.

export const FACADE_BAY = 2.7, FACADE_STOREY = 3.6, FACADE_PIXELS = 60;
// Each style's pane in its 60 × 60 px bay: [x0, x1) × [y0, y1), y up from the
// storey's base. building-materials.js paints its atlas from this table.
export const FACADE_PANES = Object.freeze([[4, 60, 16, 60], [20, 42, 12, 51], [15, 44, 15, 48], [3, 58, 19, 46], [8, 54, 7, 51], [21, 42, 18, 46]]);

/** A style's pane within its bay, in metres: [left, right, sill, head]. */
export function paneMetres(style) {
  const [x0, x1, y0, y1] = FACADE_PANES[style] ?? FACADE_PANES[1];
  return [x0 * FACADE_BAY / FACADE_PIXELS, x1 * FACADE_BAY / FACADE_PIXELS, y0 * FACADE_STOREY / FACADE_PIXELS, y1 * FACADE_STOREY / FACADE_PIXELS];
}

const walls = new Map();
/**
 * The walls of a building's facade volumes, in building-local coordinates. A
 * wall's bay grid starts where its texture does: a box face runs from its second
 * corner back to its first, a prism face from first to second, and a circle
 * continues round its whole perimeter. Storeys count up from the volume's base.
 */
export function facadeWalls(p, design = buildingDesign(p), volumes = buildingVolumes(p, design)) {
  if (walls.has(p.id)) return walls.get(p.id);
  const result = [], entrances = buildingEntrances(p, design);
  volumes.forEach((v, index) => {
    if (v.mat !== 'facade') return;
    const shape = v.shape === 'circle' || v.shape === 'hexagon' ? v.shape : 'box', unit = FOOTPRINT_VERTICES[shape === 'box' ? 'rectangle' : shape];
    const corners = unit.map(q => ({ x: v.x + q.x * v.w, z: v.z + q.z * v.d })), faces = polygonFaces(corners), unitFaces = polygonFaces(unit);
    let travelled = 0;
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % corners.length], face = faces[i], box = shape === 'box', start = box ? b : a, end = box ? a : b;
      const wall = { volume: index, face: i, ring: shape === 'circle', start, dir: { x: (end.x - start.x) / face.width, z: (end.z - start.z) / face.width },
        normal: { x: face.nx, z: face.nz }, length: face.width, scale: box ? 1 : unitFaces[i].width * v.w / face.width,
        offset: shape === 'circle' ? travelled * v.w : 0, bottom: (p.y ?? 0) + v.y - v.h / 2, height: v.h, style: design.surface, doors: [] };
      // Street doors replace the panes around them on the ground storey.
      if (index === 0) for (const e of entrances) {
        if (e.nx * face.nx + e.nz * face.nz < 1 - 1e-3 || Math.abs((e.x - a.x) * face.nx + (e.z - a.z) * face.nz) > .05) continue;
        const along = (e.x - start.x) * wall.dir.x + (e.z - start.z) * wall.dir.z;
        wall.doors.push([along - e.width / 2 - .2, along + e.width / 2 + .2, e.height]);
      }
      travelled += unitFaces[i].width;
      result.push(wall);
    });
  });
  walls.set(p.id, result);
  while (walls.size > 256) walls.delete(walls.keys().next().value);
  return result;
}

/** A pane's key: volume, wall (a circle's columns run round it), column and storey. */
export const paneKey = (wall, col, row) => `${wall.volume}:${wall.ring ? 'ring' : wall.face}:${col}:${row}`;

/**
 * The panes of one storey along a wall, clipped to it, as distances along the
 * wall from its start and heights above the volume's base.
 */
export function wallPanes(wall, row = 0) {
  const [x0, x1, y0, y1] = paneMetres(wall.style), from = wall.offset, to = wall.offset + wall.length * wall.scale, panes = [];
  const v0 = row * FACADE_STOREY + y0, v1 = Math.min(wall.height, row * FACADE_STOREY + y1);
  if (v1 - v0 < .2) return panes;
  for (let col = Math.floor(from / FACADE_BAY); col * FACADE_BAY + x0 < to; col++) {
    const u0 = Math.max(from, col * FACADE_BAY + x0), u1 = Math.min(to, col * FACADE_BAY + x1);
    if (u1 - u0 < .05) continue;
    const s0 = (u0 - wall.offset) / wall.scale, s1 = (u1 - wall.offset) / wall.scale;
    if (row === 0 && wall.doors.some(([d0, d1, h]) => v0 < h && s0 < d1 && s1 > d0)) continue;
    panes.push({ key: paneKey(wall, col, row), volume: wall.volume, face: wall.face, col, row, s0, s1, v0, v1 });
  }
  return panes;
}

/** Every piece of one pane: a circle's can wrap across two of its faces. */
export function panePieces(p, key) {
  const [volume, wall, col, row] = key.split(':'), list = facadeWalls(p).filter(w => w.volume === +volume && (wall === 'ring' ? w.ring : w.face === +wall));
  return list.flatMap(w => wallPanes(w, +row).filter(q => q.col === +col).map(q => ({ ...q, wall: w })));
}

/** Building-local point at distance `s` along a wall and `out` metres outside it. */
export function wallPoint(wall, s, out = 0) {
  return { x: wall.start.x + wall.dir.x * s + wall.normal.x * out, z: wall.start.z + wall.dir.z * s + wall.normal.z * out };
}

/**
 * The pane at a building-local point on a facade wall's outer face, or on the
 * inner face of an interior's hull behind it, or null on cladding and frames.
 * In a corner the nearer wall decides.
 */
export function paneAt(p, local, y, tolerance = .04) {
  let best = null;
  for (const wall of facadeWalls(p)) {
    const dx = local.x - wall.start.x, dz = local.z - wall.start.z, depth = dx * wall.normal.x + dz * wall.normal.z;
    const s = dx * wall.dir.x + dz * wall.dir.z, v = y - wall.bottom;
    if (depth < -.45 || depth > .2 || s < -tolerance || s > wall.length + tolerance || v < 0 || v > wall.height) continue;
    if (best && Math.abs(depth) >= best.depth) continue;
    best = { wall, depth: Math.abs(depth), s, v };
  }
  if (!best) return null;
  const { wall, s, v } = best, row = Math.floor(v / FACADE_STOREY);
  const pane = wallPanes(wall, row).find(q => s > q.s0 - tolerance && s < q.s1 + tolerance && v > q.v0 - tolerance && v < q.v1 + tolerance);
  return pane ? { ...pane, wall } : null;
}

/**
 * Windows broken this session, by building. Each building's version changes
 * whenever one of its panes breaks, so colliders and rooms can rebuild. The
 * oldest are glazed again once `limit` are broken.
 */
export function createBrokenWindows({ limit = 600 } = {}) {
  const buildings = new Map(), versions = new Map(), order = [];
  let revision = 0;
  const bump = id => { versions.set(id, (versions.get(id) ?? 0) + 1); revision++; };
  return {
    get revision() { return revision; },
    version: id => versions.get(id) ?? 0,
    has: (id, key) => buildings.get(id)?.has(key) ?? false,
    /** The broken panes of one building, as their pieces: key → pieces. */
    of: id => buildings.get(id) ?? new Map(),
    *all() { for (const [id, panes] of buildings) for (const [key, entry] of panes) yield { id, key, ...entry }; },
    /** Break a pane of building `p`. Returns false when it was already broken. */
    add(p, key) {
      if (buildings.get(p.id)?.has(key)) return false;
      const pieces = panePieces(p, key);
      if (!pieces.length) return false;
      if (!buildings.has(p.id)) buildings.set(p.id, new Map());
      buildings.get(p.id).set(key, { pieces, origin: { x: p.x, z: p.z, yaw: p.yaw ?? 0 } });
      order.push([p.id, key]); bump(p.id);
      while (order.length > limit) {
        const [id, old] = order.shift(), panes = buildings.get(id);
        panes?.delete(old); if (!panes?.size) buildings.delete(id);
        bump(id);
      }
      return true;
    },
    clear() { for (const id of buildings.keys()) bump(id); buildings.clear(); order.length = 0; },
  };
}
