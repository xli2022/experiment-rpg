import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/input.js';

function harness(t, { touch = false, requestLock, callbacks = {} } = {}) {
  function element(tagName = 'DIV') {
    const listeners = new Map(), classes = new Set(), captured = new Set();
    return {
      tagName, style: {}, dataset: {},
      classList: { toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      dispatch(type, event = {}) { for (const fn of listeners.get(type) ?? []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...event }); },
      setPointerCapture(id) { captured.add(id); },
      hasPointerCapture(id) { return captured.has(id); },
      releasePointerCapture(id) { if (captured.delete(id)) this.dispatch('lostpointercapture', { pointerId: id }); },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      focus() { document.activeElement = this; },
    };
  }
  const canvas = element('CANVAS'), window = element(), nodes = new Map();
  const document = { ...element(), body: element('BODY'), pointerLockElement: null,
    getElementById(id) {
      if (id === 'look-joystick' || id === 'look-thumb') return null;
      if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id);
    },
    exitPointerLock() { this.pointerLockElement = null; },
  };
  let requests = 0;
  canvas.requestPointerLock = () => {
    requests++;
    if (requestLock) return requestLock();
    document.pointerLockElement = canvas;
  };
  for (const [name, value] of Object.entries({ window, document, matchMedia: () => ({ matches: touch }) })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  const input = new Input(canvas, { audio() {}, fire() {}, ...callbacks });
  return { input, canvas, document, window, element, lockRequests: () => requests };
}

test('resuming gameplay restores keyboard and mouse control after a popup', t => {
  const { input, canvas, document, window, element, lockRequests } = harness(t);
  input.setEnabled(true);
  input.keys.add('KeyW'); input.firing = input.aiming = true;
  input.setEnabled(false);
  assert.equal(document.pointerLockElement, null);
  assert.deepEqual(input.axes(), { x: 0, y: 0 });
  element('BUTTON').focus();
  input.setEnabled(true);
  assert.equal(canvas.tabIndex, 0);
  assert.equal(document.activeElement, canvas);
  assert.equal(document.pointerLockElement, canvas);
  assert.equal(lockRequests(), 2);
  assert.equal(input.firing, false); assert.equal(input.aiming, false);
  window.dispatch('keydown', { target: document.activeElement, code: 'KeyW' });
  assert.deepEqual(input.axes(), { x: 0, y: 1 });
  window.dispatch('pointermove', { pointerType: 'mouse', movementX: 10, movementY: 5 });
  assert.ok(input.look().x > 0, 'Mouse look resumes without another click');
});

test('menus before starting do not capture input and touch play does not lock the mouse', t => {
  const { input, canvas, document, element, lockRequests } = harness(t, { touch: true });
  const button = element('BUTTON'); button.focus();
  input.setEnabled(false);
  assert.equal(document.activeElement, button);
  assert.equal(lockRequests(), 0);
  input.setEnabled(true);
  assert.equal(document.activeElement, canvas);
  assert.equal(document.getElementById('touch-controls').classList.contains('hidden'), false);
  assert.equal(lockRequests(), 0);
});

