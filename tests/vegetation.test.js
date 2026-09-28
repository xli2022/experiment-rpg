import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVerticalCity } from '../src/vertical-city.js';
import { WorldStream, WORLD_GEOMETRY } from '../src/world-stream.js';
import { WORLD_OBJECTS } from '../src/content.js';
import { buildingStructure } from '../src/architecture.js';
import { SpatialGrid } from '../src/spatial-grid.js';
import { geometryVolume } from '../src/infrastructure-clearance.js';

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

test('rendered tree crowns fit their reserved yards across the city and foliage fits its planters', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream, WORLD_OBJECTS);
  const trees = [], buildings = [], planters = [];
  for (let x = -15; x < 15; x++) for (let z = -15; z < 15; z++) {
    const block = city.metropolis.block(x, z);
    trees.push(...block.trees); buildings.push(...block.buildings);
    planters.push(...block.infrastructure.filter(p => p.kind === 'planter'));
  }
  const buildingIndex = new SpatialGrid(buildings.flatMap(p => buildingStructure(p).map(piece => geometryVolume({ ...piece, id: p.id,
    x: p.x + piece.x * Math.cos(p.yaw) + piece.z * Math.sin(p.yaw),
    z: p.z - piece.x * Math.sin(p.yaw) + piece.z * Math.cos(p.yaw), y: p.y + piece.y, yaw: p.yaw }))));
  const crowns = [];
  stream.add = (mat, x, y, z, w, h, d, yaw, tint, detail, shape) => {
    if (shape === 'crown') crowns.push({ x, y, z, w, h, d, yaw });
  };
  // Read sizes from the actual renderer, including the radius-one primitive.
  // This catches passing full dimensions where the geometry requires radii.
  const exemplar = trees.reduce((a, b) => b.size > a.size ? b : a);
  stream.populate(stream.cell(Math.floor(exemplar.x / 96), Math.floor(exemplar.z / 96)));
  const rendered = crowns.find(p => p.x === exemplar.x && p.z === exemplar.z);
  assert.ok(rendered);
  const ratios = { x: rendered.w / exemplar.size, y: rendered.h / exemplar.size, z: rendered.d / exemplar.size };
  WORLD_GEOMETRY.crown.computeBoundingBox();
  const primitive = WORLD_GEOMETRY.crown.boundingBox, size = primitive.getSize(new THREE.Vector3());
  const position = WORLD_GEOMETRY.crown.attributes.position;
  for (const tree of trees) {
    const vertices = Array.from({ length: position.count }, (_, i) => new THREE.Vector3(
      tree.x + position.getX(i) * ratios.x * tree.size,
      tree.y + 5.1 * tree.size + position.getY(i) * ratios.y * tree.size,
      tree.z + position.getZ(i) * ratios.z * tree.size));
    assert.equal(crownHits(vertices, buildingIndex).length, 0, `Tree at ${tree.x}, ${tree.z} penetrates a building`);
    assert.equal(crownHits(vertices, city.metropolis.infrastructureIndex).length, 0, 'Tree crowns do not pass through bridges or piers');
  }
  assert.ok(trees.length > 5000);
  for (const planter of planters) {
    crowns.length = 0;
    stream.populate(stream.cell(Math.floor(planter.x / 96), Math.floor(planter.z / 96)));
    const foliage = crowns.find(p => p.x === planter.x && p.z === planter.z && Math.abs(p.y - planter.maxY - .35) < 1e-8);
    assert.ok(foliage);
    assert.ok(size.x * foliage.w < planter.w && size.z * foliage.d < planter.d, 'Foliage stays within its container frontage');
    const bottom = foliage.y + primitive.min.y * foliage.h;
    assert.ok(bottom <= planter.maxY + .02 && bottom >= planter.maxY - .1, 'Foliage meets the soil instead of filling the concrete planter');
  }
  assert.ok(planters.length > 0);
});
