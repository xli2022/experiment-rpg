import { orientedBox, boxCoordinates } from '../core/physics.js';
import { polygonFaces, pointInConvex } from './building-footprints.js';
import { INTERIOR, levelY, levelAt } from './interior-plan.js';

// Interior collision lives only in an "interior context": while the player is
// inside (or within reach of) a building, its solid shell collider is swapped
// for hull walls whose outer faces lie exactly on the same perimeter. Outside
// a door gap the swap is therefore invisible to movement, rays and support.

export function toWorld(plan, x, z) {
  const { x: ox, z: oz, yaw } = plan.origin, c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: ox + x * c + z * s, z: oz - x * s + z * c };
}
export function toLocal(plan, x, z) {
  const p = boxCoordinates(x, z, { x: plan.origin.x, z: plan.origin.z, yaw: plan.origin.yaw });
  return { x: p.x, z: p.z };
}

// A box along a local segment, shifted `offset` metres toward its left side.
function segmentBox(plan, a, b, thickness, minY, maxY, extra, offset = 0, from = 0, to = null) {
  const length = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
  to ??= length;
  const t = (from + to) / 2, center = toWorld(plan, a.x + ux * t - uz * offset, a.z + uz * t + ux * offset);
  return orientedBox(center.x, center.z, to - from, thickness, plan.origin.yaw + Math.atan2(-uz, ux), maxY, minY, extra);
}

function localBox(plan, x, z, w, d, yaw, minY, maxY, extra) {
  const center = toWorld(plan, x, z);
  return orientedBox(center.x, center.z, w, d, plan.origin.yaw + yaw, maxY, minY, extra);
}

// Convex slabs share the building's frame, so they never overhang the outline.
function polygonSlab(plan, polygon, minY, maxY, extra) {
  const world = polygon.map(p => toWorld(plan, p.x, p.z)), xs = polygon.map(p => p.x), zs = polygon.map(p => p.z);
  return {
    x: plan.origin.x, z: plan.origin.z, yaw: plan.origin.yaw,
    w: Math.max(...xs.map(Math.abs)) * 2, d: Math.max(...zs.map(Math.abs)) * 2,
    vertices: polygon, faces: polygonFaces(polygon),
    minX: Math.min(...world.map(p => p.x)), maxX: Math.max(...world.map(p => p.x)),
    minZ: Math.min(...world.map(p => p.z)), maxZ: Math.max(...world.map(p => p.z)),
    minY, maxY, supportOnly: true, walkable: true, ...extra,
  };
}

// Solid pieces of a wall line between openings (door gaps, broken windows):
// between each pair of gap edges, the wall's height less the gaps across it.
// Glazed windows stay solid.
function wallPieces(plan, a, b, thickness, minY, maxY, openings, id, offset = 0) {
  const length = Math.hypot(b.x - a.x, b.z - a.z), boxes = [], extra = n => ({ id: `${id}:${n}`, climbable: false, interior: plan.id });
  const gaps = openings.filter(o => !o.window && o.to > o.from).map(o => ({ ...o, from: Math.max(0, o.from), to: Math.min(length, o.to) }));
  const edges = [...new Set([0, length, ...gaps.flatMap(g => [g.from, g.to])])].filter(t => t >= 0 && t <= length).sort((p, q) => p - q);
  let n = 0;
  for (let i = 1; i < edges.length; i++) {
    const t0 = edges[i - 1], t1 = edges[i], mid = (t0 + t1) / 2;
    if (t1 - t0 < 1e-4) continue;
    let y = minY;
    for (const gap of gaps.filter(g => g.from < mid && g.to > mid).sort((p, q) => p.bottomY - q.bottomY)) {
      if (gap.bottomY > y + 1e-4) boxes.push(segmentBox(plan, a, b, thickness, y, gap.bottomY, extra(n++), offset, t0, t1));
      y = Math.max(y, gap.topY);
    }
    if (maxY > y + 1e-4) boxes.push(segmentBox(plan, a, b, thickness, y, maxY, extra(n++), offset, t0, t1));
  }
  return boxes;
}

/**
 * Perimeter walls flush with the shell collider, door gaps and a roof cap.
 * `broken` (key → pieces, from createBrokenWindows) opens broken panes of the
 * base volume, so people can climb in and out through them.
 */