test('a denied mouse capture still restores focus and supports drag look', async t => {
  const { input, canvas, document, window } = harness(t, { requestLock: () => Promise.reject(new Error('Blocked')) });
  input.setEnabled(true);
  await Promise.resolve();
  assert.equal(document.activeElement, canvas);
  canvas.dispatch('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 20 });
  window.dispatch('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 25 });
  assert.ok(input.look().x > 0);
});

test('holding Escape opens or closes a menu only once', t => {
  let pauses = 0;
  const { input, window } = harness(t, { callbacks: { pause() { pauses++; } } });
  input.setEnabled(true);
  window.dispatch('keydown', { code: 'Escape', repeat: false });
  for (let i = 0; i < 5; i++) window.dispatch('keydown', { code: 'Escape', repeat: true });
  assert.equal(pauses, 1);
});

test('menu transitions cancel captured touch gestures until a fresh touch starts', t => {
  const { input, document } = harness(t, { touch: true });
  input.setEnabled(true);
  const stick = document.getElementById('joystick'), look = document.getElementById('look-zone');
  stick.dispatch('pointerdown', { pointerId: 1, clientX: 80, clientY: 20 });
  look.dispatch('pointerdown', { pointerId: 2, clientX: 50, clientY: 50 });
  assert.ok(input.axes().y > 0);
  input.setEnabled(false); input.setEnabled(true);
  stick.dispatch('pointermove', { pointerId: 1, clientX: 80, clientY: 20 });
  look.dispatch('pointermove', { pointerId: 2, clientX: 90, clientY: 80 });
  assert.deepEqual(input.axes(), { x: 0, y: 0 });
  assert.deepEqual(input.look(), { x: 0, y: 0 });
  stick.dispatch('pointerdown', { pointerId: 3, clientX: 50, clientY: 20 });
  assert.ok(input.axes().y > 0);
  stick.dispatch('pointerdown', { pointerId: 4, clientX: 50, clientY: 80 });
  stick.dispatch('pointerup', { pointerId: 4 });
  assert.ok(input.axes().y > 0, 'A second finger cannot take over or cancel the active stick');
  stick.dispatch('pointerup', { pointerId: 3 });
  assert.deepEqual(input.axes(), { x: 0, y: 0 });
});

test('movement has a quiet center, smooth partial speed, and bounded diagonal thumb travel', t => {
  const { input, document } = harness(t, { touch: true }); input.setEnabled(true);
  const stick = document.getElementById('joystick'), thumb = document.getElementById('joystick-thumb');
  stick.dispatch('pointerdown', { pointerId: 1, clientX: 52, clientY: 50 });
  assert.deepEqual(input.axes(), { x: 0, y: 0 }, 'small thumb tremors do not move the player');
  stick.dispatch('pointermove', { pointerId: 1, clientX: 64, clientY: 50 });
  assert.ok(input.axes().x > 0 && input.axes().x < .5, 'partial deflection allows careful steering');
  stick.dispatch('pointermove', { pointerId: 1, clientX: 250, clientY: -150 });
  const axes = input.axes(); assert.ok(axes.x > 0 && axes.y > 0);
  assert.ok(Math.abs(Math.hypot(axes.x, axes.y) - 1) < 1e-10, 'diagonal movement cannot exceed maximum speed');
  const offsets = [...thumb.style.transform.matchAll(/\+ ([-\d.]+)px/g)].map(match => Number(match[1]));
  assert.equal(offsets.length, 2); assert.ok(Math.hypot(...offsets) <= 28.001, 'the thumb remains within the visible ring');
  stick.dispatch('pointercancel', { pointerId: 1 });
  assert.deepEqual(input.axes(), { x: 0, y: 0 });
  assert.equal(thumb.style.transform, 'translate(-50%,-50%)');
  assert.equal(stick.hasPointerCapture(1), false); assert.equal(stick.dataset.active, 'false');
});

test('movement, drag look, and firing retain independent fingers without continuous camera drift', t => {
  let fires = 0;
  const { input, document } = harness(t, { touch: true, callbacks: { fire() { fires++; } } }); input.setEnabled(true);
  const move = document.getElementById('joystick');
  const fire = document.getElementById('touch-fire'), drag = document.getElementById('look-zone');
  move.dispatch('pointerdown', { pointerId: 1, clientX: 50, clientY: 22 });
  drag.dispatch('pointerdown', { pointerId: 2, clientX: 10, clientY: 10 });
  fire.dispatch('pointerdown', { pointerId: 3 });
  assert.deepEqual(input.axes(), { x: 0, y: 1 }); assert.equal(input.firing, true); assert.equal(fires, 1);
  assert.deepEqual(input.look(), { x: 0, y: 0 }, 'holding a stationary finger does not rotate the camera');
  drag.dispatch('pointermove', { pointerId: 2, clientX: 20, clientY: 15 });
  const look = input.look(); assert.ok(look.x > 0 && look.y > 0);
  assert.deepEqual(input.look(), { x: 0, y: 0 }, 'each drag movement is consumed once');
  drag.dispatch('pointerdown', { pointerId: 4, clientX: 100, clientY: 100 });
  drag.dispatch('pointerup', { pointerId: 4 });
  drag.dispatch('pointermove', { pointerId: 2, clientX: 30, clientY: 20 });
  assert.deepEqual(input.look(), look, 'another finger cannot change the drag origin or cancel its owner');
  drag.dispatch('lostpointercapture', { pointerId: 2 });
  drag.dispatch('pointermove', { pointerId: 2, clientX: 90, clientY: 90 });
  assert.deepEqual(input.look(), { x: 0, y: 0 });
  assert.deepEqual(input.axes(), { x: 0, y: 1 }); assert.equal(input.firing, true);
  fire.dispatch('pointercancel', { pointerId: 3 }); assert.equal(input.firing, false);
  assert.deepEqual(input.axes(), { x: 0, y: 1 });
});

test('held touch actions reject extra fingers and only their owner can release them', t => {
  const called = { fire: 0, jump: 0, interact: 0, reload: 0, climb: 0 };
  const callbacks = Object.fromEntries(Object.keys(called).map(action => [action, () => called[action]++]));
  const { input, document } = harness(t, { touch: true, callbacks }); input.setEnabled(true);
  for (const action of Object.keys(called)) {
    const el = document.getElementById(`touch-${action}`);
    el.dispatch('pointerdown', { pointerId: 1 });
    el.dispatch('pointerdown', { pointerId: 2 });
    el.dispatch('pointerdown', { pointerId: 1 });
    el.dispatch('pointercancel', { pointerId: 2 });
    assert.equal(called[action], 1, `${action} happens once for one held gesture`);
    assert.equal(el.classList.contains('active'), true);
    if (action === 'fire') assert.equal(input.firing, true);
    if (action === 'jump') assert.equal(input.keys.has('Space'), true, 'handbrake stays held after another finger leaves');
    el.dispatch('pointerup', { pointerId: 1 });
    assert.equal(el.classList.contains('active'), false); assert.equal(el.hasPointerCapture(1), false);
    if (action === 'fire') assert.equal(input.firing, false);
    if (action === 'jump') assert.equal(input.keys.has('Space'), false);
    el.dispatch('pointerdown', { pointerId: 3 });
    el.dispatch('lostpointercapture', { pointerId: 1 });
    assert.equal(el.classList.contains('active'), true, 'late capture loss cannot cancel a new gesture');
    el.dispatch('lostpointercapture', { pointerId: 3 });
    assert.equal(el.classList.contains('active'), false);
  }
});

test('drag look applies sensitivity, accumulates movement, and bounds abrupt input', t => {
  const { input, document } = harness(t, { touch: true }); input.setEnabled(true);
  const drag = document.getElementById('look-zone');
  input.sensitivity = .5;
  drag.dispatch('pointerdown', { pointerId: 2, clientX: 0, clientY: 0 });
  drag.dispatch('pointermove', { pointerId: 2, clientX: 10, clientY: 10 }); const halfDrag = input.look();
  input.sensitivity = 1; drag.dispatch('pointermove', { pointerId: 2, clientX: 20, clientY: 20 }); const normalDrag = input.look();
  assert.equal(normalDrag.x, halfDrag.x * 2); assert.equal(normalDrag.y, halfDrag.y * 2);
  drag.dispatch('pointermove', { pointerId: 2, clientX: 25, clientY: 25 });
  drag.dispatch('pointermove', { pointerId: 2, clientX: 30, clientY: 30 });
  assert.deepEqual(input.look(), normalDrag, 'multiple events in a frame retain their total motion');
  drag.dispatch('pointermove', { pointerId: 2, clientX: 5000, clientY: -5000 });
  const bounded = input.look(); assert.ok(bounded.x > 0 && bounded.x < 1 && bounded.y < 0 && bounded.y > -1);
  drag.dispatch('pointercancel', { pointerId: 2 });
  drag.dispatch('pointermove', { pointerId: 2, clientX: 0, clientY: 0 });
  assert.deepEqual(input.look(), { x: 0, y: 0 });
});

test('menu, blur, and hidden-page resets release all touch captures and reject stale gestures', t => {
  let blurs = 0, jumps = 0;
  const { input, document, window } = harness(t, { touch: true, callbacks: { blur() { blurs++; }, jump() { jumps++; } } });
  const ids = ['joystick', 'look-zone', 'touch-fire', 'touch-jump'];
  for (const reason of ['menu', 'blur', 'hidden']) {
    input.setEnabled(true);
    for (const [i, id] of ids.entries()) document.getElementById(id).dispatch('pointerdown', { pointerId: i + 1, clientX: 70, clientY: 20 });
    assert.equal(input.firing, true); assert.equal(input.keys.has('Space'), true);
    if (reason === 'menu') input.setEnabled(false);
    if (reason === 'blur') window.dispatch('blur');
    if (reason === 'hidden') { document.hidden = true; document.dispatch('visibilitychange'); }
    for (const [i, id] of ids.entries()) {
      const el = document.getElementById(id);
      assert.equal(el.hasPointerCapture(i + 1), false, `${reason} releases ${id}`);
      assert.equal(el.dataset.active, 'false');
    }
    input.setEnabled(true);
    for (const [i, id] of ids.entries()) document.getElementById(id).dispatch('pointermove', { pointerId: i + 1, clientX: 100, clientY: 100 });
    assert.deepEqual(input.axes(), { x: 0, y: 0 }); assert.deepEqual(input.look(), { x: 0, y: 0 });
    assert.equal(input.firing, false); assert.equal(input.keys.has('Space'), false);
  }
  assert.equal(blurs, 2); assert.equal(jumps, 3);
  input.setEnabled(false);
  document.getElementById('touch-jump').dispatch('pointerdown', { pointerId: 99 });
  assert.equal(jumps, 3); assert.equal(document.getElementById('touch-jump').hasPointerCapture(99), false);
});
