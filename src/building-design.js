import { orientedPrism } from './physics.js';
import { footprintShape, footprintFrontage, footprintVertices, polygonFaces } from './building-footprints.js';

export const hash = text => {
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  // Avalanche before selecting four choices: FNV's low bits alone correlate
  // different suffixes and would give every roof variant the same paint color.
  n = Math.imul(n ^ n >>> 16, 0x85ebca6b); n = Math.imul(n ^ n >>> 13, 0xc2b2ae35);
  return (n ^ n >>> 16) >>> 0;
};
const schemes = {
  office: { surfaces: [0, 1, 0, 4], colors: [0x84aaa9, 0xb7b1a3, 0x8598b1, 0x71918c] },
  apartment: { surfaces: [3, 2, 3, 5], colors: [0xb5c3ae, 0xbc9985, 0x9eb7bf, 0xc4b597] },
  terrace: { surfaces: [2, 5, 2, 5], colors: [0xc18c76, 0xe0cfab, 0x8cae9c, 0xc9a07b] },
  civic: { surfaces: [1, 4, 1, 3], colors: [0xd9d0b3, 0x9aaea9, 0xbdc8bf, 0xbeb1a0] },
  market: { surfaces: [5, 2, 5, 3], colors: [0xbb9b88, 0x959fac, 0x99b19a, 0xc5b896] },
  warehouse: { surfaces: [0, 0, 0, 0], colors: [0x8ba3a8, 0xb59b82, 0xa4b39d, 0x8f9daf] },
  factory: { surfaces: [0, 0, 0, 0], colors: [0xaa907c, 0x829e99, 0xa8aaa1, 0x9b92a3] },
};
const accents = [0x8ad7ce, 0xdca16f, 0xa9b9df, 0xc799aa];

// Independent seeded choices keep a roof shape from dictating paint or accents.
// A streamed-out building always comes back with the same identity.
export function buildingDesign(p) {
  const scheme = schemes[p.type] ?? schemes.apartment;
  const variant = hash(`${p.id}:massing`) % 4, finish = hash(`${p.id}:finish`) % 4;
  return { variant, surface: scheme.surfaces[variant], color: scheme.colors[finish],
    windowLighting: hash(`${p.id}:window-lighting`) % 5 < 2 ? 'lit' : 'dark',
    windowSeed: hash(`${p.id}:window-pattern`) & 0xffffff,
    trim: [0x425965, 0x6c706b, 0x546372, 0x4a655e][finish],
    accent: accents[hash(`${p.id}:accent`) % accents.length], mirror: hash(`${p.id}:hand`) % 2 ? 1 : -1 };
}

