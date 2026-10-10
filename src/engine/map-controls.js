import { CITY_SCALE } from '../world/world-scale.js';
import { bindMapDrag, constrainMapView, zoomMapView, MAP_WORLD_SPAN } from './map-viewport.js';
import { button } from './ui.js';

/** Zoom, "your area" and "entire city" for the full map view. Returns false for other actions. */
export function mapAction(view, canvas, action, position) {
  if (action === 'zoom-in' || action === 'zoom-out') zoomMapView(view, canvas, action === 'zoom-in' ? .5 : 2);
  else if (action === 'map-home') Object.assign(view, { x: position.x, z: position.z, span: 1200 * CITY_SCALE });
  else if (action === 'map-city') Object.assign(view, { x: 0, z: 0, span: MAP_WORLD_SPAN });
  else return false;
  constrainMapView(view, canvas);
  return true;
}

// Navigation buttons, wheel zoom and drag-to-pan. A click (not a drag) reports
// the canvas pixel so the active mode can select one of its places.
export function attachMapControls({ view, canvas, position, onPick }) {
  const navigation = document.createElement('div'); navigation.className = 'map-navigation';
  navigation.innerHTML = `${button('−', 'zoom-out')}${button('+', 'zoom-in')}${button('Your area', 'map-home')}${button('Entire city', 'map-city')}<span>Drag to pan · scroll to zoom</span>`;
  document.querySelector('.city-map-card .map-heading').after(navigation);
  navigation.addEventListener('click', e => { const target = e.target.closest('[data-action]'); if (target) mapAction(view, canvas, target.dataset.action, position()); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); if (e.deltaY) zoomMapView(view, canvas, e.deltaY > 0 ? 1.4 : 1 / 1.4); }, { passive: false });
  const layout = document.createElement('div'); layout.className = 'map-layout'; canvas.before(layout); layout.append(canvas);
  bindMapDrag(canvas, view, e => {
    constrainMapView(view, canvas);
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    onPick((e.clientX - rect.left) * canvas.width / rect.width, (e.clientY - rect.top) * canvas.height / rect.height);
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => constrainMapView(view, canvas)).observe(canvas);
  constrainMapView(view, canvas);
  return { layout };
}
