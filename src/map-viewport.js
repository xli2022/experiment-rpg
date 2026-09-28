import { WORLD_LIMIT } from './world-config.js';

export const MAP_WORLD_SPAN = WORLD_LIMIT * 2;
export const MIN_MAP_SPAN = 300;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function constrainMapView(view, canvas) {
  const width = Math.max(1, canvas.width), height = Math.max(1, canvas.height);
  view.span = clamp(Number.isFinite(view.span) ? view.span : MAP_WORLD_SPAN, MIN_MAP_SPAN, MAP_WORLD_SPAN);
  const scale = Math.min(width, height) / view.span;
  const halfWidth = width / (2 * scale), halfHeight = height / (2 * scale);
  // At Entire city, a rectangular canvas has fixed gutters along its longer
  // axis. That axis stays centered rather than allowing a pan into empty space.
  const limitX = Math.max(0, WORLD_LIMIT - halfWidth), limitZ = Math.max(0, WORLD_LIMIT - halfHeight);
  view.x = clamp(Number.isFinite(view.x) ? view.x : 0, -limitX, limitX);
  view.z = clamp(Number.isFinite(view.z) ? view.z : 0, -limitZ, limitZ);
  return { scale, halfWidth, halfHeight, limitX, limitZ };
}

export function zoomMapView(view, canvas, factor) {
  if (Number.isFinite(factor) && factor > 0) view.span *= factor;
  return constrainMapView(view, canvas);
}

export function panMapView(view, canvas, dx, dy) {
  const rect = canvas.getBoundingClientRect();
  const { scale } = constrainMapView(view, canvas);
  if (!(rect.width > 0 && rect.height > 0)) return;
  view.x -= dx * canvas.width / rect.width / scale;
  view.z -= dy * canvas.height / rect.height / scale;
  constrainMapView(view, canvas);
}

// Own a single pointer until it ends. Cancellation and capture loss must not
// leave a drag active or turn the interrupted gesture into a location click.
export function bindMapDrag(canvas, view, select) {
  let drag = null, moved = false;
  canvas.addEventListener('pointerdown', event => {
    if (drag || event.isPrimary === false || event.button !== undefined && event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    moved = false; canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 2) return;
    panMapView(view, canvas, dx, dy);
    drag.x = event.clientX; drag.y = event.clientY; moved = true;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (type !== 'pointerup') moved = true;
    drag = null;
  });
  canvas.addEventListener('click', event => { if (!moved && !drag) select(event); });
}
