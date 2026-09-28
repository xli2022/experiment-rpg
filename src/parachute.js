import * as THREE from 'three';

const span = 3, chord = 2.1;
const canopyPoint = (u, v, lower = false) => {
  const arch = .38 - .67 * Math.abs(u) ** 2;
  const airfoil = .22 * Math.sin(Math.PI * v);
  return new THREE.Vector3(u * span, arch + airfoil - (lower ? .12 + .23 * Math.sin(Math.PI * v) : 0), (v - .5) * chord);
};

function canopyGeometry() {
  const positions = [], colors = [], seams = [];
  const orange = new THREE.Color(0xf39a50), teal = new THREE.Color(0x41c3bc), dark = new THREE.Color(0x203942);
  const triangle = (a, b, c, color) => {
    for (const p of [a, b, c]) { positions.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b); }
  };
  const quad = (a, b, c, d, color) => { triangle(a, b, c, color); triangle(a, c, d, color); };
  for (let cell = 0; cell < 12; cell++) {
    const u0 = cell / 6 - 1, u1 = (cell + 1) / 6 - 1;
    const color = cell === 5 || cell === 6 ? dark : cell < 3 || cell > 8 ? teal : orange;
    for (let j = 0; j < 8; j++) {
      const v0 = j / 8, v1 = (j + 1) / 8;
      for (const lower of [false, true]) quad(canopyPoint(u0, v0, lower), canopyPoint(u1, v0, lower), canopyPoint(u1, v1, lower), canopyPoint(u0, v1, lower), color);
      if (cell === 0 || cell === 11) {
        const u = cell === 0 ? u0 : u1;
        quad(canopyPoint(u, v0), canopyPoint(u, v1), canopyPoint(u, v1, true), canopyPoint(u, v0, true), color);
      }
      for (const u of cell === 11 ? [u0, u1] : [u0]) {
        const a = canopyPoint(u, v0), b = canopyPoint(u, v1);
        a.y += .006; b.y += .006; seams.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    // Dark leading cell mouths make the wing read as an inflated ram-air foil.
    quad(canopyPoint(u0, 0), canopyPoint(u1, 0), canopyPoint(u1, 0, true), canopyPoint(u0, 0, true), dark);
    quad(canopyPoint(u0, 1), canopyPoint(u1, 1), canopyPoint(u1, 1, true), canopyPoint(u0, 1, true), color);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const seamGeometry = new THREE.BufferGeometry();
  seamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(seams, 3));
  return { geometry, seamGeometry };
}

export function createParachute() {
  const root = new THREE.Group(); root.name = 'Vex parachute';
  const canopy = new THREE.Group(); canopy.name = 'Ram-air canopy'; root.add(canopy);
  const { geometry, seamGeometry } = canopyGeometry();
  const fabric = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .84, emissive: 0x263a3b, emissiveIntensity: .16 }));
  fabric.receiveShadow = true; canopy.add(fabric);
  canopy.add(new THREE.LineSegments(seamGeometry, new THREE.LineBasicMaterial({ color: 0x1c4246, transparent: true, opacity: .58 })));
  const anchors = [];
  for (const side of [-1, 1]) for (const u of [.25, .6, .9]) for (const v of [.15, .8]) anchors.push({ side, point: canopyPoint(side * u, v, true) });
  const suspensionGeometry = new THREE.BufferGeometry();
  suspensionGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((anchors.length + 2) * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const suspension = new THREE.LineSegments(suspensionGeometry, new THREE.LineBasicMaterial({ color: 0xc6d7cf }));
  suspension.name = 'Suspension lines'; suspension.frustumCulled = false; root.add(suspension);
  canopy.visible = suspension.visible = false;
  return { root, canopy, suspension, anchors, bank: 0, time: 0, point: new THREE.Vector3() };
}

