import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// Quaternius CC0 characters, with their own rigs and authored motion.
// Speeds describe one unscaled animation cycle at the requested game height.
export const VISITOR_PROFILES = [
  { id: 'robot-scout', species: 'robot', name: 'Service robot', height: 1.62, heading: Math.PI, walkSpeed: 1.5038 },
  { id: 'robot-worker', species: 'robot', name: 'Utility mech', height: 1.90, heading: Math.PI, walkSpeed: 2.6654 },
  { id: 'alien-scout', species: 'alien', name: 'Alien resident', height: 1.86, heading: Math.PI, walkSpeed: 1.6344 },
  { id: 'alien-resident', species: 'alien', name: 'Alien traveler', height: 1.78, heading: Math.PI, walkSpeed: 1.4605 },
];

export function createVisitor(asset, profile, clipName = 'Idle') {
  const root = new THREE.Group(); root.name = `NPC_${profile.id}`;
  // Keep normalization outside the animated scene: root tracks cannot undo it.
  const body = new THREE.Group(), model = clone(asset.scene);
  root.add(body); body.add(model); body.rotation.y = profile.heading;
  model.traverse(object => {
    if (!object.isMesh) return;
    object.frustumCulled = false;
    object.castShadow = true; object.receiveShadow = true;
  });
  const idle = asset.animations.find(clip => clip.name === 'Idle');
  const walk = asset.animations.find(clip => clip.name === 'Walk');
  if (!idle || !walk) throw new Error(`Missing Idle/Walk clips for ${profile.id}`);
  const mixer = new THREE.AnimationMixer(model);
  const calibration = mixer.clipAction(idle).play(); mixer.update(0);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model, true);
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) throw new Error(`Invalid model bounds for ${profile.id}`);
  const scale = profile.height / size.y;
  body.scale.setScalar(scale);
  body.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  calibration.stop();
  const action = mixer.clipAction(clipName === 'Idle' ? idle : walk).play(); mixer.update(0);
  root.updateMatrixWorld(true);
  Object.assign(root.userData, { appearance: profile.id, species: profile.species, model: profile.id });
  return { root, body, mixer, action, scale, profile, walkSpeed: profile.walkSpeed,
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(model);
      // Skeletons belong to the instance; geometry, materials and textures are shared.
      model.traverse(object => { if (object.isSkinnedMesh) object.skeleton.dispose(); });
    },
  };
}
