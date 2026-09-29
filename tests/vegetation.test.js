import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVerticalCity } from '../src/vertical-city.js';
import { WorldStream, WORLD_GEOMETRY } from '../src/world-stream.js';
import { WORLD_OBJECTS } from '../src/content.js';
import { buildingVolumes } from '../src/building-design.js';
import { SpatialGrid } from '../src/spatial-grid.js';
import { geometryVolume } from '../src/infrastructure-clearance.js';
import { treeParts, shrubParts } from '../src/vegetation.js';
import { MASTER_DISTRICTS, terrainHeight } from '../src/master-plan.js';
import { circleHitsBox } from '../src/physics.js';

function crownHits(vertices, index) {
  const bounds = new THREE.Box3().setFromPoints(vertices);
  return index.query(bounds.min.x, bounds.min.z, bounds.max.x, bounds.max.z).filter(obstacle => {
    const rotation = obstacle.obb.rotation.clone().transpose();
    const local = vertices.map(vertex => vertex.clone().sub(obstacle.obb.center).applyMatrix3(rotation));
    const box = new THREE.Box3(obstacle.obb.halfSize.clone().negate(), obstacle.obb.halfSize.clone());
    for (let i = 0; i < local.length; i += 3) {
      if (box.intersectsTriangle(new THREE.Triangle(local[i], local[i + 1], local[i + 2]))) return true;
    }
    return false;
  });
}

let audit;
function worldAudit() {
  if (audit) return audit;
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream, WORLD_OBJECTS);
  const trees = [], shrubs = [], beds = [], buildings = [], planters = [];
  for (let x = -15; x < 15; x++) for (let z = -15; z < 15; z++) {
    const block = city.metropolis.block(x, z);
    trees.push(...block.trees); shrubs.push(...block.shrubs); beds.push(...block.features); buildings.push(...block.buildings);
    planters.push(...block.infrastructure.filter(p => p.kind === 'planter'));
  }
  const buildingIndex = new SpatialGrid(buildings.flatMap(p => buildingVolumes(p).map(piece => geometryVolume({ ...piece, id: p.id,
    x: p.x + piece.x * Math.cos(p.yaw) + piece.z * Math.sin(p.yaw),
    z: p.z - piece.x * Math.sin(p.yaw) + piece.z * Math.cos(p.yaw), y: p.y + piece.y, yaw: p.yaw }))));
  return audit = { city, stream, trees, shrubs, beds, buildings, planters, buildingIndex };
}

const primitiveVertices = new Map();
function verticesFor(part) {
  const geometry = WORLD_GEOMETRY[part.shape];
  if (!primitiveVertices.has(part.shape)) {
    const position = geometry.attributes.position, index = geometry.index;
    primitiveVertices.set(part.shape, Array.from({ length: index?.count ?? position.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i) : i)));
  }
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(part.x, part.y, part.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(part.pitch ?? 0, part.yaw ?? 0, part.roll ?? 0, 'YXZ')),
    new THREE.Vector3(part.w, part.h, part.d));
  return primitiveVertices.get(part.shape).map(vertex => vertex.clone().applyMatrix4(matrix));
}

test('the city has substantial additional planting with varied tree silhouettes and undergrowth', () => {
  const { trees, shrubs, beds, city } = worldAudit();
  const yards = trees.filter(t => t.source === 'yard'), pockets = trees.filter(t => t.source === 'pocket');
  assert.ok(yards.length > 5000 && pockets.length > yards.length * 1.5, 'new groves supplement the original rear-yard trees');
  assert.ok(shrubs.length > 20000 && beds.length > 4000, 'trees have substantial ground-level planting');
  assert.equal(new Set(trees.map(t => t.id)).size, trees.length, 'each tree has one deterministic owner');
  assert.equal(new Set(shrubs.map(t => t.id)).size, shrubs.length);
  assert.deepEqual(new Set(trees.map(t => t.type)), new Set(['broadleaf', 'cypress']));
  assert.ok(new Set(trees.filter(t => t.tint).map(t => t.tint)).size >= 4);
  assert.ok(new Set(beds.map(p => p.w / p.d)).size > 100, 'grass beds vary in proportion');
  for (const district of MASTER_DISTRICTS) {
    const blocks = city.metropolis.area(district.x - 150, district.z - 150, district.x + 150, district.z + 150);
    assert.ok(blocks.some(b => b.trees.some(t => t.source === 'pocket')), `${district.id} has new vegetation`);
  }
});

