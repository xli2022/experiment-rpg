import { orientedBox } from './physics.js';

export const PUBLIC_SPACES = ['garden', 'court', 'market', 'fountain', 'sculpture'];

// Local-space pieces let a public space share exact geometry with its obstacles.
// Open courts and paths stay traversable, including underneath market canopies.
export function publicSpaceParts(type) {
  const parts = [];
  const add = (x, y, z, w, h, d, tint, mat = 'stone', solid = false, shape = 'box', detail = false) => parts.push({ x, y, z, w, h, d, tint, mat, solid, shape, detail });
  add(0, .045, 0, 40, .07, 40, type === 'garden' ? 0x3e6351 : 0x53686b);
  add(0, .085, 0, 4, .015, 40, 0xb1a28a); add(0, .086, 0, 40, .015, 4, 0xb1a28a);
  if (type === 'court') {
    add(0, .1, 0, 16, .025, 28, 0x356b72);
    for (const side of [-1, 1]) {
      add(side * 7.8, .12, 0, .12, .018, 27.6, 0xe2d2ac);
      add(0, .12, side * 13.8, 15.6, .018, .12, 0xe2d2ac);
      add(0, 1.9, side * 14.8, .22, 3.8, .22, 0x8198a0, 'stone', true);
      add(0, 3.3, side * 14.2, 2.1, 1.2, .1, 0xd0d9c5);
      add(0, 2.92, side * 13.8, .8, .1, .8, 0xeebc82, 'glow');
    }
    add(0, .12, 0, 15.6, .018, .12, 0xe2d2ac);
    for (const side of [-1, 1]) for (const x of [-3, 3]) add(x, .12, side * 10.6, .12, .018, 6.4, 0xe2d2ac);
  } else if (type === 'market') {
    for (const x of [-11, 11]) for (const z of [-9, 0, 9]) {
      add(x, .55, z, 5, 1.1, 2, 0x927760, 'stone', true);
      add(x, 2.9, z, 6, .18, 4.5, z === 0 ? 0xb586a9 : 0xb9c391);
      for (const side of [-1, 1]) add(x + side * 2.5, 1.45, z, .12, 2.9, .12, 0x6d8b88, 'stone', true);
      add(x, 2.65, z + 2.24, 4.5, .24, .08, 0xffc28a, 'glow');
      for (const dx of [-1.5, 0, 1.5]) {
        add(x + dx, 1.2, z, 1.1, .2, 1.3, 0x5a705c);
        for (const dz of [-.4, .1, .5]) add(x + dx, 1.4, z + dz, .26, .17, .26, dx === 0 ? 0xbb7e67 : 0xa2b678, 'stone', false, 'crown', true);
      }
    }
    for (const z of [-12, 12]) {
      add(0, 3.25, z, 23, .035, .035, 0x263d44);
      for (let x = -9; x <= 9; x += 3) add(x, 3.1, z, .17, .25, .17, 0xffd9a8, 'glow');
    }
  } else if (type === 'garden') {
    for (const x of [-9, 9]) for (const z of [-9, 9]) {
      add(x, .45, z, 9, .9, 6, 0x819183, 'stone', true);
      add(x, .91, z, 8.5, .12, 5.5, 0x486451);
      for (const dx of [-2.5, 0, 2.5]) add(x + dx, 1.2, z, 1.4, .65, 5, 0x7e9b79);
    }
  } else if (type === 'fountain') {
    add(0, .55, 0, 9, 1.1, 9, 0x93a5a0, 'stone', true);
    add(0, 1.13, 0, 8, .12, 8, 0x529ea0, 'glass');
    add(0, 2, 0, 2.5, 4, 2.5, 0x718c89, 'stone', true);
    add(0, 4.1, 0, 3.5, .2, 3.5, 0x8de1cc, 'glow');
  } else {
    add(0, .45, 0, 5, .9, 5, 0x526b72, 'stone', true);
    for (const side of [-1, 1]) add(side * 1.35, 4, 0, .8, 7.2, 1.6, 0xa38973, 'stone', true);
    add(0, 7.4, 0, 3.5, .7, 1.6, 0x92e0ce, 'glow', true);
  }
  // Perimeter seating leaves all four approaches open.
  for (const x of [-16, 16]) for (const z of [-6, 6]) {
    add(x, .6, z, 1, 1.2, 3, 0x8e7764, 'stone', true);
  }
  for (const x of [-16, 16]) for (const z of [-16, 16]) {
    add(x, .45, z, 2.2, .9, 2.2, 0x6b8381, 'stone', true);
    add(x, 2.4, z, .4, 4.8, .4, 0x796b5a, 'stone', true);
    add(x, 5, z, 2.4, 2.1, 2.4, type === 'garden' ? 0x5c886c : 0x70977c, 'stone', false, 'crown');
  }
  return parts;
}

export function publicSpaceColliders(feature) {
  return publicSpaceParts(feature.type).filter(p => p.solid).map(p => orientedBox(feature.x + p.x, feature.z + p.z, p.w, p.d, 0, p.y + p.h / 2, p.y - p.h / 2));
}
