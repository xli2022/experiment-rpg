const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = p => ({ x: p.x, y: p.y, z: p.z });

// Check the whole swept path, including support at every step. Navigation
// supplies the real world's walls, furniture, cars and floor boundaries.
export function traceResidentPath(from, to, navigation) {
  const length = distance(from, to);
  if (length > 25) return null;
  let at = point(from);
  const steps = Math.max(1, Math.ceil(length / .18));
  for (let i = 1; i <= steps; i++) {
    const next = navigation.sample(at, { x: from.x + (to.x - from.x) * i / steps, y: at.y, z: from.z + (to.z - from.z) * i / steps });
    if (!next || !Number.isFinite(next.y) || Math.abs(next.y - at.y) > .35) return null;
    at = next;
  }
  return Math.abs(at.y - to.y) < .5 ? at : null;
}