test('actual tree and shrub meshes clear buildings, roads, infrastructure and story approaches', () => {
  const { trees, shrubs, city, buildingIndex } = worldAudit();
  for (const plant of trees.concat(shrubs)) {
    const parts = plant.type ? treeParts(plant) : shrubParts(plant);
    for (const part of parts.filter(p => p.shape === 'crown' || p.shape === 'cone')) {
      const vertices = verticesFor(part);
      assert.equal(crownHits(vertices, buildingIndex).length, 0, `${plant.id} foliage penetrates a building`);
      assert.equal(crownHits(vertices, city.metropolis.infrastructureIndex).length, 0, `${plant.id} foliage intersects infrastructure`);
    }
    if (plant.source === 'pocket' || !plant.type) {
      assert.equal(city.masterPlan.onRoad(plant.x, plant.z, 2), false, `${plant.id} clears sidewalks and road shoulders`);
      assert.ok(WORLD_OBJECTS.every(p => Math.hypot(p.x - plant.x, p.z - plant.z) > 8), 'story interaction and arrival areas stay open');
      assert.equal(plant.y, terrainHeight(plant.x, plant.z));
    }
  }
});

test('grass beds follow the terrain plane without floating or entering roads', () => {
  const { beds, city } = worldAudit();
  let sloped = 0;
  for (const bed of beds) {
    if (Math.abs(bed.pitch) + Math.abs(bed.roll) > .025) sloped++;
    for (const vertex of verticesFor(bed)) {
      assert.ok(Math.abs(vertex.y - terrainHeight(vertex.x, vertex.z)) < .08, `${bed.id} rests on the hillside`);
      assert.equal(city.masterPlan.onRoad(vertex.x, vertex.z, 2), false, `${bed.id} stays outside paved road shoulders`);
    }
  }
  assert.ok(sloped > 100, 'the check includes real hillside planting');
});

test('all tree species render their real canopy sizes and keep matching solid trunks after streaming', () => {
  const { trees, city, stream } = worldAudit(), examples = new Map();
  for (const tree of trees) examples.set(`${tree.source}:${tree.type}`, tree);
  assert.equal(examples.size, 4);
  for (const tree of examples.values()) {
    const cell = stream.cell(Math.floor(tree.x / 96), Math.floor(tree.z / 96));
    stream.build(cell, 0); stream.build(cell, 1);
    const calls = [...cell.recipes[0].values(), ...cell.recipes[1].values()].flatMap(batch => batch.entries.map(p => ({ ...p, shape: batch.shape })));
    for (const expected of treeParts(tree)) {
      assert.ok(calls.some(p => p.shape === expected.shape && ['x', 'y', 'z', 'w', 'h', 'd'].every(k => Math.abs(p[k] - expected[k]) < 1e-8)), 'renderer uses the same radius-one primitive dimensions audited for clearance');
    }
    const collider = city.spatial.near(tree.x, tree.z, 1).find(p => p.id === tree.id);
    assert.ok(collider && collider.walkable === false);
    assert.equal(circleHitsBox(tree.x, tree.z, .43, collider), true);
    const expected = JSON.stringify(cell.recipes.map(layer => [...layer.values()].map(batch => [batch.shape, batch.entries])));
    stream.release(cell, 0); stream.release(cell, 1); stream.chunks.delete(cell.key);
    const rebuilt = stream.cell(cell.cx, cell.cz); stream.build(rebuilt, 0); stream.build(rebuilt, 1);
    assert.equal(JSON.stringify(rebuilt.recipes.map(layer => [...layer.values()].map(batch => [batch.shape, batch.entries]))), expected);
    stream.release(rebuilt, 0); stream.release(rebuilt, 1);
  }
});

test('public planter foliage meets the soil and fits inside its container', () => {
  const { planters, stream } = worldAudit();
  WORLD_GEOMETRY.crown.computeBoundingBox();
  const primitive = WORLD_GEOMETRY.crown.boundingBox, size = primitive.getSize(new THREE.Vector3());
  assert.ok(planters.length > 0);
  for (const planter of planters) {
    const cell = stream.cell(Math.floor(planter.x / 96), Math.floor(planter.z / 96));
    stream.build(cell, 0);
    const crowns = [...cell.recipes[0].values()].filter(batch => batch.shape === 'crown').flatMap(batch => batch.entries);
    const foliage = crowns.find(p => p.x === planter.x && p.z === planter.z && Math.abs(p.y - planter.maxY - .35) < 1e-8);
    assert.ok(foliage, 'public planters stay green at shell detail');
    assert.ok(size.x * foliage.w < planter.w && size.z * foliage.d < planter.d, 'foliage stays inside its container frontage');
    const bottom = foliage.y + primitive.min.y * foliage.h;
    assert.ok(bottom <= planter.maxY + .02 && bottom >= planter.maxY - .1, 'foliage meets the soil');
    stream.release(cell, 0);
  }
  stream.dispose();
});
