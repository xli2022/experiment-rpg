import { QUESTS, WORLD_OBJECTS, DISTRICTS, UPGRADES, ENCOUNTERS, ENDINGS, questById, placeById } from './content.js';

export const SAVE_KEY = 'afterlight.last-signal.v1';
export const SAVE_VERSION = 1;
const integer = (value, fallback = 0, max = 1000000) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback;
const uniqueKnown = (value, allowed) => Array.isArray(value) ? [...new Set(value.filter(v => allowed.includes(v)))] : [];
const droneIds = ENCOUNTERS.flatMap(e => e.positions.map((_, i) => `${e.id}-${i}`));

export function freshProgress() {
  return {
    credits: 1250, xp: 0, salvage: 0, medkits: 2, upgrades: { damage: 0, armor: 0, sprint: 0 },
    reputation: { community: 0, helix: 0 }, quests: { 'dead-air': { status: 'active', step: 0, runs: 0 } },
    tracked: 'dead-air', collected: [], discovered: ['neon'], transit: [], met: [], kills: [], cleared: [],
    choices: {}, ending: null, elapsed: 0, rest: 'home',
  };
}

// Treat stored data as untrusted: whitelist IDs and bound every number used by gameplay.
export function restoreProgress(raw) {
  const data = freshProgress();
  if (!raw || typeof raw !== 'object') return data;
  for (const key of ['credits', 'xp', 'salvage', 'medkits', 'elapsed']) data[key] = integer(raw[key], data[key]);
  for (const upgrade of UPGRADES) data.upgrades[upgrade.id] = integer(raw.upgrades?.[upgrade.id], 0, upgrade.max);
  for (const faction of ['community', 'helix']) data.reputation[faction] = integer(raw.reputation?.[faction], 0, 100);
  data.collected = uniqueKnown(raw.collected, WORLD_OBJECTS.filter(p => ['cache', 'memory'].includes(p.type)).map(p => p.id));
  data.discovered = uniqueKnown(raw.discovered, DISTRICTS.map(d => d.id));
  if (!data.discovered.includes('neon')) data.discovered.unshift('neon');
  data.transit = uniqueKnown(raw.transit, WORLD_OBJECTS.filter(p => p.type === 'transit').map(p => p.id));
  data.met = uniqueKnown(raw.met, WORLD_OBJECTS.filter(p => p.type === 'contact').map(p => p.id));
  data.kills = uniqueKnown(raw.kills, droneIds);
  data.cleared = uniqueKnown(raw.cleared, ENCOUNTERS.map(e => e.id));
  if (['public', 'protected'].includes(raw.choices?.records)) data.choices.records = raw.choices.records;
  if (Object.hasOwn(ENDINGS, raw.ending)) data.ending = raw.ending;
  if (['home', 'garden-rest'].includes(raw.rest)) data.rest = raw.rest;
  for (const q of QUESTS) {
    const saved = raw.quests?.[q.id];
    if (!saved || !['active', 'complete'].includes(saved.status)) continue;
    data.quests[q.id] = { status: saved.status, step: saved.status === 'complete' ? q.steps.length : integer(saved.step, 0, q.steps.length - 1), runs: integer(saved.runs) };
  }
  // Recover a missing next chapter from otherwise valid older/incomplete saves.
  for (const q of QUESTS) if (data.quests[q.id]?.status === 'complete' && q.next && !data.quests[q.next]) data.quests[q.next] = { status: 'active', step: 0, runs: 0 };
  data.tracked = data.quests[raw.tracked]?.status === 'active' ? raw.tracked : Object.keys(data.quests).find(id => data.quests[id].status === 'active') ?? null;
  return data;
}

export function readSave(storage) {
  try {
    const text = storage.getItem(SAVE_KEY);
    if (!text) return { progress: freshProgress(), position: null, loaded: false };
    const save = JSON.parse(text);
    if (save.version !== SAVE_VERSION || !save.progress || typeof save.progress !== 'object') throw new Error('Unsupported save');
    const p = save.position;
    const position = p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) < 280 && Math.abs(p.z) < 280 ? { x: p.x, z: p.z } : null;
    return { progress: restoreProgress(save.progress), position, loaded: true };
  } catch {
    return { progress: freshProgress(), position: null, loaded: false, warning: 'Saved progress could not be loaded. This session starts fresh.' };
  }
}

export function writeSave(storage, progress, position) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, progress, position: { x: position.x, z: position.z } }));
    return true;
  } catch { return false; }
}

