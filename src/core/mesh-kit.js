import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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
