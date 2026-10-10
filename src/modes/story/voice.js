import { VOICE_PROFILES } from '../../actors/npc-profiles.js';

export const VOICE_STORAGE_KEY = 'afterlight.voice.v1';
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

// Short utterances avoid engines dropping the end of long dialogue. Preserve
// every word, preferring sentence or clause boundaries when they fit.
export function speechChunks(text, limit = 180) {
  let remaining = String(text).replace(/\s+/g, ' ').trim(); const chunks = [];
  while (remaining.length > limit) {
    const head = remaining.slice(0, limit + 1);
    const breaks = [...head.matchAll(/[.!?;:,][”"']?\s/g)];
    const boundary = breaks.at(-1);
    let cut = boundary && boundary.index > limit / 3 ? boundary.index + boundary[0].trimEnd().length : head.lastIndexOf(' ');
    if (cut < 1) cut = limit;
    chunks.push(remaining.slice(0, cut).trim()); remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function selectVoice(voices, profile) {
  const english = voices.filter(v => /^en(?:[-_]|$)/i.test(v.lang)).sort((a, b) => Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name));
  for (const preferred of profile.preferred) {
    const name = new RegExp(`\\b${preferred}\\b`, 'i');
    const match = english.find(v => name.test(v.name));
    if (match) return match;
  }
  return english[profile.voiceSlot % english.length] ?? null;
}

export class DialogueVoice {
  constructor({ synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, storage, timers = globalThis } = {}) {
    this.synth = synth; this.Utterance = Utterance; this.storage = storage; this.timers = timers;
    this.supported = !!(synth?.speak && synth?.cancel && Utterance);
    this.enabled = true; this.volume = .8; this.listeners = new Set(); this.serial = 0; this.voices = [];
    this.status = this.supported ? 'ready' : 'unavailable'; this.message = this.supported ? 'Voice ready' : 'Voice unavailable in this browser · subtitles remain on';
    try {
      const settings = JSON.parse(storage?.getItem(VOICE_STORAGE_KEY) ?? 'null');
      if (typeof settings?.enabled === 'boolean') this.enabled = settings.enabled;
      if (Number.isFinite(settings?.volume)) this.volume = clamp(settings.volume, 0, 1);
    } catch { /* Storage is optional, including in private browsing. */ }
    this.refreshVoices = () => {
      try { this.voices = this.synth?.getVoices?.() ?? []; } catch { this.voices = []; }
      this.emit();
    };
    this.refreshVoices(); this.synth?.addEventListener?.('voiceschanged', this.refreshVoices);
  }
  snapshot() {
    return { supported: this.supported, enabled: this.enabled, volume: this.volume, status: this.status,
      message: !this.supported ? 'Voice unavailable in this browser · subtitles remain on' : !this.enabled || !this.volume ? 'Voice muted · subtitles on' : this.message,
      voiceName: this.voiceName ?? null, availableVoices: this.voices.length, contact: this.last?.id ?? null };
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener(this.snapshot()); }
  setStatus(status, message) { this.status = status; this.message = message; this.emit(); }
  saveSettings() { try { this.storage?.setItem(VOICE_STORAGE_KEY, JSON.stringify({ enabled: this.enabled, volume: this.volume })); } catch { /* Session settings still work. */ } }
  setEnabled(enabled) { this.enabled = !!enabled; if (!this.enabled) this.stop(); this.saveSettings(); this.emit(); }
  setVolume(volume) {
    if (!Number.isFinite(Number(volume))) return;
    this.volume = clamp(Number(volume), 0, 1); if (!this.volume) this.stop(); this.saveSettings(); this.emit();
  }
  clearWatchdog() { if (this.watchdog !== undefined) this.timers.clearTimeout(this.watchdog); this.watchdog = undefined; }
  stop() {
    this.serial++; this.clearWatchdog(); this.current = null;
    if (this.supported) { try { this.synth.cancel(); } catch { /* A missing service must never block dialogue. */ } }
    this.setStatus('stopped', 'Voice stopped · replay anytime');
  }
  replay() { if (this.last) this.speak(this.last.text, this.last.id); }
  speak(text, id) {
    this.stop(); this.last = { text, id };
    if (!this.supported || !this.enabled || !this.volume) { this.emit(); return; }
    const chunks = speechChunks(text), serial = this.serial;
    if (!chunks.length) return;
    const profile = VOICE_PROFILES[id] ?? VOICE_PROFILES.mara;
    const voice = selectVoice(this.voices, profile);
    this.voiceName = voice?.name ?? 'Browser default';
    const fail = message => {
      if (serial !== this.serial) return;
      this.stop(); this.setStatus('error', message);
    };
    const next = () => {
      if (serial !== this.serial) return;
      this.clearWatchdog();
      const chunk = chunks.shift();
      if (!chunk) { this.current = null; this.setStatus('finished', 'Line finished · replay anytime'); return; }
      try {
        const utterance = new this.Utterance(chunk); this.current = utterance;
        utterance.lang = voice?.lang ?? 'en-US'; if (voice) utterance.voice = voice;
        utterance.pitch = profile.pitch; utterance.rate = profile.rate; utterance.volume = this.volume;
        utterance.onstart = () => {
          if (serial !== this.serial || this.current !== utterance) return;
          this.clearWatchdog(); this.setStatus('speaking', 'Speaking · subtitles on');
          this.watchdog = this.timers.setTimeout(() => fail('Voice paused by the device · try Replay'), Math.max(20000, chunk.length * 180 / profile.rate));
        };
        utterance.onend = () => { if (serial === this.serial && this.current === utterance) next(); };
        utterance.onerror = event => {
          if (serial !== this.serial || this.current !== utterance) return;
          fail(event.error === 'not-allowed' ? 'Playback blocked · select Replay to start voice' : 'Voice service unavailable · try Replay or continue reading');
        };
        this.setStatus('starting', 'Starting voice…');
        this.watchdog = this.timers.setTimeout(() => fail('No voice response · try Replay or continue reading'), 7000);
        this.synth.speak(utterance);
      } catch { fail('Voice service unavailable · try Replay or continue reading'); }
    };
    next();
  }
  dispose() { this.stop(); this.synth?.removeEventListener?.('voiceschanged', this.refreshVoices); this.listeners.clear(); }
}
