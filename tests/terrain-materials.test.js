import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTerrainMaterials, createTerrainTexture, TERRAIN_TILE_METRES, TERRAIN_TEXTURE_SIZE } from '../src/world/terrain-materials.js';
import { createVerticalGroundGeometry } from '../src/world/vertical-city.js';

test('terrain texture detail is deterministic, diffuse-only and filtered at distance', () => {
  const materials = createTerrainMaterials({ anisotropy: 16 });
  const samples = [];
  for (const [kind, material] of Object.entries(materials)) {
    const texture = material.map, repeated = createTerrainTexture(kind);
    assert.equal(texture.image.width, TERRAIN_TEXTURE_SIZE);
    assert.deepEqual(texture.image.data, repeated.image.data, 'loading the same chunk cannot change its texture');
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
    assert.equal(texture.magFilter, THREE.LinearFilter);
    assert.equal(texture.generateMipmaps, true);
    assert.equal(texture.anisotropy, 4);
    assert.equal(material.roughness, 1);
    assert.equal(material.metalness, 0);
    assert.equal(material.roughnessMap, null);
    assert.equal(material.bumpMap, null);
    assert.equal(material.normalMap, null);
    const pixels = Array.from(texture.image.data).filter((_, index) => index % 4 === 0);
    assert.ok(Math.max(...pixels) - Math.min(...pixels) >= 30, 'terrain has visible material detail');
    assert.ok(Math.min(...pixels) >= 160, 'subtle color detail avoids highly contrasting sparkle');
    samples.push(pixels.join(','));
    const shader = { vertexShader: '#include <project_vertex>' };
    material.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /instanceMatrix \* terrainWorld/);
    assert.match(shader.vertexShader, /modelMatrix \* terrainWorld/);
    assert.ok(shader.vertexShader.includes(`terrainWorld.xz / ${TERRAIN_TILE_METRES.toFixed(1)}`), 'all object sizes share a fixed world-space tile scale');
    texture.dispose(); repeated.dispose(); material.dispose();
  }
  assert.equal(new Set(samples).size, 3, 'paving, planting, and soil retain distinct surface patterns');
});

test('instanced terrain defaults to instance tinting and resident ground explicitly enables vertex colors', () => {
  const instanced = createTerrainMaterials(), resident = createTerrainMaterials({ vertexColors: true });
  const box = new THREE.BoxGeometry();
  const ground = createVerticalGroundGeometry();
  assert.equal(box.hasAttribute('color'), false, 'sidewalk and public-space boxes have no per-vertex colors');
  assert.equal(ground.hasAttribute('color'), true, 'resident ground supplies a tint for every vertex');
  for (const kind of ['paving', 'grass', 'soil']) {
    assert.equal(instanced[kind].vertexColors, false, 'default materials must not multiply a missing vertex color into black');
    assert.equal(resident[kind].vertexColors, true, 'the resident surface can opt into its regional vertex tints');
    const mesh = new THREE.InstancedMesh(box, instanced[kind], 1);
    mesh.setColorAt(0, new THREE.Color(0x526d68));
    assert.ok(mesh.instanceColor, 'instance tinting remains independent of vertex-color material selection');
    mesh.dispose();
    for (const material of [instanced[kind], resident[kind]]) { material.map.dispose(); material.dispose(); }
  }
  box.dispose(); ground.dispose();
});
