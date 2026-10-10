import * as THREE from 'three';

import { SHADOW_PROFILES } from '../core/quality.js';
export { SHADOW_PROFILES };
const sunDirection = new THREE.Vector3(-45, 85, 25).normalize();
const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDirection).normalize();
const up = new THREE.Vector3().crossVectors(sunDirection, right).normalize();

// Quantize in the light's plane, not world XZ, so the map doesn't crawl over
// stationary paving as the camera follows a moving car.
export function shadowAnchor(position, profile, target = new THREE.Vector3()) {
  target.set(position.x, position.y ?? 0, position.z);
  const texel = profile.radius * 2 / profile.size;
  const x = Math.round(target.dot(right) / texel) * texel;
  const y = Math.round(target.dot(up) / texel) * texel;
  const depth = target.dot(sunDirection);
  return target.copy(sunDirection).multiplyScalar(depth)
    .addScaledVector(right, x).addScaledVector(up, y);
}

export function createShadows(renderer, scene, light, { dynamicRoots = [] } = {}) {
  const casters = [], point = new THREE.Vector3();
  const dynamicMeshes = new WeakSet();
  // A throttled map retains old silhouettes between updates. Moving actors
  // instead use frame-synchronous contact shadows, while receiving city shade.
  for (const root of dynamicRoots) root.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = false; object.receiveShadow = true;
    dynamicMeshes.add(object);
  });
  let profile, lastUpdate = -Infinity, dirty = true, updates = 0, lastBuilds = -1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  light.castShadow = true;
  light.shadow.bias = -.00012; light.shadow.normalBias = .06;
  light.shadow.camera.near = 1; light.shadow.camera.far = 430;
  scene.add(light.target);
  // Streamed instances are handled by WorldStream. Cache the remaining meshes
  // once; only stationary furniture and story objects belong in this cache.
  scene.traverse(object => {
    if (!object.isMesh || dynamicMeshes.has(object) || object.isInstancedMesh || object.userData.resident) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(m => m.isMeshStandardMaterial && !m.transparent)) return;
    object.receiveShadow = true; casters.push(object);
  });
  return {
    setQuality(quality) {
      profile = SHADOW_PROFILES[quality];
      const camera = light.shadow.camera;
      Object.assign(camera, { left: -profile.radius, right: profile.radius, top: profile.radius, bottom: -profile.radius });
      camera.updateProjectionMatrix();
      if (light.shadow.mapSize.x !== profile.size) {
        light.shadow.map?.dispose(); light.shadow.map = null;
        light.shadow.mapSize.set(profile.size, profile.size);
      }
      dirty = true;
    },
    invalidate() { dirty = true; },
    update(now, player, paused = false, builds = 0) {
      if (!profile) return;
      if (!dirty && (now - lastUpdate < 1 / profile.hz || (paused && builds === lastBuilds))) return;
      shadowAnchor(player, profile, light.target.position);
      light.position.copy(light.target.position).addScaledVector(sunDirection, 210);
      light.target.updateMatrixWorld(); light.updateMatrixWorld();
      for (const mesh of casters) {
        mesh.getWorldPosition(point);
        mesh.castShadow = Math.hypot(point.x - player.x, point.z - player.z) < profile.casters;
      }
      renderer.shadowMap.needsUpdate = true;
      dirty = false; lastBuilds = builds; lastUpdate = now; updates++;
    },
    snapshot() { return { mapSize: profile.size, radius: profile.radius, updatesPerSecond: profile.hz, updates, lights: 1 }; },
  };
}
