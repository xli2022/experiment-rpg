import * as THREE from 'three';

// Put the pose outside every animated node. Navigation still owns the root;
// all rigs recline in the same character space, facing upward along -Z.
export function createResidentRest(root, body) {
  const pivot = new THREE.Group(); pivot.name = 'ResidentRest';
  root.add(pivot); pivot.add(body);
  const inverse = new THREE.Matrix4(), point = new THREE.Vector3(), bounds = new THREE.Box3();
  const offset = new THREE.Vector3();
  let held = false;
  return {
    reset(clear = false) {
      pivot.position.set(0, 0, 0); pivot.quaternion.identity();
      if (clear) held = false;
    },
    apply(recline = 0) {
      if (!recline) { held = false; return; }
      const blend = THREE.MathUtils.smoothstep(recline, 0, 1);
      pivot.rotation.x = blend * Math.PI / 2;
      if (!held || recline < 1) {
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
        // Center the long silhouette over its checked footprint. Ground the
        // back/helmet as well as the feet throughout the lowering motion.
        offset.set(-offset.x * blend, .004 - bounds.min.y, -offset.z * blend);
      }
      pivot.position.copy(offset);
      held = recline === 1;
      root.updateMatrixWorld(true);
    },
  };
}
