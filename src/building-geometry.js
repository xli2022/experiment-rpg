import * as THREE from 'three';
import { FOOTPRINT_VERTICES, polygonFaces } from './building-footprints.js';

export function buildingBoxGeometry() {
  const geometry = new THREE.BoxGeometry(1, 1, 1), normal = geometry.attributes.normal, spans = [], faces = [];
  geometry.name = 'building-rectangle';
  for (let i = 0; i < normal.count; i++) {
    const x = normal.getX(i), z = normal.getZ(i);
    spans.push(Math.abs(x) > .5 ? 0 : 1, Math.abs(x) > .5 ? 1 : 0);
    faces.push(x > .5 ? 0 : x < -.5 ? 1 : z > .5 ? 2 : 3);
  }
  geometry.setAttribute('facadeSpan', new THREE.Float32BufferAttribute(spans, 2));
  geometry.setAttribute('facadeFace', new THREE.Float32BufferAttribute(faces, 1));
  return geometry;
}

export function buildingPrismGeometry(footprint) {
  const vertices = FOOTPRINT_VERTICES[footprint], faces = polygonFaces(vertices), smooth = footprint === 'circle';
  const perimeter = faces.reduce((n, f) => n + f.width, 0);
  const positions = [], normals = [], uvs = [], spans = [], wallIds = [];
  const vertex = (p, y, normal, u, v, span, wall) => {
    positions.push(p.x, y, p.z); normals.push(...normal); uvs.push(u, v); spans.push(span, 0); wallIds.push(wall);
  };
  let distance = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length], face = faces[i];
    const na = smooth ? [a.x * 2, 0, a.z * 2] : [face.nx, 0, face.nz];
    const nb = smooth ? [b.x * 2, 0, b.z * 2] : na;
    const u0 = smooth ? distance / perimeter : 0, u1 = smooth ? (distance + face.width) / perimeter : 1;
    const span = smooth ? perimeter : face.width, wall = smooth ? 0 : i;
    for (const [p, y, n, u, v] of [[a, -.5, na, u0, 0], [a, .5, na, u0, 1], [b, .5, nb, u1, 1],
      [a, -.5, na, u0, 0], [b, .5, nb, u1, 1], [b, -.5, nb, u1, 0]]) vertex(p, y, n, u, v, span, wall);
    for (const side of [-1, 1]) for (const p of [{ x: 0, z: 0 }, ...(side === 1 ? [b, a] : [a, b])]) {
      vertex(p, side / 2, [0, side, 0], p.x + .5, p.z + .5, 1, wall);
    }
    distance += face.width;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.name = `building-${footprint}`;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('facadeSpan', new THREE.Float32BufferAttribute(spans, 2));
  geometry.setAttribute('facadeFace', new THREE.Float32BufferAttribute(wallIds, 1));
  return geometry;
}
