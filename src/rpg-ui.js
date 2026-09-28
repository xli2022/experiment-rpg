import { QUESTS, CONTACTS, MEMORIES, WORLD_OBJECTS, DISTRICTS, UPGRADES, ENDINGS, questById, placeById } from './content.js';
import { dialogueFor, replyScene, offerScene, endingScene, acceptanceReply } from './dialogue.js';
import { NPC_PROFILES, VOICE_PROFILES } from './npc-profiles.js';
import { COLORS, SYMBOLS } from './world.js';
import { formatCurrency } from './currency.js';
import { CITY_SCALE } from './world-scale.js';
import { bindMapDrag, constrainMapView, zoomMapView, MAP_WORLD_SPAN } from './map-viewport.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const button = (label, action, classes = '', disabled = false) => `<button class="rpg-button ${classes}" data-action="${esc(action)}" ${disabled ? 'disabled' : ''}>${label}</button>`;

export class RPGUI {
  constructor(game, callbacks) {
    this.game = game; this.cb = callbacks; this.tab = 'quests'; this.selectedQuest = game.data.tracked; this.selectedPlace = 'mara'; this.mapFilter = 'all';
    const layer = document.createElement('div');
    layer.innerHTML = `
      <div id="journal" class="modal-layer hidden" role="dialog" aria-modal="true" aria-labelledby="journal-title"><section class="journal-card">
        <header class="rpg-heading"><div><div class="eyebrow">VEX / FIELD TERMINAL</div><h2 id="journal-title">A city of stories.</h2></div><button class="icon-button" data-action="close" aria-label="Close journal">×</button></header>
        <div id="journal-stats" class="journal-stats"></div>
        <nav class="journal-tabs" aria-label="Journal sections">${['quests', 'inventory', 'people', 'memories'].map(t => button(t, `tab:${t}`)).join('')}</nav>
        <div id="journal-content" class="journal-content"></div>
        <footer class="journal-footer"><span id="save-status">Progress saves automatically</span><span>J / CLOSE &nbsp; · &nbsp; ESC / BACK</span></footer>
      </section></div>
      <div id="dialogue" class="modal-layer dialogue-layer hidden" role="dialog" aria-modal="true" aria-labelledby="speaker-name"><section class="dialogue-card">
        <header class="dialogue-heading"><div id="speaker-monogram"></div><div><div id="speaker-role" class="eyebrow"></div><h2 id="speaker-name"></h2><div id="speaker-personality"></div></div><button class="icon-button" data-action="close" aria-label="Leave conversation">×</button></header>
        <p id="dialogue-text" class="dialogue-text"></p>
        <div class="dialogue-voice"><span id="voice-status" role="status" aria-live="polite"></span><button id="voice-replay" data-action="voice-replay">Replay voice</button><button id="voice-toggle" data-action="voice-toggle" aria-pressed="true">Voice on</button></div>
        <div id="dialogue-choices" class="dialogue-choices"></div>
        <footer>AFTERLIGHT / LOCAL CHANNEL <span>Choose a response · Escape to leave</span></footer>
      </section></div>
      <div id="service" class="modal-layer hidden" role="dialog" aria-modal="true" aria-labelledby="service-title"><section class="service-card"><header class="rpg-heading"><div><div id="service-kicker" class="eyebrow"></div><h2 id="service-title"></h2></div><button class="icon-button" data-action="close" aria-label="Close panel">×</button></header><div id="service-content"></div></section></div>
      <div id="district-arrival" class="district-arrival hidden" aria-live="polite"><small>NEW DISTRICT DISCOVERED</small><strong></strong><span></span></div>`;
    $('game').append(layer);
    this.cb.voice.subscribe(voice => {
      $('voice-status').textContent = voice.message;
      $('voice-replay').disabled = !voice.supported || !voice.enabled || !voice.volume;
      $('voice-toggle').disabled = !voice.supported;
      $('voice-toggle').textContent = voice.enabled ? 'Voice on' : 'Voice off';
      $('voice-toggle').setAttribute('aria-pressed', String(voice.enabled));
      $('speaker-monogram').classList.toggle('speaking', voice.status === 'speaking');
    });
    layer.addEventListener('click', e => { const target = e.target.closest('[data-action]'); if (target && !target.disabled) this.action(target.dataset.action); });
    const mapCanvas = $('full-map');
    const navigation = document.createElement('div'); navigation.className = 'map-navigation';
    navigation.innerHTML = `${button('−', 'zoom-out')}${button('+', 'zoom-in')}${button('Your area', 'map-home')}${button('Entire city', 'map-city')}<span>Drag to pan · scroll to zoom</span>`;
    document.querySelector('.city-map-card .map-heading').after(navigation);
    navigation.addEventListener('click', e => { const target = e.target.closest('[data-action]'); if (target) this.action(target.dataset.action); });
    mapCanvas.addEventListener('wheel', e => { e.preventDefault(); if (e.deltaY) this.zoomMap(e.deltaY > 0 ? 1.4 : 1 / 1.4); }, { passive: false });
    document.querySelector('.map-legend').insertAdjacentHTML('beforeend', '<span>● CONTACT</span><span>T TRANSIT</span><span>◈ MEMORY</span>');
    const layout = document.createElement('div'); layout.className = 'map-layout'; mapCanvas.before(layout); layout.append(mapCanvas);
    const sidebar = document.createElement('aside'); sidebar.className = 'map-sidebar'; sidebar.innerHTML = `<div class="map-filters">${['all', 'contacts', 'transit'].map(f => button(f, `filter:${f}`)).join('')}</div><div id="map-locations" class="map-locations"></div><div id="map-selection" class="map-selection"></div>`; layout.append(sidebar);
    sidebar.addEventListener('click', e => { const target = e.target.closest('[data-action]'); if (target && !target.disabled) this.action(target.dataset.action); });
    bindMapDrag(mapCanvas, this.cb.mapView, e => {
      this.boundMap();
      const rect = mapCanvas.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return;
      const x = (e.clientX - rect.left) * mapCanvas.width / rect.width;
      const y = (e.clientY - rect.top) * mapCanvas.height / rect.height;
      const view = this.cb.mapView, scale = Math.min(mapCanvas.width, mapCanvas.height) / view.span;
      const places = this.mapPlaces().map(p => ({ p, distance: Math.hypot(mapCanvas.width / 2 + (p.x - view.x) * scale - x, mapCanvas.height / 2 + (p.z - view.z) * scale - y) })).sort((a, b) => a.distance - b.distance);
      if (places[0]?.distance < 25) { this.selectedPlace = places[0].p.id; this.renderMap(); }
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.mapResize = new ResizeObserver(() => this.boundMap()); this.mapResize.observe(mapCanvas);
    }
    this.boundMap();
  }
  action(action) {
    const focused = document.activeElement, focusAction = focused?.dataset.action;
    if (action === 'zoom-in' || action === 'zoom-out') { this.zoomMap(action === 'zoom-in' ? .5 : 2); return; }
    if (action === 'map-home') { Object.assign(this.cb.mapView, { x: this.cb.position().x, z: this.cb.position().z, span: 1200 * CITY_SCALE }); this.boundMap(); return; }
    if (action === 'map-city') { Object.assign(this.cb.mapView, { x: 0, z: 0, span: MAP_WORLD_SPAN }); this.boundMap(); return; }
    const [kind, id] = action.split(':');
    if (kind === 'close') this.cb.close();
    if (kind === 'voice-replay') this.cb.voice.replay();
    if (kind === 'voice-toggle') { this.cb.voice.setEnabled(!this.cb.voice.enabled); if (this.cb.voice.enabled) this.cb.voice.replay(); }
    if (kind === 'new-story') this.cb.newStory();
    if (kind === 'tab') { this.tab = id; this.renderJournal(); }
    if (kind === 'quest') { this.selectedQuest = id; this.renderJournal(); }
    if (kind === 'track') { this.game.track(id); this.renderJournal(); this.cb.changed(); }
    if (kind === 'find') { this.game.pin = id; this.cb.close(); this.cb.notify(`DESTINATION SET // ${placeById(id).name}`); }
    if (kind === 'choice') this.choose(Number(id));
    if (kind === 'medkit') { this.cb.medkit(); this.renderJournal(); }
    if (kind === 'buy-medkit') { if (!this.game.buyMedkit()) this.cb.notify('Not enough credits, or your pack is full (9 medkits).'); this.renderShop(this.shopContact); this.cb.changed(); }
    if (kind === 'upgrade') { if (this.game.buyUpgrade(id)) this.cb.upgraded(); else this.cb.notify('You need more credits or components.'); this.renderShop(this.shopContact); this.cb.changed(); }
    if (kind === 'accept') { this.game.accept(id); this.cb.changed(); this.openBoard(); }
    if (kind === 'memory') this.openMemory(id);
    if (kind === 'filter') { this.mapFilter = id; this.renderMap(); }
    if (kind === 'place') { this.selectedPlace = id; const place = placeById(id); if (place) Object.assign(this.cb.mapView, { x: place.x, z: place.z }); this.renderMap(); }
    if (kind === 'travel') { const result = this.cb.travel(id); if (result !== true) this.cb.notify(result); else this.cb.close(); }
    if (kind === 'clear-pin') { this.game.pin = null; this.renderMap(); }
    // Replacing a quest or map list removes its focused button from the DOM.
    // Preserve the selection for keyboard users after those panel updates.
    if (focusAction && !focused.isConnected && document.activeElement === document.body) {
      const dialog = document.querySelector('.modal-layer:not(.hidden)');
      const buttons = [...(dialog?.querySelectorAll('button:not(:disabled)') ?? [])];
      (buttons.find(b => b.dataset.action === focusAction) ?? buttons[0])?.focus();
    }
  }
  boundMap() { constrainMapView(this.cb.mapView, $('full-map')); }
  zoomMap(factor) { zoomMapView(this.cb.mapView, $('full-map'), factor); }
  openJournal() { this.cb.open('journal'); this.selectedQuest = this.game.data.tracked ?? this.selectedQuest ?? 'dead-air'; this.renderJournal(); }
  confirmNewStory() {
    this.cb.open('service'); $('service-kicker').textContent = 'SYSTEM / NEW STORY'; $('service-title').textContent = 'Begin again?';
    $('service-content').innerHTML = `<p class="memory-reading">Starting a new story replaces the progress saved in this browser, including quests, equipment and your ending.</p><div class="reset-actions">${button('Keep my current story', 'close', 'accent')}${button('Start a new story', 'new-story')}</div>`;
  }
  renderJournal() {
    const d = this.game.data;
    $('journal-stats').innerHTML = `<span>LEVEL <b>${1 + Math.floor(d.xp / 500)}</b></span><span>BALANCE <b>${formatCurrency(d.credits)}</b></span><span>NEIGHBORHOOD <b>${d.reputation.community}</b></span><span>HELIX <b>${d.reputation.helix}</b></span><span>DISTRICTS <b>${d.discovered.length}/${DISTRICTS.length}</b></span>`;
    document.querySelectorAll('.journal-tabs button').forEach(b => { const active = b.dataset.action === `tab:${this.tab}`; b.classList.toggle('selected', active); b.setAttribute('aria-pressed', String(active)); });
    const el = $('journal-content');
    if (this.tab === 'quests') {
      const q = questById(this.selectedQuest) ?? QUESTS[0], progress = d.quests[q.id], status = this.game.status(q.id);
      el.innerHTML = `<div class="quest-layout"><nav class="quest-list" aria-label="Quests">${['story', 'side', 'contract'].map(kind => `<h3>${kind === 'story' ? 'THE LAST SIGNAL' : kind === 'side' ? 'LOCAL STORIES' : 'STREET CONTRACTS'}</h3>${QUESTS.filter(q => q.kind === kind && this.game.status(q.id) !== 'locked').map(q => `<button data-action="quest:${q.id}" class="quest-row ${q.id === this.selectedQuest ? 'selected' : ''}"><span>${q.chapter ?? (this.game.status(q.id) === 'complete' ? '✓' : '◇')}</span><div><strong>${esc(q.title)}</strong><small>${this.game.status(q.id)}${d.tracked === q.id ? ' / TRACKED' : ''}</small></div></button>`).join('')}`).join('')}</nav>
      <article class="quest-detail"><div class="eyebrow">${q.kind === 'story' ? `CHAPTER ${q.chapter} / THE LAST SIGNAL` : 'AFTERLIGHT / LOCAL STORY'}</div><h3>${esc(q.title)}</h3><p>${esc(q.description)}</p><ol class="objective-list">${q.steps.map((s, i) => `<li class="${status === 'complete' || i < (progress?.step ?? 0) ? 'done' : i === progress?.step ? 'current' : ''}"><span>${status === 'complete' || i < (progress?.step ?? 0) ? '✓' : String(i + 1).padStart(2, '0')}</span>${esc(s.text)}${i === progress?.step && s.count > 1 ? ` <b>${Math.min(this.game.progressCount(s), s.count)}/${s.count}</b>` : ''}</li>`).join('')}</ol><div class="quest-rewards"><span>+${formatCurrency(q.reward)}</span><span>+ ${q.xp} XP</span>${q.faction ? '<span>+10 NEIGHBORHOOD TRUST</span>' : ''}</div>${status === 'active' ? button(d.tracked === q.id ? 'Currently tracked ✓' : 'Track this story ↗', `track:${q.id}`, 'accent') : status === 'available' ? button('Find the contact ↗', `find:${q.giver}`, 'accent') : '<p class="completed-note">This story is part of Afterlight now.</p>'}
      <div class="journal-tip">Explore at your own pace. Jobs can stay active together. Your tracked story sets the compass and map destination.</div></article></div>`;
    } else if (this.tab === 'inventory') {
      el.innerHTML = `<div class="inventory-intro"><div class="eyebrow">EQUIPMENT / SUPPLIES</div><h3>Built to keep going.</h3><p>Find components in salvage caches and disabled drones. Visit Rook in Foundry for upgrades.</p></div><div class="inventory-grid"><article class="inventory-item"><small>FIELD SUPPLIES</small><h3>${d.medkits} <span>medkits</span></h3><p>Restore 60 health. Carry up to 9 purchased kits.</p>${button('Use medkit · Q', 'medkit', 'accent', d.medkits < 1 || this.cb.health() >= 100)}</article><article class="inventory-item"><small>SALVAGED COMPONENTS</small><h3>${d.salvage} <span>parts</span></h3><p>Spend at Rook’s workshop, or reserve six for his radio repairs.</p>${button('Find Rook ↗', 'find:rook')}</article>${UPGRADES.map(u => `<article class="inventory-item"><small>TIER ${d.upgrades[u.id]} / ${u.max}</small><h4>${u.name}</h4><p>${u.description}</p><div class="tier-bars">${[1, 2, 3].map(i => `<i class="${d.upgrades[u.id] >= i ? 'filled' : ''}"></i>`).join('')}</div></article>`).join('')}</div>`;
    } else if (this.tab === 'people') {
      el.innerHTML = `<div class="inventory-intro"><div class="eyebrow">THE PEOPLE BEHIND THE SIGNAL</div><h3>Nobody is a rounding error.</h3><p>Help your neighbors to earn better prices. Dialogue choices also change your standing with Helix.</p></div><div class="people-grid">${CONTACTS.map(c => `<article class="person-card"><div class="person-monogram" style="--contact:${c.color}">${this.portrait(c)}</div><div><small>${d.met.includes(c.id) ? 'CONTACT ESTABLISHED' : 'UNMET / KNOWN LOCATION'}</small><h3>${c.name} <span class="person-pronouns">${esc(c.pronouns)}</span></h3><div class="person-traits">${esc(c.personality)}</div><p>${c.bio}</p>${NPC_PROFILES[c.id] ? `<p class="person-appearance">${NPC_PROFILES[c.id].description}</p>` : ''}${button('Find on the streets ↗', `find:${c.id}`)}</div></article>`).join('')}</div>`;
    } else {
      const memories = MEMORIES.filter(m => d.collected.includes(m.id));
      el.innerHTML = `<div class="inventory-intro"><div class="eyebrow">ARCHIVE / ${memories.length} OF ${MEMORIES.length} FRAGMENTS</div><h3>The things we keep.</h3><p>Look for violet memory chips across the city. Recovered fragments are kept here.</p></div>${d.ending ? `<article class="memory-entry ending-entry"><small>THE LAST SIGNAL / YOUR ENDING</small><h3>${ENDINGS[d.ending].name}</h3><p>${ENDINGS[d.ending].text}</p></article>` : ''}${memories.length ? memories.map(m => `<article class="memory-entry"><small>${m.author}</small><h3>${m.name}</h3><p>${m.description}</p></article>`).join('') : '<div class="empty-state">Somewhere nearby, somebody left a story behind.<br>Find the violet signal just north of Mara.</div>'}`;
    }
  }
  openContact(id) { this.game.meet(id); this.contactId = id; this.cb.open('dialogue'); this.renderDialogue(dialogueFor(this.game, id)); this.cb.changed(); }
  portrait(contact) { return this.cb.portraits[contact.id] ? `<img src="${this.cb.portraits[contact.id]}" alt="${esc(contact.name)}" width="192" height="240" />` : `<span>${contact.initials}</span>`; }
  renderDialogue(scene) {
    this.scene = scene;
    $('speaker-monogram').innerHTML = this.portrait(scene.contact); $('speaker-monogram').style.setProperty('--contact', scene.contact.color);
    $('speaker-name').textContent = scene.contact.name; $('speaker-role').textContent = scene.contact.role;
    $('speaker-personality').textContent = `${scene.contact.pronouns} · ${scene.contact.personality}`;
    $('speaker-monogram').title = `${scene.contact.name} · ${VOICE_PROFILES[scene.contact.id].label}`;
    $('dialogue-text').textContent = scene.text;
    $('dialogue-choices').innerHTML = scene.choices.map((c, i) => `<button data-action="choice:${i}" class="dialogue-choice"><span class="choice-index">${String(i + 1).padStart(2, '0')}</span><span>${esc(c.label)}${c.detail ? `<small>${esc(c.detail)}</small>` : ''}</span><b>↗</b></button>`).join('');
    $('dialogue-choices').querySelector('button')?.focus();
    this.cb.voice.speak(scene.text, scene.contact.id);
  }
  choose(index) {
    const choice = this.scene?.choices[index]; if (!choice) return;
    const contact = this.scene.contact;
    if (choice.kind === 'close') { this.cb.close(); return; }
    if (choice.kind === 'back') this.renderDialogue(dialogueFor(this.game, this.contactId));
    if (choice.kind === 'topic') this.renderDialogue(replyScene(contact, choice.reply, choice.topics));
    if (choice.kind === 'offer') this.renderDialogue(offerScene(contact, questById(choice.quest)));
    if (choice.kind === 'talk') { this.game.event('talk', this.contactId, choice.quest); this.renderDialogue(replyScene(contact, choice.reply)); }
    if (choice.kind === 'accept') { this.game.accept(choice.quest); this.renderDialogue(replyScene(contact, acceptanceReply(contact.id))); }
    if (choice.kind === 'shop') this.renderShop(contact);
    if (choice.kind === 'decision' && this.game.decide(choice.key, choice.value)) {
      if (choice.key === 'ending') this.showEnding(); else this.renderDialogue(replyScene(contact, choice.reply));
    }
    this.cb.changed();
  }
  openEnding() { this.contactId = 'echo'; this.cb.open('dialogue'); this.renderDialogue(endingScene()); }
  showEnding() {
    const ending = ENDINGS[this.game.data.ending]; this.cb.open('service');
    $('service-kicker').textContent = 'THE LAST SIGNAL / CAMPAIGN COMPLETE'; $('service-title').textContent = ending.name;
    $('service-content').innerHTML = `<div class="ending-emblem">◈</div><p class="ending-copy">${ending.text}</p><div class="quest-rewards"><span>+${formatCurrency(1200)}</span><span>+650 XP</span></div><p class="service-note">Dawn is a beginning. Your remaining jobs, upgrades and discoveries are still waiting in the city. Your ending is saved in the memory archive.</p>${button('Back to Afterlight ↗', 'close', 'accent')}`;
  }
  renderShop(contact) {
    this.shopContact = contact; this.cb.open('service');
    const d = this.game.data;
    $('service-kicker').textContent = `${contact.name} / ${contact.shop === 'workshop' ? 'WORKSHOP' : 'SUPPLIES'}`; $('service-title').textContent = contact.shop === 'workshop' ? 'Make it your own.' : 'Stay in one piece.';
    $('service-content').innerHTML = `<div class="shop-wallet">${formatCurrency(d.credits)} <span>${d.salvage} COMPONENTS</span></div>${d.reputation.community >= 30 ? '<p class="shop-discount">NEIGHBORHOOD TRUST / 15% upgrade discount active</p>' : ''}<div class="shop-list">${contact.shop === 'workshop' ? UPGRADES.map(u => {
      const p = this.game.upgradePrice(u.id), level = d.upgrades[u.id];
      return `<article class="shop-item"><div><small>TIER ${level}/${u.max}</small><h3>${u.name}</h3><p>${u.description}</p></div>${button(level >= u.max ? 'MAXED' : `${formatCurrency(p.credits)}<small>${p.salvage} components</small>`, `upgrade:${u.id}`, 'accent', level >= u.max || d.credits < p.credits || d.salvage < p.salvage)}</article>`;
    }).join('') : ''}<article class="shop-item"><div><small>IN PACK / ${d.medkits}</small><h3>Field medkit</h3><p>Restore 60 health with Q or from your journal.</p></div>${button(`${formatCurrency(d.reputation.community >= 20 ? 90 : 120)}<small>Buy one</small>`, 'buy-medkit', 'accent', d.credits < (d.reputation.community >= 20 ? 90 : 120) || d.medkits >= 9)}</article></div>`;
  }
  openBoard() {
    this.cb.open('service'); $('service-kicker').textContent = 'NEIGHBORHOOD / OPEN CONTRACTS'; $('service-title').textContent = 'Work worth doing.';
    $('service-content').innerHTML = `<p class="service-note">The night mail always needs runners. Other jobs begin with the people you meet in Afterlight.</p>${QUESTS.filter(q => q.kind === 'contract').map(q => `<article class="shop-item"><div><small>${this.game.status(q.id).toUpperCase()} / REPEATABLE</small><h3>${q.title}</h3><p>${q.description}</p></div>${button(this.game.status(q.id) === 'active' ? 'In progress' : `Accept · ${formatCurrency(q.reward)}`, `accept:${q.id}`, 'accent', this.game.status(q.id) === 'active')}</article>`).join('')}`;
  }
  openMemory(id) {
    const m = placeById(id); this.cb.open('service'); $('service-kicker').textContent = `MEMORY FRAGMENT / ${m.author}`; $('service-title').textContent = m.name;
    $('service-content').innerHTML = `<p class="memory-reading">${esc(m.description)}</p><p class="service-note">Saved to your journal’s memory archive.</p>${button('Keep moving ↗', 'close', 'accent')}`;
  }
  showTerminal(place, text) {
    this.cb.open('service'); $('service-kicker').textContent = 'AFTERLIGHT / LOCAL TERMINAL'; $('service-title').textContent = place.name;
    $('service-content').innerHTML = `<p class="memory-reading">${esc(text)}</p>${button('Disconnect ↗', 'close', 'accent')}`;
  }
  mapPlaces() {
    return WORLD_OBJECTS.filter(p => !['cache', 'memory', 'terminal'].includes(p.type) && (this.mapFilter === 'all' || p.type === (this.mapFilter === 'contacts' ? 'contact' : 'transit')));
  }
  renderMap() {
    this.boundMap();
    document.querySelectorAll('.map-filters button').forEach(b => b.classList.toggle('selected', b.dataset.action === `filter:${this.mapFilter}`));
    $('map-locations').innerHTML = this.mapPlaces().map(p => `<button class="map-location ${p.id === this.selectedPlace ? 'selected' : ''}" data-action="place:${p.id}"><span style="color:${COLORS[p.type]}">${SYMBOLS[p.type]}</span><span>${esc(p.name)}${p.type === 'transit' ? `<small>${this.game.data.transit.includes(p.id) ? 'CONNECTED' : 'UNDISCOVERED'}</small>` : ''}</span></button>`).join('');
    const place = placeById(this.selectedPlace) ?? placeById('mara');
    $('map-selection').innerHTML = `<div class="eyebrow">${place.type.toUpperCase()}</div><h3>${esc(place.name)}</h3><p>${esc(place.description)}</p>${button('Set destination ↗', `find:${place.id}`, 'accent')}${place.type === 'transit' ? button(this.game.data.transit.includes(place.id) ? 'Take the tram →' : 'Discover this stop on foot', `travel:${place.id}`, '', !this.game.data.transit.includes(place.id)) : ''}${this.game.pin ? button('Clear custom destination', 'clear-pin', 'subtle') : ''}`;
  }
  announceDistrict(district) {
    const el = $('district-arrival'); el.querySelector('strong').textContent = district.name; el.querySelector('span').textContent = district.description;
    el.classList.remove('hidden'); clearTimeout(this.arrivalTimeout); this.arrivalTimeout = setTimeout(() => el.classList.add('hidden'), 5500);
  }
}
