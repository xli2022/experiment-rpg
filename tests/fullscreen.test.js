import test from 'node:test';
import assert from 'node:assert/strict';
import { setupFullscreen } from '../src/fullscreen.js';

function harness({ supported = true, enabled = true, prefixed = false } = {}) {
  const doc = new EventTarget(), target = {}, button = new EventTarget(), attributes = new Map(), messages = [];
  button.setAttribute = (name, value) => attributes.set(name, value);
  doc.documentElement = target;
  const keys = prefixed
    ? { request: 'webkitRequestFullscreen', exit: 'webkitExitFullscreen', element: 'webkitFullscreenElement', enabled: 'webkitFullscreenEnabled', event: 'webkitfullscreenchange' }
    : { request: 'requestFullscreen', exit: 'exitFullscreen', element: 'fullscreenElement', enabled: 'fullscreenEnabled', event: 'fullscreenchange' };
  doc[keys.element] = null; doc[keys.enabled] = enabled;
  let requests = 0, exits = 0;
  function change(element) { doc[keys.element] = element; doc.dispatchEvent(new Event(keys.event)); }
  if (supported) {
    target[keys.request] = function () { assert.equal(this, target); requests++; change(target); return prefixed ? undefined : Promise.resolve(); };
    doc[keys.exit] = function () { assert.equal(this, doc); exits++; change(null); return prefixed ? undefined : Promise.resolve(); };
  }
  return { doc, target, button, attributes, messages, keys, change, requests: () => requests, exits: () => exits,
    setup(options = {}) { return setupFullscreen(button, { document: doc, notify: message => messages.push(message), ...options }); } };
}

test('fullscreen button enters the whole document from a click and exits through the browser API', async () => {
  const h = harness(), control = h.setup();
  assert.equal(h.attributes.get('aria-pressed'), 'false');
  assert.equal(h.attributes.get('aria-label'), 'Enter full screen');
  assert.equal(h.button.disabled, false);
  h.button.dispatchEvent(new Event('click'));
  assert.equal(h.requests(), 1, 'Request is issued synchronously within the user gesture');
  await Promise.resolve();
  assert.equal(h.doc.fullscreenElement, h.target);
  assert.equal(h.attributes.get('aria-pressed'), 'true');
  assert.equal(h.button.title, 'Exit full screen');
  const exitIcon = h.button.innerHTML;
  assert.equal(await control.toggle(), true);
  assert.equal(h.exits(), 1);
  assert.equal(h.attributes.get('aria-pressed'), 'false');
  assert.notEqual(h.button.innerHTML, exitIcon);
  assert.deepEqual(h.messages, []);
  control.dispose();
});

test('browser entry and Escape exits update the button without another click', () => {
  const h = harness(); h.change(h.target);
  const control = h.setup();
  assert.equal(h.attributes.get('aria-pressed'), 'true', 'Initialization reads existing fullscreen state');
  h.change(null);
  assert.equal(h.attributes.get('aria-pressed'), 'false');
  assert.equal(h.button.title, 'Enter full screen');
  h.change(h.target);
  assert.equal(h.button.title, 'Exit full screen');
  control.dispose();
  h.change(null);
  assert.equal(h.button.title, 'Exit full screen', 'Disposal removes the event handlers');
});

test('unsupported or policy-disabled fullscreen leaves an honest disabled control', async () => {
  for (const options of [{ supported: false }, { enabled: false }]) {
    const h = harness(options), control = h.setup();
    assert.equal(h.button.disabled, true);
    assert.equal(h.button.title, 'Full screen unavailable');
    assert.equal(h.attributes.get('aria-pressed'), 'false');
    assert.equal(await control.toggle(), false);
    assert.equal(h.requests(), 0);
    assert.equal(h.messages.length, 1);
    control.dispose();
  }
});

test('pending and rejected requests neither claim fullscreen nor issue duplicate requests', async () => {
  const h = harness();
  let reject, requests = 0, focused = 0;
  h.target.requestFullscreen = () => { requests++; return new Promise((resolve, failure) => { reject = failure; }); };
  const control = h.setup({ restoreFocus: () => focused++ }), first = control.toggle();
  assert.equal(h.button.disabled, true);
  assert.equal(h.attributes.get('aria-busy'), 'true');
  assert.equal(h.attributes.get('aria-pressed'), 'false');
  assert.equal(await control.toggle(), false);
  assert.equal(requests, 1);
  assert.equal(focused, 0, 'Focus restoration waits until the request settles');
  reject(new Error('Denied by browser'));
  assert.equal(await first, false);
  assert.equal(h.button.disabled, false);
  assert.equal(h.attributes.get('aria-busy'), 'false');
  assert.equal(h.attributes.get('aria-label'), 'Enter full screen');
  assert.equal(h.messages.length, 1);
  assert.equal(focused, 1, 'Rejected requests still restore gameplay focus');
  control.dispose();
});

test('synchronous request failures and failed exits preserve the actual browser state', async () => {
  const h = harness();
  h.target.requestFullscreen = () => { throw new Error('Blocked'); };
  h.doc.exitFullscreen = () => Promise.reject(new Error('Exit failed'));
  const control = h.setup();
  assert.equal(await control.toggle(), false);
  assert.equal(h.attributes.get('aria-pressed'), 'false');
  h.change(h.target);
  assert.equal(await control.toggle(), false);
  assert.equal(h.attributes.get('aria-pressed'), 'true');
  assert.equal(h.button.disabled, false);
  assert.match(h.messages[1], /exit control/);
  control.dispose();
});

test('a resolved request cannot claim fullscreen until the browser reports an element', async () => {
  const h = harness(); h.target.requestFullscreen = () => Promise.resolve();
  const control = h.setup();
  assert.equal(await control.toggle(), false);
  assert.equal(h.attributes.get('aria-pressed'), 'false');
  assert.equal(h.button.title, 'Enter full screen');
  control.dispose();
});

test('WebKit fullscreen events and legacy error events are handled without a promise', async () => {
  const h = harness({ prefixed: true }), control = h.setup();
  assert.equal(await control.toggle(), true);
  assert.equal(h.attributes.get('aria-pressed'), 'true');
  assert.equal(await control.toggle(), true);
  assert.equal(h.attributes.get('aria-pressed'), 'false');
  h.doc.dispatchEvent(new Event('webkitfullscreenerror'));
  assert.equal(h.messages.length, 1);
  assert.equal(h.button.disabled, false);
  control.dispose();
});
