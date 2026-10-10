import { buildingDesign, buildingVolumes, buildingEntrances, hash } from './building-design.js';
import { footprintVertices, polygonFaces, polygonArea, polygonCentroid, clipConvex, insetConvex, pointInConvex } from './building-footprints.js';
import { seededRandom } from './physics.js';

// Procedural interiors. Everything here is plain data in building-local space
// (front is +Z), derived deterministically from a city blueprint. Physics,
// rendering and future residents share the same rooms and unit identities.
export const INTERIOR = Object.freeze({
  revision: 1, storey: 3.6, slab: .3, hull: .3, partition: .14, floorOffset: .12, minHeight: 2.6,
  door: Object.freeze({ width: .95, height: 2.15, clearance: 1 }),
  stair: Object.freeze({ lane: 1.2, divider: .2, run: 3.6, rise: 1.8, landing: 1.2 }),
  lift: 1.8, liftAbove: 3, ring: 1.2, minDepth: 3.2,
});
const OPEN_KINDS = new Set(['landing', 'lobby', 'office', 'shop', 'hall']);
const PUBLIC = { market: 'shop', terrace: 'shop', apartment: 'lobby', office: 'lobby', civic: 'lobby' };
// Window bands per facade style (building-materials.js order), as fractions of
// a 2.7 m bay with sill and head heights above the floor.
const WINDOW_STYLES = [
  { width: .9, sill: .25, head: 3.05 }, { width: .42, sill: .9, head: 2.6 }, { width: .5, sill: .9, head: 2.5 },
  { width: .95, sill: 1, head: 2.4 }, { width: .8, sill: .45, head: 2.9 }, { width: .42, sill: 1, head: 2.5 },
];
const INDUSTRIAL_WINDOWS = { width: .8, sill: 2.7, head: 3.4 };

const rect = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const clip = (poly, nx, nz, c) => poly.length ? clipConvex(poly, nx, nz, c) : poly;
const clipAll = (poly, planes) => planes.reduce((q, [nx, nz, c]) => clip(q, nx, nz, c), poly);
const within = (poly, r) => clipAll(poly, [[1, 0, r.x1], [-1, 0, -r.x0], [0, 1, r.z1], [0, -1, -r.z0]]);
const fits = (inner, r) => rect(r.x0, r.z0, r.x1, r.z1).every(p => pointInConvex(inner, p.x, p.z, -1e-6));
function bounds(poly) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of poly) { b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x); b.minZ = Math.min(b.minZ, p.z); b.maxZ = Math.max(b.maxZ, p.z); }
  return b;
}
function project(poly, [ax, az]) {
  let min = Infinity, max = -Infinity;
  for (const p of poly) { const v = p.x * ax + p.z * az; min = Math.min(min, v); max = Math.max(max, v); }
  return { min, max };
}

// Collinear, opposite-facing edges of two touching convex zones.
export function sharedSegments(a, b) {
  const out = [];
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i], a1 = a[(i + 1) % a.length], length = Math.hypot(a1.x - a0.x, a1.z - a0.z);
    if (length < 1e-6) continue;
    const ux = (a1.x - a0.x) / length, uz = (a1.z - a0.z) / length;
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j], b1 = b[(j + 1) % b.length];
      const off0 = (b0.x - a0.x) * -uz + (b0.z - a0.z) * ux, off1 = (b1.x - a0.x) * -uz + (b1.z - a0.z) * ux;
      if (Math.abs(off0) > 1e-4 || Math.abs(off1) > 1e-4 || (b1.x - b0.x) * ux + (b1.z - b0.z) * uz > 0) continue;
      const t0 = (b0.x - a0.x) * ux + (b0.z - a0.z) * uz, t1 = (b1.x - a0.x) * ux + (b1.z - a0.z) * uz;
      const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(length, Math.max(t0, t1));
      if (hi - lo > 1e-3) out.push({ a: { x: a0.x + ux * lo, z: a0.z + uz * lo }, b: { x: a0.x + ux * hi, z: a0.z + uz * hi } });
    }
  }
  return out;
}

