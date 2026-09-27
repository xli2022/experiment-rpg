import { createNPC } from './npc-appearance.js';
import { CROWD_PROFILES } from './npc-profiles.js';
import { seededRandom } from './physics.js';

// Full authored skeletal motion, including the hands, torso and feet.
export function createCrowd(scene, asset) {
  const count = 26, random = seededRandom(707);
  let drawCalls = 0;
  const people = Array.from({ length: count }, (_, i) => {
    const avatar = createNPC(asset, CROWD_PROFILES[i % CROWD_PROFILES.length], i % 3 ? 'Walk' : 'WalkFormal');
    const { root, mixer, action, scale } = avatar;
    const speed = (i % 2 ? 1 : -1) * (.85 + random() * .35);
    root.position.set((i < 14 ? 0 : i < 20 ? -64 : 64) + (i % 2 ? 10.5 : -10.5), .25, -120 + random() * 240);
    root.rotation.y = speed > 0 ? Math.PI : 0;
    root.traverseVisible(object => { if (object.isMesh) drawCalls++; });
    action.time = random() * action.getClip().duration;
    action.timeScale = Math.abs(speed) / (1.084589 * scale);
    mixer.update(0); scene.add(root);
    return { root, mixer, speed };
  });
  return { count, drawCalls, archetypes: CROWD_PROFILES.length, update(dt) {
    for (const person of people) {
      person.root.position.z += person.speed * dt;
      if (person.root.position.z > 130) person.root.position.z = -130;
      if (person.root.position.z < -130) person.root.position.z = 130;
      person.mixer.update(dt);
    }
  } };
}
