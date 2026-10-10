import * as THREE from 'three';
import { rightOf } from './network.js';

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

const LAMP_COLORS = { red: [3.2, .16, .12], amber: [3, 1.35, .08], green: [.2, 2.6, 1.2], walk: [2.2, 2.4, 2.3], stop: [2.6, .7, .1] };
const DIM = .05, PROP_RANGE = 170, REBUILD = 40;

// Poles, signal heads, zebra crossings and stop lines near the player, as a
// handful of instanced meshes rebuilt when the player has moved far enough.
export function createSignalProps(scene, network, plan) {
  const root = new THREE.Group(); root.name = 'Traffic signals';
  const metal = new THREE.MeshStandardMaterial({ color: 0x1d262d, roughness: .55, metalness: .6 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xb7bcaf, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const mesh = (geometry, material, count) => {
    const m = new THREE.InstancedMesh(geometry, material, count); m.count = 0; m.frustumCulled = false;
    m.castShadow = false; m.receiveShadow = material !== lamp; root.add(m); return m;
  };
  const poles = mesh(new THREE.CylinderGeometry(.08, .11, 1, 8).translate(0, .5, 0), metal, 480);
  const arms = mesh(new THREE.BoxGeometry(1, .09, .09).translate(.5, 0, 0), metal, 160);
  const heads = mesh(new THREE.BoxGeometry(.36, 1.02, .3), metal, 320);
  const lamps = mesh(new THREE.CircleGeometry(.105, 12), lamp, 960);
  const walkers = mesh(new THREE.PlaneGeometry(.22, .22), lamp, 320);
  const stripes = mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), paint, 2400);
  lamps.setColorAt(0, new THREE.Color()); walkers.setColorAt(0, new THREE.Color());
  scene.add(root);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3(), s = new THREE.Vector3(), color = new THREE.Color();
  let center = null, faces = [], walks = [];
  const put = (target, i, x, y, z, yaw, sx, sy, sz, pitch = 0, roll = 0) => {
    target.setMatrixAt(i, m.compose(v.set(x, y, z), q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ')), s.set(sx, sy, sz)));
  };
  function rebuild(focus) {
    center = { x: focus.x, z: focus.z }; faces = []; walks = [];
    let pole = 0, arm = 0, head = 0, lampIndex = 0, walkIndex = 0, stripe = 0;
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
        if (!node.signalized || !a.arriving.length || arm >= 160) continue;
        // Pole on the drivers' kerb before the crossing, arm out over their lane, head facing them.
        const kerb = half + .7, px = node.x + a.dir.x * (a.clear - .4) - r.x * kerb, pz = node.z + a.dir.z * (a.clear - .4) - r.z * kerb;
        const ground = plan.terrainHeight(px, pz), reach = kerb - a.arriving[0].offset;
        put(poles, pole++, px, ground, pz, yaw, 1, 5.4, 1);
        put(arms, arm++, px, ground + 5.25, pz, yaw - Math.PI, reach, 1, 1);
        const hx = px + r.x * reach, hz = pz + r.z * reach;
        for (const [x, z, y, height] of [[hx, hz, ground + 4.62, 1], [px + a.dir.x * .2, pz + a.dir.z * .2, ground + 2.9, .82]]) {
          if (head >= 320) break;
          put(heads, head++, x, y, z, yaw, 1, height, 1);
          const lamps3 = [];
          for (const [k, name] of ['red', 'amber', 'green'].entries()) {
            put(lamps, lampIndex, x + a.dir.x * .155, y + (1 - k) * .31 * height, z + a.dir.z * .155, yaw, height, height, 1);
            lamps3.push([lampIndex++, name]);
          }
          faces.push({ node, approach: a, lamps: lamps3 });
        }
        // A pedestrian lamp facing each end of this approach's crossing.
        for (const side of [1, -1]) if (walkIndex < 320) {
          const wx = node.x + a.dir.x * (a.crosswalk + 1.6) + r.x * side * (half + .55), wz = node.z + a.dir.z * (a.crosswalk + 1.6) + r.z * side * (half + .55);
          const base = plan.terrainHeight(wx, wz);
          put(poles, pole++, wx, base, wz, 0, .6, 2.55, .6);
          put(walkers, walkIndex, wx, base + 2.4, wz, Math.atan2(-r.x * side, -r.z * side), 1, 1, 1);
          walks.push({ node, approach: a, index: walkIndex++ });
        }
      }
    }
    poles.count = pole; arms.count = arm; heads.count = head; lamps.count = lampIndex; walkers.count = walkIndex; stripes.count = stripe;
    for (const target of [poles, arms, heads, lamps, walkers, stripes]) target.instanceMatrix.needsUpdate = true;
  }
  return {
    root,
    update(time, focus) {
      if (!center || Math.hypot(focus.x - center.x, focus.z - center.z) > REBUILD) rebuild(focus);
      for (const face of faces) {
        const state = signalState(face.node, face.approach, time);
        for (const [index, name] of face.lamps) {
          const on = name === state.color, [r, g, b] = LAMP_COLORS[name];
          lamps.setColorAt(index, color.setRGB(on ? r : r * DIM, on ? g : g * DIM, on ? b : b * DIM));
        }
      }
      for (const w of walks) {
        // Walk is steady white; it turns to a flashing hand before the crossing traffic moves.
        const state = walkState(w.node, w.approach, time), ending = state.walk && state.remaining < 6;
        const flash = ending ? (time * 2 % 1 < .5 ? 1 : .2) : 1, [r, g, b] = LAMP_COLORS[state.walk && !ending ? 'walk' : 'stop'];
        walkers.setColorAt(w.index, color.setRGB(r * flash, g * flash, b * flash));
      }
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      if (walkers.instanceColor) walkers.instanceColor.needsUpdate = true;
    },
    invalidate() { center = null; },
    snapshot() { return { poles: poles.count, heads: heads.count, crossings: stripes.count }; },
    dispose() {
      scene.remove(root);
      for (const child of root.children) { child.geometry.dispose(); child.dispose(); }
      for (const material of [metal, paint, lamp]) material.dispose();
    },
  };
}