// Core options in order of preference: a central core with a ring landing,
// then a core against the back wall. Every room region shares a full side
// with the landing, so each unit can open directly onto it.
function placeCore(inner, levels, entranceX) {
  const S = INTERIOR.stair, stairW = S.lane * 2 + S.divider, stairD = S.run + S.landing, b = bounds(inner);
  for (const lift of levels > INTERIOR.liftAbove ? [true, false] : [false]) for (const ring of [INTERIOR.ring, 1]) {
    const cw = stairW + (lift ? INTERIOR.lift : 0), w = cw + ring * 2;
    const cz = (b.minZ + b.maxZ) / 2, central = { x0: -w / 2, x1: w / 2, z0: cz - stairD / 2 - ring, z1: cz + stairD / 2 + ring };
    for (const hand of [entranceX > central.x0 + .7 ? 1 : -1]) {
      if (!fits(inner, central)) continue;
      const regions = pinwheelRegions(inner, central, hand);
      if (regions.every(r => r.polygon.length && project(r.polygon, r.side.V).max - r.side.v0 >= INTERIOR.minDepth)) {
        return { kind: 'pinwheel', L: central, ring, lift, hand, back: false, regions };
      }
    }
    const depth = stairD + ring;
    for (let z0 = b.minZ; z0 + depth <= b.maxZ - INTERIOR.minDepth; z0 += .05) {
      const L = { x0: -w / 2, x1: w / 2, z0, z1: z0 + depth };
      if (!fits(inner, L)) continue;
      const regions = sideRegions(inner, L);
      const front = regions.find(r => r.id === 'front');
      if (front?.polygon.length && project(front.polygon, front.side.V).max - front.side.v0 >= INTERIOR.minDepth) {
        return { kind: 'side-core', L, ring, lift, hand: entranceX >= 0 ? 1 : -1, back: true, regions };
      }
      break;
    }
  }
  return null;
}

function region(id, inner, planes, side) { return { id, polygon: clipAll(inner, planes), side }; }
function pinwheelRegions(inner, L, hand) {
  const sideX = { U: [0, 1], s: [L.z0, L.z1] }, sideZ = { U: [1, 0], s: [L.x0, L.x1] };
  return hand > 0 ? [
    region('front', inner, [[0, -1, -L.z1], [-1, 0, -L.x0]], { ...sideZ, V: [0, 1], v0: L.z1 }),
    region('right', inner, [[-1, 0, -L.x1], [0, 1, L.z1]], { ...sideX, V: [1, 0], v0: L.x1 }),
    region('back', inner, [[0, 1, L.z0], [1, 0, L.x1]], { ...sideZ, V: [0, -1], v0: -L.z0 }),
    region('left', inner, [[1, 0, L.x0], [0, -1, -L.z0]], { ...sideX, V: [-1, 0], v0: -L.x0 }),
  ] : [
    region('front', inner, [[0, -1, -L.z1], [1, 0, L.x1]], { ...sideZ, V: [0, 1], v0: L.z1 }),
    region('left', inner, [[1, 0, L.x0], [0, 1, L.z1]], { ...sideX, V: [-1, 0], v0: -L.x0 }),
    region('back', inner, [[0, 1, L.z0], [-1, 0, -L.x0]], { ...sideZ, V: [0, -1], v0: -L.z0 }),
    region('right', inner, [[-1, 0, -L.x1], [0, -1, -L.z0]], { ...sideX, V: [1, 0], v0: L.x1 }),
  ];
}
function sideRegions(inner, L) {
  const sideX = { U: [0, 1], s: [L.z0, L.z1] };
  return [
    region('front', inner, [[0, -1, -L.z1]], { U: [1, 0], s: [L.x0, L.x1], V: [0, 1], v0: L.z1 }),
    region('right', inner, [[-1, 0, -L.x1], [0, 1, L.z1]], { ...sideX, V: [1, 0], v0: L.x1 }),
    region('left', inner, [[1, 0, L.x0], [0, 1, L.z1]], { ...sideX, V: [-1, 0], v0: -L.x0 }),
    region('behind', inner, [[0, 1, L.z0], [-1, 0, -L.x0], [1, 0, L.x1]], null),
  ];
}

// Stair, lift and service shaft inside the landing rectangle, plus the
// landing strips that wrap them. Lanes run along Z; the near end faces +Z.
function coreZones(core) {
  const { L, ring, lift, hand, back } = core, S = INTERIOR.stair, stairW = S.lane * 2 + S.divider;
  const cx0 = L.x0 + ring, cx1 = L.x1 - ring, cz0 = back ? L.z0 : L.z0 + ring, cz1 = L.z1 - ring;
  const stair = hand > 0 ? { x0: cx0, x1: cx0 + stairW, z0: cz0, z1: cz1 } : { x0: cx1 - stairW, x1: cx1, z0: cz0, z1: cz1 };
  const up = hand > 0 ? { x0: stair.x0, x1: stair.x0 + S.lane } : { x0: stair.x1 - S.lane, x1: stair.x1 };
  const down = hand > 0 ? { x0: stair.x1 - S.lane, x1: stair.x1 } : { x0: stair.x0, x1: stair.x0 + S.lane };
  const divider = { x0: Math.min(up.x1, down.x1), x1: Math.max(up.x0, down.x0) };
  const zones = [{ kind: 'stair', polygon: rect(stair.x0, stair.z0, stair.x1, stair.z1) }];
  let liftRect = null;
  if (lift) {
    const x0 = hand > 0 ? stair.x1 : cx0, x1 = hand > 0 ? cx1 : stair.x0;
    liftRect = { x0, x1, z0: cz1 - INTERIOR.lift, z1: cz1 };
    zones.push({ kind: 'lift', polygon: rect(x0, liftRect.z0, x1, cz1) });
    if (liftRect.z0 - cz0 > .2) zones.push({ kind: 'shaft', polygon: rect(x0, cz0, x1, liftRect.z0) });
  }
  zones.push({ kind: 'landing', polygon: rect(L.x0, cz1, L.x1, L.z1) });
  zones.push({ kind: 'landing', polygon: rect(L.x0, cz0, cx0, cz1) }, { kind: 'landing', polygon: rect(cx1, cz0, L.x1, cz1) });
  if (!back) zones.push({ kind: 'landing', polygon: rect(L.x0, L.z0, L.x1, cz0) });
  return {
    zones, lift: liftRect,
    stair: { ...stair, up, down, divider, near: stair.z1, far: stair.z0 + S.landing, landing: S.landing },
  };
}

