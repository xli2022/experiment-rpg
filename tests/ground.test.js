import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGroundGeometry } from '../src/ground.js';
import { CHUNK_SIZE, WORLD_LIMIT } from '../src/world-config.js';
import { Metropolis } from '../src/metropolis.js';
import { createTerrainMaterials, createTerrainTexture, TERRAIN_TILE_METRES, TERRAIN_TEXTURE_SIZE } from '../src/terrain-materials.js';

test('resident ground covers the world once with bounded, upward-facing cells', () => {
  const geometry = createGroundGeometry(), positions = geometry.getAttribute('position');
  const extent = WORLD_LIMIT + 200, cells = new Set();
  let area = 0;
  for (let vertex = 0; vertex < positions.count; vertex += 4) {
    const x0 = positions.getX(vertex), z0 = positions.getZ(vertex);
    const x1 = positions.getX(vertex + 2), z1 = positions.getZ(vertex + 2);
    const cx = Math.floor((x0 + x1) / 2 / CHUNK_SIZE), cz = Math.floor((z0 + z1) / 2 / CHUNK_SIZE);
    assert.ok(!cells.has(`${cx},${cz}`), 'each world cell has exactly one floor');
    cells.add(`${cx},${cz}`);
    assert.equal(x0, Math.max(-extent, cx * CHUNK_SIZE));
    assert.equal(x1, Math.min(extent, (cx + 1) * CHUNK_SIZE));
    assert.equal(z0, Math.max(-extent, cz * CHUNK_SIZE));
    assert.equal(z1, Math.min(extent, (cz + 1) * CHUNK_SIZE));
    assert.ok(x1 > x0 && x1 - x0 <= CHUNK_SIZE && z1 > z0 && z1 - z0 <= CHUNK_SIZE);
    area += (x1 - x0) * (z1 - z0);
    for (let i = vertex; i < vertex + 4; i++) assert.ok(Math.abs(positions.getY(i) + .02) < 1e-8);
  }
  assert.equal(area, (extent * 2) ** 2, 'no gaps or overlapping ground coverage');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < geometry.index.count; i += 3) {
    a.fromBufferAttribute(positions, geometry.index.getX(i));
    b.fromBufferAttribute(positions, geometry.index.getX(i + 1));
    c.fromBufferAttribute(positions, geometry.index.getX(i + 2));
    assert.ok(b.sub(a).cross(c.sub(a)).y > 0, 'both triangles face the camera above ground');
  }
  geometry.dispose();
});

test('ground material groups retain regional cell colors and continuous asphalt UVs', () => {
  const sampled = new Set(), tintAt = (x, z) => x < 0 && z < 0 ? 0x304d45 : 0x34444c;
  const geometry = createGroundGeometry({ colorAt(x, z) { sampled.add(`${x},${z}`); return tintAt(x, z); } });
  const positions = geometry.getAttribute('position'), colors = geometry.getAttribute('color');
  const uvs = geometry.getAttribute('uv'), normals = geometry.getAttribute('normal');
  const expected = new THREE.Color(), actual = new THREE.Color(), span = WORLD_LIMIT * 2 + 400;
  assert.equal(geometry.groups.length, 2);
  assert.equal(geometry.groups[0].start, 0);
  assert.equal(geometry.groups[1].start, geometry.groups[0].count);
  assert.equal(geometry.groups[1].start + geometry.groups[1].count, geometry.index.count);
  for (const group of geometry.groups) for (let i = group.start; i < group.start + group.count; i += 6) {
    const base = geometry.index.getX(i);
    const x = Math.floor((positions.getX(base) + positions.getX(base + 2)) / 2 / CHUNK_SIZE) * CHUNK_SIZE;
    const z = Math.floor((positions.getZ(base) + positions.getZ(base + 2)) / 2 / CHUNK_SIZE) * CHUNK_SIZE;
    const regional = Math.max(Math.abs(x), Math.abs(z)) > 285;
    assert.equal(group.materialIndex, regional ? 1 : 0);
    assert.equal(sampled.has(`${x},${z}`), regional);
    expected.set(regional ? tintAt(x, z) : 0xffffff);
    for (let vertex = base; vertex < base + 4; vertex++) {
      actual.fromBufferAttribute(colors, vertex);
      assert.ok(Math.abs(actual.r - expected.r) < 1e-7 && Math.abs(actual.g - expected.g) < 1e-7 && Math.abs(actual.b - expected.b) < 1e-7);
      assert.ok(Math.abs(uvs.getX(vertex) - (positions.getX(vertex) / span + .5)) < 1e-7);
      assert.ok(Math.abs(uvs.getY(vertex) - (.5 - positions.getZ(vertex) / span)) < 1e-7);
      assert.deepEqual([normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex)], [0, 1, 0]);
    }
  }
  geometry.dispose();
});

test('resident park colors match streamed blueprints without populating their cache', () => {
  const metro = new Metropolis();
  const origins = [-5760, -5568, -4992, -864, -768, -384, -288, -192, 0, 192, 672, 768, 864, 1248, 4896, 5472, 5664];
  const samples = origins.flatMap(x => origins.map(z => ({ x, z, park: metro.hasParkInArea(x, z, x + CHUNK_SIZE, z + CHUNK_SIZE) })));
  assert.equal(metro.blocks.size, 0);
  assert.equal(metro.generated, 0);
  for (const { x, z, park } of samples) {
    assert.equal(park, metro.area(x, z, x + CHUNK_SIZE, z + CHUNK_SIZE).some(block => block.park), `park color at ${x},${z}`);
  }
});

test('regional texture selection retains one resident floor and the untextured downtown road base', () => {
  const samples = new Set();
  const geometry = createGroundGeometry({ surfaceAt(x, z) { samples.add(`${x},${z}`); return x < 0 ? 'grass' : 'paving'; } });
  const positions = geometry.getAttribute('position');
  assert.deepEqual(geometry.groups.map(group => group.materialIndex), [0, 1, 2]);
  let triangles = 0;
  for (const group of geometry.groups) for (let i = group.start; i < group.start + group.count; i += 6) {
    const base = geometry.index.getX(i);
    const x = Math.floor((positions.getX(base) + positions.getX(base + 2)) / 2 / CHUNK_SIZE) * CHUNK_SIZE;
    const z = Math.floor((positions.getZ(base) + positions.getZ(base + 2)) / 2 / CHUNK_SIZE) * CHUNK_SIZE;
    const regional = Math.max(Math.abs(x), Math.abs(z)) > 285;
    assert.equal(group.materialIndex, regional ? x < 0 ? 2 : 1 : 0);
    assert.equal(samples.has(`${x},${z}`), regional, 'park selection never changes original downtown asphalt');
    triangles += 2;
  }
  assert.equal(triangles * 3, geometry.index.count);
  geometry.dispose();
});

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
  const ground = createGroundGeometry();
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
