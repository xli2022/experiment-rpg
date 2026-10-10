import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createNPCAnimation } from './npc-animation.js';

// Quaternius CC0 characters, with their own rigs and authored motion.
// Speeds describe one unscaled animation cycle at the requested game height.
export const VISITOR_PROFILES = [
  { id: 'robot-scout', species: 'robot', name: 'Service robot', height: 1.62, heading: Math.PI, walkSpeed: 1.5038 },
  { id: 'robot-worker', species: 'robot', name: 'Utility mech', height: 1.90, heading: Math.PI, walkSpeed: 2.6654 },
  { id: 'alien-scout', species: 'alien', name: 'Expedition resident', height: 1.86, heading: Math.PI, walkSpeed: 1.6436 },
  { id: 'alien-resident', species: 'alien', name: 'Atmospheric traveler', height: 1.78, heading: Math.PI, walkSpeed: 1.4633 },
  { id: 'robot-courier', species: 'robot', name: 'Cargo courier', height: 1.74, heading: Math.PI, walkSpeed: 1.4194 },
  { id: 'robot-sentinel', species: 'robot', name: 'District sentinel', height: 2.02, heading: Math.PI, walkSpeed: 2.8338 },
  { id: 'alien-envoy', species: 'alien', name: 'Ceremonial envoy', height: 1.90, heading: Math.PI, walkSpeed: 1.562 },
  { id: 'alien-navigator', species: 'alien', name: 'Crested navigator', height: 1.95, heading: Math.PI, walkSpeed: 1.4683 },
];

export function createVisitor(asset, profile, clipName = 'Idle') {
  const root = new THREE.Group(); root.name = `NPC_${profile.id}`;
  // Keep normalization outside the animated scene: root tracks cannot undo it.
  const body = new THREE.Group(), model = clone(asset.scene);
  root.add(body); body.add(model); body.rotation.y = profile.heading;
  model.traverse(object => {
    if (!object.isMesh) return;
    object.frustumCulled = false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    // Blended helmet shells otherwise cast opaque sphere shadows over faces.
    object.castShadow = !materials.every(material => material.transparent && material.opacity < .5);
    object.receiveShadow = true;
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
  // Cache contact candidates in Idle before selecting the requested clip.
  const ground = createVisitorGrounding(root, body, profile.height);
  calibration.stop();
  const animation = createNPCAnimation(mixer, [idle, walk], { initial: clipName, walkSpeed: profile.walkSpeed });
  ground();
  root.updateMatrixWorld(true);
  Object.assign(root.userData, { appearance: profile.id, species: profile.species, model: profile.id });
  return { root, body, mixer, scale, profile, walkSpeed: profile.walkSpeed,
    actions: animation.actions,
    get action() { return animation.action; },
    get animation() { return animation.animation; },
    ground,
    update(dt, speed = 0) { animation.update(dt, speed); ground(dt); },
    setAnimation(name) { animation.setAnimation(name); ground(); },
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(model);
      // Skeletons belong to the instance; geometry, materials and textures are shared.
      model.traverse(object => { if (object.isSkinnedMesh) object.skeleton.dispose(); });
    },
  };
}


// The authored robot gait dips the soles by ~5 cm. Cache only the lowest
// foot and lower-shin vertices, then apply an upward correction after blending.
// Positive clearance (the aliens' authored hop) remains intact.
function createVisitorGrounding(root, body, height) {
  const contacts = [], point = new THREE.Vector3(), inverseRoot = new THREE.Matrix4();
  root.updateMatrixWorld(true); inverseRoot.copy(root.matrixWorld).invert();
  body.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const positions = mesh.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot);
      if (point.y > height * .08) continue;
      contacts.push({ mesh, index });
    }
  });
  const baseY = body.position.y;
  let lift = 0;
  return function ground(dt = 0) {
    if (!contacts.length) return;
    body.position.y = baseY;
    root.updateMatrixWorld(true); inverseRoot.copy(root.matrixWorld).invert();
    let minimum = Infinity;
    for (const { mesh, index } of contacts) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot);
      minimum = Math.min(minimum, point.y);
    }
    const target = Math.max(0, .003 - minimum);
    lift = dt > 0 ? Math.max(target, THREE.MathUtils.damp(lift, target, 18, dt)) : target;
    body.position.y += lift;
    root.updateMatrixWorld(true);
  };
}
