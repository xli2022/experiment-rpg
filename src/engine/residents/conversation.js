import { residentPersona, chatMessages, cleanReply, previewReply, fallbackReply, opener, TOPICS } from './persona.js';
import { ResidentModel, RESIDENT_MODELS } from './model.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const MAX_LINE = 140;

/** Talking distance: close, on the player's level and roughly in front of them. */
export const RESIDENT_REACH = Object.freeze({ distance: 2.6, height: 1.2, cone: 1.2, close: 1.1 });

/**
 * The person among `people` ({ x, y, z }) nearest in front of the player, or
 * null. `visible(p)` rules out anyone behind a wall or shelf.
 */
export function facingResident(player, people, visible = () => true) {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  let best = null, score = Infinity;
  for (const p of people) {
    const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
    if (d > RESIDENT_REACH.distance || Math.abs((p.y ?? 0) - (player.y ?? 0)) > RESIDENT_REACH.height) continue;
    const angle = d > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) : 0;
    if (angle > RESIDENT_REACH.cone && d > RESIDENT_REACH.close) continue;
    if (d + angle < score && visible(p)) { best = p; score = d + angle; }
  }
  return best;
}

/**
 * One conversation at a time. Replies stream in from the model and are
 * cleaned up before they stay on screen and are spoken; a failed or unusable
 * reply becomes a short fallback line in the resident's voice. Saying
 * something new or leaving stops the speech and the reply being written, and
 * nothing late reaches the next conversation.
 */
export class ResidentConversation {
  constructor({ model, view, voice = null }) {
    Object.assign(this, { model, view, voice });
    this.persona = null; this.history = []; this.turns = 0; this.serial = 0; this.busy = false;
  }
  open(persona) {
    this.close();
    this.persona = persona; this.view.show(persona, TOPICS);
    return this.say(opener(persona));
  }
  async say(line) {
    const text = String(line ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE), persona = this.persona;
    if (!persona || this.busy || !text) return null;
    const serial = ++this.serial, current = () => serial === this.serial;
    this.voice?.stop();
    this.busy = true; this.view.said(text); this.view.reply('', true);
    let reply = null;
    try {
      const raw = await this.model.generate(chatMessages(persona, this.history, text), { onText: partial => { if (current()) this.view.reply(previewReply(partial, persona), true); } });
      reply = cleanReply(raw, persona);
    } catch { /* A fallback line answers instead. */ }
    if (!current()) return null;
    reply ??= fallbackReply(persona, this.turns);
    this.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    this.turns++; this.busy = false;
    this.view.reply(reply, false);
    this.voice?.speak(reply, persona.voice);
    return reply;
  }
  close() {
    if (this.busy) this.model.interrupt();
    if (this.persona) this.voice?.stop();
    this.serial++; this.busy = false; this.persona = null; this.history = []; this.turns = 0;
  }
  snapshot() {
    const p = this.persona;
    return { open: !!p, name: p?.name ?? null, title: p?.title ?? null, busy: this.busy, turns: this.turns, history: this.history.map(m => ({ ...m })) };
  }
}

const SPECIES_COLORS = { human: '#7ee6e3', robot: '#e8cd95', alien: '#c5a3ff' };
// The panel in index.html (#resident-chat), reusing the story's dialogue styles.
function createView({ touch, onSay, onClose, onReplay, onVoice }) {
  const root = $('resident-chat'), text = $('resident-text'), said = $('resident-said'), topics = $('resident-topics');
  const form = $('resident-form'), field = $('resident-input'), send = $('resident-send'), status = $('resident-status');
  let lines = [];
  root.addEventListener('click', event => {
    const target = event.target.closest('[data-resident]');
    if (!target || target.disabled) return;
    const [kind, index] = target.dataset.resident.split(':');
    if (kind === 'close') onClose();
    if (kind === 'topic') onSay(lines[Number(index)]);
    if (kind === 'replay') onReplay();
    if (kind === 'voice') onVoice();
  });
  form.addEventListener('submit', event => { event.preventDefault(); if (onSay(field.value)) field.value = ''; });
  return {
    show(persona, topicLines) {
      lines = topicLines;
      const monogram = $('resident-monogram');
      monogram.textContent = persona.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
      monogram.style.setProperty('--contact', SPECIES_COLORS[persona.species] ?? SPECIES_COLORS.human);
      $('resident-role').textContent = `${persona.title} / ${persona.where.split(' (')[0]}`.toUpperCase();
      $('resident-name').textContent = persona.name;
      $('resident-mood').textContent = `Seems ${persona.mood}`;
      topics.innerHTML = [...lines, 'Take care.'].map((line, i) => `<button class="dialogue-choice" data-resident="${i < lines.length ? `topic:${i}` : 'close'}"><span class="choice-index">${String(i + 1).padStart(2, '0')}</span><span>${esc(line)}</span><b>↗</b></button>`).join('');
      said.textContent = ''; text.textContent = ''; field.value = '';
      // Typing starts at once, but only once the E key that opened the panel is
      // done, or it types an "e". On touch screens the keyboard would cover the panel.
      if (!touch) setTimeout(() => field.focus({ preventScroll: true }));
    },
    said(line) { said.textContent = line; },
    reply(line, pending) {
      // Screen readers announce the finished reply, not every word as it arrives.
      text.textContent = line; text.classList.toggle('pending', pending); text.setAttribute('aria-busy', String(pending));
      send.disabled = pending;
      for (const button of topics.querySelectorAll('[data-resident^="topic"]')) button.disabled = pending;
    },
    status({ status: state, message }) {
      status.textContent = state === 'error' ? `The resident model stopped (${message}). Turn it off and on in the pause menu.` : 'Replies are written by an AI model on this device';
    },
    // The shared voice's state, as the story's dialogue card shows it.
    voice({ message, supported, enabled, volume, status: speech }) {
      $('resident-voice-status').textContent = message;
      $('resident-voice-replay').disabled = !supported || !enabled || !volume;
      const toggle = $('resident-voice-toggle');
      toggle.disabled = !supported; toggle.textContent = enabled ? 'Voice on' : 'Voice off'; toggle.setAttribute('aria-pressed', String(enabled));
      $('resident-monogram').classList.toggle('speaking', speech === 'speaking');
    },
  };
}

