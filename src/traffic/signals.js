import * as THREE from 'three';
import { rightOf } from './network.js';
import { orientedBox } from '../core/physics.js';

// Phased traffic signals: one phase per road direction, so streets that cross
// never share a green. Every state is a pure function of the clock, so a
// distant junction costs nothing and a reload resumes the same cycle.

export const SIGNAL_TIMING = { amber: 3, allRed: 1.5, minGreen: 14, maxGreen: 22 };
// Roads whose axes are within this angle run together (a road and its continuation).
const PARALLEL = 20 * Math.PI / 180;
const hash = id => { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const axisOf = dir => ((Math.atan2(dir.z, dir.x) % Math.PI) + Math.PI) % Math.PI;
const apart = (p, q) => { const d = Math.abs(p - q) % Math.PI; return Math.min(d, Math.PI - d); };

/**
 * Phases for a signalized junction: a road's approaches always share a phase,
 * roads meeting in a line join it, and every other direction gets its own.
 * The main road's phase comes first. Returns the phase per approach, green
 * times, cycle length, offset and phase start times.
 */
export function signalPlan(node) {
  if (node.signal) return node.signal;
  const roads = [];
  for (const a of node.approaches) {
    const road = roads.find(r => r.road === a.edge.road);
    if (road) road.members.push(a); else roads.push({ road: a.edge.road, members: [a], axis: axisOf(a.dir), main: a.major, width: a.width });
  }
  roads.sort((p, q) => q.main - p.main || q.width - p.width);
  const groups = [];
  for (const road of roads) {
    const group = groups.find(g => apart(g.axis, road.axis) < PARALLEL);
    if (group) group.members.push(...road.members); else groups.push({ axis: road.axis, members: [...road.members] });
  }
  const phase = new Map();
  groups.forEach((group, p) => { for (const a of group.members) phase.set(a, p); });
  const green = groups.map(group => Math.min(SIGNAL_TIMING.maxGreen, Math.max(SIGNAL_TIMING.minGreen, 8 + Math.max(...group.members.map(a => a.width)) * .65)));
  const change = SIGNAL_TIMING.amber + SIGNAL_TIMING.allRed, starts = [];
  let cycle = 0;
  for (const g of green) { starts.push(cycle); cycle += g + change; }
  node.signal = { phase, green, cycle, offset: hash(node.id) * cycle, starts, phases: groups.length };
  return node.signal;
}

/** The light facing traffic arriving on `approach`: color and seconds until it changes. */
export function signalState(node, approach, time) {
  if (!node.signalized) return { color: 'green', remaining: Infinity };
  const plan = signalPlan(node), p = plan.phase.get(approach), start = plan.starts[p], green = plan.green[p];
  const t = (((time + plan.offset - start) % plan.cycle) + plan.cycle) % plan.cycle;
  if (t < green) return { color: 'green', remaining: green - t };
  if (t < green + SIGNAL_TIMING.amber) return { color: 'amber', remaining: green + SIGNAL_TIMING.amber - t };
  return { color: 'red', remaining: plan.cycle - t };
}

/** Whether pedestrians may start crossing the street of `approach`: while another phase has green. */
export function walkState(node, approach, time) {
  if (!node.signalized) return { walk: true, remaining: Infinity, controlled: false };
  const plan = signalPlan(node), own = plan.phase.get(approach), t = (((time + plan.offset) % plan.cycle) + plan.cycle) % plan.cycle;
  for (let p = 0; p < plan.phases; p++) {
    if (p === own || t < plan.starts[p] || t >= plan.starts[p] + plan.green[p]) continue;
    return { walk: true, remaining: plan.starts[p] + plan.green[p] - t, controlled: true };
  }
  return { walk: false, remaining: 0, controlled: true };
}

// Lamp colours in the renderer's linear HDR range, before the filmic tone
// mapping every frame goes through. That curve bleaches and yellows bright
// saturated light: a lens bright enough to bloom reaches the screen as a pale
// disc (a red one as salmon). So the signal lenses stay under the bloom
// threshold, where the curve keeps their colour, and each lit lens wears a
// soft ring of its own light instead of bloom.
export const LAMP_COLORS = Object.freeze({ red: [1.2, 0, 0], amber: [1.1, .3, 0], green: [0, .5, .22], walk: [2.2, 2.4, 2.3], stop: [2.6, .7, .1] });
export const LAMP_GLOWS = Object.freeze({ red: [.42, 0, 0], amber: [.42, .13, 0], green: [0, .26, .11] });
const DIM = .1, PROP_RANGE = 170, REBUILD = 40, GLOW = .75, WALK_REACH = 6;

// A ring of light round a lens: clear over the lens itself (radius .105 of
// the glow's .375), brightest at its rim and fading out to the edge.
function glowTexture(size = 64) {
  const data = new Uint8Array(size * size * 4), smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1), alpha = smooth(.25, .31, r) * (1 - smooth(.29, 1, r)) ** 1.6;
    data.set([255, 255, 255, Math.round(255 * alpha)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.name = 'signal-glow'; texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

/**
 * The signal poles of a junction, one per approach with arriving traffic: on
 * the drivers' kerb before the crossing, an arm out over their lane with a
 * head facing them, and a second head on the pole. Each pole stands at a
 * corner where two crossings end, and carries the walk lamps facing across
 * them: its own approach's and the previous one's (when that ends here).
 */
export function signalPoles(node, plan) {
  if (node.poles) return node.poles;
  const poles = [], list = node.approaches;
  if (node.kind === 'junction' && node.ground && node.signalized) for (const a of list) {
    if (!a.arriving.length) continue;
    const r = rightOf(a.dir), yaw = Math.atan2(a.dir.x, a.dir.z), kerb = a.width / 2 + .7;
    const x = node.x + a.dir.x * (a.clear - .4) - r.x * kerb, z = node.z + a.dir.z * (a.clear - .4) - r.z * kerb;
    const ground = plan.terrainHeight(x, z), reach = kerb - a.arriving[0].offset;
    const heads = [{ x: x + r.x * reach, z: z + r.z * reach, y: ground + 4.62, height: 1 }, { x: x + a.dir.x * .2, z: z + a.dir.z * .2, y: ground + 2.9, height: .82 }];
    const walks = [], previous = list[(a.index + list.length - 1) % list.length];
    for (const [crossing, side] of [[a, 1], [previous, -1]]) {
      // The lamp faces the people waiting at the crossing's far end.
      const cr = rightOf(crossing.dir), face = { x: cr.x * side, z: cr.z * side }, across = crossing.width / 2 + .4;
      const end = { x: node.x + crossing.dir.x * crossing.crosswalk - face.x * across, z: node.z + crossing.dir.z * crossing.crosswalk - face.z * across };
      if (Math.hypot(end.x - x, end.z - z) > WALK_REACH) continue;
      walks.push({ approach: crossing, x: x + face.x * .17, z: z + face.z * .17, y: ground + 2.2, yaw: Math.atan2(face.x, face.z), face });
    }
    poles.push({ node, approach: a, x, z, ground, yaw, reach, heads, walks });
  }
  node.poles = poles;
  return poles;
}

/**
 * The solid parts of a junction's signal poles within reach: each post, the
 * head on it and its walk lamps. The arm and the head overhead are out of reach.
 */
export function signalColliders(node, plan) {
  if (node.poleColliders) return node.poleColliders;
  node.poleColliders = signalPoles(node, plan).flatMap(p => {
    const id = `signal:${node.id}:${p.approach.index}`, solid = { kind: 'signal', walkable: false }, head = p.heads[1], half = .51 * head.height;
    return [orientedBox(p.x, p.z, .26, .26, 0, p.ground + 5.4, p.ground, { id, ...solid }),
      orientedBox(head.x, head.z, .36, .3, p.yaw, head.y + half, head.y - half, { id: `${id}:head`, ...solid }),
      ...p.walks.map((w, k) => orientedBox(w.x, w.z, .3, .14, w.yaw, w.y + .15, w.y - .15, { id: `${id}:walk:${k}`, ...solid }))];
  });
  return node.poleColliders;
}

/** A spatial source of signal pole colliders: `query(minX, minZ, maxX, maxZ)` returns those overlapping. */
export function signalColliderSource(network, plan) {
  return (minX, minZ, maxX, maxZ) => {
    // Kerbs clear a junction within 22 m, so its poles stand within 25 m of its centre.
    const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2, radius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 25;
    return network.nodesNear(x, z, radius).flatMap(node => signalColliders(node, plan))
      .filter(b => b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ);
  };
}

// Poles, signal heads, zebra crossings and stop lines near the player, as a
// handful of instanced meshes rebuilt when the player has moved far enough.
export function createSignalProps(scene, network, plan) {
  const root = new THREE.Group(); root.name = 'Traffic signals';
  const metal = new THREE.MeshStandardMaterial({ color: 0x1d262d, roughness: .55, metalness: .6 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xb7bcaf, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const glow = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const mesh = (geometry, material, count) => {
    const m = new THREE.InstancedMesh(geometry, material, count); m.count = 0; m.frustumCulled = false;
    m.castShadow = false; m.receiveShadow = !material.isMeshBasicMaterial; root.add(m); return m;
  };
  const poles = mesh(new THREE.CylinderGeometry(.08, .11, 1, 8).translate(0, .5, 0), metal, 160);
  const arms = mesh(new THREE.BoxGeometry(1, .09, .09).translate(.5, 0, 0), metal, 160);
  const heads = mesh(new THREE.BoxGeometry(.36, 1.02, .3), metal, 320);
  const lamps = mesh(new THREE.CircleGeometry(.105, 12), lamp, 960);
  const glows = mesh(new THREE.PlaneGeometry(GLOW, GLOW), glow, 960);
  const housings = mesh(new THREE.BoxGeometry(.3, .3, .14), metal, 320);
  const walkers = mesh(new THREE.PlaneGeometry(.22, .22), lamp, 320);
  const stripes = mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), paint, 2400);
  for (const target of [lamps, glows, walkers]) target.setColorAt(0, new THREE.Color());
  scene.add(root);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3(), s = new THREE.Vector3(), color = new THREE.Color();
  let center = null, faces = [], walks = [];
  const put = (target, i, x, y, z, yaw, sx, sy, sz, pitch = 0, roll = 0) => {
    target.setMatrixAt(i, m.compose(v.set(x, y, z), q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ')), s.set(sx, sy, sz)));
  };
  function rebuild(focus) {
    center = { x: focus.x, z: focus.z }; faces = []; walks = [];
    let pole = 0, arm = 0, head = 0, lampIndex = 0, glowIndex = 0, walkIndex = 0, stripe = 0;
    for (const node of network.nodesNear(focus.x, focus.z, PROP_RANGE)) {
      if (node.kind !== 'junction' || !node.ground || Math.abs(node.y - (focus.y ?? node.y)) > 30) continue;
      for (const a of node.approaches) {
        const r = rightOf(a.dir), yaw = Math.atan2(a.dir.x, a.dir.z), half = a.width / 2;
        // Zebra stripes run with the traffic, a metre apart, across the whole street.
        const count = Math.floor((a.width - .6) / 1.05);
        for (let k = 0; k < count && stripe < 2400; k++) {
          const across = (k - (count - 1) / 2) * 1.05, x = node.x + a.dir.x * a.crosswalk + r.x * across, z = node.z + a.dir.z * a.crosswalk + r.z * across;
          const y = plan.surfaceHeight(x, z, node.y + 1.5);
          put(stripes, stripe++, x, y + .045, z, yaw, .5, 1, 2.3);
        }
        // Stop line across the arriving half of the street (on its left of the outward heading).
        const sx = node.x + a.dir.x * (a.stop - .25) - r.x * half / 2, sz = node.z + a.dir.z * (a.stop - .25) - r.z * half / 2;
        if (stripe < 2400 && a.arriving.length) put(stripes, stripe++, sx, plan.surfaceHeight(sx, sz, node.y + 1.5) + .045, sz, yaw, half - .3, 1, .4);
      }
      for (const p of signalPoles(node, plan)) {
        if (arm >= 160) break;
        put(poles, pole++, p.x, p.ground, p.z, p.yaw, 1, 5.4, 1);
        put(arms, arm++, p.x, p.ground + 5.25, p.z, p.yaw - Math.PI, p.reach, 1, 1);
        const dir = p.approach.dir;
        for (const { x, z, y, height } of p.heads) {
          if (head >= 320) break;
          put(heads, head++, x, y, z, p.yaw, 1, height, 1);
          const lamps3 = [];
          for (const [k, name] of ['red', 'amber', 'green'].entries()) {
            put(lamps, lampIndex, x + dir.x * .155, y + (1 - k) * .31 * height, z + dir.z * .155, p.yaw, height, height, 1);
            put(glows, glowIndex, x + dir.x * .165, y + (1 - k) * .31 * height, z + dir.z * .165, p.yaw, height, height, 1);
            lamps3.push([lampIndex++, name, glowIndex++]);
          }
          faces.push({ node, approach: p.approach, lamps: lamps3 });
        }
        // The walk lamps sit on the pole itself, each in a small housing facing across its crossing.
        for (const w of p.walks) if (walkIndex < 320) {
          put(housings, walkIndex, w.x, w.y, w.z, w.yaw, 1, 1, 1);
          put(walkers, walkIndex, w.x + w.face.x * .075, w.y, w.z + w.face.z * .075, w.yaw, 1, 1, 1);
          walks.push({ node, approach: w.approach, index: walkIndex++ });
        }
      }
    }
    poles.count = pole; arms.count = arm; heads.count = head; lamps.count = lampIndex; glows.count = glowIndex; housings.count = walkers.count = walkIndex; stripes.count = stripe;
    for (const target of [poles, arms, heads, lamps, glows, housings, walkers, stripes]) target.instanceMatrix.needsUpdate = true;
  }
  return {
    root,
    update(time, focus) {
      if (!center || Math.hypot(focus.x - center.x, focus.z - center.z) > REBUILD) rebuild(focus);
      for (const face of faces) {
        const state = signalState(face.node, face.approach, time);
        for (const [index, name, glowIndex] of face.lamps) {
          const on = name === state.color, [r, g, b] = LAMP_COLORS[name];
          lamps.setColorAt(index, color.setRGB(on ? r : r * DIM, on ? g : g * DIM, on ? b : b * DIM));
          glows.setColorAt(glowIndex, on ? color.setRGB(...LAMP_GLOWS[name]) : color.setRGB(0, 0, 0));
        }
      }
      for (const w of walks) {
        // Walk is steady white; it turns to a flashing hand before the crossing traffic moves.
        const state = walkState(w.node, w.approach, time), ending = state.walk && state.remaining < 6;
        const flash = ending ? (time * 2 % 1 < .5 ? 1 : .2) : 1, [r, g, b] = LAMP_COLORS[state.walk && !ending ? 'walk' : 'stop'];
        walkers.setColorAt(w.index, color.setRGB(r * flash, g * flash, b * flash));
      }
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
      if (walkers.instanceColor) walkers.instanceColor.needsUpdate = true;
    },
    invalidate() { center = null; },
    snapshot() { return { poles: poles.count, heads: heads.count, crossings: stripes.count }; },
    dispose() {
      scene.remove(root);
      for (const child of root.children) { child.geometry.dispose(); child.dispose(); }
      glow.map.dispose();
      for (const material of [metal, paint, lamp, glow]) material.dispose();
    },
  };
}
