import * as THREE from 'three';

// Rigid boot vertices are a much cheaper and more precise contact proxy than
// reskinning the entire character mesh each frame. Cache them per actor because
// human body shaping changes the source geometry but keeps the authored rig.
export function createNPCGrounding(root, body) {
  const contacts = [], seen = new Set(), point = new THREE.Vector3(), inverseRoot = new THREE.Matrix4();
  body.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    const positions = mesh.geometry.getAttribute('position');
    const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
    if (!joints || !weights) return;
    for (let i = 0; i < positions.count; i++) {
      const joint = joints.getX(i), bone = mesh.skeleton.bones[joint];
      if (!/^Foot[LR]$/.test(bone?.name) || weights.getX(i) < .999) continue;
      const local = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[joint]);
      const key = bone.name + local.toArray().map(value => value.toFixed(4)).join(',');
      if (!seen.has(key)) { seen.add(key); contacts.push({ bone, point: local }); }
    }
  });
  const baseY = body.position.y;
  let lift = 0;
  return function ground(dt = 0) {
    if (!contacts.length) return;
    body.position.y = baseY;
    // Refresh ancestors, then use updateMatrixWorld for descendants so
    // SkinnedMesh also refreshes its attached bindMatrixInverse. Bypassing that
    // override leaves translated/scaled actors with stale skinning transforms.
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    inverseRoot.copy(root.matrixWorld).invert();
    let minimum = Infinity;
    for (const contact of contacts) minimum = Math.min(minimum, point.copy(contact.point).applyMatrix4(contact.bone.matrixWorld).applyMatrix4(inverseRoot).y);
    const target = Math.max(0, .004 - minimum);
    lift = dt > 0 ? Math.max(target, THREE.MathUtils.damp(lift, target, 18, dt)) : target;
    body.position.y += lift;
    root.updateMatrixWorld(true);
  };
}