function floorRole(type, level, regionId, hasEntrance) {
  if (level === 0 && hasEntrance) return PUBLIC[type] ?? 'lobby';
  if (type === 'office') return 'office';
  if (type === 'civic') return level === 0 ? 'lobby' : 'office';
  if (type === 'market' && level === 0) return 'shop';
  return 'apartment';
}

// Units opening onto the landing: one, or two that split the shared side.
function unitsOf(polygon, side) {
  const [ux, uz] = side.U, length = side.s[1] - side.s[0];
  if (length < 5 || polygonArea(polygon) < 52) return [polygon];
  const cut = (side.s[0] + side.s[1]) / 2;
  return [clip(polygon, ux, uz, cut), clip(polygon, -ux, -uz, -cut)].filter(p => p.length);
}

function narrowness(polygon) {
  const b = bounds(polygon);
  return Math.min(b.maxX - b.minX, b.maxZ - b.minZ);
}

// Living space by the door; bedroom and bathroom beyond it.
function apartmentRooms(polygon, side, random) {
  const area = polygonArea(polygon), [vx, vz] = side.V, [ux, uz] = side.U;
  const depth = project(polygon, side.V).max - side.v0;
  if (area < 17 || narrowness(polygon) < 2.6) return [{ kind: 'studio', polygon, entry: true }];
  if (depth >= 6.2) {
    const split = side.v0 + Math.min(depth - 3, Math.max(3.1, depth * (.45 + random() * .1)));
    const front = clip(polygon, vx, vz, split), back = clip(polygon, -vx, -vz, -split);
    const rooms = [{ kind: 'living', polygon: front, entry: true }];
    const span = project(back, side.U);
    if (span.max - span.min >= 5.4) {
      const left = random() < .5, cut = left ? span.min + 2.2 : span.max - 2.2;
      const bath = left ? clip(back, ux, uz, cut) : clip(back, -ux, -uz, -cut);
      const bed = left ? clip(back, -ux, -uz, -cut) : clip(back, ux, uz, cut);
      rooms.push({ kind: 'bedroom', polygon: bed }, { kind: 'bath', polygon: bath });
    } else rooms.push({ kind: 'bedroom', polygon: back });
    return rooms.filter(r => r.polygon.length);
  }
  // Shallow units: living room at the door, bedroom beside it.
  const span = project(polygon, side.U), door = (Math.max(span.min, side.s[0]) + Math.min(span.max, side.s[1])) / 2;
  const toMin = door - span.min > span.max - door;
  const cut = toMin ? Math.max(span.min + 2.8, door - 2.2) : Math.min(span.max - 2.8, door + 2.2);
  const bed = toMin ? clip(polygon, ux, uz, cut) : clip(polygon, -ux, -uz, -cut);
  const living = toMin ? clip(polygon, -ux, -uz, -cut) : clip(polygon, ux, uz, cut);
  if (!bed.length || !living.length || narrowness(bed) < 2.4 || polygonArea(living) < 9) return [{ kind: 'studio', polygon, entry: true }];
  return [{ kind: 'living', polygon: living, entry: true }, { kind: 'bedroom', polygon: bed }];
}

function cutRooms(zones, rooms, room, parts, parent) {
  const entry = { ...room, id: `r${rooms.length}`, zones: [], parent };
  rooms.push(entry);
  for (const part of parts) {
    const target = part.entry || parts.length === 1 ? entry : { id: `r${rooms.length}`, kind: part.kind, unit: room.unit, zones: [], parent: entry.id };
    if (target !== entry) rooms.push(target);
    if (part.entry) entry.kind = part.kind;
    const zone = { id: `z${zones.length}`, kind: target.kind, polygon: part.polygon, room: target.id };
    zones.push(zone); target.zones.push(zone.id);
  }
}

