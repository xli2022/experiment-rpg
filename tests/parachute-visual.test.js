import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createParachute, updateParachute } from '../src/parachute.js';

test('parachute leaves no visible accessory when stowed and suspension follows the deployed canopy', () => {
  const model = createParachute();
  const visibleParts = () => {
    const parts = [];
    model.root.traverseVisible(object => { if (object.geometry) parts.push(object); });
    return parts;
  };
  const player = { x: 30, y: 80, z: -10, yaw: 0, vx: 7, vz: -6, parachute: null };
  updateParachute(model, player, 1 / 60);
  assert.equal(visibleParts().length, 0, 'No floating backpack or harness is attached while walking');
  assert.equal(model.canopy.visible, false);
  player.parachute = { openness: .1, elapsed: 0 };
  updateParachute(model, player, 1 / 60);
  const foldedWidth = new THREE.Box3().setFromObject(model.canopy).getSize(new THREE.Vector3()).x;
  player.parachute.openness = 1;
  for (let i = 0; i < 60; i++) updateParachute(model, player, 1 / 60);
  const bounds = new THREE.Box3().setFromObject(model.canopy);
  assert.ok(bounds.max.x - bounds.min.x > 5.8 && bounds.max.x - bounds.min.x < 6.5);
  assert.ok(bounds.min.y > 3.4, 'The inflated fabric clears the player and raised hands');
  assert.ok(foldedWidth < 1, 'The wing inflates from a compact deployment');
  const positions = model.suspension.geometry.getAttribute('position');
  for (let i = 0; i < model.anchors.length; i++) {
    const anchor = model.anchors[i].point.clone().applyMatrix4(model.canopy.matrix);
    assert.ok(new THREE.Vector3().fromBufferAttribute(positions, i * 2 + 1).distanceTo(anchor) < .00001, 'Lines stay attached while banking');
  }
  let draws = 0, vertices = 0;
  model.root.traverse(object => { if (object.isMesh || object.isLineSegments) { draws++; vertices += object.geometry.getAttribute('position').count; } });
  assert.ok(draws <= 3 && vertices < 6000, 'The procedural rig has a small, fixed rendering budget');
  player.parachute = null;
  updateParachute(model, player, 1 / 60);
  assert.equal(model.canopy.visible, false); assert.equal(model.suspension.visible, false);
  assert.equal(visibleParts().length, 0, 'Landing removes all visible parachute accessories');
  model.root.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
});
