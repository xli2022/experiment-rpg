import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const softBox = new RoundedBoxGeometry(1, 1, 1, 2, 0.09);
const materials = new Map();
export function material(color, emissive = 0, intensity = 0, roughness = 0.65, metalness = 0.2) {
  const key = [color, emissive, intensity, roughness, metalness].join('-');
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness, metalness }));
  return materials.get(key);
}
export function part(parent, size, position, mat, rounded = false) {
  const mesh = new THREE.Mesh(rounded ? softBox : boxGeometry, mat);
  mesh.scale.set(...size);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// Consolidate static model parts by material to keep draw calls affordable on phones.
function mergeParts(group) {
  const buckets = new Map();
  for (const mesh of [...group.children]) {
    if (!mesh.isMesh) continue;
    mesh.updateMatrix();
    const geometry = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
    if (!buckets.has(mesh.material)) buckets.set(mesh.material, []);
    buckets.get(mesh.material).push(geometry); group.remove(mesh);
  }
  for (const [mat, geometries] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), mat); group.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
}


export function createCar(color = 0x9fb2a4) {
  const root = new THREE.Group();
  const paint = material(color, 0, 0, .3, .67);
  const dark = material(0x111820, 0, 0, .68, .35);
  const trim = material(0x465660, 0, 0, .32, .8);
  const glass = material(0x0c2635, 0x113b48, .45, .1, .88);
  const headlight = material(0xdbfff3, 0xa1ffe5, 5);
  const tail = material(0xff3a53, 0xff1437, 3);
  part(root, [2.24, .42, 4.65], [0, .66, 0], dark, true);
  part(root, [2.19, .48, 4.47], [0, .95, 0], paint, true);
  part(root, [2.12, .18, 1.38], [0, 1.19, -1.52], paint, true);
  part(root, [2.07, .16, 1.01], [0, 1.22, 1.72], paint, true);
  part(root, [1.87, .57, 1.93], [0, 1.47, .2], glass, true);
  part(root, [1.83, .12, 1.49], [0, 1.8, .35], paint, true);
  const wind = part(root, [1.84, .59, .07], [0, 1.48, -.81], glass);
  wind.rotation.x = -.48;
  const rear = part(root, [1.85, .5, .06], [0, 1.48, 1.25], glass); rear.rotation.x = .48;
  part(root, [1.86, .07, .07], [0, 1.76, -.64], trim);
  for (const side of [-1, 1]) {
    part(root, [.085, .63, .09], [side * .94, 1.48, .1], paint);
    part(root, [.085, .57, .095], [side * .94, 1.47, -.76], paint).rotation.x = -.45;
    part(root, [.085, .54, .1], [side * .94, 1.48, 1.16], paint).rotation.x = .4;
    part(root, [.02, .055, .35], [side * 1.11, 1.12, .39], trim);
    part(root, [.3, .13, .28], [side * 1.17, 1.32, -.65], paint, true);
    part(root, [.035, .05, 2.45], [side * 1.13, .53, .1], material(0x6cfff0, 0x29dbcf, 2));
  }
  part(root, [1.98, .085, .075], [0, 1.02, -2.265], headlight, true);
  part(root, [1.8, .15, .08], [0, .76, -2.33], dark);
  part(root, [.7, .12, .05], [0, .77, -2.38], trim);
  part(root, [2.0, .055, .09], [0, .57, -2.27], trim);
  part(root, [2.01, .07, .07], [0, 1.03, 2.27], tail);
  part(root, [.6, .13, .06], [0, .78, 2.33], trim);
  for (let i = -3; i <= 3; i++) part(root, [.12, .025, .4], [i * .19, 1.3, 1.68], dark);
  const wheels = [];
  mergeParts(root);
  const tyreGeom = new THREE.CylinderGeometry(.44, .44, .25, 16);
  const hubGeom = new THREE.CylinderGeometry(.26, .26, .265, 12);
  for (const side of [-1, 1]) for (const z of [-1.43, 1.48]) {
    const wheel = new THREE.Group(); wheel.position.set(side * 1.08, .46, z);
    const tyre = new THREE.Mesh(tyreGeom, dark); tyre.rotation.z = Math.PI / 2; wheel.add(tyre);
    const hub = new THREE.Mesh(hubGeom, trim); hub.rotation.z = Math.PI / 2; wheel.add(hub);
    const inset = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .28, 6), dark); inset.rotation.z = Math.PI / 2; wheel.add(inset);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.3, .023, 5, 16), material(0x7ccdcc, 0x29766d, .7)); rim.rotation.y = Math.PI / 2; rim.position.x = side * .142; wheel.add(rim);
    root.add(wheel); wheels.push(wheel);
    mergeParts(wheel);
  }
  return { root, wheels };
}

export function createDrone() {
  const root = new THREE.Group();
  const shell = material(0x414857, 0, 0, .5, .7);
  const black = material(0x111b26);
  const glow = material(0xff636f, 0xff193f, 4);
  part(root, [1.05, .38, .72], [0, 0, 0], shell, true);
  part(root, [.52, .2, .12], [0, -.02, -.41], black, true);
  part(root, [.32, .075, .04], [0, 0, -.483], glow);
  part(root, [.18, .33, .22], [0, -.3, -.17], black);
  const rotors = [];
  for (const x of [-.77, .77]) {
    part(root, [.55, .11, .14], [x * .8, .02, 0], shell);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.38, .065, 6, 16), shell); ring.rotation.x = Math.PI / 2; ring.position.set(x, .04, 0); root.add(ring);
    const blade = part(root, [.59, .015, .1], [x, .04, 0], black); rotors.push(blade);
    part(root, [.08, .04, .08], [x, .12, 0], glow);
  }
  return { root, rotors };
}