// One floor layout, reused at every level with the same role.
function floorTemplate(plan, ctx, level, random) {
  const zones = [], rooms = [], open = new Map(), type = plan.type;
  const openRoom = kind => {
    if (!open.has(kind)) { const r = { id: `r${rooms.length}`, kind, unit: null, zones: [], parent: 'landing', open: true }; rooms.push(r); open.set(kind, r); }
    return open.get(kind);
  };
  const addZone = (kind, polygon, room) => { const z = { id: `z${zones.length}`, kind, polygon, room: room.id }; zones.push(z); room.zones.push(z.id); return z; };
  const entranceIn = polygon => level === 0 && plan.entrances.some(e => pointInConvex(polygon, e.x - e.nx * .6, e.z - e.nz * .6));
  let units = 0;
  if (ctx.layout === 'hall') {
    const hall = openRoom('hall'), b = bounds(plan.inner), z1 = b.minZ + 3.6;
    const office = clipAll(plan.inner, [[0, 1, z1], [1, 0, 2.1], [-1, 0, 2.1]]);
    for (const part of [clip(plan.inner, 0, -1, -z1), clipAll(plan.inner, [[0, 1, z1], [1, 0, -2.1]]), clipAll(plan.inner, [[0, 1, z1], [-1, 0, -2.1]])]) {
      if (part.length) addZone('hall', part, hall);
    }
    if (office.length) { const r = { id: `r${rooms.length}`, kind: 'office', unit: null, zones: [], parent: hall.id }; rooms.push(r); addZone('office', office, r); }
  } else if (ctx.layout === 'single') {
    const b = bounds(plan.inner), depth = b.maxZ - b.minZ, cut = b.minZ + depth * .45;
    const home = type === 'apartment' || type === 'terrace';
    const frontKind = home ? 'living' : type === 'market' ? 'shop' : 'office';
    const front = depth >= 6.5 ? clip(plan.inner, 0, -1, -cut) : plan.inner, back = depth >= 6.5 ? clip(plan.inner, 0, 1, cut) : [];
    const main = home ? { id: `r${rooms.length}`, kind: 'living', unit: units++, zones: [], parent: 'entrance' } : openRoom(frontKind);
    if (home) rooms.push(main);
    addZone(main.kind, front, main);
    if (back.length) {
      // Every back room keeps a wall on the cut line, so it opens off the front room.
      let parts = [{ kind: home ? 'bedroom' : type === 'market' ? 'storage' : 'meeting', polygon: back }];
      if (home && b.maxX - b.minX >= 5.4) {
        const x = random() < .5 ? b.minX + 2.2 : b.maxX - 2.2, bathLeft = x < 0;
        parts = [{ kind: 'bedroom', polygon: bathLeft ? clip(back, -1, 0, -x) : clip(back, 1, 0, x) }, { kind: 'bath', polygon: bathLeft ? clip(back, 1, 0, x) : clip(back, -1, 0, -x) }].filter(r => r.polygon.length);
      }
      for (const part of parts) {
        const r = { id: `r${rooms.length}`, kind: part.kind, unit: home ? main.unit : null, zones: [], parent: main.id };
        rooms.push(r); addZone(part.kind, part.polygon, r);
      }
    }
  } else {
    const landing = openRoom('landing');
    for (const z of ctx.core.zones) {
      if (z.kind === 'landing') addZone('landing', z.polygon, landing);
      // The stair opens onto the landing along its near edge; only the lift has a door.
      else { const r = { id: `r${rooms.length}`, kind: z.kind, unit: null, zones: [], parent: z.kind === 'lift' ? 'landing' : null }; rooms.push(r); addZone(z.kind, z.polygon, r); }
    }
    let meeting = type === 'office' || (type === 'civic' && level > 0);
    for (const reg of ctx.regions) {
      if (!reg.polygon.length) continue;
      if (!reg.side || polygonArea(reg.polygon) < 2.5) { const r = { id: `r${rooms.length}`, kind: 'void', unit: null, zones: [], parent: null }; rooms.push(r); addZone('void', reg.polygon, r); continue; }
      const role = floorRole(type, level, reg.id, entranceIn(reg.polygon));
      if (narrowness(reg.polygon) < 2.2 || polygonArea(reg.polygon) < 9) {
        const reach = reg.side.s[1] - reg.side.s[0] >= 1.3;
        const r = { id: `r${rooms.length}`, kind: reach ? 'storage' : 'void', unit: null, zones: [], parent: reach ? 'landing' : null };
        rooms.push(r); addZone(r.kind, reg.polygon, r); continue;
      }
      if (OPEN_KINDS.has(role)) {
        if (role === 'office' && meeting && reg.id !== 'front' && polygonArea(reg.polygon) <= 70) {
          meeting = false; const r = { id: `r${rooms.length}`, kind: 'meeting', unit: null, zones: [], parent: 'landing' }; rooms.push(r); addZone('meeting', reg.polygon, r);
        } else addZone(role, reg.polygon, openRoom(role));
        continue;
      }
      for (const unit of unitsOf(reg.polygon, reg.side)) {
        const parts = apartmentRooms(unit, reg.side, random);
        cutRooms(zones, rooms, { kind: 'living', unit: units++ }, parts, 'landing');
      }
    }
  }
  const template = { level: Math.min(level, 1), zones, rooms, units };
  buildWalls(plan, ctx, template, level);
  placeWindows(plan, ctx, template, level);
  furnish(plan, template, random);
  light(template);
  return template;
}

