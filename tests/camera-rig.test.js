import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraRig, passesThrough, spring } from '../src/engine/camera-rig.js';
import { orientedBox, rayBoxDistance } from '../src/core/physics.js';

const dt = 1 / 60;
const wall = (x, z, w, d, extra = {}) => orientedBox(x, z, w, d, 0, 4, 0, extra);
// The camera's offset from the player in the camera's own frame (back, side,
// up), so turning the view isn't counted as the camera moving.
const offset = (rig, focus, yaw) => {
  const x = rig.position.x - focus.x, y = rig.position.y - focus.y, z = rig.position.z - focus.z;
  return { back: x * Math.sin(yaw) + z * Math.cos(yaw), side: x * Math.cos(yaw) - z * Math.sin(yaw), up: y };
};
const moved = (a, b) => Math.hypot(a.back - b.back, a.side - b.side, a.up - b.up);
// Whether a wall stands between the look target and the camera.
const blocked = (rig, boxes) => {
  const dir = rig.position.clone().sub(rig.target), length = dir.length(); dir.normalize();
  return boxes.some(b => !passesThrough(b) && rayBoxDistance(rig.target, dir, b, length) < length - .02);
};
// Run the rig along a path of { focus, yaw } frames; returns per-frame moves.
function run(frames, options) {
  const rig = createCameraRig(), steps = [];
  let previous = null;
  for (const { focus, yaw, ...rest } of frames) {
    rig.update({ dt, focus, yaw, pitch: .12, ...options, ...rest });
    const now = offset(rig, focus, yaw);
    if (previous) steps.push(moved(previous, now));
    previous = now;
    assert.ok(!blocked(rig, options.boxes ?? []), `the camera sees the player at ${focus.x.toFixed(2)}, ${focus.z.toFixed(2)}`);
  }
  return { rig, steps, worst: Math.max(...steps) };
}
const straight = (from, to, count, yaw, y = 0) => Array.from({ length: count }, (_, i) => ({ focus: { x: from.x + (to.x - from.x) * i / (count - 1), y: typeof y === 'function' ? y(i) : y, z: from.z + (to.z - from.z) * i / (count - 1) }, yaw }));

test('the spring starts and stops gently and never overshoots', () => {
  const state = { value: 0 }, values = [];
  for (let i = 0; i < 120; i++) values.push(spring(state, 'value', 1, .3, dt));
  assert.ok(values[0] < .02, 'no step at the start');
  for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1] && values[i] <= 1);
  assert.ok(values.at(-1) > .999, 'arrives');
});

test('trees, poles, railings and furniture crossing the boom leave the camera where it is', () => {
  // The player walks along x with the camera behind them (+z); slender things
  // stand right where the boom passes.
  const boxes = [];
  for (let x = -10; x <= 10; x += 1.5) {
    boxes.push(wall(x, 2.5, .6, .6, { kind: 'tree' }), wall(x + .5, 4, .25, .25), wall(x, 1.2, 1.4, .1, { kind: 'rail' }), wall(x + .7, 3.2, .9, .9, { furniture: true, interior: 'b' }));
  }
  const { rig, worst } = run(straight({ x: -8, z: 0 }, { x: 8, z: 0 }, 300, 0), { boxes });
  assert.ok(worst < .01, `the camera holds its framing (moved ${worst.toFixed(3)} m in a frame)`);
  assert.ok(rig.state.distance > 5.5, 'at its full distance');
});

