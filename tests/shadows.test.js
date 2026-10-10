import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createShadows, shadowAnchor, SHADOW_PROFILES } from '../src/engine/shadows.js';
import { WorldStream } from '../src/world/world-stream.js';
import { createCar } from '../src/traffic/car-model.js';

function shadowFixture() {
  const renderer = { shadowMap: {} }, scene = new THREE.Scene();
  const light = new THREE.DirectionalLight(); scene.add(light);
  return { renderer, scene, light };
}

test('light-space snapping keeps receiver UVs stable below a texel while allowing exact texel steps', () => {
  const direction = new THREE.Vector3(-45, 85, 25).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  for (const profile of Object.values(SHADOW_PROFILES)) {
    const texel = profile.radius * 2 / profile.size;
    const light = new THREE.DirectionalLight(), camera = light.shadow.camera;
    Object.assign(camera, { left: -profile.radius, right: profile.radius, top: profile.radius, bottom: -profile.radius });
    camera.updateProjectionMatrix();
    const origin = right.clone().multiplyScalar(18 * texel).addScaledVector(up, -9 * texel).addScaledVector(direction, 17);
    const receiver = new THREE.Vector3(9, 0, 14);
    const project = position => {
      shadowAnchor(position, profile, light.target.position);
      light.position.copy(light.target.position).addScaledVector(direction, 210);
      light.updateMatrixWorld(); light.target.updateMatrixWorld(); light.shadow.updateMatrices(light);
      return receiver.clone().applyMatrix4(light.shadow.matrix);
    };
    const initial = project(origin);
    const subpixel = project(origin.clone().addScaledVector(right, texel * .2).addScaledVector(up, texel * .2).addScaledVector(direction, 3));
    assert.ok(Math.abs(initial.x - subpixel.x) < 1e-12 && Math.abs(initial.y - subpixel.y) < 1e-12, 'sub-texel car motion cannot crawl the shadow across fixed paving');
    const stepped = project(origin.clone().addScaledVector(right, texel));
    assert.ok(Math.abs(initial.x - stepped.x - 1 / profile.size) < 1e-12);
    assert.ok(Math.abs(initial.y - stepped.y) < 1e-12);
  }
});

test('one bounded shadow map honors quality, frame throttling, and pause invalidation', () => {
  const { renderer, scene, light } = shadowFixture();
  const shadows = createShadows(renderer, scene, light), player = new THREE.Vector3();
  shadows.setQuality('high');
  assert.equal(renderer.shadowMap.enabled, true);
  assert.equal(renderer.shadowMap.autoUpdate, false);
  assert.equal(renderer.shadowMap.type, THREE.PCFSoftShadowMap);
  assert.equal(shadows.snapshot().lights, 1);
  assert.equal(light.shadow.mapSize.x, 2048);
  assert.equal(light.shadow.mapSize.y, 2048);
  assert.equal(light.shadow.camera.right - light.shadow.camera.left, 144);
  assert.ok(light.shadow.camera.far <= 450, 'the sun does not render the entire world into its map');
  shadows.update(0, player);
  assert.equal(shadows.snapshot().updates, 1);
  renderer.shadowMap.needsUpdate = false;
  shadows.update(.02, player);
  assert.equal(shadows.snapshot().updates, 1);
  assert.equal(renderer.shadowMap.needsUpdate, false);
  shadows.update(.051, player);
  assert.equal(shadows.snapshot().updates, 2);
  shadows.update(2, player, true);
  assert.equal(shadows.snapshot().updates, 2, 'paused scenes reuse their map');
  shadows.invalidate(); shadows.update(2, player, true);
  assert.equal(shadows.snapshot().updates, 3, 'a paused camera teleport can request a fresh map');
  shadows.update(3, player, true);
  assert.equal(shadows.snapshot().updates, 3);
  shadows.update(3, player, true, 1);
  assert.equal(shadows.snapshot().updates, 4, 'newly built nearby scenery invalidates even a paused scene');
  let disposals = 0;
  light.shadow.map = { dispose() { disposals++; } };
  shadows.setQuality('low');
  assert.equal(disposals, 1);
  assert.equal(light.shadow.map, null);
  assert.equal(light.shadow.mapSize.x, 1024);
  assert.equal(light.shadow.mapSize.y, 1024);
  assert.equal(light.shadow.camera.right - light.shadow.camera.left, 96);
  assert.equal(shadows.snapshot().updatesPerSecond, 10);
  shadows.update(4, player);
  shadows.update(4.06, player);
  assert.equal(shadows.snapshot().updates, 5);
  shadows.update(4.101, player);
  assert.equal(shadows.snapshot().updates, 6);
});

