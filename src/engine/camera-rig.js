import * as THREE from 'three';
import { angleDelta, clamp, damp, rayBoxDistance } from '../core/physics.js';

// The third-person follow camera, as a rig of smoothed quantities rather than
// a smoothed position. Yaw and pitch come straight from the player's input.
// The look target eases over steps and stairs, the shoulder offset never
// reaches into a wall beside the player, the boom lifts over the player's head
// and lengthens or shortens gradually, and indoor framing blends in over a
// moment rather than switching at the doorway. Each of these moves on a
// critically damped spring, so none starts or stops with a jolt.
//
// Walls are anticipated rather than met. A fatter probe than the one that
// stops the camera runs along the boom both from here and from where the
// player will be a moment from now, moving and turning as they are, and the
// camera starts closing in as soon as either finds a wall. Indoors it also
// keeps to the player's room, so it has already come through a doorway before
// the player turns away from it. A wall that still arrives unannounced pulls
// it in at once, as far as that wall, so the camera never sees through it.

// The camera passes through slender things (furniture, trees, railings,
// poles and rooftop fittings) rather than lurching in and out as they cross
// the boom. Interior walls and slabs always count, however short.
export const passesThrough = box => !!box.furniture || box.kind === 'tree' || box.kind === 'rail' ||
  !box.interior && Math.max(box.w ?? box.maxX - box.minX, box.d ?? box.maxZ - box.minZ) < 1.2;

const LIFTS = [0, .15, .3, .45, .6, .8, 1, 1.2];
// The probe's radius when anticipating and when enforcing; how far ahead it
// looks, in seconds and at most in metres and radians; and how long a lower
// lift must stay roomy before the boom drops to it.
const WIDE = .28, THIN = .1, AHEAD = .45, AHEAD_METRES = 2.2, AHEAD_TURN = .7, CALM = 1;

// Whether a ray of `length` from `o` along `d` meets the box's bounds.
function crosses(box, o, d, length) {
  let near = 0, far = length;
  for (const [p, v, min, max] of [[o.x, d.x, box.minX, box.maxX], [o.y, d.y, box.minY ?? -Infinity, box.maxY ?? Infinity], [o.z, d.z, box.minZ, box.maxZ]]) {
    if (Math.abs(v) < 1e-9) { if (p < min || p > max) return false; continue; }
    let a = (min - p) / v, b = (max - p) / v;
    if (a > b) [a, b] = [b, a];
    if (a > near) near = a;
    if (b < far) far = b;
    if (near > far) return false;
  }
  return true;
}

/** Move `state[key]` toward `to` over about `time` seconds, critically damped. */
export function spring(state, key, to, time, dt) {
  const speed = `${key}Speed`, omega = 2 / time, x = omega * dt, decay = 1 / (1 + x + .48 * x * x + .235 * x * x * x);
  const change = state[key] - to, carry = ((state[speed] ?? 0) + omega * change) * dt;
  state[speed] = ((state[speed] ?? 0) - omega * carry) * decay;
  state[key] = to + (change + carry) * decay;
  // Never overshoot: arriving ends the motion.
  if (change * (state[key] - to) < 0) { state[key] = to; state[speed] = 0; }
  return state[key];
}
const settle = (state, key, value) => { state[key] = value; state[`${key}Speed`] = 0; return value; };

