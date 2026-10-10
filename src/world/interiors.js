import * as THREE from 'three';
import { INTERIOR, cachedInteriorPlan, floorPlan, levelY } from './interior-plan.js';
import { buildingEntrances } from './building-design.js';
import { polygonCentroid } from './building-footprints.js';
import { toWorld } from './interior-physics.js';

// Interior meshes are built on demand per floor, in building-local space. All
// lighting is baked into vertex colors on unlit materials: no scene lights are
// added, so the city's shader programs never change when a room appears.
const FLOOR = { living: 0x8b6a4e, studio: 0x86684f, bedroom: 0x76707f, bath: 0xb4c1c4, office: 0x5c6670, meeting: 0x535d68,
  lobby: 0xb3aa98, shop: 0xc1b6a3, hall: 0x77796f, storage: 0x6d6f6a, landing: 0x96918a, stair: 0x8c8882, lift: 0x5c6670, void: 0x3b3d40, shaft: 0x3b3d40 };
const WALLS = [0xd9d2c3, 0xc6d3cb, 0xd6c5bf, 0xc4cbd8, 0xe0d5ba, 0xcdc1d6, 0xb9cbbf, 0xd8cbb3];
const PUBLIC_WALL = { lobby: 0xcfc6b4, landing: 0xc2bdb2, stair: 0xb9b4aa, lift: 0x9aa4ab, office: 0xd5d8d6, meeting: 0xc7cfd6, shop: 0xe2d9c6, hall: 0xa9aca4, storage: 0xa6a69d, shaft: 0x6a6c6c, void: 0x6a6c6c };
const ITEMS = { sofa: 0x5b6f86, counter: 0xd8d4cb, shelf: 0x6e5440, table: 0x8a6545, plant: 0x4f7a4c, bed: 0x6a7f99, wardrobe: 0x8c6c52,
  desk: 0x9a8a76, tub: 0xe6e8e6, sink: 0xe0e2e0, toilet: 0xeeeeea, reception: 0x3f4b55, mailboxes: 0x8e9aa1, bench: 0x7a6650,
  display: 0xb7a07f, crate: 0x9a7b55, rack: 0x4f6a78 };
const color = new THREE.Color();
const rgb = hex => { color.setHex(hex); return [color.r, color.g, color.b]; };