// Walls follow every shared zone edge between different, closed rooms.
function buildWalls(plan, ctx, template, level) {
  const { zones, rooms } = template, byId = new Map(rooms.map(r => [r.id, r])), walls = [], doors = [];
  const stair = ctx.core?.stair;
  const isOpen = (za, zb, seg) => {
    if (za.room === zb.room || (byId.get(za.room).open && byId.get(zb.room).open)) return true;
    const ka = za.kind, kb = zb.kind;
    if (stair && ((ka === 'stair' && kb === 'landing') || (kb === 'stair' && ka === 'landing'))) {
      return Math.abs(seg.a.z - stair.near) < 1e-4 && Math.abs(seg.b.z - stair.near) < 1e-4;
    }
    return false;
  };
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    for (const seg of sharedSegments(zones[i].polygon, zones[j].polygon)) {
      if (isOpen(zones[i], zones[j], seg)) continue;
      walls.push({ id: `w${walls.length}`, a: seg.a, b: seg.b, zones: [zones[i].id, zones[j].id], kind: [zones[i].kind, zones[j].kind].some(k => ['stair', 'lift', 'shaft'].includes(k)) ? 'core' : 'partition', openings: [] });
    }
  }
  const zoneRoom = new Map(zones.map(z => [z.id, z.room]));
  for (const room of rooms) {
    if (!room.parent || room.open || room.parent === 'entrance') continue;
    const parent = room.parent === 'landing' ? rooms.find(r => r.kind === 'landing') : byId.get(room.parent);
    if (!parent) continue;
    const candidates = walls.filter(w => {
      const [ra, rb] = w.zones.map(id => zoneRoom.get(id));
      return (ra === room.id && rb === parent.id) || (rb === room.id && ra === parent.id);
    }).map(w => ({ w, length: Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) })).filter(c => c.length >= INTERIOR.door.width + .3 && !c.w.openings.length);
    const best = candidates.sort((a, b) => b.length - a.length)[0];
    if (!best) { room.kind = 'void'; room.unreachable = true; continue; }
    const { w, length } = best, from = length / 2 - INTERIOR.door.width / 2;
    const id = `d${doors.length}`, t = .5, x = w.a.x + (w.b.x - w.a.x) * t, z = w.a.z + (w.b.z - w.a.z) * t;
    w.openings.push({ from, to: from + INTERIOR.door.width, bottom: 0, top: INTERIOR.door.height, door: id });
    doors.push({ id, wall: w.id, x, z, yaw: Math.atan2(w.b.x - w.a.x, w.b.z - w.a.z), width: INTERIOR.door.width, rooms: [room.id, parent.id], kind: room.kind === 'lift' ? 'lift' : room.unit !== null && room.unit !== undefined && parent.kind === 'landing' ? 'unit' : 'interior' });
  }
  for (const z of zones) z.kind = byId.get(z.room).kind;
  template.walls = walls; template.doors = doors;
}

