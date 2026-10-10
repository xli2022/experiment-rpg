import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DISTRICT_ARCHITECTURE, BUILDING_FOOTPRINTS, SKYSCRAPER_HEIGHT } from '../src/world/district-architecture.js';
import { MASTER_DISTRICTS, createMasterPlan, districtAt } from '../src/world/master-plan.js';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { WORLD_OBJECTS } from '../src/modes/story/content.js';
import { WORLD_LIMIT } from '../src/world/world-config.js';
import { buildingVolumes, buildingVolumeColliders } from '../src/world/building-design.js';
import { WORLD_GEOMETRY } from '../src/world/world-stream.js';
import { footprintVertices } from '../src/world/building-footprints.js';
import { orientedPrism, boxContainsPoint, circleHitsBox, supportHeight, rayBoxDistance, moveWithCollisions } from '../src/core/physics.js';
import { findClimbFace, startClimb, stepClimb } from '../src/engine/player/climbing.js';

const worldPoint = (p, x, z, y = 0) => new THREE.Vector3(p.x + x * Math.cos(p.yaw) + z * Math.sin(p.yaw), y, p.z - x * Math.sin(p.yaw) + z * Math.cos(p.yaw));

test('all districts enforce their footprint, height range and average, including boundary lots and landmarks', () => {
  const metro = new VerticalMetropolis(createMasterPlan(), WORLD_OBJECTS);
  const buildings = metro.area(-WORLD_LIMIT, -WORLD_LIMIT, WORLD_LIMIT, WORLD_LIMIT).flatMap(b => b.buildings);
  assert.ok(buildings.length > 12000);
  for (const district of MASTER_DISTRICTS) {
    const profile = DISTRICT_ARCHITECTURE[district.id], samples = buildings.filter(p => p.district === district.id);
    assert.ok(samples.length > 100, district.id);
    assert.equal(district.averageHeight, profile.averageHeight);
    const heights = samples.map(p => p.h), average = heights.reduce((a, b) => a + b) / heights.length;
    assert.ok(Math.abs(average - profile.averageHeight) < 4, `${district.id} average ${average.toFixed(1)}m should be near ${profile.averageHeight}m`);
    for (const p of samples) {
      assert.equal(p.district, districtAt(p.x, p.z).id, `${p.id} follows the region containing its center`);
      assert.ok(p.h >= profile.heightRange[0] && p.h <= profile.heightRange[1]);
      if (profile.footprint !== 'mixed') assert.equal(p.footprint, profile.footprint);
      else assert.ok(BUILDING_FOOTPRINTS.includes(p.footprint));
      if (p.footprint !== 'rectangle') assert.equal(p.w, p.d, 'round and hexagonal footprints are regular, not stretched');
      if (!profile.skyscrapers) assert.ok(Math.max(...buildingVolumes(p).map(v => v.y + v.h / 2 + (v.cap ? .5 : 0))) < SKYSCRAPER_HEIGHT, 'roof fixtures cannot turn a low-rise region into a skyscraper region');
    }
    if (profile.skyscrapers) assert.ok(heights.filter(h => h >= SKYSCRAPER_HEIGHT).length > samples.length * .15);
    if (district.id === 'core') for (const footprint of BUILDING_FOOTPRINTS) {
      const shapes = samples.filter(p => p.footprint === footprint);
      for (const [low, high] of [[8, 26], [26, 100], [100, 170], [170, 220]]) {
        assert.ok(shapes.some(p => p.h >= low && p.h < high), `Core includes ${footprint} buildings in the ${low}–${high}m band`);
      }
    }
  }
});