export function interiorHull(plan, broken = new Map()) {
  const faces = polygonFaces(plan.outline), boxes = [];
  plan.outline.forEach((a, i) => {
    const b = plan.outline[(i + 1) % plan.outline.length], face = faces[i];
    const ux = -face.nz, uz = face.nx, openings = [];
    for (const e of plan.entrances) {
      if (Math.abs(e.nx * face.nx + e.nz * face.nz - 1) > 1e-3 || Math.abs((e.x - a.x) * face.nx + (e.z - a.z) * face.nz) > .02) continue;
      const along = (e.x - a.x) * ux + (e.z - a.z) * uz;
      openings.push({ from: along - e.width / 2, to: along + e.width / 2, bottomY: plan.floor0, topY: plan.floor0 + e.height });
    }
    for (const { pieces } of broken.values()) for (const pane of pieces) {
      if (pane.volume !== 0 || pane.face !== i) continue;
      const along = s => (pane.wall.start.x + pane.wall.dir.x * s - a.x) * ux + (pane.wall.start.z + pane.wall.dir.z * s - a.z) * uz;
      const [from, to] = [along(pane.s0), along(pane.s1)].sort((p, q) => p - q);
      openings.push({ from, to, bottomY: pane.wall.bottom + pane.v0, topY: pane.wall.bottom + pane.v1 });
    }
    // Walls are built along the inward-facing side: the outer face is the outline.
    boxes.push(...wallPieces(plan, a, b, INTERIOR.hull, plan.ground, plan.roof, openings, `interior:${plan.id}:hull:${i}`, INTERIOR.hull / 2));
  });
  boxes.push(polygonSlab(plan, plan.outline, plan.top, plan.roof, { id: `interior:${plan.id}:roof`, interior: plan.id }));
  return boxes;
}

/** Slabs, stairs, partitions and furniture of one level. */
export function floorColliders(plan, level) {
  const template = plan.templates[Math.min(level, plan.templates.length - 1)], y = levelY(plan, level);
  const top = level >= plan.levels - 1 ? plan.top : levelY(plan, level + 1), boxes = [], tag = `interior:${plan.id}:${level}`;
  const stairZone = template.zones.find(z => z.kind === 'stair');
  for (const zone of template.zones) {
    if (zone === stairZone && level > 0) continue;
    boxes.push(polygonSlab(plan, zone.polygon, level === 0 ? plan.ground : y - INTERIOR.slab, y, { id: `${tag}:slab:${zone.id}`, interior: plan.id }));
  }
  for (const wall of template.walls) {
    const openings = wall.openings.map(o => ({ ...o, bottomY: y + o.bottom, topY: y + o.top }));
    boxes.push(...wallPieces(plan, wall.a, wall.b, wall.kind === 'core' ? .2 : INTERIOR.partition, y, top, openings, `${tag}:${wall.id}`));
  }
  if (plan.core) {
    const s = plan.core.stair, S = INTERIOR.stair, extra = id => ({ id: `${tag}:${id}`, interior: plan.id, climbable: false });
    const lane = l => (l.x0 + l.x1) / 2, width = s.up.x1 - s.up.x0;
    if (level < plan.levels - 1) {
      const ramp = (id, x, z0, y0, z1, y1) => {
        const a = toWorld(plan, x, z0), b = toWorld(plan, x, z1);
        return { ...localBox(plan, x, (z0 + z1) / 2, width, Math.abs(z1 - z0), 0, Math.min(y0, y1) - INTERIOR.slab, Math.max(y0, y1), extra(id)),
          supportOnly: true, walkable: true, slabThickness: INTERIOR.slab, supportOverlap: .02,
          surface: { a: { x: a.x, y: y0, z: a.z }, b: { x: b.x, y: y1, z: b.z }, width } };
      };
      boxes.push(ramp('flight-up', lane(s.up), s.near, y, s.far, y + S.rise));
      boxes.push(ramp('flight-down', lane(s.down), s.far, y + S.rise, s.near, y + plan.storey));
      boxes.push({ ...localBox(plan, (s.x0 + s.x1) / 2, (s.z0 + s.far) / 2, s.x1 - s.x0, s.far - s.z0, 0, y + S.rise - INTERIOR.slab, y + S.rise, extra('mid-landing')), supportOnly: true, walkable: true });
      boxes.push(localBox(plan, (s.divider.x0 + s.divider.x1) / 2, (s.far + s.near) / 2, s.divider.x1 - s.divider.x0, s.near - s.far, 0, y, top, extra('divider')));
    } else {
      // Top floor: guard the open up-lane and its side; the down flight arrives here.
      boxes.push(localBox(plan, (s.divider.x0 + s.divider.x1) / 2, (s.far + s.near) / 2, s.divider.x1 - s.divider.x0, s.near - s.far, 0, y, y + 1.1, extra('divider-rail')));
      boxes.push(localBox(plan, lane(s.up), s.near - .05, width, .1, 0, y, y + 1.1, extra('rail')));
    }
    // Nothing arrives in the ground floor's down lane: close it off as a cupboard.
    // It stops below the flight overhead, which reaches this floor's ceiling here.
    if (level === 0) boxes.push(localBox(plan, lane(s.down), s.near - .05, width, .1, 0, y, y + INTERIOR.door.height, extra('closet')));
  }
  for (const f of template.furniture) {
    boxes.push(localBox(plan, f.x, f.z, f.w, f.d, f.yaw, y, y + f.h, { id: `${tag}:${f.id}`, interior: plan.id, climbable: false, furniture: f.item }));
  }
  return boxes;
}

