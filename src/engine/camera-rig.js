import * as THREE from 'three';

// The third-person follow camera. It keeps the same distance behind the player
// everywhere, indoors and out, and never closes in for walls or rooms: the
// world fades whatever comes between it and the player instead (see
// world/view-cutaway.js). Yaw and pitch come straight from the player's input.
// The look height eases over steps and stairs, and changes of framing (aiming,
// driving, gliding) move on critically damped springs, so none starts or stops
// with a jolt. The camera never sinks below the floor the player stands on or
// the ground beneath it.

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

// Framings, in metres: how far the boom reaches, how high above the player's
// feet it pivots, how far right of them, and how far the camera rises above
// the orbit. On foot the camera sits close over the shoulder, looking past the
// top of the head, so at the default view the frame cuts the character off at
// the knees. Driving and a full canopy keep their wide views; a canopy's
// distance also grows to fit a narrow screen.
export const CAMERA_FRAMES = Object.freeze({
  foot: Object.freeze({ distance: 2.2, height: 2.1, shoulder: .55, rise: 0 }),
  aim: Object.freeze({ distance: 1.9, height: 2.05, shoulder: .7, rise: 0 }),
  drive: Object.freeze({ distance: 10.4, height: 1.45, shoulder: .35, rise: .5 }),
  glide: Object.freeze({ distance: 9.4, height: 2.6, shoulder: .2, rise: .5 }),
});

// How far, in metres, the look height may trail the player's own: little
// enough that a fall keeps them in the close on-foot frame.
export const CAMERA_TRAIL = .7;

export function createCameraRig() {
  const target = new THREE.Vector3(), position = new THREE.Vector3(), look = new THREE.Vector3(), boom = new THREE.Vector3();
  const state = { ready: false, x: 0, z: 0, y: 0, distance: 0, shoulder: 0, rise: 0 };

  return {
    target, position, look, state,
    /**
     * `player` is the player's (or car's) position; `fall` its vertical
     * speed; `floor` the height they stand on; `ground(x, z)` the terrain
     * height; `aspect` the screen's width over its height. `snap` places
     * everything at once (scene cuts, lifts, teleports).
     */
    update({ dt, snap = false, player, fall = player.velocityY ?? 0, yaw, pitch, aiming = false, driving = false, glide = 0, glideDistance = CAMERA_FRAMES.glide.distance, aspect = 16 / 9, floor = -Infinity, ground = () => -Infinity }) {
      dt = Math.max(dt, 1e-4);
      // A long jump in a single frame is a cut, not motion; so is recovering
      // from a frame with no viewport to measure.
      snap ||= !state.ready || Math.hypot(player.x - state.x, player.z - state.z) > 6 || !Number.isFinite(state.distance + state.y + state.shoulder + state.rise);
      state.x = player.x; state.z = player.z;
      // The canopy opens over half a second but is gone the moment the
      // player lands: the canopy's framing follows it out gently instead of
      // closing seven metres of boom in a few frames.
      if (snap || glide >= (state.glide ?? 0)) settle(state, 'glide', glide); else glide = spring(state, 'glide', glide, .3, dt);
      const near = aiming ? CAMERA_FRAMES.aim : CAMERA_FRAMES.foot, far = { ...CAMERA_FRAMES.glide, distance: glideDistance };
      // On a portrait screen the close shoulder offset would push the player
      // off its edge.
      const narrow = Math.min(1, Math.max(.4, aspect / (16 / 9)));
      const frame = driving ? CAMERA_FRAMES.drive : Object.fromEntries(Object.keys(near).map(key =>
        [key, (key === 'shoulder' ? near[key] * narrow : near[key]) * (1 - glide) + far[key] * glide]));
      // Ease the look height over steps and stairs. A lift or teleport moves
      // it metres in one frame: that cuts. A fall covers as much over many
      // frames, so the camera follows it on a spring that quickens with the
      // fall, trailing no more than a short leash: trailing further and
      // further, then cutting to catch up, jolted the view as a parachute opened.
      const y = player.y + frame.height, moved = y - (state.goal ?? y);
      state.goal = y;
      if (snap || Math.abs(moved) > 2.5) settle(state, 'y', y);
      else {
        spring(state, 'y', y, Math.min(.14, CAMERA_TRAIL * .8 / Math.max(Math.abs(fall), 1e-3)), dt);
        if (Math.abs(state.y - y) > CAMERA_TRAIL) { state.y = y + Math.sign(state.y - y) * CAMERA_TRAIL; state.ySpeed = moved / dt; }
      }
      // The boom eases a little slower than the rest: getting into a car
      // pulls it out by eight metres.
      for (const [key, time] of [['distance', .4], ['shoulder', .25], ['rise', .25]]) {
        if (snap) settle(state, key, frame[key]); else spring(state, key, frame[key], time, dt);
      }
      target.set(player.x + Math.cos(yaw) * state.shoulder, state.y, player.z - Math.sin(yaw) * state.shoulder);
      boom.set(Math.sin(yaw) * Math.cos(pitch) * state.distance, Math.sin(pitch) * state.distance + state.rise, Math.cos(yaw) * Math.cos(pitch) * state.distance);
      position.copy(target).add(boom);
      const lift = Math.max(0, Math.max(ground(position.x, position.z), floor) + .55 - position.y);
      position.y += lift;
      look.copy(target); look.y += lift;
      state.ready = true;
      return this;
    },
    reset() { state.ready = false; },
  };
}
