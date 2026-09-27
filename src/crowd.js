import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { seededRandom } from './physics.js';

// Full authored skeletal motion, including the hands, torso and feet.
export function createCrowd(scene, asset) {
  const count = 26, random = seededRandom(707);
  const palette = [0xb9c2c9, 0x797ca8, 0xb6ad8f, 0x718fa7, 0x9e715f];
  const skinTones = [0xffffff, 0xdcbca5, 0xad876e, 0xefcdb8];
  let drawCalls = 0;
  const people = Array.from({ length: count }, (_, i) => {
    const root = clone(asset.scene);
    const scale = .88 + random() * .12;
    const clip = asset.animations.find(clip => clip.name === (i % 3 ? 'Walk' : 'WalkFormal'));
    const speed = (i % 2 ? 1 : -1) * (.85 + random() * .35);
    root.scale.set(scale * (i % 3 ? 1 : .95), scale, scale);
    root.position.set((i < 14 ? 0 : i < 20 ? -64 : 64) + (i % 2 ? 10.5 : -10.5), .25, -120 + random() * 240);
    root.rotation.y = speed > 0 ? Math.PI : 0;
    root.traverse(object => {
      if (!object.isMesh) return;
      drawCalls++;
      object.frustumCulled = false;
      if (object.material.name === 'Jacket' || object.material.name === 'Skin') {
        object.material = object.material.clone();
        object.material.color.multiply(new THREE.Color(object.material.name === 'Jacket' ? palette[i % palette.length] : skinTones[i % skinTones.length]));
      }
    });
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip).play();
    action.time = random() * clip.duration;
    action.timeScale = Math.abs(speed) / (1.084589 * scale);
    mixer.update(0); scene.add(root);
    return { root, mixer, speed };
  });
  return { count, drawCalls, update(dt) {
    for (const person of people) {
      person.root.position.z += person.speed * dt;
      if (person.root.position.z > 130) person.root.position.z = -130;
      if (person.root.position.z < -130) person.root.position.z = 130;
      person.mixer.update(dt);
    }
  } };
}