// Perimeter windows sit on a bay grid along each inner wall. A window never
// straddles a partition or cuts through a street door.
function placeWindows(plan, ctx, template, level) {
  const style = plan.industrial ? INDUSTRIAL_WINDOWS : WINDOW_STYLES[plan.surface] ?? WINDOW_STYLES[1];
  const perimeter = [], windows = [];
  for (const zone of template.zones) {
    const faces = polygonFaces(zone.polygon);
    zone.polygon.forEach((a, i) => {
      const b = zone.polygon[(i + 1) % zone.polygon.length], face = faces[i];
      const innerFace = plan.innerFaces.findIndex(f => Math.abs(f.nx * face.nx + f.nz * face.nz - 1) < 1e-6 && Math.abs((a.x - f.x) * f.nx + (a.z - f.z) * f.nz) < 1e-4);
      if (innerFace >= 0) perimeter.push({ zone: zone.id, face: innerFace, a, b, openings: [] });
    });
  }
  for (const seg of perimeter) {
    const face = plan.innerFaces[seg.face], start = plan.inner[seg.face];
    const ux = -face.nz, uz = face.nx, t0 = (seg.a.x - start.x) * ux + (seg.a.z - start.z) * uz, t1 = (seg.b.x - start.x) * ux + (seg.b.z - start.z) * uz;
    const length = t1 - t0;
    if (level === 0) for (const e of plan.entrances) {
      if (Math.abs(e.nx * face.nx + e.nz * face.nz - 1) > 1e-3) continue;
      const along = (e.x - e.nx * INTERIOR.hull - seg.a.x) * ux + (e.z - e.nz * INTERIOR.hull - seg.a.z) * uz;
      if (along > -e.width / 2 && along < length + e.width / 2 && Math.abs((e.x - e.nx * INTERIOR.hull - seg.a.x) * face.nx + (e.z - e.nz * INTERIOR.hull - seg.a.z) * face.nz) < .05) {
        seg.openings.push({ from: Math.max(0, along - e.width / 2), to: Math.min(length, along + e.width / 2), bottom: 0, top: e.height, entrance: e.id });
      }
    }
    const kind = template.zones.find(z => z.id === seg.zone).kind;
    if (['lift', 'shaft', 'void'].includes(kind)) continue;
    const bay = Math.min(2.7, face.width), count = Math.max(face.width >= 1 ? 1 : 0, Math.floor(face.width / 2.7));
    const margin = (face.width - count * bay) / 2;
    for (let i = 0; i < count; i++) {
      const center = margin + bay * (i + .5), half = bay * style.width / 2;
      // Trim to this wall segment; drop slivers left beside a partition.
      const from = Math.max(.15, center - half - t0), to = Math.min(length - .15, center + half - t0);
      if (to - from < .6) continue;
      const head = Math.min(style.head, ctx.storey - .45);
      if (seg.openings.some(o => o.from < to + .2 && o.to > from - .2)) continue;
      seg.openings.push({ from, to, bottom: style.sill, top: head, window: true });
      windows.push({ zone: seg.zone, face: seg.face, x: seg.a.x + ux * (from + to) / 2, z: seg.a.z + uz * (from + to) / 2, width: to - from, bottom: style.sill, top: head, nx: face.nx, nz: face.nz });
    }
  }
  template.perimeter = perimeter; template.windows = windows;
}

const FURNITURE = {
  living: [['sofa', 2, .9, .8], ['counter', 2.4, .62, .92], ['shelf', 1.2, .4, 1.8], ['table', 1.2, .8, .75, 'free'], ['plant', .5, .5, 1.1]],
  bedroom: [['bed', 1.6, 2.05, .55], ['wardrobe', 1.2, .6, 2], ['desk', 1.2, .6, .75]],
  bath: [['tub', 1.7, .75, .55], ['sink', .6, .45, .85], ['toilet', .45, .7, .42]],
  studio: [['bed', 1.4, 2, .55], ['counter', 1.8, .62, .92], ['sofa', 1.6, .85, .8], ['wardrobe', 1, .6, 2]],
  office: [['shelf', 1.6, .45, 1.9], ['shelf', 1.6, .45, 1.9], ['desk', 1.6, .8, .75, 'grid']],
  meeting: [['table', 2.4, 1.1, .75, 'free'], ['shelf', 1.2, .4, 1.5]],
  lobby: [['reception', 2.4, .8, 1.1], ['mailboxes', 1.4, .3, 1.6], ['bench', 1.6, .5, .45], ['plant', .6, .6, 1.2], ['plant', .6, .6, 1.2]],
  shop: [['counter', 2.4, .7, 1], ['shelf', 2, .5, 1.8], ['shelf', 2, .5, 1.8], ['shelf', 2, .5, 1.8], ['display', 1.4, .9, .8, 'grid']],
  storage: [['shelf', 1.6, .5, 2], ['shelf', 1.6, .5, 2], ['crate', .9, .9, .9]],
  hall: [['rack', 3.6, 1.1, 2.8, 'grid'], ['crate', 1.2, 1.2, 1.2], ['crate', 1.2, 1.2, 1.2], ['crate', 1.2, 1.2, 1.2]],
};

function rectCorners(f) {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: f.x + i * f.w / 2 * c + j * f.d / 2 * s, z: f.z - i * f.w / 2 * s + j * f.d / 2 * c }));
}
function rectDistance(f, x, z) {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw), dx = x - f.x, dz = z - f.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - f.w / 2), Math.max(0, Math.abs(lz) - f.d / 2));
}
function rectsOverlap(a, b, gap) {
  if (Math.hypot(a.x - b.x, a.z - b.z) > (Math.hypot(a.w, a.d) + Math.hypot(b.w, b.d)) / 2 + gap) return false;
  const ca = rectCorners({ ...a, w: a.w + gap, d: a.d + gap }), cb = rectCorners(b);
  for (const f of [a, b]) for (const [ax, az] of [[Math.cos(f.yaw), -Math.sin(f.yaw)], [Math.sin(f.yaw), Math.cos(f.yaw)]]) {
    const pa = ca.map(p => p.x * ax + p.z * az), pb = cb.map(p => p.x * ax + p.z * az);
    if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
  }
  return true;
}

