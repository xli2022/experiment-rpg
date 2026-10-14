import * as THREE from 'three';

// Fold the native rig's legs in character space, keeping the torso upright.
// A separate pivot lowers the posed mesh without changing navigation position.
export function createResidentSit(root, body) {
  const pivot = new THREE.Group(); pivot.name = 'ResidentSit';
  root.add(pivot); pivot.add(body);
  const bones = new Map(), previous = new Map();
  body.traverse(object => { if (object.isBone) bones.set(object.name, object); });
  const find = (...names) => names.map(name => bones.get(name)).find(Boolean);
  const limbs = ['L', 'R'].map(side => ({
    thigh: find(`Thigh${side}`, `UpperLeg${side}`, `UpperLeg.${side}`), shin: find(`Shin${side}`, `LowerLeg${side}`, `LowerLeg.${side}`), foot: find(`Foot${side}`, `Foot.${side}`),
    mid: find(`MidLeg${side}`, `MidLeg.${side}`),
    upper: find(`UpperArm${side}`, `UpperArm.${side}`), lower: find(`Forearm${side}`, `LowerArm${side}`, `LowerArm.${side}`),
    hand: find(`Hand${side}`, `Palm${side}`, `Palm1${side}`, `PalmI${side}`, `Palm.${side}`, `Palm1.${side}`, `PalmI.${side}`),
    footRotation: new THREE.Quaternion(), footOffset: new THREE.Vector3(),
  }));
  const inverse = new THREE.Matrix4(), from = new THREE.Vector3(), to = new THREE.Vector3(), target = new THREE.Vector3();
  const parentRotation = new THREE.Quaternion(), local = new THREE.Quaternion(), delta = new THREE.Quaternion(), identity = new THREE.Quaternion();
  const point = new THREE.Vector3(), bounds = new THREE.Box3(), offset = new THREE.Vector3();
  let held = false;
  function rotationInRoot(object, result) {
    result.identity();
    for (let node = object; node && node !== root; node = node.parent) result.premultiply(node.quaternion);
    return result;
  }
  function remember(bone) {
    if (!previous.has(bone)) previous.set(bone, { quaternion: bone.quaternion.clone(), position: bone.position.clone() });
  }
  function attachFoot(limb) {
    if (!limb.foot || !limb.shin || limb.foot.parent === limb.shin) return;
    // Visitor feet are baked IK targets outside the leg hierarchy. Carry them
    // with their posed shin so the ankle remains connected during the bend.
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    point.copy(limb.footOffset).applyMatrix4(limb.shin.matrixWorld);
    remember(limb.foot); limb.foot.position.copy(limb.foot.parent.worldToLocal(point));
  }
  function aim(bone, child, x, y, z, weight) {
    if (!bone || !child) return;
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true); inverse.copy(root.matrixWorld).invert();
    bone.getWorldPosition(from).applyMatrix4(inverse); child.getWorldPosition(to).applyMatrix4(inverse);
    from.subVectors(to, from).normalize(); target.set(x, y, z).normalize();
    delta.setFromUnitVectors(from, target).slerp(identity, 1 - weight);
    rotationInRoot(bone.parent, parentRotation);
    local.copy(parentRotation).invert().multiply(delta).multiply(parentRotation);
    remember(bone); bone.quaternion.premultiply(local).normalize();
  }
  return {
    reset(clear = false) {
      pivot.position.set(0, 0, 0);
      for (const [bone, pose] of previous) { bone.quaternion.copy(pose.quaternion); bone.position.copy(pose.position); }
      previous.clear();
      if (clear) held = false;
    },
    apply(progress = 0) {
      if (!progress) { held = false; return; }
      const blend = THREE.MathUtils.smoothstep(progress, 0, 1);
      for (const [i, limb] of limbs.entries()) {
        if (limb.foot) rotationInRoot(limb.foot, limb.footRotation);
        if (limb.foot && limb.shin && limb.foot.parent !== limb.shin) {
          root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
          limb.foot.getWorldPosition(limb.footOffset); limb.shin.worldToLocal(limb.footOffset);
        }
        const side = i ? 1 : -1;
        aim(limb.thigh, limb.mid ?? limb.shin, side * .28, .6, -1, blend);
        // Three-jointed mechs fold the middle segment back under the thigh.
        aim(limb.mid, limb.shin, 0, -.15, 1, blend);
        attachFoot(limb);
        aim(limb.shin, limb.foot, 0, -.75, -.8, blend);
        attachFoot(limb);
        if (limb.foot) {
          remember(limb.foot);
          rotationInRoot(limb.foot.parent, parentRotation);
          limb.foot.quaternion.copy(parentRotation.invert().multiply(limb.footRotation));
        }
        aim(limb.upper, limb.lower, side * .18, -.85, -.35, blend);
        aim(limb.lower, limb.hand, -side * .2, -.25, -.9, blend);
      }
      if (!held || progress < 1) {
        root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
        inverse.copy(root.matrixWorld).invert(); bounds.makeEmpty();
        body.traverse(mesh => {
          if (!mesh.isMesh || !mesh.visible) return;
          for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
            mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
            bounds.expandByPoint(point);
          }
        });
        if (bounds.isEmpty()) return;
        bounds.getCenter(offset);
        // Keep the full seated silhouette centered in its checked floor space,
        // with both the feet and the seat of the body above the floor.
        offset.set(-offset.x * blend, .004 - bounds.min.y, -offset.z * blend);
      }
      pivot.position.copy(offset); held = progress === 1;
      root.updateMatrixWorld(true);
    },
  };
}
