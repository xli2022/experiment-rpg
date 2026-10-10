import * as THREE from 'three';

// Analytic two-bone IK keeps hands and boots on the facade while alternating
// reaches advance with actual climbing distance, including reverse movement.
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const direction = new THREE.Vector3(), bend = new THREE.Vector3(), elbow = new THREE.Vector3();
const from = new THREE.Vector3(), to = new THREE.Vector3(), target = new THREE.Vector3(), pole = new THREE.Vector3();
const worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), deltaQ = new THREE.Quaternion(), endQ = new THREE.Quaternion();
function aim(bone, end, goal, weight) {
  bone.getWorldPosition(a); end.getWorldPosition(b);
  from.subVectors(b, a).normalize(); to.subVectors(goal, a).normalize();
  bone.getWorldQuaternion(worldQ); deltaQ.setFromUnitVectors(from, to); worldQ.premultiply(deltaQ);
  bone.parent.getWorldQuaternion(parentQ).invert(); worldQ.premultiply(parentQ);
  bone.quaternion.slerp(worldQ, weight); bone.updateWorldMatrix(false, true);
}
function solve(root, mid, end, goal, bendPoint, weight) {
  if (!root || !mid || !end) return;
  root.getWorldPosition(a); mid.getWorldPosition(b); end.getWorldPosition(c); end.getWorldQuaternion(endQ);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c), distance = THREE.MathUtils.clamp(a.distanceTo(goal), .04, (l1 + l2) * .995);
  direction.subVectors(goal, a).normalize();
  bend.subVectors(bendPoint, a); bend.addScaledVector(direction, -bend.dot(direction)).normalize();
  const cos = THREE.MathUtils.clamp((l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance), -1, 1);
  elbow.copy(a).addScaledVector(direction, l1 * cos).addScaledVector(bend, l1 * Math.sqrt(1 - cos * cos));
  aim(root, mid, elbow, weight); aim(mid, end, goal, weight);
  end.parent.getWorldQuaternion(parentQ).invert(); endQ.premultiply(parentQ);
  end.quaternion.slerp(endQ, weight); end.updateWorldMatrix(false, true);
}
const fract = x => (x % 1 + 1) % 1;
function reach(phase) {
  const p = fract(phase);
  if (p < .65) return { height: 1 - p / .65, lift: 0 };
  const t = (p - .65) / .35;
  return { height: t * t * (3 - 2 * t), lift: Math.sin(t * Math.PI) * .16 };
}
export function animateClimb(model, climb, dt) {
  model.climbWeight = THREE.MathUtils.damp(model.climbWeight ?? 0, climb ? 1 : 0, 16, dt);
  model.gun.visible = model.climbWeight < .1;
  if (climb) model.lastClimbPose = { ...climb };
  const pose = climb ?? model.lastClimbPose;
  if (!pose || model.climbWeight < .001) return;
  let weight = model.climbWeight;
  if (pose.mode === 'mantle') {
    weight *= 1 - THREE.MathUtils.smoothstep(pose.progress, .55, 1);
    model.body.position.y -= Math.sin(pose.progress * Math.PI) * .16 * model.climbWeight;
  }
  model.root.updateMatrixWorld(true);
  for (const [side, sign, offset] of [['L', -1, 0], ['R', 1, .5]]) {
    const hand = reach(pose.phase + offset), foot = reach(pose.phase + offset + .5);
    const mantle = pose.mode === 'mantle';
    const handY = mantle ? Math.max(.65, pose.roofY - model.root.position.y + .08) : 1.25 + hand.height * .52;
    target.set(sign * .3, handY, -.46 + hand.lift); model.root.localToWorld(target);
    pole.set(sign * .85, 1.15, .3); model.root.localToWorld(pole);
    solve(model.bones.get(`UpperArm${side}`), model.bones.get(`Forearm${side}`), model.bones.get(`Hand${side}`), target, pole, weight);
    target.set(sign * .21, .1 + foot.height * .48, -.32 + foot.lift); model.root.localToWorld(target);
    pole.set(sign * .32, .62, -.9); model.root.localToWorld(pole);
    solve(model.bones.get(`Thigh${side}`), model.bones.get(`Shin${side}`), model.bones.get(`Foot${side}`), target, pole, weight);
  }
  if (climb) model.animation = pose.mode === 'mantle' ? 'Mantle' : pose.speed > .1 ? 'Climb' : 'ClimbHang';
}