// Each main volume includes a flush, half-metre roof slab. Rendered walls, stepped
// terraces, climbing targets and landing support all use this same recipe.
export function buildingVolumes(p, design = buildingDesign(p)) {
  if (p.footprint && p.footprint !== 'rectangle') return radialBuildingVolumes(p, design);
  const { w, d, h, type } = p, { variant: v, mirror: m } = design, volumes = [];
  const volume = (x, z, sw, sd, bottom, top, mat = 'facade', tint) => {
    volumes.push({ x: x * w, z: z * d, w: w * sw, d: d * sd, y: (bottom + top) / 2, h: top - bottom, mat, tint, cap: true });
  };
  const tier = (x, z, sw, sd, bottom, top) => volume(x, z, sw, sd, bottom * h, top * h);
  const roof = (x, z, sw, sd, height, mat = 'stone', tint = design.trim, bottom) => {
    bottom ??= Math.max(...volumes.filter(part => part.cap && Math.abs(part.x - x * w) <= part.w / 2 && Math.abs(part.z - z * d) <= part.d / 2)
      .map(part => part.y + part.h / 2 + .5));
    volumes.push({ x: x * w, z: z * d, w: w * sw, d: d * sd, y: bottom + height / 2, h: height, mat, tint, cap: false });
  };
  if (type === 'office') {
    if (v === 0) {
      tier(0, 0, 1, 1, 0, .52); tier(.07 * m, -.07, .8, .8, .52, .83); tier(.07 * m, -.07, .55, .58, .83, 1);
    } else if (v === 1) {
      tier(0, 0, 1, 1, 0, .24); tier(-.25 * m, 0, .5, 1, .24, 1); tier(.27 * m, -.09, .46, .82, .24, .78);
    } else if (v === 2) {
      tier(0, 0, 1, 1, 0, .9); tier(0, -.12, .72, .7, .9, 1);
    } else {
      tier(0, 0, 1, 1, 0, .4); tier(.13 * m, -.1, .74, .8, .4, 1);
    }
    roof(v === 1 ? -.25 * m : .05 * m, -.08, .2, .26, 3.2, 'glass', 0xaac8ca);
    if (v === 0 || v === 3) roof(.05 * m, -.08, .025, .025, h * .07 + 4, 'stone', 0x91a7ac, h + 3.7);
  } else if (type === 'apartment') {
    if (v === 0) {
      tier(0, 0, 1, 1, 0, .62); tier(.07 * m, -.12, .84, .76, .62, 1);
    } else if (v === 1) {
      tier(0, 0, 1, 1, 0, .3); tier(-.27 * m, 0, .46, 1, .3, 1); tier(.27 * m, -.06, .46, .88, .3, .82);
    } else if (v === 2) tier(0, 0, 1, 1, 0, 1);
    else {
      tier(0, 0, 1, 1, 0, .48); tier(0, -.14, .94, .72, .48, .77); tier(0, -.275, .84, .45, .77, 1);
    }
    roof(v === 1 ? -.27 * m : 0, v === 3 ? -.28 : -.18, .22, .2, 3.2, 'stone', 0x82948c);
  } else if (type === 'civic') {
    if (v === 0) { tier(0, 0, 1, 1, 0, .65); tier(0, 0, .58, .76, .65, 1); }
    else if (v === 1) { tier(0, 0, 1, 1, 0, .8); tier(0, -.04, .36, .86, .8, 1); }
    else if (v === 2) tier(0, 0, 1, 1, 0, 1);
    else { tier(0, 0, 1, 1, 0, .62); tier(-.28, 0, .44, .82, .62, 1); tier(.28, 0, .44, .82, .62, .88); }
    roof(v === 3 ? -.28 : 0, 0, .2, .24, 2.8, 'glass', 0xc0cabc);
  } else if (type === 'terrace') {
    tier(0, 0, 1, 1, 0, .82);
    for (let i = -1; i <= 1; i++) tier(i / 3, 0, 1 / 3, 1, .82, 1 - ((i + v + 4) % 3) * .055);
    for (const side of [-1, 1]) roof(side * .32, -.29, .055, .08, 2 + v * .3, 'stone', 0x977966);
  } else if (type === 'market') {
    tier(0, 0, 1, 1, 0, v % 2 ? 1 : .74);
    if (v === 0) tier(0, -.1, .72, .55, .74, 1);
    if (v === 2) { tier(-.23, -.1, .38, .6, .74, 1); tier(.23, -.1, .38, .6, .74, .92); }
    roof(-.29, -.25, .16, .2, 1.3, 'stone', 0x78888b);
    if (v === 3) roof(.28, -.26, .15, .2, 2.8, 'stone', 0xaaa184);
  } else {
    volume(0, 0, 1, 1, 0, h, 'industrial');
    if (v === 0) {
      for (const side of [-1, 0, 1]) roof(side * .27, -.06, .17, .7, 1.5 + (side + 1) * .45, 'glass', 0x8caeb2);
    } else if (v === 2) {
      for (const side of [-1, 0, 1]) roof(0, side * .27, .7, .17, 1.5 + (side + 1) * .45, 'glass', 0x8caeb2);
    } else roof(0, -.1, .72, .28, 2.7, 'industrial', design.color);
    if (type === 'factory') for (const side of [-1, 1]) {
      roof(side * .42, -.32, .075, .085, 7 + v * 2, 'stone', 0x9e8371);
    }
    else if (v === 3) roof(.31, -.31, .16, .19, 4, 'stone', 0xb5a58b);
  }
  if (['apartment', 'terrace', 'market'].includes(type)) {
    const body = volumes.filter(part => part.cap).sort((a, b) => b.y + b.h / 2 - a.y - a.h / 2)[0];
    const top = body.y + body.h / 2 + .5;
    for (const side of [-1, 1]) volumes.push({ x: body.x + side * body.w * .32, z: body.z + body.d * .14,
      y: top + .35, w: body.w * .15, h: .7, d: body.d * .22, mat: 'stone', tint: v % 2 ? 0x66846b : 0x858e7e, cap: false, planter: true });
    if (v % 2 === 0) volumes.push({ x: body.x, z: body.z + body.d * .2, y: top + .16,
      w: body.w * .35, h: .32, d: body.d * .29, mat: 'glass', tint: 0x567f96, cap: false });
  }
  return volumes;
}

