import * as THREE from 'three';

// Eight metres repeats cleanly across chunks, paths and differently sized beds.
// Diffuse variation supplies detail without high-frequency specular/bump flashes.
export const TERRAIN_TILE_METRES = 8;
export const TERRAIN_TEXTURE_SIZE = 128;

const fract = value => value - Math.floor(value);
function noise(x, y, seed) {
  let hash = Math.imul(x + seed, 374761393) + Math.imul(y + seed, 668265263);
  hash = Math.imul(hash ^ hash >>> 13, 1274126177);
  return ((hash ^ hash >>> 16) >>> 0) / 4294967295;
}
function smoothNoise(x, y, cells, seed) {
  const px = x * cells, py = y * cells, ix = Math.floor(px), iy = Math.floor(py);
  const sx = fract(px) ** 2 * (3 - 2 * fract(px)), sy = fract(py) ** 2 * (3 - 2 * fract(py));
  const a = noise(ix % cells, iy % cells, seed), b = noise((ix + 1) % cells, iy % cells, seed);
  const c = noise(ix % cells, (iy + 1) % cells, seed), d = noise((ix + 1) % cells, (iy + 1) % cells, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

export function createTerrainTexture(kind, anisotropy = 4) {
  if (!['paving', 'grass', 'soil'].includes(kind)) throw new Error(`Unknown terrain surface: ${kind}`);
  const size = TERRAIN_TEXTURE_SIZE, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = noise(x, y, 23) - .5;
    const broad = smoothNoise(x / size, y / size, 8, 11) - .5;
    const fine = smoothNoise(x / size, y / size, 32, 17) - .5;
    let value;
    if (kind === 'paving') {
      // Staggered one-metre paving slabs with subdued, six-centimetre joints.
      const row = Math.floor(y / 16), stagger = row % 2 * 8;
      const slab = noise(Math.floor((x + stagger) / 16) % 8, row, 5) - .5;
      const joint = y % 16 === 0 || (x + stagger) % 16 === 0;
      value = (joint ? 181 : 231) + slab * 13 + grain * 7 + broad * 4;
    } else if (kind === 'grass') {
      value = 215 + broad * 38 + fine * 21 + grain * 9;
    } else {
      value = 213 + broad * 23 + fine * 18 + grain * 22;
    }
    const index = (y * size + x) * 4;
    data[index] = Math.round(value);
    data[index + 1] = Math.round(value);
    data[index + 2] = Math.round(value);
    data[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = `terrain-${kind}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.max(1, Math.min(4, anisotropy));
  texture.needsUpdate = true;
  return texture;
}

export function createTerrainMaterials({ anisotropy = 4, vertexColors = false } = {}) {
  return Object.fromEntries(['paving', 'grass', 'soil'].map(kind => {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: createTerrainTexture(kind, anisotropy),
      vertexColors, roughness: 1, metalness: 0,
    });
    material.name = `terrain-${kind}`;
    material.userData.terrainSurface = kind;
    material.onBeforeCompile = shader => {
      // Box UVs otherwise stretch one slab across an entire instanced plaza.
      // World coordinates also prevent a texture seam when chunks stream in.
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vec4 terrainWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          terrainWorld = instanceMatrix * terrainWorld;
        #endif
        terrainWorld = modelMatrix * terrainWorld;
        vMapUv = terrainWorld.xz / ${TERRAIN_TILE_METRES.toFixed(1)};
        #include <project_vertex>`);
    };
    material.customProgramCacheKey = () => 'terrain-world-metres-v1';
    return [kind, material];
  }));
}
