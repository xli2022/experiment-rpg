import { orientedBox } from './physics.js';

// Structural pieces are shared by rendering, collision and climbing. Decorations
// never enlarge the ground footprint, and rooftop equipment has its own height.
export function buildingStructure(p) {
  const { w, d, h, type } = p, roof = h + .5;
  const parts = [
    { x: 0, z: 0, y: h / 2, w, h, d, mat: type === 'greenhouse' ? 'glass' : ['warehouse', 'factory'].includes(type) ? 'stone' : 'facade', tint: null },
    { x: 0, z: 0, y: 1.5, w: w + .25, h: 3, d: d + .25, mat: 'stone', tint: 0x53616b },
    { x: 0, z: 0, y: h + .25, w: w + .8, h: .5, d: d + .8, mat: 'stone', tint: 0x424d58 },
  ];
  const rooftop = (x, z, sw, sh, sd, mat = 'stone', tint = 0x657880) => parts.push({ x, z, y: roof + sh / 2, w: sw, h: sh, d: sd, mat, tint, rooftop: true });
  if (type === 'office') rooftop(0, -d * .12, w * .56, 7, d * .52, 'glass');
  else if (type === 'apartment') rooftop(0, -d * .17, w * .48, 3.5, d * .4);
  else if (type === 'civic') rooftop(0, 0, w * .28, 3.2, d * .3, 'stone', 0xbfc3b4);
  else if (type === 'greenhouse') rooftop(0, -d * .18, w * .55, 1.1, d * .25, 'glass');
  else if (type === 'warehouse' || type === 'factory') for (const side of [-1, 1]) rooftop(side * w * .25, -d * .1, w * .22, 1.3, d * .6, 'glass');
  else rooftop(-w * .22, -d * .22, 1.4, 1.2, 2, 'stone', 0x76888a);
  if (type === 'factory') for (const side of [-1, 1]) rooftop(side * w * .37, -d * .3, 1.1, 9, 1.1, 'stone', 0x9a8a7c);
  // Terraces, apartments and markets have little roof gardens to reach on foot.
  if (['terrace', 'apartment', 'market'].includes(type)) for (const side of [-1, 1]) rooftop(side * w * .29, d * .16, 1.3, .7, d * .24, 'stone', 0x688b75);
  return parts;
}

export function buildingColliders(p) {
  const id = `building:${p.id}`, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const boxes = [orientedBox(p.x, p.z, p.w + .25, p.d + .25, p.yaw, p.h + .5, 0, { id, climbable: true })];
  for (const [i, part] of buildingStructure(p).entries()) if (part.rooftop) {
    boxes.push(orientedBox(p.x + part.x * c + part.z * s, p.z - part.x * s + part.z * c, part.w, part.d, p.yaw,
      part.y + part.h / 2, part.y - part.h / 2, { id: `${id}:roof:${i}`, climbable: part.h >= 2.5 }));
  }
  return boxes;
}
