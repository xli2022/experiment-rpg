import { residentPersona, chatMessages, cleanReply, previewReply, fallbackReply } from './persona.js';
import { Vector3 } from 'three';
import { ResidentModel, RESIDENT_MODEL } from './model.js';
import { decisionFormat, decisionMessages, parseDecision, preliminaryDecision } from './decisions.js';

const $ = id => document.getElementById(id);
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
 * One conversation at a time, starting with the player's first message.
 * Replies stream in from the model and are cleaned up before they stay on
 * screen and are spoken; a failed or unusable reply becomes a short fallback
 * line in the resident's voice. Saying something new or leaving stops the
 * speech and the reply being written. Nothing late reaches the next conversation.
 */
export class ResidentConversation {
  constructor({ model, view, voice = null }) {
    Object.assign(this, { model, view, voice });
    this.persona = null; this.history = []; this.turns = 0; this.serial = 0; this.busy = false;
  }
  open(persona, actions = null) {
    this.close();
    this.persona = persona; this.actions = actions; this.lastAction = null; this.pendingAction = null;
    this.view.show(persona);
    this.view.reply('', false);
  }
  async say(line) {
    const text = String(line ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE), persona = this.persona;
    if (!persona || this.busy || !text) return null;
    const serial = ++this.serial, current = () => serial === this.serial;
    this.voice?.stop();
    this.busy = true; this.view.reply('', true);
    const structured = !!(this.actions && this.model.supportsActions);
    let reply = null, decision = null;
    try {
      const context = structured ? this.actions.context() : null;
      const messages = structured ? decisionMessages(text, context) : chatMessages(persona, this.history, text);
      decision = structured ? preliminaryDecision(text) : null;
      const raw = decision ? null : await this.model.generate(messages, {
        ...(structured ? { responseFormat: decisionFormat(context) } : {}),
        onText: partial => { if (current() && !structured) this.view.reply(previewReply(partial, persona), true); },
      });
      if (structured) {
        decision ??= parseDecision(raw);
        if (decision?.action === 'none' && current()) {
          const speech = await this.model.generate(chatMessages(persona, this.history, text, context), { onText: partial => { if (current()) this.view.reply(previewReply(partial, persona), true); } });
          reply = cleanReply(speech, persona);
        }
      }
      else reply = cleanReply(raw, persona);
    } catch { /* A fallback line answers instead. */ }
    if (!current()) return null;
    if (decision && decision.action !== 'none') {
      // Validate without moving. Only the latest accepted request is queued;
      // a completed conversation rechecks it against the live world.
      let result;
      const request = ['guide', 'go_to'].includes(decision.action) ? decision : decision.action;
      try { result = this.actions.prepare(request); }
      catch { result = { ok: false, reply: 'I cannot do that right now.' }; }
      reply = result.reply;
      this.lastAction = { action: decision.action, ok: result.ok };
      if (result.ok) this.pendingAction = request;
    }
    reply ??= structured ? 'I did not catch that. Could you say it another way?' : fallbackReply(persona, this.turns);
    this.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    this.turns++; this.busy = false;
    this.view.reply(reply, false);
    this.voice?.speak(reply, persona.voice);
    return reply;
  }
  close() {
    if (this.busy) this.model.interrupt();
    if (this.persona) this.voice?.stop();
    this.serial++; this.busy = false; this.persona = null; this.actions = null; this.lastAction = null; this.pendingAction = null; this.history = []; this.turns = 0;
    this.view.hide?.();
  }
  finish() {
    const action = this.pendingAction, actions = this.actions;
    this.close();
    if (!action) return null;
    try { return actions.execute(action); }
    catch { return { ok: false, reply: 'I cannot do that right now.' }; }
  }
  snapshot() {
    const p = this.persona;
    return { open: !!p, name: p?.name ?? null, title: p?.title ?? null, busy: this.busy, turns: this.turns, lastAction: this.lastAction, pendingAction: this.pendingAction ?? null, history: this.history.map(m => ({ ...m })) };
  }
}

