import { footprintVertices, polygonFaces } from '../core/geometry.js';
export { FOOTPRINT_VERTICES, footprintVertices, polygonFaces, polygonArea, polygonCentroid, clipConvex, insetConvex, pointInConvex } from '../core/geometry.js';
export const footprintShape = footprint => footprint === 'circle' || footprint === 'hexagon' ? footprint : 'box';

// The front wall/entrance is centered toward local +Z. Signs on landmarks can
// also select another face, pointing at their nearest street.
export function footprintFrontage(p, direction = { x: 0, z: 1 }) {
  const faces = polygonFaces(footprintVertices(p.footprint, p.w, p.d));
  const face = faces.reduce((best, f) => f.nx * direction.x + f.nz * direction.z > best.nx * direction.x + best.nz * direction.z ? f : best);
  // A curved facade can carry a wider tangent-mounted entrance/sign than one
  // tiny tessellation segment. Hexagonal signs stay within a single flat face.
  return { ...face, width: p.footprint === 'circle' ? Math.min(p.w, p.d) * .65 : face.width };
}
