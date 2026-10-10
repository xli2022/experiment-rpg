const ENTER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
const EXIT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5"/></svg>';

export function setupFullscreen(button, {
  document: doc = globalThis.document, target = doc.documentElement,
  window: win = globalThis.window, navigator: nav = win?.navigator ?? globalThis.navigator,
  notify = () => {}, restoreFocus = () => {}, showHelp,
} = {}) {
  let pending = false, disposed = false, lastAttempt = null;
  const active = () => !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
  const installed = () => {
    if (nav?.standalone === true) return true;
    return ['standalone', 'fullscreen'].some(mode => win?.matchMedia?.(`(display-mode: ${mode})`).matches);
  };
  // Safari's availability can change when a hardware keyboard is connected.
  // Resolve both methods and capability flags when used, not only at startup.
  function entryAPI() {
    for (const api of [
      { name: 'standard', request: target.requestFullscreen, exit: doc.exitFullscreen, enabled: doc.fullscreenEnabled },
      { name: 'webkit', request: target.webkitRequestFullscreen, exit: doc.webkitExitFullscreen, enabled: doc.webkitFullscreenEnabled },
    ]) if (typeof api.request === 'function' && typeof api.exit === 'function' && api.enabled !== false) return api;
    return null;
  }
  function exitAPI() {
    if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') return { name: 'standard', exit: doc.exitFullscreen };
    if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === 'function') return { name: 'webkit', exit: doc.webkitExitFullscreen };
    return null;
  }
  function help(reason) {
    if (typeof showHelp === 'function') { showHelp({ reason, installed: installed() }); return true; }
    notify(reason === 'unsupported' ? 'Full screen is not supported or is disabled by this browser.' : 'Full screen could not be enabled. Try again or use your browser’s full screen command.');
    return false;
  }
  function failure(attempt) {
    if (disposed || attempt.failed) return;
    attempt.failed = true;
    if (attempt.exiting) notify('Could not exit full screen. Use your browser’s exit control.');
    else attempt.helpShown = help('rejected');
  }

  function sync() {
    if (disposed) return;
    const fullscreen = active(), options = !fullscreen && !entryAPI();
    const label = fullscreen ? 'Exit full screen' : options ? installed() ? 'Home Screen mode' : 'Full screen options' : 'Enter full screen';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(fullscreen));
    button.setAttribute('aria-busy', String(pending));
    button.setAttribute('aria-haspopup', options ? 'dialog' : 'false');
    button.disabled = pending;
    button.innerHTML = fullscreen ? EXIT_ICON : ENTER_ICON;
  }

  async function toggle() {
    if (disposed || pending) return false;
    const exiting = active(), api = exiting ? exitAPI() : entryAPI();
    if (!api) {
      sync();
      if (exiting) notify('Could not exit full screen. Use your browser’s exit control.');
      else help('unsupported');
      return false;
    }
    const attempt = { api: api.name, exiting, failed: false, helpShown: false, completed: false };
    lastAttempt = attempt;
    pending = true; sync();
    try {
      // Call inside the click gesture; awaiting anything first loses activation.
      if (exiting) await api.exit.call(doc);
      else if (api.name === 'standard') await api.request.call(target, { navigationUI: 'hide' });
      else await api.request.call(target);
      attempt.completed = active() !== exiting;
      return !attempt.failed && attempt.completed;
    } catch {
      failure(attempt);
      return false;
    } finally {
      pending = false; sync();
      if (!disposed && !attempt.helpShown) restoreFocus();
    }
  }

  const click = () => { void toggle(); };
  const legacyError = () => {
    if (lastAttempt?.api === 'webkit' && !lastAttempt.completed && active() === lastAttempt.exiting) failure(lastAttempt);
    sync();
  };
  button.type = 'button';
  button.addEventListener('click', click);
  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('webkitfullscreenchange', sync);
  // Standard requests reject their promise; older WebKit reports an event.
  doc.addEventListener('webkitfullscreenerror', legacyError);
  win?.addEventListener('pageshow', sync);
  win?.addEventListener('resize', sync);
  sync();
  return {
    toggle, sync,
    dispose() {
      disposed = true;
      button.removeEventListener('click', click);
      doc.removeEventListener('fullscreenchange', sync);
      doc.removeEventListener('webkitfullscreenchange', sync);
      doc.removeEventListener('webkitfullscreenerror', legacyError);
      win?.removeEventListener('pageshow', sync);
      win?.removeEventListener('resize', sync);
    },
  };
}