// Block furniture against real walls, keeping every doorway and its approach clear.
function furnish(plan, template, random) {
  const furniture = [], doorPoints = template.doors.map(d => ({ x: d.x, z: d.z }));
  for (const seg of template.perimeter) for (const o of seg.openings) if (o.entrance) {
    const t = (o.from + o.to) / 2, length = Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z);
    doorPoints.push({ x: seg.a.x + (seg.b.x - seg.a.x) * t / length, z: seg.a.z + (seg.b.z - seg.a.z) * t / length });
  }
  if (plan.core) {
    const s = plan.core.stair;
    for (const lane of [s.up, s.down]) doorPoints.push({ x: (lane.x0 + lane.x1) / 2, z: s.near });
  }
  for (const zone of template.zones) {
    const list = FURNITURE[zone.kind];
    if (!list) continue;
    const segments = [];
    for (const seg of template.perimeter) if (seg.zone === zone.id) segments.push({ a: seg.a, b: seg.b, offset: .04 });
    for (const w of template.walls) if (w.zones.includes(zone.id)) {
      const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 }, length = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
      const nx = -(w.b.z - w.a.z) / length, nz = (w.b.x - w.a.x) / length, probe = pointInConvex(zone.polygon, mid.x + nx * .05, mid.z + nz * .05);
      segments.push(probe ? { a: w.a, b: w.b, offset: INTERIOR.partition / 2 + .04 } : { a: w.b, b: w.a, offset: INTERIOR.partition / 2 + .04 });
    }
    const placed = [];
    const ok = (f, gap = .08) => rectCorners(f).every(p => pointInConvex(zone.polygon, p.x, p.z, .02)) &&
      !placed.some(o => rectsOverlap(f, o, gap)) &&
      doorPoints.every(p => rectDistance(f, p.x, p.z) > INTERIOR.door.clearance + (f.mode === 'free' || f.mode === 'grid' ? .5 : 0));
    for (const [item, w, d, h, mode = 'wall'] of list) {
      if (mode === 'wall') {
        const order = segments.map((s, i) => ({ s, k: random() + i * 1e-3 })).sort((a, b) => a.k - b.k).map(o => o.s);
        let done = false;
        for (const seg of order) {
          const length = Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z);
          if (length < w + .2) continue;
          const ux = (seg.b.x - seg.a.x) / length, uz = (seg.b.z - seg.a.z) / length, nx = -uz, nz = ux;
          const start = random();
          for (let k = 0; k < 8 && !done; k++) {
            const t = w / 2 + .1 + ((start + k * .382) % 1) * (length - w - .2);
            const f = { item, mode, w, d, h, zone: zone.id, x: seg.a.x + ux * t + nx * (seg.offset + d / 2), z: seg.a.z + uz * t + nz * (seg.offset + d / 2), yaw: Math.atan2(nx, nz) };
            if (ok(f)) { placed.push(f); done = true; }
          }
          if (done) break;
        }
      } else {
        const b = bounds(zone.polygon), aisle = mode === 'grid' ? (item === 'rack' ? 2 : 1.3) : 0;
        const center = polygonCentroid(zone.polygon);
        const candidates = mode === 'free' ? [center] : [];
        if (mode === 'grid') for (let x = b.minX + 1.4 + w / 2; x <= b.maxX - 1.4 - w / 2; x += w + aisle) for (let z = b.minZ + 1.4 + d / 2; z <= b.maxZ - 1.4 - d / 2; z += d + aisle) candidates.push({ x, z });
        for (const c of candidates.slice(0, 24)) {
          const f = { item, mode, w, d, h, zone: zone.id, x: c.x, z: c.z, yaw: 0 };
          if (rectCorners(f).every(p => pointInConvex(zone.polygon, p.x, p.z, mode === 'grid' ? 1 : .9)) && ok(f, .9)) placed.push(f);
        }
      }
    }
    furniture.push(...placed);
  }
  template.furniture = furniture.map((f, i) => ({ id: `f${i}`, ...f }));
}

function light(template) {
  const lights = [];
  for (const zone of template.zones) {
    if (['shaft', 'void'].includes(zone.kind)) continue;
    const b = bounds(zone.polygon), spacing = zone.kind === 'hall' ? 7 : 4.6, points = [];
    for (let x = b.minX + spacing / 2; x < b.maxX; x += spacing) for (let z = b.minZ + spacing / 2; z < b.maxZ; z += spacing) {
      if (pointInConvex(zone.polygon, x, z, .5)) points.push({ x, z });
    }
    if (!points.length) points.push(polygonCentroid(zone.polygon));
    for (const p of points) lights.push({ zone: zone.id, room: zone.room, x: p.x, z: p.z });
  }
  template.lights = lights;
}

