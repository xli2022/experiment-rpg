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
    const mesh = new THREE.Mesh(mergeGeometries(geometries), mat);
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
}


// Folded bodywork built from chamfered cross-sections, ordered nose to tail.
// The car points down -Z, matching steering, wheel animation and parked spawns.
function carShell(parent, sections, mat, bevel = .1) {
  const positions = [], uvs = [], indices = [];
  for (const [i, [z, w, bottom, top]] of sections.entries()) {
    const cut = Math.min(bevel, (top - bottom) / 3);
    for (const [j, [x, y]] of [[-w + bevel, bottom], [w - bevel, bottom], [w, bottom + cut], [w, top - cut], [w - bevel, top], [-w + bevel, top], [-w, top - cut], [-w, bottom + cut]].entries()) {
      positions.push(x, y, z); uvs.push(j / 7, i / (sections.length - 1));
    }
    if (i) for (let j = 0; j < 8; j++) {
      const a = (i - 1) * 8 + j, b = (i - 1) * 8 + (j + 1) % 8;
      indices.push(a, b, b + 8, a, b + 8, a + 8);
    }
  }
  const end = (sections.length - 1) * 8;
  for (let i = 1; i < 7; i++) indices.push(0, i + 1, i, end, end + i, end + i + 1);
  const source = new THREE.BufferGeometry();
  source.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  source.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); source.setIndex(indices);
  const geometry = source.toNonIndexed(); geometry.computeVertexNormals(); source.dispose();
  const mesh = new THREE.Mesh(geometry, mat); parent.add(mesh); return mesh;
}

export function createCar(color = 0x9fb2a4) {
  const root = new THREE.Group(); root.name = 'Archer GT';
  const paint = material(color, 0, 0, .43, .55);
  const dark = material(0x101c27, 0, 0, .7, .32);
  const trim = material(0x546877, 0, 0, .42, .72);
  const glass = material(0x081b28, 0x0b3441, .22, .24, .65);
  const cyan = material(0x6de6df, 0x1aaeb9, 1.5);
  const headlight = material(0xcefff3, 0x83e3db, 2.3);
  const tail = material(0xff526b, 0xff173e, 2.1);
  const rubber = material(0x0a1118, 0, 0, .94, 0);

  carShell(root, [[-2.34, .96, .4, .62], [-1.65, 1.12, .4, .72], [1.7, 1.12, .4, .72], [2.34, 1.01, .4, .64]], dark);
  carShell(root, [[-2.3, .99, .59, .86], [-1.75, 1.1, .59, 1.02], [-.98, 1.08, .59, 1.12], [.76, 1.1, .59, 1.14], [1.72, 1.1, .59, 1.04], [2.3, 1.01, .59, .96]], paint);
  // A continuous smoked canopy and sloping roof replace the old upright cabin.
  carShell(root, [[-1.03, .94, 1.07, 1.12], [-.3, .84, 1.07, 1.67], [.62, .81, 1.07, 1.63], [1.39, .94, 1.03, 1.09]], glass, .055);
  carShell(root, [[-.26, .8, 1.645, 1.695], [.57, .77, 1.61, 1.66]], paint, .035);
  // Inset hood, battery-deck louvers and a narrow dorsal stripe.
  carShell(root, [[-2.02, .55, .948, .967], [-1.75, .575, 1.029, 1.048], [-1.14, .63, 1.095, 1.114]], dark, .025);
  part(root, [.085, .014, .65], [0, 1.687, .04], dark).rotation.x = .042;
  for (let i = 0; i < 5; i++) part(root, [1.35, .04, .08], [0, 1.093 - i * .012, 1.47 + i * .12], dark);

  const brace = (a, b, width, mat) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    const mesh = part(root, [width, delta.length(), width], start.clone().add(end).multiplyScalar(.5).toArray(), mat);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  };
  for (const side of [-1, 1]) {
    brace([side * .94, 1.12, -1.02], [side * .83, 1.67, -.3], .048, trim);
    brace([side * .8, 1.62, .62], [side * .93, 1.09, 1.38], .055, paint);
    brace([side * .87, 1.12, .17], [side * .82, 1.65, .17], .043, dark);
    part(root, [.025, .25, 1.78], [side * 1.107, .79, .04], dark);
    part(root, [.025, .035, 1.78], [side * 1.124, .66, .04], cyan);
    part(root, [.035, .045, .3], [side * 1.114, .995, .27], trim);
    part(root, [.1, .095, .23], [side * 1.09, 1.14, -.88], dark);
    part(root, [.012, .028, .1], [side * 1.146, 1.14, -.91], cyan);
    for (let i = 0; i < 3; i++) part(root, [.025, .12, .055], [side * 1.115, .93, .92 + i * .12], dark).rotation.x = -.3;
    for (const z of [-1.43, 1.48]) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(.5, .075, 4, 10, Math.PI), paint);
      arch.rotation.y = Math.PI / 2; arch.position.set(side * 1.065, .46, z); root.add(arch);
    }
    // Split front optics and a six-segment rear signature stay legible without flooding the road.
    part(root, [.83, .13, .045], [side * .535, .77, -2.306], dark);
    part(root, [.73, .044, .018], [side * .55, .805, -2.335], headlight).rotation.z = side * -.055;
    for (let i = 0; i < 3; i++) part(root, [.205, .055, .025], [side * (.31 + i * .255), .86, 2.313], tail);
    part(root, [.045, .18, .13], [side * .72, 1.125, 1.99], trim);
  }
  part(root, [.12, .07, .03], [0, .79, -2.328], cyan);
  part(root, [1.43, .15, .035], [0, .545, -2.348], dark);
  for (const x of [-.51, -.17, .17, .51]) part(root, [.07, .115, .055], [x, .545, -2.341], trim);
  part(root, [2.08, .055, .23], [0, 1.23, 1.99], dark);
  part(root, [1.74, .021, .018], [0, 1.245, 2.11], tail);
  part(root, [1.78, .18, .08], [0, .5, 2.32], dark);
  for (const x of [-.66, -.22, .22, .66]) part(root, [.045, .2, .2], [x, .47, 2.24], trim);
  part(root, [.43, .11, .035], [0, .72, 2.322], dark);
  part(root, [.22, .021, .014], [0, .72, 2.347], cyan);
  mergeParts(root);

  const wheels = [], tyreGeom = new THREE.CylinderGeometry(.44, .44, .27, 20);
  const hubGeom = new THREE.CylinderGeometry(.35, .35, .278, 20);
  for (const side of [-1, 1]) for (const z of [-1.43, 1.48]) {
    const wheel = new THREE.Group(); wheel.name = `Wheel ${side} ${z}`; wheel.position.set(side, .46, z);
    const tyre = new THREE.Mesh(tyreGeom, rubber); tyre.rotation.z = Math.PI / 2; wheel.add(tyre);
    const hub = new THREE.Mesh(hubGeom, dark); hub.rotation.z = Math.PI / 2; wheel.add(hub);
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      const blade = part(wheel, [.026, .105, .32], [side * .151, Math.sin(angle) * .155, Math.cos(angle) * .155], trim);
      blade.rotation.x = -angle + .3;
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.335, .017, 4, 20), cyan);
    rim.rotation.y = Math.PI / 2; rim.position.x = side * .15; wheel.add(rim);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.105, .105, .31, 6), trim); cap.rotation.z = Math.PI / 2; wheel.add(cap);
    root.add(wheel); wheels.push(wheel); mergeParts(wheel);
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
