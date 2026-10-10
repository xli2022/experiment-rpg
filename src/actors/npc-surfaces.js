import * as THREE from 'three';

// Small, seamless material tiles shared by every wardrobe instance. These are
// authored in code so accessories never rely on network images or a canvas.
// Albedo is sRGB; normal/roughness data remain linear.
const surfaces = new Map();
const SIZE = 64, TAU = Math.PI * 2;
const byte = value => Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);

export function npcSurfaceTextures(kind = 'cloth') {
  if (surfaces.has(kind)) return surfaces.get(kind);
  const height = new Float32Array(SIZE * SIZE), albedo = new Uint8Array(SIZE * SIZE * 4);
  const normals = new Uint8Array(albedo.length), roughness = new Uint8Array(albedo.length);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x, u = x / SIZE * TAU, v = y / SIZE * TAU;
    const grain = Math.sin(u * 11 + Math.cos(v * 7)) * Math.cos(v * 13 - Math.sin(u * 5));
    const weave = Math.sin(u * 16) * Math.sin(v * 16);
    height[i] = kind === 'skin' ? grain * .035 : kind === 'hair' ? Math.sin(u * 23 + Math.sin(v) * .5) * .22 + grain * .025
      : kind === 'leather' ? grain * .12 + Math.sin(u * 5 + Math.cos(v * 4)) * .05
        : kind === 'metal' ? Math.sin(v * 29) * .035 + grain * .02
          : weave * .16 + grain * .04;
    const shade = .92 + height[i] * (kind === 'hair' ? .22 : .12);
    const r = .86 + height[i] * .28;
    albedo.set([byte(shade), byte(shade), byte(shade), 255], i * 4);
    roughness.set([byte(r), byte(r), byte(r), 255], i * 4);
  }
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const at = (a, b) => height[((b + SIZE) % SIZE) * SIZE + ((a + SIZE) % SIZE)];
    const n = new THREE.Vector3((at(x - 1, y) - at(x + 1, y)) * .8, (at(x, y - 1) - at(x, y + 1)) * .8, 1).normalize();
    normals.set([byte(n.x * .5 + .5), byte(n.y * .5 + .5), byte(n.z * .5 + .5), 255], (y * SIZE + x) * 4);
  }
  const texture = (data, suffix, isColor = false) => {
    const map = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
    map.name = `NPC_${kind}_${suffix}`;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.anisotropy = 4;
    map.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.needsUpdate = true; return map;
  };
  const maps = { map: texture(albedo, 'albedo', true), normalMap: texture(normals, 'normal'), roughnessMap: texture(roughness, 'roughness') };
  surfaces.set(kind, maps); return maps;
}

export function npcSurfaceMaterial(color, kind = 'cloth', options = {}) {
  const material = new THREE.MeshStandardMaterial({ color, ...npcSurfaceTextures(kind),
    roughness: kind === 'hair' ? .62 : kind === 'leather' ? .53 : kind === 'metal' ? .4 : .91,
    metalness: kind === 'metal' ? .75 : 0, normalScale: new THREE.Vector2(.35, .35), ...options });
  material.name = `Wardrobe_${kind}`;
  material.userData.surface = kind;
  return material;
}
