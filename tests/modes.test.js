import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES } from '../src/modes/index.js';
import { modeCards } from '../src/engine/mode-picker.js';
import { LAST_MODE_KEY } from '../src/engine/save.js';
import { chapterSummary } from '../src/modes/story/index.js';
import { freshProgress, writeSave } from '../src/modes/story/campaign.js';
import { WORLD_REVISION } from '../src/world/world-config.js';

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
