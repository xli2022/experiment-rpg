import field from './npc-head-shape.js';

const cells = new Map(), cache = new Map(), size = .035;
const key = (x, y, z) => `${x}:${y}:${z}`;
for (let i = 0; i < field.length; i += 6) {
  const k = key(Math.floor(field[i] / size), Math.floor(field[i + 1] / size), Math.floor(field[i + 2] / size));
  if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i);
}

// Interpolate the source surface to fit eyes, hair and glasses along with skin.
// Memoize by bind-space position: all profiles use the same reusable field.
export function headDisplacement(point) {
  const k = `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`;
  if (cache.has(k)) return cache.get(k);
  const x = Math.floor(point.x / size), y = Math.floor(point.y / size), z = Math.floor(point.z / size), near = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
    for (const i of cells.get(key(x + dx, y + dy, z + dz)) ?? []) {
      near.push({ i, distance: (point.x - field[i]) ** 2 + (point.y - field[i + 1]) ** 2 + (point.z - field[i + 2]) ** 2 });
    }
  }
  near.sort((a, b) => a.distance - b.distance);
  const delta = [0, 0, 0]; let total = 0;
  for (const { i, distance } of near.slice(0, 4)) {
    const weight = 1 / Math.max(1e-12, distance ** 2); total += weight;
    for (let axis = 0; axis < 3; axis++) delta[axis] += field[i + 3 + axis] * weight;
  }
  if (total) for (let axis = 0; axis < 3; axis++) delta[axis] /= total;
  cache.set(k, delta); return delta;
}
