import * as THREE from 'three';
import { material, part } from '../../core/mesh-kit.js';

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
