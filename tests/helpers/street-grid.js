import * as THREE from 'three';
import { SpatialGrid } from '../../src/core/spatial-grid.js';
import { surfaceHeightAt } from '../../src/core/physics.js';

// A flat, minimal road plan with the same shape as the master plan, for fast
// and deterministic traffic tests: `roads`, a `roadIndex` of road segments,
// terrain and surface heights, optional decks and a district.
export function streetPlan(roads, { district = 'core', supports = [] } = {}) {
  const roadIndex = new SpatialGrid([], 48), supportIndex = new SpatialGrid(supports, 48);
  for (const road of roads) {
    road.kind ??= 'road'; road.class ??= 'local'; road.level ??= 0;
    road.points = road.points.map(p => ({ x: p.x, y: p.y ?? .07, z: p.z }));
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], half = road.width / 2;
      roadIndex.add({ id: `${road.id}:${i}`, road, kind: road.kind, a, b, width: road.width, crossSlope: 0, supportOverlap: 0,
        minX: Math.min(a.x, b.x) - half, maxX: Math.max(a.x, b.x) + half, minZ: Math.min(a.z, b.z) - half, maxZ: Math.max(a.z, b.z) + half,
        minY: Math.min(a.y, b.y) - .5, maxY: Math.max(a.y, b.y) });
    }
  }
  const terrainHeight = () => 0;
  return {
    roads, roadIndex, supports, supportIndex, terrainHeight, districts: [{ id: district }],
    districtAt: () => ({ id: district }),
    surfaceHeight(x, z, ceiling = Infinity) {
      let y = terrainHeight(x, z);
      for (const s of [...roadIndex.near(x, z, 1), ...supportIndex.near(x, z, 1)]) {
        const top = surfaceHeightAt(x, z, s);
        if (top !== null && top <= ceiling + 1e-6 && top > y) y = top;
      }
      return y;
    },
  };
}

/** A square grid of two-way streets, `count` lines each way, `spacing` metres apart. */
export function gridPlan({ count = 4, spacing = 110, width = 10, district = 'core', classes = {} } = {}) {
  const roads = [], extent = (count - 1) * spacing / 2 + 70;
  for (let i = 0; i < count; i++) {
    const c = -(count - 1) * spacing / 2 + i * spacing;
    roads.push({ id: `ns-${i}`, width, class: classes[`ns-${i}`] ?? 'local', points: [{ x: c, z: -extent }, { x: c, z: extent }] });
    roads.push({ id: `ew-${i}`, width, class: classes[`ew-${i}`] ?? 'local', points: [{ x: -extent, z: c }, { x: extent, z: c }] });
  }
  return streetPlan(roads, { district });
}

/** Character assets with empty rigs and the clips the crowd uses. */
export function crowdAsset(clips = ['Idle', 'Walk', 'WalkFormal', 'Jog'], baseModel = 'citizen') {
  return { scene: new THREE.Group(), userData: { baseModel, motionSpeeds: { Walk: 1.08, WalkFormal: 1.08, Jog: 5.36 } },
    animations: clips.map(name => new THREE.AnimationClip(name, 1, [])) };
}

/** A robot or alien visitor rig with a single animated root bone. */
export function visitorAsset() {
  const scene = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'VisitorRoot';
  const geometry = new THREE.BoxGeometry(.5, 1.8, .45).translate(0, .9, 0), vertices = geometry.attributes.position.count;
  const weights = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  scene.add(bone, mesh); mesh.bind(new THREE.Skeleton([bone]));
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .15);
  const track = new THREE.QuaternionKeyframeTrack('VisitorRoot.quaternion', [0, .5, 1], [0, 0, 0, 1, ...turn.toArray(), 0, 0, 0, 1]);
  return { scene, animations: [new THREE.AnimationClip('Idle', 1, []), new THREE.AnimationClip('Walk', 1, [track])] };
}