function radialBuildingVolumes(p, design) {
  const { w, d, h, type } = p, { variant: v, trim } = design, volumes = [], shape = footprintShape(p.footprint);
  const industrial = type === 'factory' || type === 'warehouse';
  const tier = (scale, bottom, top) => volumes.push({ x: 0, z: 0, w: w * scale, d: d * scale,
    y: h * (bottom + top) / 2, h: h * (top - bottom), mat: industrial ? 'industrial' : 'facade', shape, cap: true });
  // Concentric setbacks preserve a circular/hexagonal identity all the way up.
  // Low buildings keep a full-height street wall for doors and shop signs.
  if (h < 22 || industrial || v === 2) tier(1, 0, 1);
  else if (v === 0) { tier(1, 0, .58); tier(.78, .58, .86); tier(.58, .86, 1); }
  else if (v === 1) { tier(1, 0, .9); tier(.72, .9, 1); }
  else { tier(1, 0, .42); tier(.86, .42, .76); tier(.64, .76, 1); }
  const top = volumes.at(-1), roofY = h + .5;
  const roof = (x, z, sw, sd, height, mat = 'stone', tint = trim, form = 'box', bottom = roofY) =>
    volumes.push({ x: x * top.w, z: z * top.d, w: sw * top.w, d: sd * top.d,
      y: bottom + height / 2, h: height, mat, tint, shape: form, cap: false });
  if (industrial) {
    roof(0, 0, .45, .45, 2, 'glass', 0x8caeb2, shape);
    if (type === 'factory') for (const side of [-1, 1]) roof(side * .27, -.18, .085, .085, 7 + v * 2, 'stone', 0x9e8371, 'circle');
    else roof(.25, -.2, .15, .15, 2 + v * .5, 'stone', trim, shape);
  } else {
    const lantern = type === 'office' || type === 'civic', height = type === 'market' ? 1.5 : 3.2;
    roof(0, -.1, .24 + v * .025, .24 + v * .025, height, lantern ? 'glass' : 'stone', lantern ? 0xaac8ca : trim, shape);
    if (type === 'office' && (v === 0 || v === 3)) roof(0, -.1, .028, .028, h * .05 + 3, 'stone', 0x91a7ac, shape, roofY + height);
    if (['apartment', 'terrace', 'market'].includes(type)) {
      for (const side of [-1, 1]) { roof(side * .26, .1, .15, .17, .7, 'stone', 0x66846b); volumes.at(-1).planter = true; }
      if (v % 2 === 0) roof(0, .24, .3, .17, .32, 'glass', 0x567f96);
    }
  }
  return volumes;
}

export function buildingVolumeColliders(p, volumes = buildingVolumes(p)) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), base = p.y ?? 0;
  return volumes.map((part, i) => orientedPrism(p.x + part.x * c + part.z * s, p.z - part.x * s + part.z * c,
    part.w, part.d, p.yaw, base + part.y + part.h / 2 + (part.cap ? .5 : 0),
    i === 0 ? p.ground ?? base : base + part.y - part.h / 2,
    part.shape === 'circle' || part.shape === 'hexagon' ? part.shape : 'rectangle',
    { id: `building:${p.id}${i ? `:volume:${i}` : ''}`, climbable: part.h > 2, ...(i ? {} : { buildingId: p.id }) }));
}