test('non-instanced casters are limited by world position and exclude glows and the resident floor', () => {
  const { renderer, scene, light } = shadowFixture();
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const near = new THREE.Mesh(geometry, material), far = new THREE.Mesh(geometry, material);
  const parent = new THREE.Group(); parent.position.x = 150; parent.add(far);
  const glow = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const resident = new THREE.Mesh(geometry, material); resident.userData.resident = true;
  scene.add(near, parent, glow, resident);
  const shadows = createShadows(renderer, scene, light);
  shadows.setQuality('low'); shadows.update(0, new THREE.Vector3());
  assert.equal(near.castShadow, true);
  assert.equal(near.receiveShadow, true);
  assert.equal(far.castShadow, false, 'a child at local origin uses its distant world position');
  assert.equal(glow.castShadow, false);
  assert.equal(resident.castShadow, false);
  shadows.update(1, new THREE.Vector3(150, 0, 0));
  assert.equal(near.castShadow, false);
  assert.equal(far.castShadow, true);
  geometry.dispose(); material.dispose(); glow.material.dispose();
});

test('cars, skinned characters, and instanced traffic never reenter the throttled shadow map', () => {
  const { renderer, scene, light } = shadowFixture();
  const car = createCar(), avatar = new THREE.Group(), traffic = new THREE.Group();
  const geometry = new THREE.BoxGeometry(), skinGeometry = geometry.clone();
  const material = new THREE.MeshStandardMaterial(), vertices = skinGeometry.getAttribute('position').count;
  const skinIndices = new Uint16Array(vertices * 4), skinWeights = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i++) skinWeights[i * 4] = 1;
  skinGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  skinGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  const body = new THREE.SkinnedMesh(skinGeometry, material), bone = new THREE.Bone();
  body.add(bone); body.bind(new THREE.Skeleton([bone])); avatar.add(body);
  const attachment = new THREE.Mesh(geometry, material); bone.add(attachment);
  // Hidden equipment and passengers must also stay excluded when shown later.
  attachment.visible = false;
  const fleet = new THREE.InstancedMesh(geometry, material, 2); traffic.add(fleet);
  const building = new THREE.Mesh(geometry, material); building.position.set(12, 7, 0);
  const roots = [car.root, avatar, traffic], meshes = [];
  for (const root of roots) root.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true; meshes.push(object);
  });
  scene.add(...roots, building);
  const shadows = createShadows(renderer, scene, light, { dynamicRoots: roots });
  const checkActors = () => {
    for (const mesh of meshes) {
      assert.equal(mesh.castShadow, false, 'no moving silhouette can be left at an old position in the cached map');
      assert.equal(mesh.receiveShadow, true, 'moving actors still receive shade from the city');
    }
  };
  checkActors();
  const player = new THREE.Vector3();
  shadows.setQuality('high'); shadows.update(0, player);
  assert.equal(building.castShadow, true, 'stationary buildings continue casting shadows');
  for (let frame = 1; frame <= 4; frame++) {
    car.root.position.set(frame * 3, .04, -frame);
    car.wheels.forEach(wheel => { wheel.rotation.x += .4; });
    avatar.position.set(-frame, 0, frame * 2); bone.rotation.z += .1;
    fleet.setMatrixAt(0, new THREE.Matrix4().makeTranslation(frame * 4, .04, 6));
    fleet.instanceMatrix.needsUpdate = true; attachment.visible = true;
    scene.updateMatrixWorld(true); shadows.update(frame * .01, player);
    checkActors();
  }
  assert.equal(shadows.snapshot().updates, 1, 'actors move across several frames without updating the static map');
  scene.remove(car.root); avatar.visible = false;
  shadows.setQuality('low'); shadows.update(.041, player); checkActors();
  assert.equal(shadows.snapshot().updates, 2);
  scene.add(car.root); avatar.visible = true;
  shadows.update(.15, player, false, 4); checkActors();
  assert.equal(shadows.snapshot().updates, 3);
  shadows.setQuality('high'); shadows.update(.151, player); checkActors();
  shadows.invalidate(); shadows.update(.152, player, true, 4); checkActors();
  assert.equal(building.castShadow, true, 'quality switches and teleports retain stationary casters');
  fleet.dispose(); geometry.dispose(); skinGeometry.dispose(); material.dispose();
});

