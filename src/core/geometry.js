// Shared by render geometry, physics and the map. Circular buildings use the
// same 32-sided perimeter everywhere, with smooth wall normals in the renderer.
const regular = (count, start = 0) => Object.freeze(Array.from({ length: count }, (_, i) => {
  const angle = start + i * Math.PI * 2 / count;
  return Object.freeze({ x: Math.cos(angle) / 2, z: Math.sin(angle) / 2 });
}));
export const FOOTPRINT_VERTICES = Object.freeze({
  rectangle: Object.freeze([[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, z]) => Object.freeze({ x, z }))),
  circle: regular(32, Math.PI / 32),
  hexagon: regular(6),
});
export const footprintShape = footprint => footprint === 'circle' || footprint === 'hexagon' ? footprint : 'box';
export function footprintVertices(footprint, w, d) {
  return (FOOTPRINT_VERTICES[footprint] ?? FOOTPRINT_VERTICES.rectangle).map(p => ({ x: p.x * w, z: p.z * d }));
}
export function polygonFaces(vertices) {
  return vertices.map((a, i) => {
    const b = vertices[(i + 1) % vertices.length], dx = b.x - a.x, dz = b.z - a.z, width = Math.hypot(dx, dz);
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, nx: dz / width, nz: -dx / width, width };
  });
}
// Convex polygon helpers for interiors. Polygons keep the counter-clockwise
// (x, z) winding of FOOTPRINT_VERTICES, so polygonFaces yields outward normals.
export function polygonArea(vertices) {
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}
export function polygonCentroid(vertices) {
  let area = 0, x = 0, z = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length], cross = a.x * b.z - b.x * a.z;
    area += cross; x += (a.x + b.x) * cross; z += (a.z + b.z) * cross;
  }
  return Math.abs(area) < 1e-9 ? { x: vertices[0]?.x ?? 0, z: vertices[0]?.z ?? 0 } : { x: x / (3 * area), z: z / (3 * area) };
}
// Keep the half-plane nx * x + nz * z <= c. Degenerate slivers become empty.
export function clipConvex(vertices, nx, nz, c) {
  const result = [], eps = 1e-9;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const da = a.x * nx + a.z * nz - c, db = b.x * nx + b.z * nz - c;
    if (da <= eps) result.push({ x: a.x, z: a.z });
    if ((da < -eps && db > eps) || (da > eps && db < -eps)) {
      const t = da / (da - db);
      result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  const unique = result.filter((p, i) => {
    const q = result[(i + 1) % result.length];
    return result.length < 2 || Math.hypot(p.x - q.x, p.z - q.z) > 1e-7;
  });
  return unique.length >= 3 && polygonArea(unique) > 1e-6 ? unique : [];
}
export function insetConvex(vertices, distance) {
  return polygonFaces(vertices).reduce((poly, f) => poly.length ? clipConvex(poly, f.nx, f.nz, f.x * f.nx + f.z * f.nz - distance) : poly, vertices);
}
export function pointInConvex(vertices, x, z, inset = 0) {
  return polygonFaces(vertices).every(f => (x - f.x) * f.nx + (z - f.z) * f.nz <= -inset + 1e-9);
}

// Swept 2D segment against an axis-aligned box grown by pad.
export function segmentHitsBox(a, b, box, pad) {
  let near = 0, far = 1;
  for (const [axis, min, max] of [['x', box.minX - pad, box.maxX + pad], ['z', box.minZ - pad, box.maxZ + pad]]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-8) { if (a[axis] < min || a[axis] > max) return false; }
    else {
      let first = (min - a[axis]) / delta, last = (max - a[axis]) / delta;
      if (first > last) [first, last] = [last, first];
      near = Math.max(near, first); far = Math.min(far, last);
      if (near > far) return false;
    }
  }
  return true;
}
