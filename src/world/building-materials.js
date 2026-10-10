import * as THREE from 'three';

const TILE = 256, GUTTER = 8, INNER = TILE - GUTTER * 2, WIDTH = TILE * 4, HEIGHT = TILE * 4;
export const FACADE_STYLES = ['curtain-wall', 'limestone', 'brick', 'ribbon-windows', 'metal-grid', 'stucco'];

export function facadeUV(style, windowLighting = 'dark') {
  const tile = style + (windowLighting === 'lit' ? 8 : 0);
  return [(tile % 4 * TILE + GUTTER) / WIDTH, (Math.floor(tile / 4) * TILE + GUTTER) / HEIGHT, INNER / WIDTH, INNER / HEIGHT];
}

function facadePixel(style, x, y, lit) {
  const bx = x % 60, by = y % 60;
  const noise = (x * 13 + y * 7) % 7 - 3;
  let color, window = false, frame = false;
  if (style === 0) {
    // Closely spaced curtain-wall mullions with dark opaque spandrels.
    color = by < 13 ? [63, 85, 94] : [117, 151, 162];
    window = by > 15 && bx > 3; frame = bx < 3 || by === 14 || by === 59;
  } else if (style === 1) {
    color = [207 + noise, 203 + noise, 188 + noise];
    if (by < 3 || bx < 2) color = [151, 153, 142];
    window = bx > 19 && bx < 42 && by > 11 && by < 51;
    frame = bx >= 16 && bx <= 44 && by >= 8 && by <= 53 && !window;
  } else if (style === 2) {
    const mortar = y % 8 === 0 || (x + (Math.floor(y / 8) % 2) * 12) % 24 === 0;
    color = mortar ? [149, 141, 128] : [187 + noise, 146 + noise, 124 + noise];
    window = bx > 14 && bx < 44 && by > 14 && by < 48;
    frame = bx >= 11 && bx <= 47 && by >= 11 && by <= 51 && !window;
  } else if (style === 3) {
    color = by < 10 ? [158, 165, 160] : [214 + noise, 217 + noise, 204 + noise];
    window = by > 18 && by < 46 && bx > 2 && bx < 58;
    frame = by === 17 || by === 47 || bx < 2;
  } else if (style === 4) {
    color = [105 + noise, 128 + noise, 129 + noise];
    window = bx > 7 && bx < 54 && by > 6 && by < 51;
    frame = bx < 5 || by < 4 || (by > 52 && by < 56);
  } else {
    color = [216 + noise, 211 + noise, 192 + noise];
    window = bx > 20 && bx < 42 && by > 17 && by < 46;
    frame = bx >= 17 && bx <= 45 && by >= 14 && by <= 49 && !window;
    if (by > 52 && by < 56) color = [164, 167, 153];
  }
  if (frame) color = style === 0 || style === 4 ? [55, 77, 85] : [156, 161, 149];
  if (window) {
    color = lit ? [185, 198, 185] : [47 + Math.floor(by / 6), 77 + Math.floor(by / 5), 91 + Math.floor(by / 4)];
    if (bx === 30 && style !== 0) color = [103, 121, 124];
  }
  return { color, emission: window && lit ? [148, 140, 105] : [0, 0, 0] };
}

// Integer hashing keeps window decisions stable across GPUs and frames. Each
// whole, unwrapped floor/bay participates, rather than its repeating atlas UV.
const windowHashGLSL = `
  uint buildingWindowHash(uint n) {
    n = (n ^ (n >> 16u)) * 0x85ebca6bu;
    n = (n ^ (n >> 13u)) * 0xc2b2ae35u;
    return n ^ (n >> 16u);
  }
`;