class Builder {
  constructor() { this.position = []; this.color = []; }
  vertex(x, y, z, c) { this.position.push(x, y, z); this.color.push(c[0], c[1], c[2]); }
  quad(a, b, c, d, shade) {
    const ca = shade(a), cb = shade(b), cc = shade(c), cd = shade(d);
    this.vertex(a.x, a.y, a.z, ca); this.vertex(b.x, b.y, b.z, cb); this.vertex(c.x, c.y, c.z, cc);
    this.vertex(a.x, a.y, a.z, ca); this.vertex(c.x, c.y, c.z, cc); this.vertex(d.x, d.y, d.z, cd);
  }
  // Oriented box in building-local space; yaw follows the physics convention.
  box(x, y, z, w, h, d, yaw, shade) {
    const c = Math.cos(yaw), s = Math.sin(yaw), at = (i, j, k) => ({ x: x + i * w / 2 * c + k * d / 2 * s, y: y + j * h / 2, z: z - i * w / 2 * s + k * d / 2 * c });
    const faces = [[[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
      [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
      [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]];
    const normals = [[s, 0, c], [-s, 0, -c], [c, 0, -s], [-c, 0, s], [0, 1, 0], [0, -1, 0]];
    faces.forEach((f, n) => this.quad(...f.map(v => at(...v)), p => shade(p, normals[n])));
  }
  get empty() { return !this.position.length; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    g.computeBoundingSphere(); return g;
  }
}

function lighting(plan, floor) {
  const rooms = new Map(floor.rooms.map(r => [r.local, r])), zones = new Map(floor.template.zones.map(z => [z.id, z]));
  const lights = floor.template.lights.filter(l => rooms.get(l.room)?.lit), ceiling = floor.ceiling;
  return (zoneId, albedo) => (p, n = [0, 1, 0]) => {
    const zone = zones.get(zoneId), room = zone ? rooms.get(zone.room) : null, lit = room?.lit ?? true;
    let warm = 0;
    for (const l of lights) if (!room || l.room === room.local) {
      const dx = p.x - l.x, dz = p.z - l.z, dy = ceiling - p.y, d2 = dx * dx + dz * dz + dy * dy * .5;
      warm += Math.exp(-d2 / 16) * (n[1] < -.5 ? .45 : 1);
    }
    // Warm fixtures over a cool, dim moonlit ambient keep rooms readable without
    // washing out after tone mapping and bloom.
    const base = lit ? .17 : .085, face = n[1] > .5 ? 1 : n[1] < -.5 ? .7 : .86, k = Math.min(1.2, warm) * .5;
    return [albedo[0] * (base + k + .02) * face, albedo[1] * (base + k * .86 + .035) * face, albedo[2] * (base + k * .66 + .06) * face];
  };
}

function wallColor(plan, floor, zone) {
  const room = floor.rooms.find(r => r.local === zone?.room);
  if (!room) return PUBLIC_WALL.landing;
  if (room.unit) return WALLS[[...room.unit].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % WALLS.length];
  return PUBLIC_WALL[room.kind] ?? PUBLIC_WALL.landing;
}

// Fan triangulation from the centroid gives each zone a soft light gradient.
function polygonSurface(builder, polygon, y, down, shade) {
  const c = polygonCentroid(polygon), center = { x: c.x, y, z: c.z }, normal = [0, down ? -1 : 1, 0];
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length], m = { x: (a.x + b.x) / 2, y, z: (a.z + b.z) / 2 };
    const pa = { x: a.x, y, z: a.z }, pb = { x: b.x, y, z: b.z };
    for (const [p, q] of [[pa, m], [m, pb]]) {
      const tri = down ? [center, q, p] : [center, p, q];
      const shadeN = v => shade(v, normal);
      builder.vertex(tri[0].x, tri[0].y, tri[0].z, shadeN(tri[0])); builder.vertex(tri[1].x, tri[1].y, tri[1].z, shadeN(tri[1])); builder.vertex(tri[2].x, tri[2].y, tri[2].z, shadeN(tri[2]));
    }
  });
}

// A vertical strip along a→b between distances t0..t1 and heights y0..y1,
// subdivided so baked light can vary along it. `offset` moves it sideways.
function strip(builder, a, b, t0, t1, y0, y1, shade, normal, offset = 0) {
  const length = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
  const steps = Math.max(1, Math.ceil((t1 - t0) / 1.6)), rows = y1 - y0 > 1.6 ? 2 : 1;
  const at = (t, y) => ({ x: a.x + ux * t - uz * offset, y, z: a.z + uz * t + ux * offset });
  for (let i = 0; i < steps; i++) for (let j = 0; j < rows; j++) {
    const ta = t0 + (t1 - t0) * i / steps, tb = t0 + (t1 - t0) * (i + 1) / steps;
    const ya = y0 + (y1 - y0) * j / rows, yb = y0 + (y1 - y0) * (j + 1) / rows;
    builder.quad(at(ta, ya), at(tb, ya), at(tb, yb), at(ta, yb), p => shade(p, normal));
  }
}

