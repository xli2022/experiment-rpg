import { createNPC } from './npc-appearance.js';
import { CROWD_PROFILES } from './npc-profiles.js';
import { seededRandom } from './physics.js';
import * as THREE from 'three';
import { streetPoint } from './metropolis.js';

// Full authored skeletal motion, including the hands, torso and feet.
export function createCrowd(scene, asset) {
  const count = 26, random = seededRandom(707);
  let drawCalls = 0, active = 0;
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 2);
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
    return { root, mixer, speed, elapsed: 0, spawn: root.position.clone(), regional: false, lane: 0, along: 0 };
  });
  return { count, drawCalls, get active() { return active; }, archetypes: CROWD_PROFILES.length, update(dt, player, camera, radius = 65) {
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(matrix); active = 0;
    const regional = Math.max(Math.abs(player.x), Math.abs(player.z)) > 950;
    for (const [i, person] of people.entries()) {
      let distance = Math.hypot(person.root.position.x - player.x, person.root.position.z - player.z);
      if (regional && (!person.regional || distance > 250)) {
        person.regional = true; person.lane = (Math.round(player.x / 192) + i % 3 - 1) * 192; person.along = player.z + (i - 13) * 13;
      } else if (!regional && person.regional) { person.regional = false; person.root.position.copy(person.spawn); }
      if (person.regional) {
        person.along += person.speed * dt;
        const point = streetPoint(person.lane, person.along), ahead = streetPoint(person.lane, person.along + Math.sign(person.speed));
        person.root.position.set(point.x + (i % 2 ? 11 : -11), .04, point.z);
        person.root.rotation.y = Math.atan2(point.x - ahead.x, point.z - ahead.z);
      } else {
        person.root.rotation.y = person.speed > 0 ? Math.PI : 0;
        person.root.position.z += person.speed * dt;
        if (person.root.position.z > 130) person.root.position.z = -130;
        if (person.root.position.z < -130) person.root.position.z = 130;
      }
      distance = Math.hypot(person.root.position.x - player.x, person.root.position.z - player.z);
      sphere.center.copy(person.root.position); sphere.center.y += 1;
      person.root.visible = distance < radius && frustum.intersectsSphere(sphere);
      person.elapsed += dt;
      if (!person.root.visible) { if (person.root.parent) scene.remove(person.root); continue; }
      if (!person.root.parent) scene.add(person.root);
      active++;
      if (distance < 22 || person.elapsed > .1) { person.mixer.update(Math.min(person.elapsed, .25)); person.elapsed = 0; }
    }
  } };
}
