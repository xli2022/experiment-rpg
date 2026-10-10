import { LAST_MODE_KEY } from './save.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Start-screen cards, one per registered mode: title, tagline, description,
 * save summary and Continue / New game. The last played mode is preferred and
 * its primary button is `#start-button`.
 */
export function modeCards(modes, storage) {
  const last = storage.getItem(LAST_MODE_KEY) ?? modes[0].id;
  return modes.map(m => {
    const summary = m.saveSummary?.(storage) ?? null, preferred = m.id === last;
    return `<article class="mode-card${preferred ? ' preferred' : ''}" style="--mode-accent:${m.accent ?? '#deff7a'}" data-mode="${m.id}">
      <div class="mode-kicker">${esc(m.tagline ?? '')}</div><h3>${esc(m.title)}</h3><p>${esc(m.description ?? '')}</p>
      <div class="mode-save">${summary ? esc(summary) : 'No saved game in this browser'}</div>
      <div class="mode-actions"><button class="primary-button" ${preferred ? 'id="start-button" ' : ''}data-mode-start="${m.id}">${summary ? 'CONTINUE' : 'START'} <span>↗</span></button>
      ${summary ? `<button class="text-button" data-mode-new="${m.id}">New game…</button>` : ''}</div></article>`;
  }).join('');
}