// World-anchored speech and a separate, non-modal composer.
function createView({ touch, onSay, onClose, onFocus }) {
  const root = $('resident-chat'), bubble = $('resident-bubble'), text = $('resident-text');
  const form = $('resident-form'), field = $('resident-input'), send = $('resident-send'), composer = root.querySelector('.resident-composer');
  root.querySelector('[data-resident="close"]').addEventListener('click', onClose);
  form.addEventListener('submit', event => { event.preventDefault(); if (onSay(field.value)) field.value = ''; });
  root.addEventListener('focusin', onFocus);
  const viewport = globalThis.visualViewport;
  function fitKeyboard() {
    const keyboard = touch && viewport && innerHeight - viewport.height > 120;
    root.classList.toggle('resident-keyboard', !!keyboard);
    if (keyboard) {
      root.style.setProperty('--keyboard-bottom', `${Math.max(0, innerHeight - viewport.height - viewport.offsetTop) + 8}px`);
      root.style.setProperty('--keyboard-height', `${Math.max(120, viewport.height - 16)}px`);
    }
  }
  viewport?.addEventListener('resize', fitKeyboard);
  viewport?.addEventListener('scroll', fitKeyboard);
  return {
    show(persona) {
      root.classList.remove('hidden'); document.body.classList.add('resident-chatting');
      fitKeyboard();
      $('resident-bubble-name').textContent = persona.name;
      text.textContent = ''; field.value = '';
      // Let the opening E key finish before typing; touch keeps its keyboard closed.
      if (!touch) setTimeout(() => { if (!root.classList.contains('hidden')) field.focus({ preventScroll: true }); });
    },
    hide() { root.classList.add('hidden'); document.body.classList.remove('resident-chatting'); bubble.style.visibility = 'hidden'; },
    focused: () => root.contains(document.activeElement),
    anchor(x, y, visible) {
      visible = visible && !!text.textContent;
      bubble.style.visibility = visible ? 'visible' : 'hidden';
      if (!visible) return;
      const half = bubble.offsetWidth / 2, left = Math.max(half + 12, Math.min(innerWidth - half - 12, x));
      const panel = composer.getBoundingClientRect();
      // Keep the reply readable on a short screen. Its tail still points to
      // the actor when the composer would otherwise cover the speech.
      const overlap = left + half > panel.left && left - half < panel.right;
      const bottom = Math.max(bubble.offsetHeight + 14, overlap ? Math.min(y, panel.top - 16) : y);
      bubble.style.left = `${left}px`; bubble.style.top = `${bottom}px`;
      bubble.style.setProperty('--tail-height', `${Math.max(11, y - bottom + 11)}px`);
      bubble.style.setProperty('--tail-x', `${Math.max(20, Math.min(bubble.offsetWidth - 20, x - left + half))}px`);
    },
    reply(line, pending) {
      // Screen readers announce the finished reply, not every word as it arrives.
      text.textContent = line || (pending ? 'Thinking…' : ''); text.classList.toggle('pending', pending); text.setAttribute('aria-busy', String(pending));
      send.disabled = pending;
    },
  };
}

