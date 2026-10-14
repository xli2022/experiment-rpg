import * as THREE from 'three';

// A pose layer in character space, so the human and Quaternius rigs can use
// the same dance despite their different bone names, axes and model scales.
export function createResidentDance(root, model) {
  const bones = new Map(), previous = new Map();
  model.traverse(object => { if (object.isBone) bones.set(object.name, object); });
  const find = (...names) => names.map(name => bones.get(name)).find(Boolean);
  const chest = find('Chest', 'Torso'), hips = find('Hips', 'Abdomen'), head = find('Head');
  const arms = ['L', 'R'].map(side => ({
    upper: find(`UpperArm${side}`, `UpperArm.${side}`), lower: find(`Forearm${side}`, `LowerArm${side}`, `LowerArm.${side}`),
    hand: find(`Hand${side}`, `Palm${side}`, `Palm1${side}`, `PalmI${side}`, `Palm.${side}`, `Palm1.${side}`, `PalmI.${side}`),
  }));
  const thighs = ['L', 'R'].map(side => find(`Thigh${side}`, `UpperLeg${side}`, `UpperLeg.${side}`));
  const parentRotation = new THREE.Quaternion(), delta = new THREE.Quaternion(), local = new THREE.Quaternion();
  const axis = new THREE.Vector3(), from = new THREE.Vector3(), to = new THREE.Vector3(), target = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const identity = new THREE.Quaternion();
  function remember(bone) { if (!previous.has(bone)) previous.set(bone, bone.quaternion.clone()); }
  function rotate(bone, rotation) {
    if (!bone) return;
    remember(bone);
    parentRotation.identity();
    for (let parent = bone.parent; parent && parent !== root; parent = parent.parent) parentRotation.premultiply(parent.quaternion);
    local.copy(parentRotation).invert().multiply(rotation).multiply(parentRotation);
    bone.quaternion.premultiply(local).normalize();
  }
  function turn(bone, x, y, z, angle) { rotate(bone, delta.setFromAxisAngle(axis.set(x, y, z), angle)); }
  function aim(bone, child, x, y, z, weight) {
    if (!bone || !child) return;
    root.updateWorldMatrix(true, true); inverse.copy(root.matrixWorld).invert();
    bone.getWorldPosition(from).applyMatrix4(inverse); child.getWorldPosition(to).applyMatrix4(inverse);
    from.subVectors(to, from).normalize(); target.set(x, y, z).normalize();
    delta.setFromUnitVectors(from, target);
    delta.slerp(identity, 1 - weight);
    rotate(bone, delta);
  }
  return {
    // Restore before the mixer runs, including bones that Idle does not key.
    reset() { for (const [bone, quaternion] of previous) bone.quaternion.copy(quaternion); previous.clear(); },
    apply(activity) {
      if (activity?.kind !== 'dance') return;
      const elapsed = activity.elapsed ?? 0, fade = THREE.MathUtils.smoothstep(elapsed, 0, .4), beat = elapsed * Math.PI * 2 * 1.4;
      const sway = Math.sin(beat / 2), bounce = Math.sin(beat);
      turn(hips, 0, 1, 0, -.12 * sway * fade);
      turn(chest, 0, 1, 0, .24 * sway * fade);
      turn(chest, 0, 0, 1, .10 * sway * fade);
      turn(head, 1, 0, 0, .09 * bounce * fade);
      for (const [i, arm] of arms.entries()) {
        if (!arm.upper) continue;
        const pulse = Math.sin(beat + i * Math.PI);
        root.updateWorldMatrix(true, true); inverse.copy(root.matrixWorld).invert();
        const side = Math.sign(arm.upper.getWorldPosition(from).applyMatrix4(inverse).x) || (i ? 1 : -1);
        aim(arm.upper, arm.lower, side * .85, -.2 + .25 * pulse, -.4, fade);
        aim(arm.lower, arm.hand, side * (.2 + .18 * pulse), .85, -.35 - .2 * pulse, fade);
        turn(thighs[i], 1, 0, 0, .10 * Math.max(0, pulse) * fade);
      }
    },
  };
}