test('continuous streaming builds cannot exceed the shadow refresh budget', () => {
  const { renderer, scene, light } = shadowFixture();
  const shadows = createShadows(renderer, scene, light), player = new THREE.Vector3();
  shadows.setQuality('high'); shadows.update(0, player, false, 0);
  for (let i = 1; i <= 45; i++) shadows.update(i / 1000, player, false, i * 2);
  assert.equal(shadows.snapshot().updates, 1, 'new chunks each frame do not force extra sun passes');
  shadows.update(.051, player, false, 92);
  assert.equal(shadows.snapshot().updates, 2);
  shadows.update(.08, player, true, 94);
  assert.equal(shadows.snapshot().updates, 2, 'paused scene builds also honor the frame budget');
  shadows.update(.102, player, true, 94);
  assert.equal(shadows.snapshot().updates, 3, 'the changed scene is eventually captured while paused');
  shadows.invalidate(); shadows.update(.11, player, true, 94);
  assert.equal(shadows.snapshot().updates, 4, 'explicit teleports can still force an immediate refresh');
  shadows.update(1, player, true, 94);
  assert.equal(shadows.snapshot().updates, 4, 'a paused unchanged scene stays cached');
});

test('offscreen nearby streamed silhouettes remain shadow-visible while paint and detail do not cast', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene);
  const material = new THREE.MeshStandardMaterial();
  const player = new THREE.Vector3(10, 0, -24), cell = stream.cell(0, -2);
  stream.add(material, 20, 10, -130, 8, 20, 8, 0, undefined, false, 'box', cell);
  stream.add(material, 25, .035, -130, .12, .01, 4, 0, undefined, false, 'box', cell);
  stream.add(material, 20, 5, -130, .5, 2, .5, 0, undefined, true, 'box', cell);
  stream.build(cell, 0); stream.build(cell, 1);
  const camera = new THREE.PerspectiveCamera(50, 1, .1, 510);
  camera.position.set(10, 3, -24); camera.lookAt(10, 3, 100);
  stream.update(camera, player, 0);
  assert.equal(stream.frustum.intersectsBox(cell.bounds), false, 'fixture lies fully behind the driving camera');
  assert.equal(cell.groups[0].visible, true, 'light can still see offscreen objects that shadow visible ground');
  assert.equal(cell.groups[0].children.length, 2, 'tall buildings and thin road paint separate even with one shared stone material');
  const building = cell.groups[0].children.find(mesh => mesh.userData.shadowCaster);
  const lanePaint = cell.groups[0].children.find(mesh => !mesh.userData.shadowCaster);
  assert.equal(building.castShadow, true);
  assert.equal(building.frustumCulled, true, 'normal camera culling still skips the offscreen color draw');
  assert.equal(lanePaint.castShadow, false);
  assert.equal(cell.groups[1].children[0].castShadow, false);
  assert.ok(stream.stats.shadowBatches >= 1);
  stream.setQuality('low'); stream.update(camera, player, 1);
  assert.equal(building.castShadow, false, 'lower quality reduces the caster radius');
  assert.equal(cell.groups[0].visible, false);
  stream.dispose(); material.dispose();
});
