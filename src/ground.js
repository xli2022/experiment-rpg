import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_LIMIT } from './world-config.js';

// A single resident surface owns every ground cell. Separate material groups
// preserve downtown asphalt and regional textures without overlapping floor layers.
// The downtown base is also its road network, so only regional land is textured.
export const GROUND_MATERIALS = { asphalt: 0, paving: 1, grass: 2 };
export function createGroundGeometry({ colorAt = () => 0x34444c, surfaceAt = () => 'paving' } = {}) {
  const extent = WORLD_LIMIT + 200, span = extent * 2;
  const first = Math.floor(-extent / CHUNK_SIZE), end = Math.ceil(extent / CHUNK_SIZE);
  const vertices = (end - first) ** 2 * 4;
  const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3), uvs = new Float32Array(vertices * 2);
  const indices = [[], [], []], color = new THREE.Color();
  let vertex = 0;
  for (let cx = first; cx < end; cx++) for (let cz = first; cz < end; cz++) {
    const x = cx * CHUNK_SIZE, z = cz * CHUNK_SIZE;
    const regional = Math.max(Math.abs(x), Math.abs(z)) > 285;
    const materialIndex = regional ? (surfaceAt(x, z) === 'grass' ? GROUND_MATERIALS.grass : GROUND_MATERIALS.paving) : GROUND_MATERIALS.asphalt;
    const x0 = Math.max(-extent, x), x1 = Math.min(extent, x + CHUNK_SIZE);
    const z0 = Math.max(-extent, z), z1 = Math.min(extent, z + CHUNK_SIZE);
    color.set(regional ? colorAt(x, z) : 0xffffff);
    for (const [px, pz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
      positions.set([px, -.02, pz], vertex * 3);
      normals.set([0, 1, 0], vertex * 3);
      color.toArray(colors, vertex * 3);
      // Match the original rotated PlaneGeometry so asphalt texel density stays fixed.
      uvs.set([px / span + .5, .5 - pz / span], vertex * 2);
      vertex++;
    }
    const base = vertex - 4;
    indices[materialIndex].push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices.flat());
  let start = 0;
  for (const [materialIndex, group] of indices.entries()) {
    if (group.length) geometry.addGroup(start, group.length, materialIndex);
    start += group.length;
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