// Street doors in building-local space (front is +Z), matching the glazed and
// roll-up entrances drawn by buildingDetails. `glass` is the drawn panel width;
// `width`/`height` is the walkable opening an interior cuts through the wall.
export function buildingEntrances(p, design = buildingDesign(p)) {
  const { w, d, type } = p, { variant: v } = design, freight = type === 'warehouse' || type === 'factory';
  const opening = (kind, glass) => kind === 'roller'
    ? { width: Math.min(4, glass * .9), height: 4.2 } : { width: Math.min(2, Math.max(1.2, glass * .6)), height: 2.5 };
  if (p.footprint && p.footprint !== 'rectangle') {
    const front = footprintFrontage(p), kind = freight ? 'roller' : 'door', glass = front.width * .66;
    // A curved wall can only open within one flat segment of its perimeter.
    const face = polygonFaces(footprintVertices(p.footprint, w, d)).reduce((best, f) => f.nz > best.nz ? f : best);
    const size = opening(kind, glass);
    return [{ id: 'main', kind, x: face.x, z: face.z, nx: face.nx, nz: face.nz, glass, ...size, width: Math.min(size.width, face.width - .1) }];
  }
  const front = d / 2, at = (id, kind, x, glass) => ({ id, kind, x, z: front, nx: 0, nz: 1, glass, ...opening(kind, glass) });
  if (type === 'market') {
    const count = v % 2 ? 4 : 3, bay = w / count;
    return Array.from({ length: count }, (_, i) => at(`bay-${i}`, 'door', -w / 2 + bay * (i + .5), bay * .83));
  }
  if (freight) {
    const count = v % 2 ? 2 : 3, bay = w * .8 / count;
    return Array.from({ length: count }, (_, i) => at(`bay-${i}`, 'roller', (i - (count - 1) / 2) * bay, bay * .76));
  }
  const entrances = [at('main', 'door', type === 'office' ? design.mirror * w * .18 : 0, w * (type === 'civic' ? .45 : .27))];
  if (type === 'terrace') for (const side of [-1, 1]) entrances.push(at(side < 0 ? 'west' : 'east', 'door', side * w / 3, w * .14));
  return entrances;
}

// All decoration is batched with the existing city materials. Larger features
// survive the distant LOD; small rails, awnings and planters are nearby details.
export function buildingDetails(p, design = buildingDesign(p), volumes = buildingVolumes(p, design)) {
  if (p.footprint && p.footprint !== 'rectangle') return radialBuildingDetails(p, design, volumes);
  const parts = [], { w, d, h, type } = p, { variant: v, trim, accent } = design;
  const add = (mat, x, y, z, sw, sh, sd, tint, detail = true) => parts.push({ mat, x, y, z, w: sw, h: sh, d: sd, tint, detail });
  const front = d / 2, freight = type === 'warehouse' || type === 'factory';
  const entryX = type === 'office' ? design.mirror * w * .18 : 0;
  // Different entrances replace the former identical full-width shop canopy.
  if (!freight && type !== 'market') {
    add('glass', entryX, 1.65, front + .09, w * (type === 'civic' ? .45 : .27), 3.2, .16, 0x8caab5);
    add('stone', entryX, 3.5, front + .5, w * (type === 'civic' ? .64 : .4), .22, 1.4, trim);
    add('glow', entryX, 3.42, front + 1.19, w * .23, .08, .06, accent);
  }
  for (const body of volumes.filter(part => part.cap)) {
    const bottom = body.y - body.h / 2, top = body.y + body.h / 2;
    if (['office', 'civic'].includes(type)) {
      // Metal corner frames, limestone piers and crown bands give each mass a
      // readable structure without covering its windows with opaque panels.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add('stone', body.x + sx * (body.w / 2 - .12), body.y,
        body.z + sz * (body.d / 2 - .12), type === 'civic' ? .65 : .3, body.h, type === 'civic' ? .65 : .3, trim, false);
      if (type === 'office' && v !== 1) add('stone', body.x, top - .7, body.z, body.w + .12, .38, body.d + .12, trim, false);
      if (type === 'civic') {
        for (const x of [-.3, .3]) for (const side of [-1, 1]) add('stone', body.x + x * body.w, body.y,
          body.z + side * (body.d / 2 + .07), .42, body.h, .22, 0xc4c2ad, false);
        add('stone', body.x, top - .2, body.z, body.w + .36, .42, body.d + .36, 0xcac6b4, false);
      }
    }
    if (type === 'apartment') {
      const floors = Math.min(9, Math.floor((body.h - 3) / 7.2));
      for (let floor = 0; floor < floors; floor++) {
        const y = Math.max(10, bottom + 4) + floor * 7.2;
        if (y > top - 1.5) continue;
        const bays = v === 2 ? [0] : [-.26, .26];
        for (const bay of bays) {
          const x = body.x + bay * body.w, z = body.z + body.d / 2;
          const width = body.w * (v === 2 ? .88 : .39);
          add('stone', x, y, z + .34, width, .22, .9, 0xb1b7af, false);
          add('stone', x, y + .48, z + .73, width, .52, .1, trim);
          if ((floor + v) % 3 === 0) add('stone', x + width * .28, y + .4, z + .31, .65, .65, .55, 0x63856a);
        }
      }
    }
  }
  if (type === 'terrace') {
    for (let i = -1; i <= 1; i++) {
      const x = i * w / 3;
      add('stone', x + w / 6 - .15, h * .43, front + .05, .3, h * .86, .22, trim, false);
      add('stone', x, 3.55, front + .48, w * .27, .24, 1.1, i === 0 ? accent : trim);
      if (i) add('glass', x, 1.5, front + .1, w * .14, 2.8, .18, 0x759493);
      // Individual stepped parapets suggest adjoining houses, not one slab.
      const top = h * (1 - ((i + v + 4) % 3) * .055) + .5;
      add('stone', x, top + .23, front - .12, w / 3, .46, .28, trim, false);
    }
  } else if (type === 'market') {
    const count = v % 2 ? 4 : 3, bay = w / count;
    for (let i = 0; i < count; i++) {
      const x = -w / 2 + bay * (i + .5);
      add('glass', x, 1.5, front + .1, bay * .83, 2.8, .18, 0x8da6a6);
      for (let stripe = 0; stripe < 4; stripe++) add('stone', x + (stripe - 1.5) * bay * .23, 3.3, front + .62,
        bay * .23, .19, 1.55, (stripe + i + v) % 2 ? accent : 0xd8cbb1);
      add('stone', x, 3.05, front + 1.32, bay * .92, .34, .1, accent);
      add('glow', x, 4.35, front + .12, bay * .59, .27, .12, accent);
    }
  } else if (freight) {
    const count = v % 2 ? 2 : 3, bay = w * .8 / count;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * bay;
      add('stone', x, 2.55, front + .08, bay * .76, 4.9, .14, trim);
      for (let y = .7; y < 5; y += .7) add('stone', x, y, front + .17, bay * .73, .06, .07, 0x93a19f);
      add('stone', x, 5.04, front + .18, bay * .82, .16, .26, accent);
    }
    if (type === 'factory') for (const side of [-1, 1]) {
      add('stone', side * w * .42, h + 5 + v * 2, -d * .32, w * .079, .6, d * .09, accent, false);
    }
  }
  return parts;
}