export function updateParachute(model, player, dt) {
  model.time += dt;
  const state = player.parachute, openness = THREE.MathUtils.clamp(state?.openness ?? 0, 0, 1);
  model.canopy.visible = model.suspension.visible = !!state && openness > .005;
  if (!model.canopy.visible) { model.bank = 0; return; }
  const inflated = THREE.MathUtils.smoothstep(openness, 0, 1);
  const sideSpeed = (player.vx ?? 0) * Math.cos(player.yaw ?? 0) - (player.vz ?? 0) * Math.sin(player.yaw ?? 0);
  model.bank = THREE.MathUtils.damp(model.bank, THREE.MathUtils.clamp(-sideSpeed * .018, -.16, .16), 5, dt);
  const wing = model.canopy;
  wing.position.set(0, 1.7 + 2.6 * inflated, .12);
  wing.scale.set(.09 + .91 * inflated, .18 + .82 * inflated, .2 + .8 * inflated);
  wing.rotation.set(-.035 + Math.sin(model.time * 1.7) * .012 * inflated, 0, model.bank);
  wing.updateMatrix();
  const positions = model.suspension.geometry.getAttribute('position');
  let index = 0;
  for (const { side, point } of model.anchors) {
    positions.setXYZ(index++, side * .23, 1.48, .015);
    model.point.copy(point).applyMatrix4(wing.matrix);
    positions.setXYZ(index++, model.point.x, model.point.y, model.point.z);
  }
  for (const side of [-1, 1]) {
    positions.setXYZ(index++, side * .23, 1.48, .015);
    positions.setXYZ(index++, side * .43, 1.9, -.12);
  }
  positions.needsUpdate = true;
}

// Two-bone posing uses actual exported bone lengths rather than assuming a
// local Euler convention. Hands reach risers while knees hang below the harness.
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const direction = new THREE.Vector3(), bend = new THREE.Vector3(), elbow = new THREE.Vector3();
const from = new THREE.Vector3(), to = new THREE.Vector3(), target = new THREE.Vector3(), pole = new THREE.Vector3();
const worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), deltaQ = new THREE.Quaternion();
function aimBone(bone, end, goal, weight) {
  bone.getWorldPosition(a); end.getWorldPosition(b);
  from.subVectors(b, a).normalize(); to.subVectors(goal, a).normalize();
  bone.getWorldQuaternion(worldQ); deltaQ.setFromUnitVectors(from, to); worldQ.premultiply(deltaQ);
  bone.parent.getWorldQuaternion(parentQ).invert(); worldQ.premultiply(parentQ);
  bone.quaternion.slerp(worldQ, weight); bone.updateWorldMatrix(false, true);
}
function solveLimb(root, mid, end, goal, bendPoint, weight) {
  if (!root || !mid || !end) return;
  root.getWorldPosition(a); mid.getWorldPosition(b); end.getWorldPosition(c);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const distance = THREE.MathUtils.clamp(a.distanceTo(goal), .04, (l1 + l2) * .995);
  direction.subVectors(goal, a).normalize();
  bend.subVectors(bendPoint, a); bend.addScaledVector(direction, -bend.dot(direction)).normalize();
  const cos = THREE.MathUtils.clamp((l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance), -1, 1);
  elbow.copy(a).addScaledVector(direction, l1 * cos).addScaledVector(bend, l1 * Math.sqrt(1 - cos * cos));
  aimBone(root, mid, elbow, weight); aimBone(mid, end, goal, weight);
}

export function animateParachutePose(model, parachute, dt) {
  model.parachuteWeight = THREE.MathUtils.damp(model.parachuteWeight ?? 0, parachute ? 1 : 0, parachute ? 8 : 14, dt);
  const weight = model.parachuteWeight;
  if (parachute || weight > .1) model.gun.visible = false;
  if (weight < .001) return;
  model.root.updateMatrixWorld(true);
  for (const [side, sign] of [['L', -1], ['R', 1]]) {
    target.set(sign * .43, 1.9, -.12); model.root.localToWorld(target);
    pole.set(sign * .85, 1.45, -.25); model.root.localToWorld(pole);
    solveLimb(model.bones.get(`UpperArm${side}`), model.bones.get(`Forearm${side}`), model.bones.get(`Hand${side}`), target, pole, weight);
    target.set(sign * .14, .10, .10); model.root.localToWorld(target);
    pole.set(sign * .25, .65, -.45); model.root.localToWorld(pole);
    solveLimb(model.bones.get(`Thigh${side}`), model.bones.get(`Shin${side}`), model.bones.get(`Foot${side}`), target, pole, weight);
  }
  if (parachute) model.animation = 'Parachute';
}