/** Flat support steps from the street up to each entrance threshold. */
export function entranceSteps(p, entrances, terrainHeight) {
  const plan = { origin: { x: p.x, z: p.z, yaw: p.yaw ?? 0 } }, floor = p.y + INTERIOR.floorOffset, steps = [];
  for (const e of entrances) {
    const width = e.width + .8, tx = -e.nz, tz = e.nx, yaw = Math.atan2(-tz, tx);
    const at = depth => toWorld(plan, e.x + e.nx * depth, e.z + e.nz * depth);
    const piece = (from, to, height, i) => {
      const c = at((from + to) / 2);
      steps.push({ ...orientedBox(c.x, c.z, width, to - from, (p.yaw ?? 0) + yaw, height, Math.min(height, p.ground ?? p.y) - .4, { id: `entrance:${p.id}:${e.id}:${i}` }), supportOnly: true, walkable: true, step: true });
    };
    // The landing reaches through the hull's door gap to meet the floor slab.
    // Pieces overlap slightly so no hairline seam drops the player to the street.
    piece(-INTERIOR.hull - .02, 1.22, floor, 0);
    const outer = at(1.2), rise = floor - terrainHeight(outer.x, outer.z);
    const count = rise > .3 ? Math.ceil(rise / .25) - 1 : 0;
    for (let k = 1; k <= count; k++) piece(1.2 + (k - 1) * .35 - .02, 1.2 + k * .35, floor - k * rise / (count + 1), k);
  }
  return steps;
}

/** The building context for a point: inside, in the doorway or brushing the wall. */
export function interiorContext(plan, x, y, z) {
  if (!plan || y < plan.ground - .5 || y >= plan.top - .3) return null;
  const local = toLocal(plan, x, z);
  if (!pointInConvex(plan.outline, local.x, local.z, -.75)) return null;
  return { id: plan.id, plan, level: levelAt(plan, y), local, inside: pointInConvex(plan.outline, local.x, local.z, 0) };
}

const colliderCache = new Map();
function cached(key, make) {
  if (colliderCache.has(key)) { const v = colliderCache.get(key); colliderCache.delete(key); colliderCache.set(key, v); return v; }
  const value = make(); colliderCache.set(key, value);
  while (colliderCache.size > 64) colliderCache.delete(colliderCache.keys().next().value);
  return value;
}
export function interiorColliders(plan, level, windows = null) {
  const hull = cached(`${plan.id}:hull:${windows?.version(plan.id) ?? 0}`, () => interiorHull(plan, windows?.of(plan.id))), floors = [];
  for (let l = Math.max(0, level - 1); l <= Math.min(plan.levels - 1, level + 1); l++) floors.push(...cached(`${plan.id}:${l}`, () => floorColliders(plan, l)));
  return hull.concat(floors);
}

/** Same query/near/along API as city.spatial, with the shell swapped for the interior. */
export function interiorSpatial(spatial, context, windows = null) {
  const shell = `building:${context.id}`, extra = interiorColliders(context.plan, context.level, windows);
  return {
    context,
    query(minX, minZ, maxX, maxZ) {
      return spatial.query(minX, minZ, maxX, maxZ).filter(b => b.id !== shell)
        .concat(extra.filter(b => b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ));
    },
    near(x, z, radius = 8) { return this.query(x - radius, z - radius, x + radius, z + radius); },
    along(origin, direction, distance) {
      const x = origin.x + direction.x * distance, z = origin.z + direction.z * distance;
      return this.query(Math.min(origin.x, x) - .5, Math.min(origin.z, z) - .5, Math.max(origin.x, x) + .5, Math.max(origin.z, z) + .5);
    },
  };
}
