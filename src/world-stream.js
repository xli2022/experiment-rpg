import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_LIMIT } from './world-config.js';
import { SHADOW_PROFILES } from './shadows.js';

export const WORLD_GEOMETRY = {
  box: new THREE.BoxGeometry(1, 1, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  crown: new THREE.IcosahedronGeometry(1, 0),
  trunk: new THREE.CylinderGeometry(.7, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 7),
};
const transform = new THREE.Object3D(), color = new THREE.Color();
const distanceToCell = (p, c) => Math.hypot(Math.max(c.coverage.minX - p.x, 0, p.x - c.coverage.maxX), Math.max(c.coverage.minZ - p.z, 0, p.z - c.coverage.maxZ));

export const RENDER_PROFILES = {
  high: { far: 510, detail: 135, actors: 65, dpr: 1.5, minScale: .7, rain: 1100, budget: 2.5 },
  low: { far: 340, detail: 85, actors: 42, dpr: 1, minScale: .65, rain: 250, budget: 1.5 },
};

export class WorldStream {
  constructor(scene, populate = null) {
    this.scene = scene; this.populate = populate; this.chunks = new Map(); this.loose = [];
    this.frustum = new THREE.Frustum(); this.projection = new THREE.Matrix4(); this.profile = RENDER_PROFILES.high;
    this.lastScan = -Infinity; this.lastX = Infinity; this.lastZ = Infinity; this.queue = [];
    this.shadowRange = SHADOW_PROFILES.high.casters;
    this.stats = { resident: 0, visible: 0, detail: 0, queued: 0, instances: 0, builds: 0, evictions: 0, shadowBatches: 0 };
  }
  cell(cx, cz) {
    const key = `${cx},${cz}`;
    if (!this.chunks.has(key)) this.chunks.set(key, {
      key, x: cx * CHUNK_SIZE, z: cz * CHUNK_SIZE, cx, cz, generated: false, authored: false,
      recipes: [new Map(), new Map()], groups: [null, null], lastSeen: 0,
      coverage: { minX: cx * CHUNK_SIZE, maxX: (cx + 1) * CHUNK_SIZE, minZ: cz * CHUNK_SIZE, maxZ: (cz + 1) * CHUNK_SIZE },
      // Unbuilt chunks must include hilltop towers before their actual geometry
      // can expand the bounds; otherwise a visible upper floor never loads.
      bounds: new THREE.Box3(new THREE.Vector3(cx * CHUNK_SIZE - 48, -4, cz * CHUNK_SIZE - 48), new THREE.Vector3((cx + 1) * CHUNK_SIZE + 48, 300, (cz + 1) * CHUNK_SIZE + 48)),
    });
    return this.chunks.get(key);
  }
  add(mat, x, y, z, w, h, d, yaw = 0, tint, detail = false, shape = 'box', owner = null, pitch = 0, roll = 0, uvRect = null) {
    const c = owner ?? this.cell(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    if (!owner) c.authored = true;
    // Long authored roads and buildings may cross several cells. Their owner must
    // remain visible/resident wherever any part of that geometry is still near us.
    const radius = shape === 'box' || shape === 'plane' ? .5 : 1, cos = Math.abs(Math.cos(yaw)), sin = Math.abs(Math.sin(yaw));
    const tiltPad = Math.abs(Math.sin(pitch)) * h * .5 + Math.abs(Math.sin(roll)) * h * .5;
    const rx = (cos * w + sin * d) * radius + tiltPad, rz = (sin * w + cos * d) * radius + tiltPad;
    const ry = h * (shape === 'crown' ? 1 : .5) + Math.abs(Math.sin(pitch)) * d * .5 + Math.abs(Math.sin(roll)) * w * .5;
    c.coverage.minX = Math.min(c.coverage.minX, x - rx); c.coverage.maxX = Math.max(c.coverage.maxX, x + rx);
    c.coverage.minZ = Math.min(c.coverage.minZ, z - rz); c.coverage.maxZ = Math.max(c.coverage.maxZ, z + rz);
    c.bounds.min.x = Math.min(c.bounds.min.x, x - rx); c.bounds.max.x = Math.max(c.bounds.max.x, x + rx);
    c.bounds.min.z = Math.min(c.bounds.min.z, z - rz); c.bounds.max.z = Math.max(c.bounds.max.z, z + rz);
    c.bounds.min.y = Math.min(c.bounds.min.y, y - ry); c.bounds.max.y = Math.max(c.bounds.max.y, y + ry);
    const casts = !detail && !mat.isMeshBasicMaterial && h > .35;
    const key = `${mat.uuid}:${shape}:${casts ? 'solid' : 'flat'}`, recipes = c.recipes[detail ? 1 : 0];
    if (!recipes.has(key)) recipes.set(key, { mat, shape, entries: [] });
    recipes.get(key).entries.push({ x, y, z, w, h, d, yaw, pitch, roll, tint, uvRect });
  }
  capture(objects) {
    for (const object of objects) {
      object.updateMatrix(); object.matrixAutoUpdate = false;
      this.loose.push({ object, x: object.position.x, z: object.position.z, range: object.isLight ? 110 : object.material?.transparent ? 100 : 260 });
    }
  }
  setQuality(quality) { this.profile = RENDER_PROFILES[quality]; this.shadowRange = SHADOW_PROFILES[quality].casters; this.lastScan = -Infinity; }
  build(c, level) {
    if (!c.generated) { this.populate?.(c); c.generated = true; }
    const root = new THREE.Group(); root.name = `City ${c.key} ${level ? 'detail' : 'shell'}`;
    root.matrixAutoUpdate = false;
    for (const { mat, shape, entries } of c.recipes[level].values()) {
      const atlas = entries.some(v => v.uvRect), geometry = atlas ? WORLD_GEOMETRY[shape].clone() : WORLD_GEOMETRY[shape];
      if (atlas) geometry.setAttribute('instanceUvRect', new THREE.InstancedBufferAttribute(new Float32Array(entries.flatMap(v => v.uvRect ?? [0, 0, 1, 1])), 4));
      const mesh = new THREE.InstancedMesh(geometry, mat, entries.length);
      mesh.userData.ownedGeometry = atlas;
      mesh.receiveShadow = !mat.isMeshBasicMaterial;
      // Main silhouettes cast; lane paint and tiny facade trim don't need a
      // second draw. Shadow receivers keep their full visible detail.
      mesh.userData.shadowCaster = level === 0 && !mat.isMeshBasicMaterial && entries.some(v => v.h > .35);
      entries.forEach((v, i) => {
        transform.position.set(v.x, v.y, v.z); transform.scale.set(v.w, v.h, v.d); transform.rotation.set(v.pitch ?? 0, v.yaw, v.roll ?? 0, 'YXZ'); transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
        if (v.tint !== undefined) mesh.setColorAt(i, color.set(v.tint));
      });
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false; root.add(mesh);
    }
    this.scene.add(root); c.groups[level] = root; this.stats.builds++;
  }
  release(c, level) {
    const group = c.groups[level]; if (!group) return;
    for (const mesh of group.children) {
      mesh.dispose(); // Instance buffers; shared geometry/materials stay alive.
      if (mesh.userData.ownedGeometry) mesh.geometry.dispose();
    }
    this.scene.remove(group); c.groups[level] = null; this.stats.evictions++;
  }
  update(camera, player, now, force = false) {
    camera.updateMatrixWorld(); this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.projection);
    const p = this.profile, moved = Math.hypot(player.x - this.lastX, player.z - this.lastZ);
    if (force || now - this.lastScan > .18 || moved > 30) {
      this.lastScan = now; this.lastX = player.x; this.lastZ = player.z;
      const range = p.far + CHUNK_SIZE;
      for (let x = Math.floor((player.x - range) / CHUNK_SIZE); x <= Math.floor((player.x + range) / CHUNK_SIZE); x++) {
        for (let z = Math.floor((player.z - range) / CHUNK_SIZE); z <= Math.floor((player.z + range) / CHUNK_SIZE); z++) {
          if (Math.abs(x * CHUNK_SIZE) <= WORLD_LIMIT + CHUNK_SIZE && Math.abs(z * CHUNK_SIZE) <= WORLD_LIMIT + CHUNK_SIZE) this.cell(x, z);
        }
      }
      this.queue = [];
      for (const [key, c] of this.chunks) {
        const distance = distanceToCell(player, c), visible = this.frustum.intersectsBox(c.bounds);
        if (distance < 100 || (distance < p.far && visible)) {
          c.lastSeen = now;
          if (!c.groups[0]) this.queue.push({ c, level: 0, distance });
          if (distance < p.detail && !c.groups[1]) this.queue.push({ c, level: 1, distance: distance + 25 });
        }
        if (distance > p.detail + 55) this.release(c, 1);
        if (distance > p.far + 96 || (distance > 120 && now - c.lastSeen > 4)) {
          this.release(c, 0); this.release(c, 1);
          if (!c.authored) this.chunks.delete(key);
        }
      }
      this.queue.sort((a, b) => a.distance - b.distance || a.level - b.level);
    }
    const deadline = performance.now() + (force ? 30 : p.budget); let built = 0;
    while (this.queue.length && (built < 1 || performance.now() < deadline) && built < (force ? 24 : 2)) {
      const { c, level } = this.queue.shift();
      if (!this.chunks.has(c.key) || c.groups[level]) continue;
      this.build(c, level); built++;
    }
    let resident = 0, visible = 0, detail = 0, instances = 0, shadowBatches = 0;
    for (const c of this.chunks.values()) {
      const distance = distanceToCell(player, c), inView = distance < p.far && this.frustum.intersectsBox(c.bounds);
      if (c.groups[0]) {
        resident++;
        const nearShadow = distance < this.shadowRange;
        // Offscreen buildings can still cast into the view. Three's mesh
        // frustum culling keeps them out of the main color pass.
        c.groups[0].visible = inView || nearShadow;
        if (inView) visible++;
        for (const mesh of c.groups[0].children) {
          mesh.castShadow = nearShadow && mesh.userData.shadowCaster;
          if (mesh.castShadow) shadowBatches++;
        }
      }
      if (c.groups[1]) { c.groups[1].visible = inView && distance < p.detail + 25; if (c.groups[1].visible) detail++; }
      for (const group of c.groups) if (group?.visible) for (const mesh of group.children) instances += mesh.count;
    }
    for (const item of this.loose) item.object.visible = Math.hypot(player.x - item.x, player.z - item.z) < Math.min(item.range, p.far);
    Object.assign(this.stats, { resident, visible, detail, instances, shadowBatches, queued: this.queue.length });
  }
  dispose() {
    for (const c of this.chunks.values()) { this.release(c, 0); this.release(c, 1); }
    this.chunks.clear(); this.queue = [];
  }
}

// Slow, hysteretic changes avoid continually reallocating render targets or following one bad frame.
export class ResolutionGovernor {
  constructor() { this.reset(); }
  reset() { this.scale = 1; this.elapsed = 0; this.frames = 0; this.slow = 0; this.fast = 0; }
  sample(dt, minimum = .65) {
    if (dt <= 0 || dt > .15) return false;
    this.elapsed += dt; this.frames++;
    if (this.elapsed < 2) return false;
    const ms = this.elapsed * 1000 / this.frames; this.elapsed = 0; this.frames = 0;
    this.slow = ms > 22 ? this.slow + 1 : 0; this.fast = ms < 17.5 ? this.fast + 1 : 0;
    const old = this.scale;
    if (this.slow >= 2) { this.scale = Math.max(minimum, this.scale - .1); this.slow = 0; }
    if (this.fast >= 4) { this.scale = Math.min(1, this.scale + .05); this.fast = 0; }
    return Math.abs(old - this.scale) > .001;
  }
}