test('walking in through a door and turning away from it never jumps the camera or shows it through the wall', () => {
  // A tall facade along z = 0 with a 2 m door at x 0; the room lies at z < 0.
  const tall = (x, z, w, d, minY = 0) => orientedBox(x, z, w, d, 0, 30, minY);
  const boxes = [tall(-6, 0, 10, .3), tall(6, 0, 10, .3), tall(0, 0, 2, .3, 2.5), tall(0, -6, 22, .3), tall(-11, -3, .3, 6), tall(11, -3, .3, 6), orientedBox(0, -3, 22, 6, 0, 3.6, 3.4)];
  const inside = (x, z) => z < -.15 && z > -6 && Math.abs(x) < 11;
  const frames = [...straight({ x: 0, z: 6 }, { x: 0, z: -1.2 }, 110, Math.PI), ...straight({ x: 0, z: -1.2 }, { x: 5, z: -1.2 }, 60, Math.PI)];
  const { worst, rig } = run(frames.map(f => ({ ...f, indoors: f.focus.z < -.15, inside: f.focus.z < -.15 ? inside : null })), { boxes });
  assert.ok(worst < .6, `the camera eases through the door (moved ${worst.toFixed(2)} m in a frame)`);
  assert.ok(inside(rig.position.x, rig.position.z), 'and ends up in the room');
});

test('stairs ease the camera up step by step, and a lift ride cuts', () => {
  // 0.18 m risers every 8 frames: the camera climbs smoothly rather than hopping.
  const frames = straight({ x: 0, z: 0 }, { x: 0, z: -4 }, 160, Math.PI, i => Math.floor(i / 8) * .18), heights = [];
  const climb = createCameraRig();
  for (const { focus, yaw } of frames) { climb.update({ dt, focus, yaw, pitch: .12 }); heights.push(climb.position.y); }
  const hop = Math.max(...heights.slice(1).map((y, i) => Math.abs(y - heights[i])));
  assert.ok(hop < .05, `no visible hop at each riser (${hop.toFixed(3)} m in a frame)`);
  const rig = createCameraRig();
  rig.update({ dt, focus: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: .12 });
  rig.update({ dt, focus: { x: 0, y: 18, z: 0 }, yaw: 0, pitch: .12 });
  assert.ok(Math.abs(rig.target.y - 18 - 1.35) < 1e-9, 'a long change of level snaps');
});

test('a wall swinging into the boom brings the camera in front of it, and it draws back slowly', () => {
  // Turn the view round towards a tall wall a metre behind the player's left.
  const boxes = [orientedBox(0, 1.2, 12, .3, 0, 30, 0)], frames = [];
  for (let i = 0; i < 90; i++) frames.push({ focus: { x: 0, y: 0, z: 0 }, yaw: -Math.PI / 2 + i / 89 * Math.PI / 2 });
  const { rig } = run(frames, { boxes });
  assert.ok(rig.position.z < 1.05 - .1, 'in front of the wall, lifted over the player');
  // Turning away again, the camera eases back out instead of springing.
  const out = [];
  for (let i = 0; i < 30; i++) { rig.update({ dt, focus: { x: 0, y: 0, z: 0 }, yaw: Math.PI, pitch: .12, boxes }); out.push(rig.state.distance); }
  for (let i = 1; i < out.length; i++) assert.ok(out[i] - out[i - 1] < .25, 'lengthens gradually');
  assert.ok(out.at(-1) > 4, 'back out');
});

test('turning round on a cramped landing holds the boom\'s lift rather than bobbing it', () => {
  // A 2.4 m square landing with a ceiling: the boom must lift whichever way the view turns.
  const boxes = [wall(0, -1.35, 2.7, .3), wall(0, 1.35, 2.7, .3), wall(-1.35, 0, .3, 2.7), wall(1.35, 0, .3, 2.7), orientedBox(0, 0, 3, 3, 0, 3.8, 3.6)];
  const rig = createCameraRig(), lifts = [];
  for (let i = 0; i < 360; i++) {
    rig.update({ dt, focus: { x: .3 * Math.sin(i / 40), y: 0, z: 0 }, yaw: i / 60 * 2, pitch: .12, indoors: true, boxes });
    lifts.push(rig.state.liftTarget);
    assert.ok(!blocked(rig, boxes), 'never through a wall');
  }
  const changes = lifts.filter((lift, i) => i && lift !== lifts[i - 1]).length;
  assert.ok(changes <= 8, `${changes} lift changes in six seconds of turning`);
});
