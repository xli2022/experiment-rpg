import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES } from '../src/modes/index.js';
import { modeCards } from '../src/engine/mode-picker.js';
import { LAST_MODE_KEY, createStorage } from '../src/engine/save.js';
import { readProgress } from '../src/modes/free-roam/index.js';
import { chapterSummary } from '../src/modes/story/index.js';
import { freshProgress, writeSave } from '../src/modes/story/campaign.js';
import { WORLD_LIMIT, WORLD_REVISION } from '../src/world/world-config.js';

const memory = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; };

test('every registered mode satisfies the plug-in contract', () => {
  assert.deepEqual(MODES.map(m => m.id), ['free-roam', 'story']);
  assert.equal(new Set(MODES.map(m => m.id)).size, MODES.length);
  for (const mode of MODES) {
    assert.ok(mode.title && mode.tagline && mode.description && /^#[0-9a-f]{6}$/i.test(mode.accent), `${mode.id} describes itself for the picker`);
    assert.equal(typeof mode.create, 'function');
    assert.equal(mode.saveSummary(memory()), null, `${mode.id} reports no save in an empty browser`);
  }
});

test('picker save summaries come from each mode’s own save slot', () => {
  const storage = memory(), mode = id => MODES.find(m => m.id === id);
  writeSave(storage, { ...freshProgress(), elapsed: 3900 }, { x: 0, y: 0, z: 0 });
  assert.equal(mode('story').saveSummary(storage), 'Chapter 01 · Dead air · 1 h 5 min');
  assert.equal(mode('free-roam').saveSummary(storage), null, 'free roam ignores the story save');
  storage.setItem('afterlight.free-roam.v1', JSON.stringify({ version: 1, worldRevision: WORLD_REVISION, position: { x: 1, y: 2, z: 3 }, time: 60, districts: ['core', 'core', 'citadel'], buildings: ['a'] }));
  assert.equal(mode('free-roam').saveSummary(storage), '2 districts · 1 buildings entered');
  storage.setItem('afterlight.free-roam.v1', '{broken');
  assert.equal(mode('free-roam').saveSummary(storage), null, 'a corrupt slot reads as no save');
  assert.equal(chapterSummary({ ...freshProgress(), ending: 'free', elapsed: 600 }), 'Epilogue · 10 min');
});

test('free roam is the first card and the default until another mode is played', () => {
  const storage = memory(), preferred = html => html.match(/<article class="mode-card preferred"[^>]*data-mode="([^"]+)"/)[1];
  const cards = modeCards(MODES, storage);
  assert.deepEqual([...cards.matchAll(/data-mode="([^"]+)"/g)].map(m => m[1]), ['free-roam', 'story']);
  assert.equal(preferred(cards), 'free-roam');
  assert.match(cards, /id="start-button" data-mode-start="free-roam"/);
  storage.setItem(LAST_MODE_KEY, 'story');
  assert.equal(preferred(modeCards(MODES, storage)), 'story', 'the last played mode stays preselected');
});

test('blocked or full browser storage never stops the game; writes report failure but last the session', () => {
  const failing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
  const storage = createStorage(failing);
  assert.equal(storage.getItem(LAST_MODE_KEY), null);
  assert.throws(() => storage.setItem(LAST_MODE_KEY, 'story'), /Storage unavailable/, 'callers can warn that progress is session-only');
  assert.equal(storage.getItem(LAST_MODE_KEY), 'story', 'the value still lasts for this session');
  assert.doesNotThrow(() => storage.removeItem(LAST_MODE_KEY));
  // Blocked site data makes reading window.localStorage itself throw.
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    const blocked = createStorage();
    assert.equal(blocked.getItem('afterlight.free-roam.v1'), null);
    assert.equal(MODES.find(m => m.id === 'free-roam').saveSummary(blocked), null);
    assert.throws(() => blocked.setItem('k', 'v'), /Storage unavailable/);
    assert.equal(blocked.getItem('k'), 'v');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
});

test('free roam only resumes at positions inside the current city', () => {
  const storage = memory(), save = position => storage.setItem('afterlight.free-roam.v1', JSON.stringify({ version: 1, worldRevision: WORLD_REVISION, position, time: 5, districts: ['core'], buildings: [] }));
  save({ x: 10, y: 4, z: -20 });
  assert.deepEqual(readProgress(storage).position, { x: 10, y: 4, z: -20 });
  for (const outside of [{ x: WORLD_LIMIT + 50, y: 4, z: 0 }, { x: 0, y: 4, z: -WORLD_LIMIT - 1 }, { x: 0, y: 9000, z: 0 }, { x: 0, y: -500, z: 0 }]) {
    save(outside);
    const progress = readProgress(storage);
    assert.equal(progress.position, null, `rejects ${JSON.stringify(outside)}`);
    assert.deepEqual(progress.districts, ['core'], 'the rest of the save is kept');
  }
});
