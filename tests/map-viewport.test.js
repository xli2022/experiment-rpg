import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_LIMIT } from '../src/world-config.js';
import { CITY_SCALE } from '../src/world-scale.js';
import { WORLD_OBJECTS } from '../src/content.js';
import { RPGUI } from '../src/rpg-ui.js';
import { bindMapDrag, constrainMapView, panMapView, zoomMapView, MAP_WORLD_SPAN, MIN_MAP_SPAN } from '../src/map-viewport.js';

function canvas(width = 900, height = 700, cssWidth = width, cssHeight = height) {
  const listeners = new Map();
  return {
    width, height, captures: [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: cssWidth, height: cssHeight }),
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
    setPointerCapture(id) { this.captures.push(id); },
    dispatch(type, event = {}) { for (const listener of listeners.get(type) ?? []) listener({ pointerId: 1, clientX: 0, clientY: 0, button: 0, isPrimary: true, ...event }); },
  };
}

function assertInside(view, target) {
  // Derive the visible world rectangle from the renderer's projection, rather
  // than reusing the helper's returned bounds to assert its own calculation.
  const scale = Math.min(target.width, target.height) / view.span;
  for (const [center, size] of [[view.x, target.width], [view.z, target.height]]) {
    const half = size / (2 * scale);
    if (half >= WORLD_LIMIT) assert.ok(Math.abs(center) < 1e-9, 'An overview gutter must remain centered');
    else {
      assert.ok(center - half >= -WORLD_LIMIT - 1e-9, 'Near edge remains in the city');
      assert.ok(center + half <= WORLD_LIMIT + 1e-9, 'Far edge remains in the city');
    }
  }
}

test('panning and direct focus clamp every viewport edge across portrait and landscape maps', () => {
  for (const [width, height] of [[900, 700], [400, 900], [700, 700]]) {
    const target = canvas(width, height);
    for (const span of [MIN_MAP_SPAN, 1200, 3200, MAP_WORLD_SPAN]) {
      for (const x of [-WORLD_LIMIT * 2, WORLD_LIMIT * 2]) for (const z of [-WORLD_LIMIT * 2, WORLD_LIMIT * 2]) {
        const view = { x, z, span };
        constrainMapView(view, target); assertInside(view, target);
        panMapView(view, target, -x * 10, -z * 10); assertInside(view, target);
      }
    }
  }
});

test('zooming out near a corner keeps the whole view bounded and the full city immovable', () => {
  const target = canvas(), view = { x: WORLD_LIMIT, z: -WORLD_LIMIT, span: MIN_MAP_SPAN };
  constrainMapView(view, target);
  for (let i = 0; i < 20; i++) { zoomMapView(view, target, 1.4); assertInside(view, target); }
  assert.equal(view.span, WORLD_LIMIT * 2);
  panMapView(view, target, 1000, -1000);
  assert.ok(Math.abs(view.x) < 1e-9 && Math.abs(view.z) < 1e-9);
  for (let i = 0; i < 20; i++) { zoomMapView(view, target, .5); assertInside(view, target); }
  assert.equal(view.span, MIN_MAP_SPAN);
});

test('resizing between wide and tall canvases reclamps the newly exposed edges', () => {
  const target = canvas(700, 700), view = { x: 1800, z: -1800, span: 1800 };
  constrainMapView(view, target);
  target.width = 1600;
  constrainMapView(view, target); assertInside(view, target);
  assert.ok(view.x < 1800, 'A wider viewport shifts the focused area away from the east edge');
  view.z = -1800; target.width = 500; target.height = 1600;
  constrainMapView(view, target); assertInside(view, target);
  assert.ok(Math.abs(view.z) < 1e-9, 'An axis wider than the city locks to its center');
});

test('drag distance uses CSS pixels and remains safe while the canvas is hidden', () => {
  const target = canvas(900, 700, 450, 350), view = { x: 0, z: 0, span: 700 };
  panMapView(view, target, 45, -35);
  assert.equal(view.x, -90); assert.equal(view.z, 70);
  const hidden = canvas(900, 700, 0, 0), before = { ...view };
  panMapView(view, hidden, 45, -35);
  assert.deepEqual(view, before);
});

test('a drag owns one pointer and cancels cleanly without selecting a map location', () => {
  for (const end of ['pointercancel', 'lostpointercapture']) {
    const target = canvas(), view = { x: 0, z: 0, span: 700 };
    let selections = 0; bindMapDrag(target, view, () => selections++);
    target.dispatch('pointerdown', { pointerId: 1 });
    target.dispatch('pointerdown', { pointerId: 2, isPrimary: false });
    target.dispatch('pointermove', { pointerId: 2, clientX: 200 });
    target.dispatch('pointercancel', { pointerId: 2 });
    assert.equal(view.x, 0, 'A second pointer cannot pan or cancel the first gesture');
    target.dispatch('pointermove', { pointerId: 1, clientX: 20 });
    assert.equal(view.x, -20);
    target.dispatch(end, { pointerId: 1 });
    target.dispatch('pointermove', { pointerId: 1, clientX: 200 });
    target.dispatch('click');
    assert.equal(view.x, -20); assert.equal(selections, 0);
    target.dispatch('pointerdown', { pointerId: 3 }); target.dispatch('pointerup', { pointerId: 3 }); target.dispatch('click');
    assert.equal(selections, 1, 'A fresh tap works after a cancelled drag');
    assert.deepEqual(target.captures, [1, 3]);
  }
});

test('completed drags suppress clicks while taps and capture release still select', () => {
  const target = canvas(), view = { x: 0, z: 0, span: 700 };
  let selections = 0; bindMapDrag(target, view, () => selections++);
  target.dispatch('pointerdown'); target.dispatch('pointermove', { clientX: 20 });
  target.dispatch('pointerup'); target.dispatch('lostpointercapture'); target.dispatch('click');
  assert.equal(selections, 0);
  target.dispatch('pointerdown'); target.dispatch('pointerup'); target.dispatch('lostpointercapture'); target.dispatch('click');
  assert.equal(selections, 1);
});

test('home, entire-city, and transit selection actions apply the same viewport bounds', t => {
  const target = canvas(), nodes = new Map([['full-map', target]]);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    activeElement: null, querySelectorAll: () => [],
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, { innerHTML: '' }); return nodes.get(id); },
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; });
  const ui = Object.create(RPGUI.prototype), view = { x: 0, z: 0, span: 500 };
  ui.cb = { mapView: view, position: () => ({ x: WORLD_LIMIT - 1, z: -WORLD_LIMIT + 1 }) };
  ui.game = { data: { transit: [], memories: [], discovered: [] }, pin: null };
  ui.mapFilter = 'all'; ui.selectedPlace = 'mara';
  ui.action('map-home'); assertInside(view, target); assert.equal(view.span, 1200 * CITY_SCALE);
  ui.action('map-city'); assertInside(view, target); assert.equal(view.span, MAP_WORLD_SPAN);
  // Every real station is selectable at both a neighborhood view and at the
  // overview. The latter must not shift the city offscreen to center a station.
  for (const place of WORLD_OBJECTS.filter(place => place.type === 'transit')) {
    for (const span of [1800, MAP_WORLD_SPAN]) {
      view.span = span; ui.action(`place:${place.id}`);
      assert.equal(ui.selectedPlace, place.id); assertInside(view, target);
    }
  }
});