/** The pause-menu note for the resident-chat setting. */
export function settingsNote({ status, progress, message, size }, touch = false) {
  switch (status) {
    case 'idle': return 'On. The resident model loads when you start playing.';
    case 'checking': return 'Checking your graphics card…';
    case 'loading': return `${message || 'Downloading'}… ${Math.round(progress * 100)}%. You can keep playing.`;
    case 'ready': return 'Ready. Face someone on the street or indoors and press E to talk. Replies are written on this device; nothing you type is sent anywhere.';
    case 'unsupported': return `Not available here: ${message} It needs WebGPU on a graphics card, as in current desktop Chrome or Edge.`;
    case 'error': return `The resident model stopped: ${message} Turn it off and on to try again.`;
  }
  return `${message ? `${message} ` : ''}Chat with people on the street and indoors, written live by a small AI model on your graphics card. Turning this on downloads about ${(RESIDENT_MODELS[size] ?? RESIDENT_MODELS.small).download} once${touch ? '; phones and tablets may run out of memory' : ''}. Story contacts keep their own dialogue.`;
}
function bindSettings(model, touch) {
  const toggle = $('resident-chat-toggle'), size = $('resident-chat-model'), note = $('resident-chat-note'), forget = $('resident-chat-forget');
  toggle.addEventListener('change', () => model.setEnabled(toggle.checked));
  size.addEventListener('change', () => model.setSize(size.value));
  forget.addEventListener('click', () => model.forget());
  model.subscribe(state => {
    toggle.checked = state.enabled; size.value = state.size; note.textContent = settingsNote(state, touch);
    forget.classList.toggle('hidden', !state.downloaded || ['checking', 'loading'].includes(state.status));
  });
}

/**
 * Talking to background residents: the pause-menu setting, the model and the
 * conversation panel. The engine asks `prompt()` for the E prompt and calls
 * `open()`; a mode's own characters come first and never reach this.
 */
export function createResidentChat({ ui, hud, storage, voice = null, touch = false, playing = () => true, model = new ResidentModel({ storage }) }) {
  ui.register('resident-chat');
  let conversation = null, wasReady = model.ready;
  const view = createView({ touch,
    onSay: line => { if (conversation.busy || !String(line ?? '').trim()) return false; conversation.say(line); return true; },
    onClose: () => ui.close(),
    onReplay: () => voice?.replay(),
    onVoice: () => { if (!voice) return; voice.setEnabled(!voice.enabled); if (voice.enabled) voice.replay(); } });
  conversation = new ResidentConversation({ model, view, voice });
  voice?.subscribe(state => view.voice(state));
  bindSettings(model, touch);
  model.subscribe(state => {
    if (state.status === 'ready' && !wasReady && playing()) hud.notify('RESIDENTS // Conversations ready. Face someone and press E to talk.', 5);
    wasReady = state.status === 'ready';
    view.status(state);
  });
  return {
    model, conversation,
    get ready() { return model.ready; },
    get open() { return !!conversation.persona; },
    /** Load the model when play starts, if the player turned it on. */
    wake() { model.load(); },
    prompt: (resident, time) => ({ caption: residentPersona(resident, { time }).title.toUpperCase(), label: 'Talk' }),
    open(resident, time) { ui.open('resident-chat'); conversation.open(residentPersona(resident, { time })); },
    /** A menu opened or closed: anything but this panel ends the conversation. */
    onMenu(id) { if (id !== 'resident-chat') conversation.close(); },
    snapshot: () => ({ ...model.snapshot(), conversation: conversation.snapshot() }),
  };
}