/** The pause-menu note for the resident-chat setting. */
export function settingsNote({ status, progress, message }, touch = false) {
  switch (status) {
    case 'idle': return 'On. The resident model loads when you start playing.';
    case 'checking': return 'Checking your graphics card…';
    case 'loading': return `${message || 'Downloading'}… ${Math.round(progress * 100)}%. You can keep playing.`;
    case 'ready': return `Ready. Face a resident and ${touch ? 'tap USE' : 'press E'} to talk. Ask them to dance, lie down, get up, follow, wait, move aside, guide you somewhere, go to a place, or return to their routine. Agreed actions start after Bye. Replies stay on this device.`;
    case 'unsupported': return `Not available here: ${message} It needs WebGPU on a graphics card, as in current desktop Chrome or Edge.`;
    case 'error': return `The resident model stopped: ${message} Turn it off and on to try again.`;
  }
  return `${message ? `${message} ` : ''}Chat with people on the street and indoors, written live by Qwen3.5 2B on your graphics card. Turning this on downloads about ${RESIDENT_MODEL.download} once${touch ? '; phones and tablets may run out of memory' : ''}. Story contacts keep their own dialogue.`;
}
function bindSettings(model, touch) {
  const toggle = $('resident-chat-toggle'), note = $('resident-chat-note'), forget = $('resident-chat-forget');
  toggle.addEventListener('change', () => model.setEnabled(toggle.checked));
  forget.addEventListener('click', () => model.forget());
  model.subscribe(state => {
    toggle.checked = state.enabled; note.textContent = settingsNote(state, touch);
    forget.classList.toggle('hidden', !state.downloaded || ['checking', 'loading'].includes(state.status));
  });
}

/**
 * Talking to background residents: the pause-menu setting, the model and the
 * conversation panel. The engine asks `prompt()` for the E prompt and calls
 * `open()`; a mode's own characters come first and never reach this.
 */
export function createResidentChat({ hud, storage, voice = null, touch = false, playing = () => true, controls = {}, actions = null, model = new ResidentModel({ storage }) }) {
  let conversation = null, resident = null, wasReady = model.ready;
  const projected = new Vector3();
  function finish({ commit = true, focus = true } = {}) {
    if (!conversation.persona) return;
    const name = conversation.persona.name;
    actions?.talk(resident, false);
    resident = null;
    const result = commit ? conversation.finish() : (conversation.close(), null);
    controls.engage?.(false, focus);
    if (result) hud.notify(`${name} // ${result.ok ? result.status : result.reply}`, 4);
  }
  const view = createView({ touch,
    onSay: line => { if (conversation.busy || !String(line ?? '').trim()) return false; conversation.say(line); return true; },
    onClose: () => finish(),
    onFocus: () => controls.focus?.() });
  conversation = new ResidentConversation({ model, view, voice });
  bindSettings(model, touch);
  model.subscribe(state => {
    if (state.status === 'ready' && !wasReady && playing()) hud.notify('RESIDENTS // Conversations ready. Face someone and press E to talk.', 5);
    wasReady = state.status === 'ready';
  });
  return {
    model, conversation,
    get ready() { return model.ready; },
    get active() { return !!conversation.persona; },
    /** Load the model when play starts, if the player turned it on. */
    wake() { model.load(); },
    prompt: (resident, time) => ({ caption: residentPersona(resident, { time }).title.toUpperCase(), label: 'Talk' }),
    open(resident, time) {
      return start(resident, time);
    },
    finish,
    /** Menus finish chat; a scene reset instead cancels the queued request. */
    onMenu(id) { if (id) finish({ focus: false }); },
    update(player, camera) {
      if (!resident) return;
      const at = actions?.position(resident);
      if (!at) { finish({ commit: false, focus: view.focused() }); return; }
      if (Math.hypot(at.x - player.x, at.z - player.z) > 4.5 || Math.abs(at.y - player.y) > 1.3) { finish({ focus: view.focused() }); return; }
      projected.set(at.x, at.y + at.head, at.z).project(camera);
      view.anchor((projected.x + 1) * innerWidth / 2, (1 - projected.y) * innerHeight / 2, at.visible && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1);
    },
    snapshot: () => ({ ...model.snapshot(), conversation: conversation.snapshot() }),
  };
  function start(next, time) {
    finish({ focus: false });
    if (!model.ready || !playing() || actions && !actions.talk(next, true)) return null;
    resident = next;
    controls.engage?.(true);
    return conversation.open(residentPersona(next, { time }), actions ? {
      context: () => ({ ...actions.context(next), queued: conversation.pendingAction }),
      prepare: action => actions.prepare(next, action), execute: action => actions.execute(next, action),
    } : null);
  }
}
