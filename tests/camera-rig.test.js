import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAMERA_FRAMES, createCameraRig, spring } from '../src/engine/camera-rig.js';

const dt = 1 / 60;
const boom = rig => rig.position.distanceTo(rig.target);

test('the spring starts and stops gently and never overshoots', () => {
  const state = { value: 0 }, values = [];
  for (let i = 0; i < 120; i++) values.push(spring(state, 'value', 1, .3, dt));
  assert.ok(values[0] < .02, 'no step at the start');
  for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1] && values[i] <= 1);
  assert.ok(values.at(-1) > .999, 'arrives');
});

test('the camera keeps the same distance everywhere: it never closes in', () => {
  // Whatever the view, the floor or the player's position, the boom keeps its length.
  const rig = createCameraRig(), full = CAMERA_FRAMES.foot.distance;
  for (let i = 0; i < 240; i++) {
    const player = { x: Math.sin(i / 30) * 4, y: 12, z: i * .05 };
    rig.update({ dt, player, yaw: i / 40, pitch: .12, floor: 12 });
    assert.ok(Math.abs(boom(rig) - full) < 1e-6, `frame ${i}: ${boom(rig).toFixed(3)} m`);
  }
  assert.ok(Math.abs(rig.focus.x - Math.sin(239 / 30) * 4) < 1e-9 && Math.abs(rig.focus.y - (12 + CAMERA_FRAMES.foot.height)) < .01, 'the cutaway aims at the player');
});

test('stairs ease the camera up step by step, and a lift ride cuts', () => {
  // 0.18 m risers every 8 frames: the camera climbs smoothly rather than hopping.
  const rig = createCameraRig(), heights = [];
  for (let i = 0; i < 160; i++) {
    const y = Math.floor(i / 8) * .18;
    rig.update({ dt, player: { x: 0, y, z: -i * .025 }, yaw: Math.PI, pitch: .12, floor: y });
    heights.push(rig.position.y);
  }
  const hop = Math.max(...heights.slice(1).map((y, i) => Math.abs(y - heights[i])));
  assert.ok(hop < .05, `no visible hop at each riser (${hop.toFixed(3)} m in a frame)`);
  rig.update({ dt, player: { x: 0, y: 18, z: -4 }, yaw: Math.PI, pitch: .12, floor: 18 });
  assert.ok(Math.abs(rig.target.y - 18 - CAMERA_FRAMES.foot.height) < 1e-9, 'a long change of level snaps');
});

test('on foot the frame cuts the character off at the knees; driving and a canopy keep their wide views', () => {
  // Where a point on a 1.8 m player standing at the origin lands on screen (-1 is the bottom edge).
  const shot = (options, height, aspect = 16 / 9, side = 0) => {
    const rig = createCameraRig(), camera = new THREE.PerspectiveCamera(62, aspect, .12, 760);
    rig.update({ dt, player: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: .12, aspect, floor: 0, ...options });
    camera.position.copy(rig.position); camera.lookAt(rig.look); camera.updateMatrixWorld();
    return { rig, at: new THREE.Vector3(side, height, 0).project(camera) };
  };
  assert.ok(shot({}, .6).at.y < -1, 'the lower third is below the frame');
  assert.ok(shot({}, .9).at.y > -1 && shot({}, 1.8).at.y < 0, 'hips up to the head are in it, the head just below the middle');
  for (const aspect of [16 / 9, 9 / 19.5]) for (const side of [-.3, .3]) {
    const x = shot({}, 1.2, aspect, side).at.x;
    assert.ok(x > -1 && x < 1, `the whole body stays on a ${aspect < 1 ? 'portrait' : 'landscape'} screen (${x.toFixed(2)})`);
  }
  // The car and a full canopy frame as they always have.
  const boom = rig => rig.position.clone().sub(rig.target);
  const drive = shot({ driving: true }, 1).rig, glide = shot({ glide: 1, glideDistance: 11 }, 1).rig;
  assert.ok(Math.abs(boom(drive).length() - Math.hypot(10.4 * Math.cos(.12), 10.4 * Math.sin(.12) + .5)) < 1e-9 && Math.abs(drive.target.y - 1.45) < 1e-9);
  assert.ok(Math.abs(boom(glide).length() - Math.hypot(11 * Math.cos(.12), 11 * Math.sin(.12) + .5)) < 1e-9 && Math.abs(glide.target.y - 2.6) < 1e-9);
});

test('aiming, driving and gliding change the framing smoothly', () => {
  const rig = createCameraRig(), player = { x: 0, y: 0, z: 0 };
  for (const [from, to] of [[{}, { aiming: true }], [{ aiming: true }, {}], [{}, { driving: true }], [{}, { glide: 1 }]]) {
    rig.reset();
    rig.update({ dt, player, yaw: 0, pitch: .12, ...from });
    let last = rig.position.clone(), worst = 0;
    for (let i = 0; i < 90; i++) {
      rig.update({ dt, player, yaw: 0, pitch: .12, ...to });
      worst = Math.max(worst, rig.position.distanceTo(last)); last = rig.position.clone();
    }
    assert.ok(worst < .3, `${JSON.stringify(to)}: moved ${worst.toFixed(2)} m in a frame`);
    const settled = rig.position.clone();
    rig.update({ dt, player, yaw: 0, pitch: .12, ...to });
    assert.ok(rig.position.distanceTo(settled) < .01, 'and settles within a second and a half');
  }
});

test('looking up never takes the camera below the floor or the ground', () => {
  const rig = createCameraRig();
  rig.update({ dt, player: { x: 0, y: 10, z: 0 }, yaw: 0, pitch: -.65, floor: 10 });
  assert.ok(rig.position.y >= 10.55 - 1e-9, 'above an upper floor');
  rig.update({ dt, snap: true, player: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: -.65, ground: (x, z) => z > 1 ? 3 : 0 });
  assert.ok(rig.position.y >= 3.55 - 1e-9, 'above rising ground behind the player');
  assert.ok(rig.look.y > rig.target.y, 'the view lifts with it');
});
