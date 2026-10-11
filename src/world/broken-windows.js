import * as THREE from 'three';
import { createBrokenWindows, paneAt, wallPoint } from './facade-windows.js';

// Broken facade windows. The registry decides which panes are broken; this
// draws them from outside as dark openings ringed with jagged glass, one
// instanced draw over the panes near the player. Inside, rooms drop the glass
// and the hull opens (interiors.js, interior-physics.js).

const SIZE = 128;
// A dark opening ringed with triangular teeth of glass left in the frame.
function shardTexture() {
  let n = 0x5eed;
  const random = () => (n = Math.imul(n ^ n >>> 15, 0x2c1b3c6d) + 0x9e3779b9 >>> 0) / 4294967296;
  const teeth = [], edges = [[[0, 0], [1, 0]], [[1, 0], [0, 1]], [[1, 1], [-1, 0]], [[0, 1], [0, -1]]];
  for (const [[ox, oy], [dx, dy]] of edges) {
    const nx = -dy, ny = dx;
    for (let t = 0; t < 1;) {
      const width = .06 + random() * .14, end = Math.min(1, t + width), reach = .04 + random() ** 2 * .32, mid = (t + end) / 2 + (random() - .5) * width * .6;
      const at = (along, inward) => [(ox + dx * along + nx * inward) * SIZE, (oy + dy * along + ny * inward) * SIZE];
      teeth.push({ points: [at(t, 0), at(end, 0), at(mid, reach)], shade: .8 + random() * .35 });
      t = end;
    }
  }
  const inside = ([ax, ay], [bx, by], [cx, cy], x, y) => {
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by), d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy), d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const tooth = teeth.find(t => inside(...t.points, x + .5, y + .5)), grain = (x * 37 + y * 91) % 9;
    const color = tooth ? [150, 178, 190].map(c => Math.min(255, c * tooth.shade + grain * 2)) : [9 + grain, 12 + grain, 17 + grain];
    data.set([...color, 255], (y * SIZE + x) * 4);
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE);
  texture.name = 'broken-window'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

const toWorld = (origin, x, z) => {
  const c = Math.cos(origin.yaw), s = Math.sin(origin.yaw);
  return { x: origin.x + x * c + z * s, z: origin.z - x * s + z * c };
};

export function createWindowBreakage(scene, metropolis, { limit = 600, radius = 260 } = {}) {
  const panes = createBrokenWindows({ limit });
  const material = new THREE.MeshBasicMaterial({ map: shardTexture(), color: 0xb9c3c7 });
  material.name = 'broken-window';
  const geometry = new THREE.PlaneGeometry(1, 1), mesh = new THREE.InstancedMesh(geometry, material, limit * 2);
  mesh.name = 'Broken windows'; mesh.frustumCulled = false; mesh.count = 0; scene.add(mesh);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let drawn = -1, center = null;

  function redraw(focus) {
    let count = 0;
    for (const { key, pieces, origin } of panes.all()) for (const pane of pieces) {
      const { wall } = pane, local = wallPoint(wall, (pane.s0 + pane.s1) / 2, .03), at = toWorld(origin, local.x, local.z);
      if (Math.hypot(at.x - focus.x, at.z - focus.z) > radius || count >= mesh.instanceMatrix.count) continue;
      const nx = wall.normal.x * Math.cos(origin.yaw) + wall.normal.z * Math.sin(origin.yaw), nz = -wall.normal.x * Math.sin(origin.yaw) + wall.normal.z * Math.cos(origin.yaw);
      // Half the panes turn the pattern over, so neighbours don't repeat it.
      euler.set(0, Math.atan2(nx, nz), key.length % 2 ? Math.PI : 0);
      mesh.setMatrixAt(count++, matrix.compose(position.set(at.x, wall.bottom + (pane.v0 + pane.v1) / 2, at.z), quaternion.setFromEuler(euler), scale.set(pane.s1 - pane.s0, pane.v1 - pane.v0, 1)));
    }
    mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
  }

  /** The building and pane at a world point on a facade (or the hull behind it). */
  function find(point) {
    for (const p of metropolis.buildingsNear(point.x, point.z, 1)) {
      const c = Math.cos(p.yaw ?? 0), s = Math.sin(p.yaw ?? 0), dx = point.x - p.x, dz = point.z - p.z;
      const pane = paneAt(p, { x: dx * c - dz * s, z: dx * s + dz * c }, point.y);
      if (pane) return { p, pane };
    }
    return null;
  }

  return {
    mesh, version: panes.version, of: panes.of, has: panes.has, all: panes.all, find,
    get revision() { return panes.revision; },
    /** Break the pane at a world point. Returns the pane (`fresh` unless it was already broken), or null on cladding. */
    breakAt(point) {
      const hit = find(point);
      if (!hit) return null;
      const fresh = panes.add(hit.p, hit.pane.key);
      const { wall } = hit.pane, origin = { x: hit.p.x, z: hit.p.z, yaw: hit.p.yaw ?? 0 }, local = wallPoint(wall, (hit.pane.s0 + hit.pane.s1) / 2), at = toWorld(origin, local.x, local.z);
      const out = toWorld({ ...origin, x: 0, z: 0 }, wall.normal.x, wall.normal.z);
      return { fresh, building: hit.p.id, key: hit.pane.key, x: at.x, y: wall.bottom + (hit.pane.v0 + hit.pane.v1) / 2, z: at.z, normal: { x: out.x, y: 0, z: out.z }, width: hit.pane.s1 - hit.pane.s0, height: hit.pane.v1 - hit.pane.v0 };
    },
    update(focus) {
      if (drawn === panes.revision && center && Math.hypot(center.x - focus.x, center.z - focus.z) < 30) return;
      drawn = panes.revision; center = { x: focus.x, z: focus.z }; redraw(focus);
    },
    clear() { panes.clear(); },
    dispose() { scene.remove(mesh); geometry.dispose(); material.map.dispose(); material.dispose(); mesh.dispose(); },
  };
}