// Exterior materials can be cut open around the building the player occupies:
// up to four street doorways (world boxes) and that building's interior cavity,
// where exterior trim such as balcony rings would otherwise cross the rooms.
export const INTERIOR_CLIP_DOORS = 4;
export function interiorClipUniforms() {
  return {
    interiorDoorCenter: { value: Array.from({ length: INTERIOR_CLIP_DOORS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    interiorDoorHalf: { value: Array.from({ length: INTERIOR_CLIP_DOORS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    interiorCavity: { value: new THREE.Vector4(0, 0, 0, 0) },
    interiorCavityRange: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}
export function patchInteriorClip(material, uniforms) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec3 vInteriorClip;\n${shader.vertexShader}`.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 interiorClipWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        interiorClipWorld = instanceMatrix * interiorClipWorld;
      #endif
      vInteriorClip = (modelMatrix * interiorClipWorld).xyz;`);
    shader.fragmentShader = `varying vec3 vInteriorClip;
      uniform vec4 interiorDoorCenter[${INTERIOR_CLIP_DOORS}];
      uniform vec4 interiorDoorHalf[${INTERIOR_CLIP_DOORS}];
      uniform vec4 interiorCavity;
      uniform vec4 interiorCavityRange;
      ${shader.fragmentShader}`.replace('void main() {', `void main() {
      for (int i = 0; i < ${INTERIOR_CLIP_DOORS}; i++) {
        vec4 door = interiorDoorCenter[i], size = interiorDoorHalf[i];
        if (size.w < .5) continue;
        vec3 d = vInteriorClip - door.xyz;
        float c = cos(door.w), s = sin(door.w);
        vec2 local = vec2(d.x * c - d.z * s, d.x * s + d.z * c);
        if (abs(local.x) < size.x && abs(d.y) < size.y && abs(local.y) < size.z) discard;
      }
      if (interiorCavity.w > .5 && vInteriorClip.y > interiorCavityRange.x && vInteriorClip.y < interiorCavityRange.y) {
        vec2 d = vInteriorClip.xz - interiorCavity.xy;
        float c = cos(interiorCavity.z), s = sin(interiorCavity.z);
        vec2 local = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
        bool inside = true;
        if (interiorCavity.w < 1.5) inside = abs(local.x) < interiorCavityRange.z && abs(local.y) < interiorCavityRange.w;
        else if (interiorCavity.w < 2.5) {
          for (int k = 0; k < 6; k++) {
            float a = .5235988 + float(k) * 1.0471976;
            if (dot(local, vec2(cos(a), sin(a))) > interiorCavityRange.z) inside = false;
          }
        } else inside = length(local) < interiorCavityRange.z;
        if (inside) discard;
      }`);
  };
  material.customProgramCacheKey = () => `${key}|interior-clip-v1`;
  return material;
}

export function createFacadeMaterial() {
  const diffuse = new Uint8Array(WIDTH * HEIGHT * 4), emission = new Uint8Array(diffuse.length);
  for (let tile = 0; tile < 16; tile++) for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    // Wrap the eight-pixel gutter so bilinear filtering across the repeated
    // tile edge sees its own next bay, never the neighboring facade style.
    const px = (x - GUTTER + INNER) % INNER, py = (y - GUTTER + INNER) % INNER;
    // Fully dark/lit banks share their cladding. The shader selects a bank
    // per window, so no light pattern is baked into this repeating texture.
    const pixel = facadePixel(tile % 8 % FACADE_STYLES.length, px, py, tile >= 8);
    const at = ((Math.floor(tile / 4) * TILE + y) * WIDTH + tile % 4 * TILE + x) * 4;
    diffuse.set([...pixel.color, 255], at); emission.set([...pixel.emission, 255], at);
  }
  const texture = (data, name) => {
    const map = new THREE.DataTexture(data, WIDTH, HEIGHT); map.name = name; map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.anisotropy = 4; map.needsUpdate = true; return map;
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: texture(diffuse, 'building-facade-atlas'),
    emissiveMap: texture(emission, 'building-window-lights'), emissive: 0xffffff, emissiveIntensity: .36, roughness: .77, metalness: .12 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = `attribute vec4 instanceUvRect;
      attribute float instanceWindowSeed;
      attribute vec2 facadeSpan;
      attribute float facadeFace;
      varying vec4 vFacadeRect;
      flat varying uint vWindowSeed;
      flat varying uint vWindowFace;
      ${windowHashGLSL}
      ${shader.vertexShader}`
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vFacadeRect = instanceUvRect;
        #ifdef USE_INSTANCING
          float frontage = dot(facadeSpan, vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz)));
          vec2 facadeScale = vec2(frontage / 10.8, length(instanceMatrix[1].xyz) / 14.4);
          vMapUv *= facadeScale; vEmissiveMapUv *= facadeScale;
          // Distinct wings and opposite faces must not mirror one another.
          uvec3 origin = uvec3(ivec3(round(instanceMatrix[3].xyz * 100.0)));
          vWindowSeed = buildingWindowHash(uint(instanceWindowSeed) ^ buildingWindowHash(origin.x)
            ^ buildingWindowHash(origin.y + 0x9e3779b9u) ^ buildingWindowHash(origin.z + 0x7f4a7c15u));
          vWindowFace = uint(facadeFace);
        #endif`);
    // Derivatives come from the unwrapped UVs. Taking them after fract creates
    // mip seams at every repeat. Both maps share the same per-instance tile.
    shader.fragmentShader = `varying vec4 vFacadeRect;
      flat varying uint vWindowSeed;
      flat varying uint vWindowFace;
      ${windowHashGLSL}
      ${shader.fragmentShader}`
      .replace('#include <map_fragment>', `
        uvec2 windowCell = uvec2(floor(vMapUv * 4.0));
        uint windowRandom = buildingWindowHash(vWindowSeed ^ buildingWindowHash(windowCell.x + 0x68bc21ebu)
          ^ buildingWindowHash(windowCell.y + 0x02e5be93u) ^ buildingWindowHash(vWindowFace + 0x967a889bu));
        vec2 windowAtlasOrigin = vFacadeRect.xy;
        // About 6% exceptions preserves each building's dominant light level.
        if ((windowRandom & 15u) == 0u) windowAtlasOrigin.y += vFacadeRect.y < 0.5 ? 0.5 : -0.5;
        ${THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )',
          'textureGrad( map, windowAtlasOrigin + fract(vMapUv) * vFacadeRect.zw, dFdx(vMapUv) * vFacadeRect.zw, dFdy(vMapUv) * vFacadeRect.zw )')}`)
      .replace('#include <emissivemap_fragment>', THREE.ShaderChunk.emissivemap_fragment.replace('texture2D( emissiveMap, vEmissiveMapUv )',
        'textureGrad( emissiveMap, windowAtlasOrigin + fract(vEmissiveMapUv) * vFacadeRect.zw, dFdx(vEmissiveMapUv) * vFacadeRect.zw, dFdy(vEmissiveMapUv) * vFacadeRect.zw )'));
  };
  material.customProgramCacheKey = () => 'building-facade-atlas-v4';
  return material;
}