const cache = new Map();
/** The deterministic interior of a blueprint's base volume, or null. */
export function interiorPlan(p) {
  const design = buildingDesign(p), volumes = buildingVolumes(p, design), base = volumes[0];
  if (base.h < INTERIOR.minHeight) return null;
  const outline = footprintVertices(p.footprint, p.w, p.d), inner = insetConvex(outline, INTERIOR.hull);
  if (!inner.length) return null;
  const freight = p.type === 'warehouse' || p.type === 'factory', entrances = buildingEntrances(p, design);
  const floor0 = p.y + INTERIOR.floorOffset, top = p.y + base.y + base.h / 2;
  let levels = freight ? 1 : Math.max(1, Math.floor((base.h - .1) / INTERIOR.storey));
  const main = entrances[0];
  const core = levels > 1 ? placeCore(inner, levels, main.x) : null;
  if (levels > 1 && !core) levels = 1;
  const layout = freight ? 'hall' : core ? core.kind : 'single';
  const plan = {
    id: p.id, revision: INTERIOR.revision, name: p.sign?.title ?? null, type: p.type, layout, footprint: p.footprint ?? 'rectangle',
    origin: { x: p.x, z: p.z, yaw: p.yaw ?? 0 }, ground: p.ground ?? p.y, floor0, top, roof: top + .5, levels,
    storey: INTERIOR.storey, ceiling: levels === 1 ? top : floor0 + INTERIOR.storey - INTERIOR.slab,
    surface: design.surface, windowLighting: design.windowLighting, industrial: freight, color: design.color, accent: design.accent,
    outline, inner, innerFaces: polygonFaces(inner), entrances, core: null, templates: null,
  };
  const ctx = { layout, storey: levels === 1 ? top - floor0 : INTERIOR.storey, regions: core?.regions ?? [], core: null };
  if (core) {
    const zones = coreZones(core);
    ctx.core = zones;
    plan.core = { landing: core.L, lift: zones.lift, stair: zones.stair, hand: core.hand };
  }
  plan.templates = [floorTemplate(plan, ctx, 0, seededRandom(hash(`${p.id}:interior:ground`)))];
  if (levels > 1) plan.templates.push(floorTemplate(plan, ctx, 1, seededRandom(hash(`${p.id}:interior:upper`))));
  return plan;
}

/** Shared, bounded cache for streamed buildings. Plans are immutable once made. */
export function cachedInteriorPlan(p) {
  if (cache.has(p.id)) { const plan = cache.get(p.id); cache.delete(p.id); cache.set(p.id, plan); return plan; }
  const plan = interiorPlan(p);
  cache.set(p.id, plan);
  while (cache.size > 48) cache.delete(cache.keys().next().value);
  return plan;
}

export const levelLabel = level => String(level + 1);
export function levelY(plan, level) { return plan.floor0 + level * INTERIOR.storey; }
export function levelCeiling(plan, level) { return level >= plan.levels - 1 ? plan.top : levelY(plan, level + 1) - INTERIOR.slab; }
export function levelAt(plan, y) {
  return Math.max(0, Math.min(plan.levels - 1, Math.floor((y - plan.floor0 + .6) / INTERIOR.storey)));
}

/** Rooms and units with stable IDs at one level. */
export function floorPlan(plan, level) {
  const template = plan.templates[Math.min(level, plan.templates.length - 1)], label = levelLabel(level);
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ', unitIds = new Map();
  const unitId = index => {
    if (!unitIds.has(index)) unitIds.set(index, `${plan.id}/${label}${letters[unitIds.size] ?? unitIds.size}`);
    return unitIds.get(index);
  };
  const lit = plan.windowLighting === 'lit' ? .72 : .38, counts = new Map();
  const rooms = template.rooms.map(r => {
    const unit = r.unit === null || r.unit === undefined ? null : unitId(r.unit);
    const key = `${unit ?? `${plan.id}/${label}`}:${r.kind}`, n = (counts.get(key) ?? 0) + 1; counts.set(key, n);
    const on = unit ? (hash(`${unit}:lights`) % 1000) / 1000 < lit : !['void', 'shaft'].includes(r.kind);
    return { id: n > 1 ? `${key}-${n}` : key, local: r.id, kind: r.kind, unit, zones: r.zones, lit: on };
  });
  const units = [...unitIds.values()].map(id => ({ id, label: id.slice(plan.id.length + 1), rooms: rooms.filter(r => r.unit === id).map(r => r.id) }));
  return { level, label, y: levelY(plan, level), ceiling: levelCeiling(plan, level), template, rooms, units };
}

export function roomAt(plan, level, x, z) {
  const floor = floorPlan(plan, level), zone = floor.template.zones.find(zn => pointInConvex(zn.polygon, x, z, -.05));
  return zone ? floor.rooms.find(r => r.local === zone.room) ?? null : null;
}

/** Every unit in a building, for attaching residents later. */
export function buildingUnits(p) {
  const plan = interiorPlan(p);
  if (!plan) return [];
  return Array.from({ length: plan.levels }, (_, level) => floorPlan(plan, level).units.map(u => ({ ...u, level }))).flat();
}
