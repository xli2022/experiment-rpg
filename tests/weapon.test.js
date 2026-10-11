import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWeapon } from '../src/engine/weapon.js';
import { orientedBox } from '../src/core/physics.js';

test('shots aim past the walls the camera sees through, but not past walls ahead of the player', () => {
  // The player stands at the origin facing -z; the camera is 6 m behind them,
  // with a wall between, which the view cuts away.
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, .12, 760);
  camera.position.set(0, 1.4, 6); camera.lookAt(0, 1.4, -10); camera.updateMatrixWorld();
  const object = position => { const o = new THREE.Object3D(); o.position.copy(position); o.updateMatrixWorld(); return o; };
  const character = { root: object(new THREE.Vector3(0, 0, 0)), muzzle: object(new THREE.Vector3(.3, 1.4, -.3)), gun: {}, flash: {}, clips: { Reload: { duration: 1 } } };
  const quiet = new Proxy({}, { get: () => () => {} }), hits = [];
  const behind = orientedBox(0, 3, 6, .3, 0, 4, 0), ahead = orientedBox(0, -5, 6, .3, 0, 4, 0);
  let scenery = [behind];
  const weapon = createWeapon({ camera, character, audio: quiet, effects: quiet, hud: quiet, input: { touch: false }, traffic: { cars: [], hit() {} } },
    { canAct: () => true, shot() {}, scenery: () => scenery, ownedCars: () => [], allCars: () => [], breakWindow: () => false });
  weapon.enable({ targets: () => [{ position: new THREE.Vector3(0, 1.45, -10), radius: 1, hit: damage => hits.push(damage) }], damage: () => 34 });
  weapon.fire();
  assert.deepEqual(hits, [34], 'the wall behind the player does not stop the shot');
  scenery = [behind, ahead]; weapon.cooldown = 0;
  weapon.fire();
  assert.equal(hits.length, 1, 'a wall in front of the player still does');
});
