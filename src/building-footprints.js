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
// The front wall/entrance is centered toward local +Z. Signs on landmarks can
// also select another face, pointing at their nearest street.
export function footprintFrontage(p, direction = { x: 0, z: 1 }) {
  const faces = polygonFaces(footprintVertices(p.footprint, p.w, p.d));
  const face = faces.reduce((best, f) => f.nx * direction.x + f.nz * direction.z > best.nx * direction.x + best.nz * direction.z ? f : best);
  // A curved facade can carry a wider tangent-mounted entrance/sign than one
  // tiny tessellation segment. Hexagonal signs stay within a single flat face.
  return { ...face, width: p.footprint === 'circle' ? Math.min(p.w, p.d) * .65 : face.width };
}
