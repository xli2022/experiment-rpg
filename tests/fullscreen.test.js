import test from 'node:test';
import assert from 'node:assert/strict';
import { setupFullscreen } from '../src/fullscreen.js';

function harness({ supported = true, enabled = true, prefixed = false, mode = 'browser', standalone = false } = {}) {
  const doc = new EventTarget(), target = {}, button = new EventTarget(), attributes = new Map(), messages = [], helps = [], requestArguments = [];
  const win = new EventTarget(), nav = { standalone };
  win.mode = mode; win.navigator = nav;
  win.matchMedia = query => ({ matches: query === `(display-mode: ${win.mode})` });
  button.setAttribute = (name, value) => attributes.set(name, value);
  doc.documentElement = target;
  const keys = prefixed
    ? { request: 'webkitRequestFullscreen', exit: 'webkitExitFullscreen', element: 'webkitFullscreenElement', enabled: 'webkitFullscreenEnabled', event: 'webkitfullscreenchange' }
    : { request: 'requestFullscreen', exit: 'exitFullscreen', element: 'fullscreenElement', enabled: 'fullscreenEnabled', event: 'fullscreenchange' };
  doc[keys.element] = null; doc[keys.enabled] = enabled;
  let requests = 0, exits = 0;
  function change(element) { doc[keys.element] = element; doc.dispatchEvent(new Event(keys.event)); }
  if (supported) {
    target[keys.request] = function (...args) { assert.equal(this, target); requestArguments.push(args); requests++; change(target); return prefixed ? undefined : Promise.resolve(); };
    doc[keys.exit] = function () { assert.equal(this, doc); exits++; change(null); return prefixed ? undefined : Promise.resolve(); };
  }
  return { doc, target, button, win, nav, attributes, messages, helps, requestArguments, keys, change, requests: () => requests, exits: () => exits,
    setup(options = {}) { return setupFullscreen(button, { document: doc, window: win, navigator: nav, notify: message => messages.push(message), showHelp: details => helps.push(details), ...options }); } };
}

