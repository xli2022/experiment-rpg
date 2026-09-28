import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldStream } from '../src/world-stream.js';

test('a previously unloaded tower streams in when only its upper floors are visible from another rooftop', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial();
  // Citadel buildings can rise from terrain near 27 m to roofs near 187 m.
  // This view is from a neighboring roof, looking up within the player camera's
  // allowed angle. The distant street and lower floors are outside the frame.
  const tower = { x: 1080, z: -2296, y: 27, width: 30, depth: 26, height: 160 };
  const player = new THREE.Vector3(1129.52, 173.05, -2538.03);
  const camera = new THREE.PerspectiveCamera(62, 1.4, .12, 760);
  camera.position.set(player.x, player.y + 3, player.z);
  const distance = Math.hypot(tower.x - player.x, tower.z - player.z);
  camera.lookAt(tower.x, camera.position.y + Math.tan(Math.PI / 6) * distance, tower.z);
  camera.updateMatrixWorld();
  const view = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const towerBounds = new THREE.Box3(
    new THREE.Vector3(tower.x - tower.width / 2, tower.y, tower.z - tower.depth / 2),
    new THREE.Vector3(tower.x + tower.width / 2, tower.y + tower.height, tower.z + tower.depth / 2),
  );
  const stream = new WorldStream(scene), cell = stream.cell(11, -24);
  let populated = false;
  stream.populate = owner => {
    if (owner !== cell) return;
    populated = true;
    stream.add(material, tower.x, tower.y + tower.height / 2, tower.z, tower.width, tower.height, tower.depth, 0, undefined, false, 'box', owner);
  };
  try {
    assert.ok(view.intersectsBox(towerBounds), 'the upper tower belongs in this view');
    const oldHeightBounds = cell.bounds.clone(); oldHeightBounds.max.y = 150;
    assert.equal(view.intersectsBox(oldHeightBounds), false, 'the former flat-city bounds miss the visible floors');
    assert.equal(cell.generated, false);
    assert.ok(Math.hypot(player.x - tower.x, player.z - tower.z) > 100, 'the fixture is outside the always-loaded nearby ring');
    for (let frame = 0; frame < 20 && !cell.groups[0]; frame++) stream.update(camera, player, frame * .2, true);
    assert.equal(populated, true, 'first-load culling must queue this visible tower without an earlier ground-level visit');
    assert.ok(cell.groups[0]?.visible, 'the resulting shell remains visible in the same camera view');
    assert.equal(cell.groups[0].children.length, 1);
    assert.ok(view.intersectsBox(cell.groups[0].children[0].boundingBox), 'the loaded tower actually intersects the view');
  } finally { stream.dispose(); material.dispose(); }
});