function furniturePiece(builder, f, y, shade) {
  const base = rgb(ITEMS[f.item] ?? 0x888888), light = rgb(0xe9e4da), dark = rgb(0x3a3f44), green = rgb(0x5f9a58);
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  const part = (lx, ly, lz, w, h, d, albedo) => builder.box(f.x + lx * c + lz * s, y + ly, f.z - lx * s + lz * c, w, h, d, f.yaw, shade(albedo));
  const { w, d, h } = f;
  switch (f.item) {
    case 'bed': part(0, .18, 0, w, .36, d, base); part(0, .44, .05, w - .08, .16, d - .14, light); part(0, .56, -d / 2 + .3, w * .8, .12, .35, light); part(0, .55, -d / 2 + .04, w, 1.1, .08, base); break;
    case 'sofa': part(0, .22, .05, w, .44, d - .1, base); part(0, .62, -d / 2 + .12, w, .5, .24, base); for (const k of [-1, 1]) part(k * (w / 2 - .1), .32, 0, .2, .64, d, base); break;
    case 'counter': part(0, h / 2 - .02, 0, w, h - .04, d, base); part(0, h - .02, .02, w + .02, .04, d + .04, rgb(0x6b6f72)); part(0, 1.7, -d / 2 + .18, w, .7, .36, base); break;
    case 'table': case 'reception': part(0, h - .03, 0, w, .06, d, f.item === 'reception' ? light : base); part(0, (h - .06) / 2, 0, f.item === 'reception' ? w : .14, h - .06, f.item === 'reception' ? d : .14, base); break;
    case 'desk': part(0, h - .03, 0, w, .05, d, base); for (const k of [-1, 1]) part(k * (w / 2 - .03), (h - .05) / 2, 0, .05, h - .05, d, dark); part(0, h + .22, -d / 2 + .15, .55, .34, .04, dark); break;
    case 'shelf': part(0, h / 2, 0, w, h, d, base); for (let k = 1; k < 4; k++) part(0, h * k / 4, .02, w - .08, .03, d - .02, light); break;
    case 'plant': part(0, .2, 0, w * .7, .4, d * .7, rgb(0x6b5a4c)); part(0, .4 + (h - .4) / 2, 0, w, h - .4, d, green); break;
    case 'tub': part(0, h / 2, 0, w, h, d, base); part(0, h - .02, 0, w - .14, .03, d - .14, rgb(0x9fb6c0)); break;
    case 'bench': part(0, h - .04, 0, w, .08, d, base); for (const k of [-1, 1]) part(k * (w / 2 - .1), (h - .08) / 2, 0, .08, h - .08, d * .8, dark); break;
    case 'rack': for (const k of [-1, 1]) part(k * (w / 2 - .05), h / 2, 0, .1, h, d, base); for (const ly of [.15, h / 2, h - .1]) part(0, ly, 0, w, .06, d, base);
      part(-w / 4, .45, 0, w * .35, .5, d * .8, rgb(ITEMS.crate)); part(w / 5, h / 2 + .3, 0, w * .4, .55, d * .8, rgb(0x8a8f7a)); break;
    default: part(0, h / 2, 0, w, h, d, base);
  }
}

