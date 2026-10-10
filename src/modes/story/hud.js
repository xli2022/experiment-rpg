import { formatCurrency } from './currency.js';

// The story's own HUD panels: the mission card, Vex's vitals and wallet, and
// the journal button. They mount into the engine HUD and leave with the mode.
export function createStoryHud(host, { journal, medkit }) {
  const mission = document.createElement('aside');
  mission.className = 'mission-panel';
  mission.innerHTML = `<div class="eyebrow"><span class="diamond"></span> YOUR NEXT MOVE</div>
    <h2 id="mission-title">Dead air</h2><p id="mission-description">Someone in the static remembers your name.</p>
    <div class="mission-objective"><span id="objective-icon">◇</span><span id="objective-text"></span></div>
    <div class="mission-meta"><span id="objective-distance"></span><span id="mission-reward"></span></div>`;
  const vitals = document.createElement('section');
  vitals.className = 'player-panel';
  vitals.innerHTML = `<div class="player-id"><div class="portrait"><svg viewBox="0 0 40 48"><path d="m10 45 3-15 7-3 7 3 3 15M14 10l6-5 6 5v12l-6 6-6-6Z"/><path class="visor" d="M14 14h12v5H14z"/><path d="M10 45h20"/></svg></div><div><div class="player-name">VEX <span>LVL <b id="level">01</b></span></div><div class="player-role">STREET RUNNER</div></div></div>
    <div class="vital-row"><svg viewBox="0 0 20 20"><path d="M8 3h4v5h5v4h-5v5H8v-5H3V8h5Z"/></svg><div class="bar"><span id="health-bar"></span></div><strong id="health-value">100</strong><small>/ 100</small></div>
    <div class="vital-row armor"><svg viewBox="0 0 20 20"><path d="m10 2 7 3v5c0 4-7 8-7 8s-7-4-7-8V5Z"/></svg><div class="bar"><span id="armor-bar"></span></div><strong id="armor-value">50</strong><small id="armor-max">/ 50</small></div>
    <div class="credits"><span>$</span> <b id="credits">1,250</b><span class="cred-meter">STREET CRED <b id="cred-value">0</b></span></div>
    <button id="medkit-button" class="medkit-hud" aria-label="Use field medkit"><kbd>Q</kbd> MEDKIT <b id="medkit-count">2</b><span id="salvage-count">0 COMPONENTS</span></button>`;
  const journalButton = document.createElement('button');
  journalButton.id = 'journal-button'; journalButton.className = 'icon-button'; journalButton.title = 'Field journal (J)';
  journalButton.setAttribute('aria-label', 'Open field journal');
  journalButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/></svg>';
  host.hud.mount(mission); host.hud.mount(vitals);
  document.querySelector('.top-actions').prepend(journalButton);
  journalButton.addEventListener('click', journal);
  vitals.querySelector('#medkit-button').addEventListener('click', () => { medkit(); host.renderer.domElement.focus(); });
  const n = id => (mission.querySelector(`#${id}`) ?? vitals.querySelector(`#${id}`));
  const nodes = Object.fromEntries(['mission-title', 'mission-description', 'objective-text', 'objective-distance', 'mission-reward', 'health-value', 'health-bar', 'armor-value', 'armor-bar', 'armor-max', 'credits', 'cred-value', 'level', 'medkit-count', 'salvage-count'].map(id => [id, n(id)]));
  return {
    update({ campaign, vitals: v, player, objective }) {
      const data = campaign.data;
      nodes['health-value'].textContent = Math.ceil(v.health); nodes['health-bar'].style.transform = `scaleX(${v.health / 100})`;
      nodes['armor-value'].textContent = Math.ceil(v.armor); nodes['armor-bar'].style.transform = `scaleX(${v.armor / campaign.maxArmor})`;
      nodes['armor-max'].textContent = `/ ${campaign.maxArmor}`;
      nodes['medkit-count'].textContent = data.medkits; nodes['salvage-count'].textContent = `${data.salvage} COMPONENTS`;
      nodes.credits.textContent = data.credits.toLocaleString('en-US'); nodes['cred-value'].textContent = data.xp; nodes.level.textContent = String(1 + Math.floor(data.xp / 500)).padStart(2, '0');
      const distance = Math.round(Math.hypot(player.x - objective.x, player.z - objective.z));
      const rise = Math.round((objective.y ?? player.y) - player.y);
      nodes['objective-distance'].textContent = objective.hidden ? 'CITY OPEN' : `${distance} M AWAY${Math.abs(rise) > 3 ? ` / ${rise > 0 ? '↑' : '↓'} ${Math.abs(rise)} M` : ''}`;
      nodes['mission-title'].textContent = objective.pinned ? objective.label : objective.quest?.title ?? 'The city is yours';
      nodes['mission-description'].textContent = objective.pinned ? 'A place worth finding. Your stories are waiting in the journal.' : objective.quest?.description ?? 'There are still voices to hear and streets to explore.';
      nodes['objective-text'].textContent = objective.text;
      nodes['mission-reward'].textContent = objective.quest ? `+${formatCurrency(objective.quest.reward)}` : 'J / FIELD JOURNAL';
    },
    dispose() { journalButton.remove(); },
  };
}