test('fullscreen button enters the whole document from a click and exits through the browser API', async () => {
  const h = harness(), control = h.setup();
  assert.equal(h.attributes.get('aria-pressed'), 'false');
  assert.equal(h.attributes.get('aria-label'), 'Enter full screen');
  assert.equal(h.button.disabled, false);
  h.button.dispatchEvent(new Event('click'));
  assert.equal(h.requests(), 1, 'Request is issued synchronously within the user gesture');
  assert.deepEqual(h.requestArguments, [[{ navigationUI: 'hide' }]]);
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
  assert.deepEqual(h.helps, []);
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

test('unsupported or policy-disabled fullscreen offers help without claiming fullscreen', async () => {
  for (const options of [{ supported: false }, { enabled: false }]) {
    const h = harness(options), control = h.setup();
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.title, 'Full screen options');
    assert.equal(h.attributes.get('aria-haspopup'), 'dialog');
    assert.equal(h.attributes.get('aria-pressed'), 'false');
    assert.equal(await control.toggle(), false);
    assert.equal(h.requests(), 0);
    assert.deepEqual(h.helps, [{ reason: 'unsupported', installed: false }]);
    assert.deepEqual(h.messages, []);
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
  assert.deepEqual(h.helps, [{ reason: 'rejected', installed: false }]);
  assert.equal(focused, 0, 'The help dialog owns focus after rejection');
  control.dispose();
});

test('synchronous request failures and failed exits preserve the actual browser state', async () => {
  const h = harness();
  h.target.requestFullscreen = () => { throw new Error('Blocked'); };
  h.doc.exitFullscreen = () => Promise.reject(new Error('Exit failed'));
  const control = h.setup();
  assert.equal(await control.toggle(), false);
  assert.equal(h.attributes.get('aria-pressed'), 'false');
  assert.deepEqual(h.helps, [{ reason: 'rejected', installed: false }]);
  h.change(h.target);
  assert.equal(await control.toggle(), false);
  assert.equal(h.attributes.get('aria-pressed'), 'true');
  assert.equal(h.button.disabled, false);
  assert.equal(h.messages.length, 1); assert.match(h.messages[0], /exit control/);
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

test('WebKit fullscreen uses no options and follows entry and exit events without a promise', async () => {
  const h = harness({ prefixed: true }), control = h.setup();
  assert.equal(await control.toggle(), true);
  assert.equal(h.attributes.get('aria-pressed'), 'true');
  assert.deepEqual(h.requestArguments, [[]]);
  assert.equal(await control.toggle(), true);
  assert.equal(h.attributes.get('aria-pressed'), 'false');
  h.doc.dispatchEvent(new Event('webkitfullscreenerror'));
  assert.equal(h.helps.length, 0, 'An unrelated error cannot reopen help after a completed transition');
  assert.equal(h.button.disabled, false);
  control.dispose();
});

test('legacy WebKit entry errors show help once whether reported by event or rejected promise', async () => {
  for (const returnsPromise of [false, true]) {
    const h = harness({ prefixed: true });
    h.target.webkitRequestFullscreen = () => {
      if (!returnsPromise) return;
      h.doc.dispatchEvent(new Event('webkitfullscreenerror'));
      return Promise.reject(new Error('Not allowed'));
    };
    const control = h.setup();
    assert.equal(await control.toggle(), false);
    h.doc.dispatchEvent(new Event('webkitfullscreenerror'));
    h.doc.dispatchEvent(new Event('webkitfullscreenerror'));
    assert.deepEqual(h.helps, [{ reason: 'rejected', installed: false }]);
    assert.equal(h.attributes.get('aria-pressed'), 'false');
    assert.equal(h.button.disabled, false);
    control.dispose();
  }
});

test('capability changes choose the usable standard or WebKit pair on each gesture', async () => {
  const h = harness({ enabled: false });
  let webkitRequests = 0;
  h.target.webkitRequestFullscreen = function (...args) {
    assert.equal(this, h.target); assert.deepEqual(args, []); webkitRequests++;
    h.doc.webkitFullscreenElement = h.target; h.doc.dispatchEvent(new Event('webkitfullscreenchange'));
  };
  h.doc.webkitExitFullscreen = () => { h.doc.webkitFullscreenElement = null; h.doc.dispatchEvent(new Event('webkitfullscreenchange')); };
  h.doc.webkitFullscreenEnabled = false;
  const control = h.setup();
  assert.equal(h.button.title, 'Full screen options');
  h.doc.webkitFullscreenEnabled = true;
  h.win.dispatchEvent(new Event('resize'));
  assert.equal(h.button.title, 'Enter full screen');
  assert.equal(h.attributes.get('aria-haspopup'), 'false');
  assert.equal(await control.toggle(), true); assert.equal(webkitRequests, 1); assert.equal(h.requests(), 0);
  // Exit must remain available even after entry capability disappears.
  h.doc.webkitFullscreenEnabled = false;
  assert.equal(await control.toggle(), true);
  h.doc.fullscreenEnabled = true;
  h.win.dispatchEvent(new Event('pageshow'));
  assert.equal(h.button.title, 'Enter full screen');
  assert.equal(await control.toggle(), true); assert.equal(h.requests(), 1);
  assert.equal(await control.toggle(), true);
  h.doc.fullscreenEnabled = false;
  assert.equal(await control.toggle(), false, 'A gesture rechecks capabilities even without a preceding event');
  assert.deepEqual(h.helps, [{ reason: 'unsupported', installed: false }]);
  control.dispose();
  h.doc.fullscreenEnabled = true; h.win.dispatchEvent(new Event('resize'));
  assert.equal(h.button.title, 'Full screen options', 'Disposal removes window refresh listeners');
});

test('Home Screen display modes open installed-mode help without claiming a native fullscreen exit', async () => {
  for (const options of [{ mode: 'standalone' }, { mode: 'fullscreen' }, { standalone: true }]) {
    const h = harness({ supported: false, ...options }), control = h.setup();
    assert.equal(h.button.title, 'Home Screen mode');
    assert.equal(h.attributes.get('aria-pressed'), 'false');
    assert.equal(h.attributes.get('aria-haspopup'), 'dialog');
    assert.equal(h.button.disabled, false);
    assert.equal(await control.toggle(), false);
    assert.equal(h.exits(), 0);
    assert.deepEqual(h.helps, [{ reason: 'unsupported', installed: true }]);
    control.dispose();
  }
  const h = harness({ supported: false }), control = h.setup();
  h.win.mode = 'standalone'; h.win.dispatchEvent(new Event('pageshow'));
  assert.equal(h.button.title, 'Home Screen mode', 'Returning to an installed context refreshes the label');
  control.dispose();
});

test('incomplete native APIs offer help and callers without a help dialog retain notification and focus fallback', async () => {
  const h = harness(); delete h.doc.exitFullscreen;
  let focused = 0;
  const control = h.setup({ showHelp: undefined, restoreFocus: () => focused++ });
  assert.equal(h.button.title, 'Full screen options');
  assert.equal(await control.toggle(), false); assert.equal(h.requests(), 0); assert.equal(h.messages.length, 1);
  h.doc.exitFullscreen = () => Promise.resolve();
  h.target.requestFullscreen = () => Promise.reject(new Error('Denied'));
  assert.equal(await control.toggle(), false);
  assert.equal(h.messages.length, 2); assert.equal(focused, 1);
  control.dispose();
});