export function createCameraRig() {
  const target = new THREE.Vector3(), position = new THREE.Vector3(), look = new THREE.Vector3(), ahead = new THREE.Vector3(), heading = new THREE.Vector3();
  const head = new THREE.Vector3(), direction = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), start = new THREE.Vector3();
  const state = { ready: false, y: 0, shoulder: 0, indoor: 0, lift: 0, liftTarget: 0, calm: 0, distance: 0, x: 0, z: 0, yaw: 0, vx: 0, vz: 0, turn: 0 };
  const sky = new THREE.Vector3(0, 1, 0);

  // The nearest obstruction along a ray, ignoring a ray that starts inside one.
  // Boxes whose bounds the ray misses are passed over before the exact test.
  const along = (boxes, origin, dir, length) => {
    let nearest = length;
    for (const box of boxes) {
      if (!crosses(box, origin, dir, nearest)) continue;
      const d = rayBoxDistance(origin, dir, box, nearest);
      if (d > 1e-3 && d < nearest) nearest = d;
    }
    return nearest;
  };
  // A thick probe: the boom's centre line and four lines `radius` round it.
  function clearance(boxes, from, dir, length, radius) {
    side.crossVectors(dir, sky); if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize();
    up.crossVectors(side, dir).normalize();
    let nearest = along(boxes, from, dir, length);
    for (const [a, b] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      start.copy(from).addScaledVector(side, a).addScaledVector(up, b);
      nearest = Math.min(nearest, along(boxes, start, dir, length));
    }
    return nearest;
  }
  // The boom at a yaw and pitch: its direction and full length, with the
  // camera half a metre above the orbit.
  function boom(yaw, pitch, distance) {
    direction.set(Math.sin(yaw) * Math.cos(pitch) * distance, Math.sin(pitch) * distance + .5, Math.cos(yaw) * Math.cos(pitch) * distance);
    const length = direction.length(); direction.normalize();
    return length;
  }

  return {
    target, position, look, state,
    /**
     * `focus` is the player's (or car's) position; `boxes` the colliders near
     * it; `ground(x, z)` the terrain height; `inside(x, z)` whether a point is
     * within the room the player is in. `snap` places everything at once
     * (scene cuts, lifts, teleports).
     */
    update({ dt, snap = false, focus, yaw, pitch, indoors = false, inside = null, aiming = false, driving = false, glide = 0, glideDistance = 9.4, boxes = [], ground = () => -Infinity }) {
      dt = Math.max(dt, 1e-4);
      // A long jump in a single frame is a cut, not motion; so is recovering
      // from a frame with no viewport to measure.
      snap ||= !state.ready || Math.hypot(focus.x - state.x, focus.z - state.z) > 6 || !Number.isFinite(state.distance + state.lift + state.y + state.shoulder);
      // How the player is moving and the view turning, to look ahead with.
      if (snap) { state.vx = state.vz = state.turn = 0; }
      else {
        state.vx = damp(state.vx, (focus.x - state.x) / dt, 10, dt); state.vz = damp(state.vz, (focus.z - state.z) / dt, 10, dt);
        state.turn = damp(state.turn, angleDelta(state.yaw, yaw) / dt, 10, dt);
      }
      state.x = focus.x; state.z = focus.z; state.yaw = yaw;

      const k = snap ? settle(state, 'indoor', +indoors) : spring(state, 'indoor', +indoors, .4, dt), mix = (outside, inside) => outside + (inside - outside) * k;
      const distance = driving ? 10.4 : aiming ? mix(3.3, 2.2) : mix(5.9 + glide * (glideDistance - 5.9), 2.6);
      const height = driving ? 1.45 : 1.35 + glide * 1.25, shoulder = driving ? .35 : aiming ? mix(.8, .55) : mix(.68 * (1 - glide * .7), .4);
      const margin = mix(.35, .2), closest = mix(.6, .35), room = aiming ? 1.1 : mix(2, 1.5);

      // Ease the look height over steps and stairs; a long drop or a lift cuts.
      const y = focus.y + height;
      if (snap || Math.abs(y - state.y) > 2.5) settle(state, 'y', y); else spring(state, 'y', y, .14, dt);
      head.set(focus.x, state.y, focus.z);
      // The shoulder offset stops short of a wall beside the player.
      const walls = boxes.filter(box => !passesThrough(box));
      side.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const beside = along(walls, head, side, shoulder + .3) - .3, wanted = Math.max(0, Math.min(shoulder, beside));
      if (snap) settle(state, 'shoulder', wanted);
      else if (spring(state, 'shoulder', wanted, .25, dt) > wanted) settle(state, 'shoulder', wanted);
      target.copy(head).addScaledVector(side, state.shoulder);
      // The same target a moment from now, short of any wall in the way.
      const speed = Math.hypot(state.vx, state.vz);
      ahead.copy(target);
      if (speed > .1) {
        heading.set(state.vx / speed, 0, state.vz / speed);
        ahead.addScaledVector(heading, Math.max(0, along(walls, target, heading, Math.min(speed * AHEAD, AHEAD_METRES) + .3) - .3));
      }
      const later = yaw + clamp(state.turn * AHEAD, -AHEAD_TURN, AHEAD_TURN);
      // Only what the boom could touch, in any of its lifts, now or soon.
      const sweep = { minX: Math.min(target.x, ahead.x), maxX: Math.max(target.x, ahead.x), minY: target.y, maxY: target.y, minZ: Math.min(target.z, ahead.z), maxZ: Math.max(target.z, ahead.z) };
      for (const turn of [yaw, (yaw + later) / 2, later]) for (const angle of [pitch, 0, Math.min(1.35, pitch + LIFTS.at(-1))]) {
        const length = boom(turn, angle, distance);
        for (const from of [target, ahead]) {
          const x = from.x + direction.x * length, y = from.y + direction.y * length, z = from.z + direction.z * length;
          sweep.minX = Math.min(sweep.minX, x); sweep.maxX = Math.max(sweep.maxX, x); sweep.minY = Math.min(sweep.minY, y);
          sweep.maxY = Math.max(sweep.maxY, y); sweep.minZ = Math.min(sweep.minZ, z); sweep.maxZ = Math.max(sweep.maxZ, z);
        }
      }
      const pad = WIDE + .05, solid = walls.filter(box => box.maxX > sweep.minX - pad && box.minX < sweep.maxX + pad &&
        box.maxZ > sweep.minZ - pad && box.minZ < sweep.maxZ + pad && (box.maxY ?? Infinity) > sweep.minY - pad && (box.minY ?? -Infinity) < sweep.maxY + pad);

      // How far the boom can reach at a pitch, through the fatter probe, from
      // here or from where the player will be in a moment: short of what it
      // meets, but no nearer than `closest` unless that is nearer still.
      const limit = (raw, length) => raw < length ? Math.max(Math.min(closest, raw - .12), raw - margin) : length;
      const reachFrom = (from, turn, angle) => {
        const length = boom(turn, angle, distance);
        return limit(clearance(solid, from, direction, length, WIDE), length);
      };
      const reaches = new Map(), reach = lift => {
        if (!reaches.has(lift)) reaches.set(lift, reachFrom(target, yaw, Math.min(1.35, pitch + lift)));
        return reaches.get(lift);
      };
      // Lift the boom over the player's head where there's too little room
      // behind them, holding a lift until a lower one has been clearly roomy
      // enough for a moment, so turning round on a landing doesn't bob it.
      const enough = (lift, factor) => reach(lift) >= Math.min(distance, room * factor);
      const lower = LIFTS.find(lift => lift < state.liftTarget && enough(lift, 1.15));
      state.calm = lower === undefined ? 0 : state.calm + dt;
      if (lower !== undefined && (snap || state.calm > CALM)) { state.liftTarget = lower; state.calm = 0; }
      else if (!enough(state.liftTarget, .9)) {
        state.liftTarget = LIFTS.find(lift => enough(lift, 1)) ?? LIFTS.reduce((best, lift) => reach(lift) > reach(best) ? lift : best, 0);
      }
      if (snap) settle(state, 'lift', state.liftTarget); else spring(state, 'lift', state.liftTarget, .35, dt);

      // Close in on a wall the fat probe finds quickly, on one the player is
      // heading for a little less so, and draw back slowly; but never stay
      // past a wall the boom meets now.
      const angle = Math.min(1.35, pitch + state.lift), soon = reachFrom(ahead, later, angle);
      let near = reachFrom(target, yaw, angle);
      const length = boom(yaw, angle, distance), hard = limit(clearance(solid, target, direction, length, THIN), length);
      // Indoors, the camera comes into the player's room rather than hanging
      // out beyond the doorway (or broken window) the boom leaves by, where
      // the player's next step aside would cut it in.
      if (inside?.(target.x, target.z)) for (let t = .25; t < Math.min(length, state.distance + .5); t += .25) {
        if (!inside(target.x + direction.x * t, target.z + direction.z * t)) { near = Math.min(near, limit(t, length)); break; }
      }
      const goal = Math.min(near, soon);
      if (snap) settle(state, 'distance', Math.min(goal, hard));
      else spring(state, 'distance', goal, goal >= state.distance ? .5 : near <= soon ? .2 : .35, dt);
      if (state.distance > hard) settle(state, 'distance', hard);
      position.copy(target).addScaledVector(direction, state.distance);
      const lift = Math.max(0, ground(position.x, position.z) + .55 - position.y);
      position.y += lift;
      look.copy(target); look.y += lift;
      state.ready = true;
      return this;
    },
    reset() { state.ready = false; },
  };
}