// One floor's static geometry plus its door leaves and glazing.
function buildFloor(plan, level) {
  const floor = floorPlan(plan, level), t = floor.template, y = floor.y, top = level >= plan.levels - 1 ? plan.top : levelY(plan, level + 1);
  const shadeFor = lighting(plan, floor), zones = new Map(t.zones.map(z => [z.id, z]));
  const surfaces = new Builder(), fixtures = new Builder(), glass = new Builder(), doors = [];
  const stairZone = t.zones.find(z => z.kind === 'stair');
  for (const zone of t.zones) {
    if (zone !== stairZone || level === 0) polygonSurface(surfaces, zone.polygon, y + .002, false, shadeFor(zone.id, rgb(FLOOR[zone.kind] ?? 0x888888)));
    if (zone !== stairZone || level >= plan.levels - 1) polygonSurface(surfaces, zone.polygon, floor.ceiling - .002, true, shadeFor(zone.id, rgb(0xdedbd2)));
  }
  // Slab edges around the stair well, seen from the flights.
  if (stairZone && level < plan.levels - 1) stairZone.polygon.forEach((a, i) => {
    const b = stairZone.polygon[(i + 1) % stairZone.polygon.length];
    strip(surfaces, a, b, 0, Math.hypot(b.x - a.x, b.z - a.z), floor.ceiling, top, shadeFor(stairZone.id, rgb(0xb8b3a8)), [0, 0, 1]);
  });
  for (const seg of t.perimeter) {
    const zone = zones.get(seg.zone), albedo = rgb(wallColor(plan, floor, zone)), shade = shadeFor(seg.zone, albedo);
    const length = Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z), normal = [-(seg.b.z - seg.a.z) / length, 0, (seg.b.x - seg.a.x) / length];
    const openings = [...seg.openings].sort((p, q) => p.from - q.from);
    let cursor = 0;
    for (const o of openings) {
      if (o.from > cursor) strip(surfaces, seg.a, seg.b, cursor, o.from, y, top, shade, normal);
      if (o.bottom > 0) strip(surfaces, seg.a, seg.b, o.from, o.to, y, y + o.bottom, shade, normal);
      strip(surfaces, seg.a, seg.b, o.from, o.to, y + o.top, top, shade, normal);
      // Reveals run out to the shell plane; windows get a faint pane.
      const reveal = shadeFor(seg.zone, albedo.map(v => v * .8)), depth = -INTERIOR.hull;
      const ux = (seg.b.x - seg.a.x) / length, uz = (seg.b.z - seg.a.z) / length;
      const p = (tt, yy, off) => ({ x: seg.a.x + ux * tt - uz * off, y: yy, z: seg.a.z + uz * tt + ux * off });
      for (const tt of [o.from, o.to]) surfaces.quad(p(tt, y + o.bottom, 0), p(tt, y + o.bottom, depth), p(tt, y + o.top, depth), p(tt, y + o.top, 0), q => reveal(q, normal));
      surfaces.quad(p(o.from, y + o.top, 0), p(o.to, y + o.top, 0), p(o.to, y + o.top, depth), p(o.from, y + o.top, depth), q => reveal(q, [0, -1, 0]));
      if (o.bottom > 0) surfaces.quad(p(o.from, y + o.bottom, 0), p(o.to, y + o.bottom, 0), p(o.to, y + o.bottom, depth), p(o.from, y + o.bottom, depth), q => reveal(q, [0, 1, 0]));
      if (o.window) glass.quad(p(o.from, y + o.bottom, depth + .05), p(o.to, y + o.bottom, depth + .05), p(o.to, y + o.top, depth + .05), p(o.from, y + o.top, depth + .05), () => [1, 1, 1]);
      if (o.entrance) {
        const mid = (o.from + o.to) / 2, half = (o.to - o.from) / 2;
        for (const side of [-1, 1]) doors.push({ kind: 'entrance', x: seg.a.x + ux * (mid + side * half / 2) - uz * (depth / 2), z: seg.a.z + uz * (mid + side * half / 2) + ux * (depth / 2),
          ux: ux * side, uz: uz * side, w: half, h: o.top, travel: half * .95, y });
      }
      cursor = Math.max(cursor, o.to);
    }
    if (length > cursor) strip(surfaces, seg.a, seg.b, cursor, length, y, top, shade, normal);
  }
  for (const wall of t.walls) {
    const length = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z), ux = (wall.b.x - wall.a.x) / length, uz = (wall.b.z - wall.a.z) / length;
    const thick = wall.kind === 'core' ? .2 : INTERIOR.partition, left = [-uz, 0, ux], right = [uz, 0, -ux];
    // Each face takes the paint and light of the room it faces.
    const [za, zb] = wall.zones.map(id => zones.get(id));
    const probe = { x: (wall.a.x + wall.b.x) / 2 - uz * .2, z: (wall.a.z + wall.b.z) / 2 + ux * .2 };
    const leftZone = za && pointInZone(za, probe) ? za : zb, rightZone = leftZone === za ? zb : za;
    const faces = [[leftZone, left, thick / 2], [rightZone, right, -thick / 2]];
    const openings = [...wall.openings].sort((p, q) => p.from - q.from);
    const solid = (t0, t1, y0, y1) => {
      for (const [zone, normal, off] of faces) strip(surfaces, wall.a, wall.b, t0, t1, y0, y1, shadeFor(zone?.id, rgb(wallColor(plan, floor, zone))), normal, off);
      for (const tt of [t0, t1]) {
        const p = off => ({ x: wall.a.x + ux * tt - uz * off, z: wall.a.z + uz * tt + ux * off });
        const pa = p(thick / 2), pb = p(-thick / 2), trim = shadeFor(leftZone?.id, rgb(0xcfcac0));
        surfaces.quad({ ...pa, y: y0 }, { ...pb, y: y0 }, { ...pb, y: y1 }, { ...pa, y: y1 }, q => trim(q, [ux, 0, uz]));
      }
    };
    let cursor = 0;
    for (const o of openings) {
      if (o.from > cursor) solid(cursor, o.from, y, top);
      solid(o.from, o.to, y + o.top, top);
      const door = t.doors.find(dd => dd.id === o.door);
      if (door) doors.push({ kind: door.kind, x: door.x, z: door.z, ux, uz, w: o.to - o.from, h: o.top, travel: (o.to - o.from) * .92, y });
      cursor = o.to;
    }
    if (length > cursor) solid(cursor, length, y, top);
  }
  if (plan.core) {
    const s = plan.core.stair, S = INTERIOR.stair, steps = Math.round(S.rise / .15), tread = S.run / steps;
    const stone = shadeFor(stairZone?.id, rgb(0x9d988f)), lane = l => (l.x0 + l.x1) / 2, width = s.up.x1 - s.up.x0;
    if (level < plan.levels - 1) {
      for (let i = 0; i < steps; i++) {
        const upTop = y + (i + 1) * .15, downTop = y + S.rise + (i + 1) * .15;
        surfaces.box(lane(s.up), upTop - .2, s.near - (i + .5) * tread, width, .4, tread, 0, stone);
        surfaces.box(lane(s.down), downTop - .2, s.far + (i + .5) * tread, width, .4, tread, 0, stone);
      }
      surfaces.box((s.x0 + s.x1) / 2, y + S.rise - .15, (s.z0 + s.far) / 2, s.x1 - s.x0, .3, s.far - s.z0, 0, stone);
      surfaces.box((s.divider.x0 + s.divider.x1) / 2, (y + top) / 2, (s.far + s.near) / 2, s.divider.x1 - s.divider.x0, top - y, s.near - s.far, 0, shadeFor(stairZone?.id, rgb(0xc2bdb2)));
    } else {
      surfaces.box((s.divider.x0 + s.divider.x1) / 2, y + .55, (s.far + s.near) / 2, s.divider.x1 - s.divider.x0, 1.1, s.near - s.far, 0, shadeFor(stairZone?.id, rgb(0xc2bdb2)));
      surfaces.box(lane(s.up), y + 1.05, s.near - .05, width, .08, .1, 0, stone);
      for (const k of [-1, 0, 1]) surfaces.box(lane(s.up) + k * (width / 2 - .05), y + .5, s.near - .05, .05, 1, .05, 0, stone);
    }
    if (level === 0) surfaces.box(lane(s.down), y + INTERIOR.door.height / 2, s.near - .05, width, INTERIOR.door.height, .1, 0, shadeFor(stairZone?.id, rgb(0xb0aa9e)));
    if (plan.core.lift) {
      const l = plan.core.lift, panel = { x: s.x0 < l.x0 ? l.x1 - .2 : l.x0 + .2, z: l.z1 + .12 };
      fixtures.box(panel.x, y + 1.25, panel.z, .14, .22, .04, 0, () => [.4, 1.3, 1.5]);
    }
  }
  for (const f of t.furniture) furniturePiece(surfaces, f, y, albedo => (p, n) => shadeFor(f.zone, albedo)(p, n));
  for (const l of t.lights) {
    const room = floor.rooms.find(r => r.local === l.room), lit = room?.lit;
    const glow = lit ? [2.1, 1.85, 1.5] : [.16, .16, .17];
    const yy = floor.ceiling - .01, h = .32;
    fixtures.quad({ x: l.x - h, y: yy, z: l.z - h }, { x: l.x + h, y: yy, z: l.z - h }, { x: l.x + h, y: yy, z: l.z + h }, { x: l.x - h, y: yy, z: l.z + h }, () => glow);
  }
  return { floor, surfaces, fixtures, glass, doors };
}

