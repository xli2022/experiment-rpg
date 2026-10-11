import * as THREE from 'three';

// The third-person follow camera. It keeps the same distance behind the player
// everywhere, indoors and out, and never closes in for walls or rooms: the
// world cuts away whatever comes between it and the player instead (see
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

export function createCameraRig() {
  // `focus` is the player at the look height, where the world's cutaway aims.
  const target = new THREE.Vector3(), position = new THREE.Vector3(), look = new THREE.Vector3(), focus = new THREE.Vector3(), boom = new THREE.Vector3();
  const state = { ready: false, x: 0, z: 0, y: 0, distance: 0, shoulder: 0 };

  return {
    target, position, look, focus, state,
    /**
     * `player` is the player's (or car's) position; `floor` the height they
     * stand on; `ground(x, z)` the terrain height. `snap` places everything
     * at once (scene cuts, lifts, teleports).
     */
    update({ dt, snap = false, player, yaw, pitch, aiming = false, driving = false, glide = 0, glideDistance = 9.4, floor = -Infinity, ground = () => -Infinity }) {
      dt = Math.max(dt, 1e-4);
      // A long jump in a single frame is a cut, not motion; so is recovering
      // from a frame with no viewport to measure.
      snap ||= !state.ready || Math.hypot(player.x - state.x, player.z - state.z) > 6 || !Number.isFinite(state.distance + state.y + state.shoulder);
      state.x = player.x; state.z = player.z;
      const distance = driving ? 10.4 : aiming ? 3.3 : 5.9 + glide * (glideDistance - 5.9);
      const height = driving ? 1.45 : 1.35 + glide * 1.25, shoulder = driving ? .35 : aiming ? .8 : .68 * (1 - glide * .7);
      // Ease the look height over steps and stairs; a long drop or a lift cuts.
      const y = player.y + height;
      if (snap || Math.abs(y - state.y) > 2.5) settle(state, 'y', y); else spring(state, 'y', y, .14, dt);
      for (const [key, value] of [['distance', distance], ['shoulder', shoulder]]) {
        if (snap) settle(state, key, value); else spring(state, key, value, .25, dt);
      }
      focus.set(player.x, state.y, player.z);
      target.set(player.x + Math.cos(yaw) * state.shoulder, state.y, player.z - Math.sin(yaw) * state.shoulder);
      // The boom, with the camera half a metre above the orbit.
      boom.set(Math.sin(yaw) * Math.cos(pitch) * state.distance, Math.sin(pitch) * state.distance + .5, Math.cos(yaw) * Math.cos(pitch) * state.distance);
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