export class Campaign {
  constructor(progress = freshProgress()) {
    this.data = restoreProgress(progress); this.messages = []; this.revision = 0; this.pin = null;
  }
  changed(message) { this.revision++; if (message) this.messages.push(message); }
  status(id) { return this.data.quests[id]?.status ?? (questById(id)?.kind === 'story' ? 'locked' : 'available'); }
  current(id) { const q = questById(id), p = this.data.quests[id]; return p?.status === 'active' ? q.steps[p.step] : null; }
  activeSteps() { return QUESTS.filter(q => this.status(q.id) === 'active').map(q => ({ quest: q, step: this.current(q.id) })); }
  accept(id) {
    const q = questById(id);
    if (!q || q.kind === 'story' || !['available', 'complete'].includes(this.status(id)) || (this.status(id) === 'complete' && !q.repeatable)) return false;
    const runs = this.data.quests[id]?.runs ?? 0;
    this.data.quests[id] = { status: 'active', step: 0, runs };
    this.track(id); this.changed(`JOB ACCEPTED // ${q.title}`); this.reconcile(); return true;
  }
  track(id) {
    if (this.status(id) !== 'active') return false;
    this.data.tracked = id; this.pin = null; this.changed(); return true;
  }
  advance(id) {
    const p = this.data.quests[id], q = questById(id);
    if (!p || p.status !== 'active') return;
    p.step++;
    if (p.step < q.steps.length) { this.changed(`OBJECTIVE UPDATED // ${q.steps[p.step].text}`); return; }
    p.status = 'complete'; p.runs++;
    this.data.credits += q.reward; this.data.xp += q.xp; this.data.medkits += q.medkits ?? 0;
    if (q.faction) this.data.reputation[q.faction] = Math.min(100, this.data.reputation[q.faction] + 10);
    this.changed(`COMPLETED // ${q.title} · +${q.reward} credits · +${q.xp} XP`);
    if (q.next && !this.data.quests[q.next]) this.data.quests[q.next] = { status: 'active', step: 0, runs: 0 };
    if (this.data.tracked === id) this.data.tracked = q.next ?? QUESTS.find(other => this.status(other.id) === 'active')?.id ?? null;
  }
  event(type, target, questId = null) {
    // Snapshot the eligible steps. A conversation cannot skip two steps or two chapters.
    const eligible = this.activeSteps().filter(({ quest, step }) => (!questId || quest.id === questId) && step.type === type && step.target === target);
    for (const { quest } of eligible) this.advance(quest.id);
    this.reconcile();
  }
  progressCount(step) {
    if (step.type === 'kill') return this.data.kills.filter(id => id.startsWith(`${step.target}-`)).length;
    if (step.type === 'memories') return this.data.collected.filter(id => id.startsWith('lore-')).length;
    if (step.type === 'districts') return this.data.discovered.length;
    if (step.type === 'salvage') return this.data.salvage;
    return 0;
  }
  reconcile() {
    for (const { quest, step } of this.activeSteps()) {
      if (!['kill', 'memories', 'districts', 'salvage'].includes(step.type) || this.progressCount(step) < step.count) continue;
      if (step.type === 'salvage') this.data.salvage -= step.count;
      this.advance(quest.id);
    }
  }
  meet(id) {
    if (!this.data.met.includes(id)) { this.data.met.push(id); this.changed(); }
  }
  decide(key, value) {
    if (key === 'records' && ['public', 'protected'].includes(value) && this.current('paper-ghosts')?.type === 'choice') {
      this.data.choices.records = value;
      const faction = value === 'public' ? 'community' : 'helix';
      this.data.reputation[faction] = Math.min(100, this.data.reputation[faction] + 20);
      this.event('choice', 'records'); return true;
    }
    if (key === 'ending' && Object.hasOwn(ENDINGS, value) && this.current('before-dawn')?.type === 'choice' && !this.data.ending) {
      this.data.ending = value;
      if (value === 'together') this.data.reputation.community = Math.max(40, this.data.reputation.community);
      if (value === 'order') this.data.reputation.helix = Math.max(40, this.data.reputation.helix);
      this.event('choice', 'ending'); this.changed(`THE LAST SIGNAL // ${ENDINGS[value].name}`); return true;
    }
    return false;
  }
  collect(id) {
    const item = placeById(id);
    if (!item || !['cache', 'memory'].includes(item.type) || this.data.collected.includes(id)) return false;
    this.data.collected.push(id);
    if (item.type === 'cache') { this.data.salvage += 3; this.data.credits += 65; this.changed('SALVAGE FOUND // +3 components · +65 credits'); }
    else { this.data.xp += 60; this.changed(`MEMORY RECOVERED // ${item.name} · +60 XP`); }
    this.reconcile(); return true;
  }
  discover(id) {
    if (this.data.discovered.includes(id) || !DISTRICTS.some(d => d.id === id)) return false;
    this.data.discovered.push(id); this.data.xp += 80;
    this.changed(`DISTRICT DISCOVERED // ${DISTRICTS.find(d => d.id === id).name} · +80 XP`); this.reconcile(); return true;
  }
  unlockTransit(id) {
    if (placeById(id)?.type !== 'transit' || this.data.transit.includes(id)) return false;
    this.data.transit.push(id); this.changed(`TRANSIT ONLINE // ${placeById(id).name}`); return true;
  }
  recordKill(id, group) {
    if (!droneIds.includes(id) || this.data.kills.includes(id)) return false;
    this.data.kills.push(id); this.data.credits += 75; this.data.xp += 35; this.data.salvage++;
    this.changed('ROGUE DISABLED // +75 credits · +1 component');
    const encounter = ENCOUNTERS.find(e => e.id === group);
    if (encounter && this.data.kills.filter(k => k.startsWith(`${group}-`)).length === encounter.positions.length && !this.data.cleared.includes(group)) {
      this.data.cleared.push(group); this.data.credits += 200; this.data.xp += 120;
      this.changed(`STREETS RECLAIMED // ${encounter.name} · +200 credits`);
    }
    this.reconcile(); return true;
  }
  upgradePrice(id) {
    const item = UPGRADES.find(u => u.id === id);
    if (!item) return null;
    return { credits: Math.round(item.cost * (1 + this.data.upgrades[id] * .65) * (this.data.reputation.community >= 30 ? .85 : 1)), salvage: item.salvage };
  }
  buyUpgrade(id) {
    const upgrade = UPGRADES.find(u => u.id === id), price = this.upgradePrice(id);
    if (!upgrade || this.data.upgrades[id] >= upgrade.max || this.data.credits < price.credits || this.data.salvage < price.salvage) return false;
    this.data.credits -= price.credits; this.data.salvage -= price.salvage; this.data.upgrades[id]++;
    this.changed(`UPGRADE INSTALLED // ${upgrade.name} · tier ${this.data.upgrades[id]}`); return true;
  }
  buyMedkit() {
    const price = this.data.reputation.community >= 20 ? 90 : 120;
    if (this.data.credits < price || this.data.medkits >= 9) return false;
    this.data.credits -= price; this.data.medkits++; this.changed('FIELD MEDKIT // Added to your pack'); return true;
  }
  useMedkit(health) {
    if (health >= 100 || this.data.medkits < 1) return 0;
    this.data.medkits--; this.changed('FIELD MEDKIT // +60 health'); return Math.min(60, 100 - health);
  }
  get maxArmor() { return 50 + this.data.upgrades.armor * 25; }
  get damage() { return 34 + this.data.upgrades.damage * 10; }
  get sprintSpeed() { return 6.6 + this.data.upgrades.sprint * .8; }
  get completed() { return QUESTS.filter(q => this.status(q.id) === 'complete').length; }
  objective(player = { x: 0, z: 0 }) {
    if (this.pin) { const p = placeById(this.pin); if (p) return { ...p, label: p.name, text: 'Custom destination', pinned: true }; }
    const q = questById(this.data.tracked), step = q && this.current(q.id);
    if (!step) return { x: 0, z: 0, hidden: true, label: 'Explore Vesper', text: 'Find stories, memories and unclaimed streets.' };
    let target = step.target;
    if (step.type === 'choice') target = step.target === 'records' ? 'sable' : 'uplink';
    if (step.type === 'kill') {
      const encounter = ENCOUNTERS.find(e => e.id === step.target);
      const remaining = encounter.positions.map(([x, z], i) => ({ x, z, id: `${encounter.id}-${i}` })).filter(d => !this.data.kills.includes(d.id));
      const nearest = remaining.sort((a, b) => Math.hypot(player.x - a.x, player.z - a.z) - Math.hypot(player.x - b.x, player.z - b.z))[0];
      if (nearest) return { ...nearest, label: encounter.name, text: `${step.text} (${this.progressCount(step)}/${step.count})`, quest: q };
    }
    if (['memories', 'salvage', 'districts'].includes(step.type)) {
      const candidates = step.type === 'districts' ? DISTRICTS.filter(d => !this.data.discovered.includes(d.id)) : WORLD_OBJECTS.filter(p => p.type === (step.type === 'memories' ? 'memory' : 'cache') && !this.data.collected.includes(p.id));
      const nearest = [...candidates].sort((a, b) => Math.hypot(player.x - a.x, player.z - a.z) - Math.hypot(player.x - b.x, player.z - b.z))[0];
      return { ...(nearest ?? player), label: nearest?.name ?? 'Explore the city', text: `${step.text} (${this.progressCount(step)}/${step.count})`, quest: q };
    }
    const place = placeById(target);
    return { ...(place ?? player), label: place?.name ?? q.title, text: step.text, quest: q };
  }
}