function pointInZone(zone, p) {
  return zone.polygon.every((a, i) => {
    const b = zone.polygon[(i + 1) % zone.polygon.length];
    return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) >= -1e-6;
  });
}

const leafGeometry = new THREE.BoxGeometry(1, 1, 1);
export function createInteriors(scene, city) {
  const root = new THREE.Group(); root.name = 'Interiors'; scene.add(root);
  const materials = {
    surface: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    fixture: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }),
    glass: new THREE.MeshBasicMaterial({ color: 0x9fc4d6, transparent: true, opacity: .14, depthWrite: false, side: THREE.DoubleSide }),
    leaf: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    glassLeaf: new THREE.MeshBasicMaterial({ color: 0x9fc4d6, transparent: true, opacity: .32, depthWrite: false }),
  };
  for (const [name, m] of Object.entries(materials)) m.name = `interior-${name}`;
  // One hidden triangle per material lets the initial renderer.compile cover them.
  const warm = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, -900, 0, .01, -900, 0, 0, -900, .01], 3));
  warm.setAttribute('color', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
  for (const m of Object.values(materials)) { const mesh = new THREE.Mesh(warm, m); mesh.frustumCulled = false; mesh.name = 'Interior warmup'; root.add(mesh); }
  const active = new Map(), uniforms = city.interiorClip;
  let scanAt = -Infinity, wanted = [], built = 0;

  function disposeFloor(entry) {
    for (const child of entry.group.children) { child.geometry !== leafGeometry && child.geometry.dispose(); if (child.isInstancedMesh) child.dispose(); }
    entry.group.removeFromParent();
  }
  function disposeBuilding(b) { for (const f of b.floors.values()) disposeFloor(f); b.group.removeFromParent(); }

  function materialize(b, level, now) {
    const { floor, surfaces, fixtures, glass, doors } = buildFloor(b.plan, level), group = new THREE.Group();
    group.name = `Interior ${b.plan.id} level ${level}`;
    for (const [builder, material] of [[surfaces, materials.surface], [fixtures, materials.fixture], [glass, materials.glass]]) {
      if (builder.empty) continue;
      const mesh = new THREE.Mesh(builder.geometry(), material); mesh.matrixAutoUpdate = false; mesh.castShadow = false; mesh.receiveShadow = false; group.add(mesh);
    }
    const solid = doors.filter(d => d.kind !== 'entrance'), glassy = doors.filter(d => d.kind === 'entrance');
    const leaves = [];
    for (const [list, material] of [[solid, materials.leaf], [glassy, materials.glassLeaf]]) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(leafGeometry, material, list.length); mesh.frustumCulled = false; group.add(mesh);
      list.forEach((d, i) => {
        if (material === materials.leaf) mesh.setColorAt(i, color.setHex(d.kind === 'lift' ? 0x7a858c : 0x5e4a3c));
        const world = toWorld(b.plan, d.x, d.z);
        leaves.push({ ...d, mesh, index: i, open: 0, world });
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    group.matrixAutoUpdate = false; b.group.add(group);
    const entry = { level, group, leaves, floor, lastWanted: now, triangles: (surfaces.position.length + fixtures.position.length + glass.position.length) / 9 };
    animateDoors(entry, null, 0, true);
    return entry;
  }

  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), position = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function animateDoors(entry, player, dt, force = false) {
    const touched = new Set();
    for (const leaf of entry.leaves) {
      const near = player && Math.abs(player.y - leaf.y) < 2 && Math.hypot(player.x - leaf.world.x, player.z - leaf.world.z) < (leaf.kind === 'entrance' ? 3 : 1.9);
      const target = near ? 1 : 0, before = leaf.open;
      leaf.open += Math.sign(target - leaf.open) * Math.min(Math.abs(target - leaf.open), dt * 3.2);
      if (!force && Math.abs(before - leaf.open) < 1e-5) continue;
      // Leaves slide along their wall: pocket doors, and paired glass doors at the street.
      const slide = leaf.open * leaf.travel;
      position.set(leaf.x + leaf.ux * slide, leaf.y + leaf.h / 2, leaf.z + leaf.uz * slide);
      quaternion.setFromAxisAngle(up, Math.atan2(-leaf.uz, leaf.ux)); scale.set(leaf.w, leaf.h, leaf.kind === 'entrance' ? .03 : .05);
      leaf.mesh.setMatrixAt(leaf.index, matrix.compose(position, quaternion, scale)); touched.add(leaf.mesh);
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }

  function scan(player, context) {
    const options = [];
    for (const p of city.metropolis.buildingsNear(player.x, player.z, 26)) {
      if (Math.abs(player.y - p.y) > 9 && context?.id !== p.id) continue;
      const frame = { origin: { x: p.x, z: p.z, yaw: p.yaw ?? 0 } };
      const distance = Math.min(...buildingEntrances(p).map(e => { const w = toWorld(frame, e.x, e.z); return Math.hypot(w.x - player.x, w.z - player.z); }));
      if (distance < 25) options.push({ p, distance });
    }
    options.sort((a, b) => a.distance - b.distance);
    wanted = options.slice(0, 2).map(o => o.p);
    if (context && !wanted.some(p => p.id === context.id)) {
      const p = city.metropolis.buildingsNear(player.x, player.z, 1).find(q => q.id === context.id);
      if (p) wanted.unshift(p);
    }
  }

  // While driving nothing new is built (a car can't go in); built floors age out.
  function update(player, context, now, dt, { build = true } = {}) {
    if (!build) wanted = [];
    else if (now - scanAt > .3 || (context && !active.has(context.id))) { scanAt = now; scan(player, context); }
    let madePlan = false;
    for (const p of wanted) {
      if (active.has(p.id)) continue;
      if (madePlan && context?.id !== p.id) continue;
      madePlan = true;
      const plan = cachedInteriorPlan(p);
      if (!plan) continue;
      const group = new THREE.Group(); group.name = `Interior ${p.id}`;
      group.position.set(plan.origin.x, 0, plan.origin.z); group.rotation.y = plan.origin.yaw; group.updateMatrix(); group.matrixAutoUpdate = false;
      root.add(group); active.set(p.id, { plan, group, floors: new Map(), lastWanted: now });
    }
    const ids = new Set(wanted.map(p => p.id));
    let budget = 1;
    for (const [id, b] of active) {
      if (ids.has(id)) b.lastWanted = now;
      else if (now - b.lastWanted > 2) { disposeBuilding(b); active.delete(id); continue; }
      const levels = context?.id === id ? [context.level, context.level - 1, context.level + 1] : [0];
      for (const level of levels) {
        if (level < 0 || level >= b.plan.levels) continue;
        const f = b.floors.get(level);
        if (f) { f.lastWanted = now; continue; }
        if (budget-- > 0) { b.floors.set(level, materialize(b, level, now)); built++; }
      }
      for (const [level, f] of b.floors) {
        if (now - f.lastWanted > 1.5) { disposeFloor(f); b.floors.delete(level); continue; }
        animateDoors(f, player, dt);
      }
    }
    updateClip(player, context);
  }

  function updateClip(player, context) {
    const doors = [];
    for (const b of active.values()) {
      if (!b.floors.has(0)) continue;
      for (const e of b.plan.entrances) {
        const center = toWorld(b.plan, e.x + e.nx * .05, e.z + e.nz * .05);
        doors.push({ e, plan: b.plan, center, distance: Math.hypot(center.x - player.x, center.z - player.z) });
      }
    }
    doors.sort((a, b) => a.distance - b.distance);
    uniforms.interiorDoorCenter.value.forEach((v, i) => {
      const d = doors[i], half = uniforms.interiorDoorHalf.value[i];
      if (!d) { half.set(0, 0, 0, 0); return; }
      const yaw = d.plan.origin.yaw + Math.atan2(-d.e.nx, -d.e.nz);
      v.set(d.center.x, d.plan.floor0 + .02 + d.e.height / 2, d.center.z, yaw);
      half.set(d.e.width / 2, d.e.height / 2, .3, 1);
    });
    const b = context && active.get(context.id);
    if (b && b.floors.has(context.level)) {
      const { plan } = b, inset = INTERIOR.hull + .02, r = Math.max(...plan.outline.map(p => Math.hypot(p.x, p.z)));
      const shape = plan.footprint === 'hexagon' ? 2 : plan.footprint === 'circle' ? 3 : 1;
      const halfW = Math.max(...plan.outline.map(p => Math.abs(p.x))), halfD = Math.max(...plan.outline.map(p => Math.abs(p.z)));
      const apothem = shape === 2 ? r * Math.cos(Math.PI / 6) : r * Math.cos(Math.PI / 32);
      uniforms.interiorCavity.value.set(plan.origin.x, plan.origin.z, plan.origin.yaw, shape);
      uniforms.interiorCavityRange.value.set(plan.floor0 - .1, plan.top - .02, shape === 1 ? halfW - inset : apothem - inset, halfD - inset);
    } else uniforms.interiorCavity.value.w = 0;
  }

  function snapshot() {
    return {
      buildings: [...active.keys()],
      floors: [...active.values()].flatMap(b => [...b.floors.keys()].map(level => `${b.plan.id}#${level}`)),
      triangles: [...active.values()].reduce((n, b) => n + [...b.floors.values()].reduce((m, f) => m + f.triangles, 0), 0),
      built,
      doors: uniforms.interiorDoorHalf.value.filter(v => v.w > .5).length,
      cavity: uniforms.interiorCavity.value.w > .5,
    };
  }
  function dispose() {
    for (const b of active.values()) disposeBuilding(b);
    active.clear(); root.removeFromParent();
    warm.dispose(); for (const material of Object.values(materials)) material.dispose();
  }
  return { root, update, snapshot, dispose, materials };
}
