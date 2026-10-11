import * as THREE from 'three';
import { carCollider, rayBoxDistance, rayObstructionDistance } from '../core/physics.js';

/**
 * The player's sidearm as an optional engine capability. A mode turns it on
 * with `enable({ damage, targets })`; targets are `{ position, radius, hit }`
 * spheres the mode owns (for example drones). Shots also hit scenery and
 * traffic, where three hits stop a car for the player to take over.
 */
export function createWeapon({ camera, character, audio, effects, hud, input, traffic, magazine = 24 }, world) {
  const raycaster = new THREE.Raycaster(), sphere = new THREE.Sphere(new THREE.Vector3(), 1), point = new THREE.Vector3();
  const muzzle = new THREE.Vector3(), direction = new THREE.Vector3(), projected = new THREE.Vector3(), aim = new THREE.Vector2(0, .02);
  let options = null;
  const weapon = {
    enabled: false, magazine, ammo: magazine, reloading: 0, cooldown: 0, recoil: 0,
    enable(config = {}) {
      options = config; weapon.enabled = true; weapon.refill(); character.gun.visible = true;
    },
    disable() { options = null; weapon.enabled = false; weapon.reloading = 0; input.firing = input.aiming = false; character.gun.visible = false; character.flash.visible = false; },
    refill() { weapon.ammo = magazine; weapon.reloading = 0; },
    cancel() { weapon.reloading = 0; },
    reload() {
      if (!weapon.enabled || !world.canAct() || weapon.reloading > 0 || weapon.ammo === magazine) return;
      weapon.reloading = character.clips.Reload.duration; input.firing = false; audio.reload();
    },
    fire() {
      if (!weapon.enabled || !world.canAct() || weapon.cooldown > 0 || weapon.reloading > 0) return;
      if (weapon.ammo === 0) { weapon.reload(); return; }
      weapon.ammo--; weapon.cooldown = .2; weapon.recoil = 1; character.flash.visible = true; world.shot(); audio.shot();
      raycaster.setFromCamera(aim, camera); const ray = raycaster.ray;
      const scenery = world.scenery(), owned = world.ownedCars(), targets = options.targets?.() ?? [];
      let distance = Math.min(150, rayObstructionDistance(ray.origin, ray.direction, 150, scenery, owned)), target = null, car = null;
      for (const candidate of traffic.cars) {
        const d = rayBoxDistance(ray.origin, ray.direction, carCollider(candidate), distance);
        if (d < distance) { distance = d; car = candidate; }
      }
      for (const candidate of targets) {
        sphere.center.copy(candidate.position); sphere.radius = candidate.radius ?? 1;
        if (ray.intersectSphere(sphere, point)) {
          const d = point.distanceTo(ray.origin);
          if (d < distance) { distance = d; target = candidate; car = null; }
        }
      }
      // A small touch aim assist compensates for thumbs obscuring a tiny distant target.
      if (!target && !car && input.touch) for (const candidate of targets) {
        projected.copy(candidate.position).project(camera);
        const d = candidate.position.distanceTo(ray.origin);
        if (projected.z < 1 && Math.hypot(projected.x, projected.y - .02) < .11 && d < distance) {
          direction.subVectors(candidate.position, ray.origin).normalize();
          if (rayObstructionDistance(ray.origin, direction, d, scenery, world.allCars()) === Infinity) { target = candidate; distance = d; break; }
        }
      }
      const end = target ? target.position.clone() : ray.at(distance, new THREE.Vector3());
      character.muzzle.getWorldPosition(muzzle);
      direction.subVectors(end, muzzle); const length = direction.length(); direction.normalize();
      const blocked = rayObstructionDistance(muzzle, direction, length, scenery, world.allCars(), car);
      if (blocked < length - .1) { end.copy(muzzle).addScaledVector(direction, blocked); target = null; car = null; }
      effects.tracer(muzzle, end);
      if (target) target.hit(options.damage?.() ?? 34, end);
      else if (car) hitTrafficCar(car, end);
      // A pane breaks; an open window swallows the shot; anything else sparks.
      else if ((distance < 150 || blocked < length) && !world.breakWindow?.(end, direction)) effects.sparks(end, 0xf9e8b7, 5);
    },
    update(dt) {
      if (weapon.reloading > 0) {
        weapon.reloading -= dt;
        if (weapon.reloading <= 0) { weapon.reloading = 0; weapon.ammo = magazine; audio.tone(670, .08, 'triangle', .15); }
      }
      weapon.cooldown = Math.max(0, weapon.cooldown - dt);
      weapon.recoil = Math.max(0, weapon.recoil - dt * 12); if (weapon.recoil < .5) character.flash.visible = false;
    },
  };
  function hitTrafficCar(car, end) {
    const result = traffic.hit(car);
    if (!result.hit) return;
    effects.hitMarker(); audio.hit(); effects.sparks(end, 0xbfe3d7, 6);
    if (result.car) {
      hud.notify(input.touch ? 'VEHICLE STOPPED // Approach and tap USE to take the wheel.' : 'VEHICLE STOPPED // Approach and press E to take the wheel.', 4);
    } else hud.notify(`VEHICLE HIT // ${result.hitsRemaining} more ${result.hitsRemaining === 1 ? 'hit' : 'hits'} to stop it.`, 1.4);
  }
  character.gun.visible = false;
  return weapon;
}