test('round and hexagonal stepped roofs and walls agree with independent rendered mesh raycasts', () => {
  const material = new THREE.MeshBasicMaterial();
  try {
    for (const footprint of ['circle', 'hexagon']) for (const type of ['office', 'apartment', 'civic', 'market', 'factory']) for (let variant = 0; variant < 4; variant++) {
      const p = { id: `shape:${type}:${variant}`, footprint, type, x: 34, z: -21, y: 5, ground: 4.7, w: 18, d: 18, h: type === 'market' ? 16 : 86, yaw: .63 };
      const volumes = buildingVolumes(p, { variant, trim: 0x444444 }), boxes = buildingVolumeColliders(p, volumes);
      const meshes = volumes.map(v => {
        const cap = v.cap ? .5 : 0, mesh = new THREE.Mesh(WORLD_GEOMETRY[v.shape ?? 'box'], material);
        mesh.position.copy(worldPoint(p, v.x, v.z, p.y + v.y + cap / 2));
        mesh.rotation.y = p.yaw; mesh.scale.set(v.w, v.h + cap, v.d); mesh.updateMatrixWorld(); return mesh;
      });
      const compareRay = (origin, direction) => {
        const hit = new THREE.Raycaster(origin, direction).intersectObjects(meshes)[0];
        const distance = Math.min(...boxes.map(b => rayBoxDistance(origin, direction, b)));
        if (!hit) assert.equal(distance, Infinity, `${footprint} empty corners do not obstruct rays`);
        else assert.ok(Math.abs(hit.distance - distance) < .00002, `${footprint} ray matches its rendered wall or roof`);
        return hit;
      };
      for (const x of [-.49, -.35, -.13, .11, .38, .49]) for (const z of [-.49, -.34, -.09, .14, .39, .49]) {
        const origin = worldPoint(p, x * p.w, z * p.d, p.y + p.h + 40);
        const hit = compareRay(origin, new THREE.Vector3(0, -1, 0));
        const floor = supportHeight(origin.x, origin.z, boxes, origin.y, p.ground);
        assert.ok(Math.abs(floor - (hit?.point.y ?? p.ground)) < .00002, 'roof support excludes unused lot corners');
      }
      for (const y of [10, p.h * .7, p.h * .95]) for (let i = 0; i < 24; i++) {
        const angle = i * Math.PI / 12, origin = worldPoint(p, Math.cos(angle) * 24, Math.sin(angle) * 24, p.y + y);
        const target = worldPoint(p, 0, 0, origin.y), direction = target.sub(origin).normalize();
        compareRay(origin, direction);
      }
      // Every rooftop accessory and tier fits on the supporting roof polygon.
      volumes.forEach((v, i) => {
        if (!i) return;
        const bottom = p.y + v.y - v.h / 2;
        for (const vertex of footprintVertices(v.shape, v.w, v.d)) {
          const at = worldPoint(p, v.x + vertex.x * .999, v.z + vertex.z * .999);
          const roof = supportHeight(at.x, at.z, boxes.filter((_, j) => j !== i), bottom + .51, p.ground);
          assert.ok(Math.abs(roof - bottom) < .51, `${footprint} ${type} fixture ${i} is fully supported`);
        }
      });
    }
  } finally { material.dispose(); }
});

test('movement uses curved/polygon walls and players can climb, shimmy around corners and mantle them', () => {
  for (const footprint of ['circle', 'hexagon']) {
    const box = orientedPrism(0, 0, 20, 20, .41, 24, 0, footprint, { id: footprint, climbable: true });
    const corner = worldPoint(box, 9, 9);
    assert.equal(circleHitsBox(corner.x, corner.z, .43, box), false);
    assert.equal(boxContainsPoint(corner.x, corner.z, box), false);
    const walker = { x: corner.x, z: corner.z, y: 0 };
    assert.equal(moveWithCollisions(walker, .1, .1, .43, [box]), false, 'an empty lot corner is walkable');
    const f = box.faces[0], start = worldPoint(box, f.x + f.nx * .6, f.z + f.nz * .6, 3);
    const player = { x: start.x, y: 3, z: start.z, yaw: 0 };
    const face = findClimbFace(player, [box]); assert.ok(face);
    assert.equal(startClimb(player, face, [box]), true);
    const firstFace = player.climb.faceIndex;
    for (let i = 0; i < 360; i++) {
      stepClimb(player, { x: 1, y: 0 }, 1 / 60, [box]);
      assert.equal(circleHitsBox(player.x, player.z, .43, box), false, 'shimmy never cuts through a corner');
      assert.ok(findClimbFace(player, [box]), 'the next wall face stays reachable');
    }
    assert.notEqual(player.climb.faceIndex, firstFace, 'sideways climbing follows the perimeter');
    let result;
    for (let i = 0; i < 600 && result !== 'roof'; i++) result = stepClimb(player, { x: 0, y: 1 }, 1 / 60, [box], true);
    assert.equal(result, 'roof'); assert.equal(player.y, 24);
    assert.equal(boxContainsPoint(player.x, player.z, box, .38), true);
    assert.equal(supportHeight(player.x, player.z, [box], 24.1), 24);
  }
});