function radialBuildingDetails(p, design, volumes) {
  const parts = [], { variant: v, trim, accent } = design, { type } = p;
  const add = (mat, x, y, z, w, h, d, tint, detail = true, shape = 'box', yaw = 0) =>
    parts.push({ mat, x, y, z, w, h, d, tint, detail, shape, yaw });
  const front = footprintFrontage(p), yaw = Math.atan2(front.nx, front.nz), width = front.width;
  const entrance = (mat, y, offset, w, h, d, tint) =>
    add(mat, front.x + front.nx * offset, y, front.z + front.nz * offset, w, h, d, tint, true, 'box', yaw);
  const freight = type === 'warehouse' || type === 'factory';
  entrance(freight ? 'stone' : 'glass', freight ? 2.4 : 1.6, .1, width * .66, freight ? 4.7 : 3.1, .18, freight ? trim : 0x8caab5);
  entrance('stone', freight ? 5 : 3.5, .45, width * .84, .22, 1.3, type === 'market' ? accent : trim);
  entrance('glow', freight ? 4.9 : 3.42, 1.12, width * .57, .08, .07, accent);
  for (const body of volumes.filter(part => part.cap)) {
    const top = body.y + body.h / 2, bottom = body.y - body.h / 2;
    if (type === 'office' || type === 'civic') {
      const columns = footprintVertices('hexagon', body.w * .98, body.d * .98);
      for (const point of columns) add('stone', point.x, body.y, point.z, .26, body.h, .26, trim, false);
      add('stone', 0, top - .45, 0, body.w + .1, .3, body.d + .1, trim, false, body.shape);
    }
    if (type === 'apartment' || type === 'terrace') {
      // Shallow perimeter balconies follow the wall, not a rectangular facade.
      for (let y = Math.max(10, bottom + 4), i = 0; y < top - 1.5 && i < 7; y += 9 + v, i++) {
        add('stone', 0, y, 0, body.w + 1, .22, body.d + 1, 0xb1b7af, false, body.shape);
      }
    }
  }
  return parts;
}
