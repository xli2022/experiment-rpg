const ENTER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
const EXIT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5"/></svg>';

export function setupFullscreen(button, { document: doc = globalThis.document, target = doc.documentElement, notify = () => {}, restoreFocus = () => {} } = {}) {
  let pending = false, disposed = false;
  const standard = typeof target.requestFullscreen === 'function';
  const request = standard ? target.requestFullscreen : target.webkitRequestFullscreen;
  const exit = standard ? doc.exitFullscreen : doc.webkitExitFullscreen;
  const active = () => !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
  const supported = () => typeof request === 'function' && typeof exit === 'function' && (standard ? doc.fullscreenEnabled : doc.webkitFullscreenEnabled) !== false;

  function sync() {
    if (disposed) return;
    const fullscreen = active(), available = fullscreen ? typeof exit === 'function' : supported();
    const label = fullscreen ? 'Exit full screen' : available ? 'Enter full screen' : 'Full screen unavailable';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(fullscreen));
    button.setAttribute('aria-busy', String(pending));
    button.disabled = pending || !available;
    button.innerHTML = fullscreen ? EXIT_ICON : ENTER_ICON;
  }

  async function toggle() {
    if (disposed || pending) return false;
    const exiting = active(), action = exiting ? exit : request;
    if (typeof action !== 'function' || !exiting && !supported()) {
      sync(); notify('Full screen is not supported or is disabled by this browser.'); return false;
    }
    pending = true; sync();
    try {
      // Call inside the click gesture; awaiting anything first loses activation.
      await action.call(exiting ? doc : target);
      return active() !== exiting;
    } catch {
      if (!disposed) notify(exiting ? 'Could not exit full screen. Use your browser’s exit control.' : 'Full screen could not be enabled. Try again or use your browser’s full screen command.');
      return false;
    } finally {
      pending = false; sync();
      if (!disposed) restoreFocus();
    }
  }

  const click = () => { void toggle(); };
  const legacyError = () => {
    sync(); notify('Full screen could not be changed. Use your browser’s full screen control.');
  };
  button.type = 'button';
  button.addEventListener('click', click);
  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('webkitfullscreenchange', sync);
  // Standard requests reject their promise; older WebKit reports an event.
  if (!standard) doc.addEventListener('webkitfullscreenerror', legacyError);
  sync();
  return {
    toggle, sync,
    dispose() {
      disposed = true;
      button.removeEventListener('click', click);
      doc.removeEventListener('fullscreenchange', sync);
      doc.removeEventListener('webkitfullscreenchange', sync);
      if (!standard) doc.removeEventListener('webkitfullscreenerror', legacyError);
    },
  };
}
