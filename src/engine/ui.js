const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const button = (label, action, classes = '', disabled = false) => `<button class="rpg-button ${classes}" data-action="${esc(action)}" ${disabled ? 'disabled' : ''}>${label}</button>`;

/**
 * Modal layers shared by the engine and game modes. One modal is open at a
 * time; opening one pauses the game. The generic `service` panel routes its
 * button actions to whoever opened it.
 */
export function createUI({ state, input, audio, onMenu = () => {} }) {
  const modals = new Set(['pause', 'city-map', 'service']), closeKeys = new Map([['KeyM', 'city-map']]);
  let panelHandler = null;
  const ui = {
    open(id, handler) {
      onMenu(id);
      if (id === 'service') panelHandler = handler ?? null;
      state.paused = true; state.modal = id; state.mapOpen = id === 'city-map';
      input.setEnabled(false); audio.update(0, false); document.body.classList.add('menu-open');
      for (const modal of modals) $(modal)?.classList.toggle('hidden', modal !== id);
      $(id)?.querySelector('button:not(:disabled)')?.focus();
    },
    close() {
      onMenu(null);
      state.paused = false; state.mapOpen = false; state.modal = null; document.body.classList.remove('menu-open');
      for (const modal of modals) $(modal)?.classList.add('hidden');
      input.setEnabled(state.started);
    },
    panel({ kicker, title, html, onAction }) {
      $('service-kicker').textContent = kicker; $('service-title').textContent = title; $('service-content').innerHTML = html;
      ui.open('service', onAction);
    },
    setPause(paused) { if (!paused) { ui.close(); return; } ui.open('pause'); $('resume-button').focus(); },
    togglePause() { if (state.paused) ui.close(); else if (state.started) ui.setPause(true); },
    register(id, key = null) { modals.add(id); if (key) closeKeys.set(key, id); },
    unregister(id) { modals.delete(id); for (const [key, modal] of closeKeys) if (modal === id) closeKeys.delete(key); },
    /** Mode-owned pause-menu buttons and settings rows. Returns a cleanup. */
    menu(items = [], settings = null) {
      const host = $('mode-menu'), panel = $('mode-settings');
      host.innerHTML = items.map((item, i) => `<button class="text-button" data-mode-menu="${i}">${esc(item.label)}</button>`).join('');
      const click = e => { const target = e.target.closest('[data-mode-menu]'); if (target) items[Number(target.dataset.modeMenu)].action(); };
      host.addEventListener('click', click);
      if (settings) panel.append(settings);
      return () => { host.removeEventListener('click', click); host.innerHTML = ''; panel.replaceChildren(); };
    },
  };
  $('service').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target || target.disabled) return;
    if (target.dataset.action === 'close') ui.close(); else panelHandler?.(target.dataset.action);
  });
  // Keep keyboard focus inside whichever dialog is open; map/journal keys close their own layer.
  document.addEventListener('keydown', event => {
    const closing = closeKeys.get(event.code);
    if (closing && state.modal === closing) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) ui.close(); return; }
    const dialog = state.modal ? $(state.modal) : null;
    if (event.key !== 'Tab' || !dialog) return;
    const elements = [...dialog.querySelectorAll('button:not(:disabled), select, input')], first = elements[0], last = elements.at(-1);
    if (!elements.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  return ui;
}
