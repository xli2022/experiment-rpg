import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/input.js';

function harness(t, { touch = false, requestLock, callbacks = {} } = {}) {
  function element(tagName = 'DIV') {
    const listeners = new Map(), classes = new Set();
    return {
      tagName, style: {},
      classList: { toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      dispatch(type, event = {}) { for (const fn of listeners.get(type) ?? []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...event }); },
      setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      focus() { document.activeElement = this; },
    };
  }
  const canvas = element('CANVAS'), window = element(), nodes = new Map();
  const document = { ...element(), body: element('BODY'), pointerLockElement: null,
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
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
