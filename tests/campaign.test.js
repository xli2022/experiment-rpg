import test from 'node:test';
import assert from 'node:assert/strict';
import { Campaign, freshProgress, restoreProgress, readSave, writeSave, SAVE_KEY } from '../src/campaign.js';
import { QUESTS, WORLD_OBJECTS, MEMORIES, CACHES, CONTACTS, DISTRICTS, ENCOUNTERS, UPGRADES, ENDINGS, placeById, districtAt } from '../src/content.js';
import { dialogueFor, endingScene } from '../src/dialogue.js';

function completeStep(game, questId, ending = 'free', records = 'public') {
  const step = game.current(questId);
  assert.ok(step, `${questId} has an active step`);
  if (step.type === 'choice') assert.equal(game.decide(step.target, step.target === 'ending' ? ending : records), true);
  else if (step.type === 'kill') {
    const e = ENCOUNTERS.find(e => e.id === step.target);
    e.positions.forEach((_, i) => game.recordKill(`${e.id}-${i}`, e.id));
  } else if (step.type === 'salvage') CACHES.slice(0, 2).forEach(c => game.collect(c.id));
  else if (step.type === 'memories') MEMORIES.slice(0, 3).forEach(m => game.collect(m.id));
  else if (step.type === 'districts') DISTRICTS.forEach(d => game.discover(d.id));
  else game.event(step.type, step.target, questId);
}

for (const ending of Object.keys(ENDINGS)) for (const records of ['public', 'protected']) {
  test(`complete campaign: ${records} evidence -> ${ending} ending, with save/reload between chapters`, () => {
    let game = new Campaign();
    for (const q of QUESTS.filter(q => q.kind === 'story')) {
      assert.equal(game.status(q.id), 'active', q.id);
      let iterations = 0;
      while (game.current(q.id)) { completeStep(game, q.id, ending, records); assert.ok(++iterations <= q.steps.length); }
      assert.equal(game.status(q.id), 'complete');
      game = new Campaign(JSON.parse(JSON.stringify(game.data)));
    }
    assert.equal(game.data.ending, ending); assert.equal(game.data.choices.records, records);
    const credits = game.data.credits;
    assert.equal(game.decide('ending', ending), false); game.event('talk', 'mara');
    assert.equal(game.data.credits, credits, 'completed chapters cannot pay twice');
    assert.equal(game.data.tracked, null);
  });
}

test('dialogue advances only the selected job and provides authored replies for every talk step', () => {
  for (const quest of QUESTS) for (let i = 0; i < quest.steps.length; i++) {
    const step = quest.steps[i]; if (step.type !== 'talk') continue;
    const progress = freshProgress(); progress.quests[quest.id] = { status: 'active', step: i, runs: 0 };
    const game = new Campaign(progress), dialogue = dialogueFor(game, step.target);
    const choice = dialogue.choices.find(c => c.quest === quest.id && c.kind === 'talk');
    assert.ok(choice && choice.reply.length > 80, `${quest.id} step ${i} has an authored reply`);
  }
  const game = new Campaign(); game.accept('voices'); MEMORIES.slice(0, 3).forEach(m => game.collect(m.id));
  game.event('talk', 'mara', 'dead-air');
  assert.equal(game.current('dead-air').target, 'trace'); assert.equal(game.status('voices'), 'active');
});

test('all side stories complete, and only the delivery contract can be repeated', () => {
  for (const q of QUESTS.filter(q => q.kind !== 'story')) {
    const game = new Campaign(); assert.equal(game.accept(q.id), true);
    let count = 0;
    while (game.current(q.id)) { completeStep(game, q.id); assert.ok(++count <= q.steps.length); }
    assert.equal(game.status(q.id), 'complete', q.id);
    assert.equal(game.accept(q.id), !!q.repeatable);
    if (q.repeatable) {
      assert.equal(game.current(q.id).target, 'parcel');
      game.event('interact', 'board'); assert.equal(game.current(q.id).target, 'parcel', 'must do the route again');
      game.event('interact', 'parcel'); game.event('interact', 'board'); assert.equal(game.data.quests[q.id].runs, 2);
    }
  }
});

test('exploration and patrols done before accepting a quest still count; salvage is reserved once', () => {
  const game = new Campaign();
  ENCOUNTERS.find(e => e.id === 'freight').positions.forEach((_, i) => game.recordKill(`freight-${i}`, 'freight'));
  game.accept('freight'); assert.equal(game.current('freight').target, 'freight-manifest');
  const credits = game.data.credits; assert.equal(game.recordKill('freight-0', 'freight'), false); assert.equal(game.data.credits, credits);
  for (const m of MEMORIES.slice(0, 3)) game.collect(m.id);
  game.accept('voices'); assert.equal(game.current('voices').target, 'mara');
  game.collect(CACHES[0].id); assert.equal(game.data.salvage, 6);
  game.accept('spare-parts'); assert.equal(game.data.salvage, 0); assert.equal(game.current('spare-parts').target, 'rook');
  game.reconcile(); assert.equal(game.data.salvage, 0);
});

test('invalid or out-of-order actions cannot unlock chapters or grant rewards', () => {
  const game = new Campaign();
  assert.equal(game.accept('undertow'), false); assert.equal(game.decide('ending', 'free'), false); assert.equal(game.decide('records', 'public'), false);
  game.event('interact', 'trace'); assert.equal(game.current('dead-air').type, 'talk');
  assert.equal(game.collect('mara'), false); assert.equal(game.recordKill('fake', 'ridge'), false);
  assert.equal(game.unlockTransit('mara'), false); assert.equal(game.track('before-dawn'), false);
  assert.equal(game.data.credits, 1250);
});

test('upgrades consume currency and salvage, respect tier limits and alter gameplay stats', () => {
  const game = new Campaign(); assert.equal(game.buyUpgrade('damage'), false);
  game.data.credits = 20000; game.data.salvage = 40;
  for (const u of UPGRADES) {
    const price = game.upgradePrice(u.id), credits = game.data.credits, parts = game.data.salvage;
    assert.equal(game.buyUpgrade(u.id), true); assert.equal(game.data.credits, credits - price.credits); assert.equal(game.data.salvage, parts - price.salvage);
    assert.equal(game.buyUpgrade(u.id), true); assert.equal(game.buyUpgrade(u.id), true); assert.equal(game.buyUpgrade(u.id), false);
  }
  assert.equal(game.damage, 64); assert.equal(game.maxArmor, 125); assert.equal(game.sprintSpeed, 9);
  const price = game.upgradePrice('damage').credits; game.data.reputation.community = 30;
  assert.ok(game.upgradePrice('damage').credits < price);
  assert.equal(game.buyUpgrade('fake'), false);
});

test('medkits cannot be wasted at full health, bought without funds, or exceed shop capacity', () => {
  const game = new Campaign(); assert.equal(game.useMedkit(100), 0); assert.equal(game.data.medkits, 2);
  assert.equal(game.useMedkit(80), 20); assert.equal(game.useMedkit(10), 60); assert.equal(game.useMedkit(10), 0);
  game.data.credits = 0; assert.equal(game.buyMedkit(), false);
  game.data.credits = 10000; for (let i = 0; i < 9; i++) assert.equal(game.buyMedkit(), true);
  assert.equal(game.buyMedkit(), false); assert.equal(game.data.medkits, 9);
});

test('saves round-trip and gracefully recover from malformed, unavailable and unknown-version storage', () => {
  const items = new Map(), storage = { getItem: key => items.get(key), setItem: (key, value) => items.set(key, value) };
  const game = new Campaign(); game.event('talk', 'mara'); game.collect('cache-0'); game.unlockTransit('metro-neon'); game.accept('letters');
  assert.equal(writeSave(storage, game.data, { x: 12, z: -30 }), true);
  const restored = readSave(storage); assert.equal(restored.loaded, true); assert.deepEqual(restored.progress, game.data); assert.deepEqual(restored.position, { x: 12, z: -30 });
  items.set(SAVE_KEY, '{broken'); assert.ok(readSave(storage).warning);
  items.set(SAVE_KEY, JSON.stringify({ version: 99 })); assert.equal(readSave(storage).loaded, false);
  const denied = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.equal(writeSave(denied, game.data, { x: 0, z: 0 }), false); assert.ok(readSave(denied).warning);
});

test('save validation rejects unknown IDs and sanitizes nonfinite values and impossible counts', () => {
  const p = restoreProgress({ credits: -999, xp: NaN, salvage: Infinity, upgrades: { damage: 500, armor: -1 }, ending: 'bogus', collected: ['lore-radio', 'lore-radio', 'fake'], transit: ['mara'], kills: ['fake'], quests: { 'dead-air': { status: 'active', step: 500 }, fake: { status: 'complete' } } });
  assert.equal(p.credits, 0); assert.equal(p.xp, 0); assert.equal(p.salvage, 0); assert.equal(p.upgrades.damage, 3);
  assert.equal(p.ending, null); assert.deepEqual(p.collected, ['lore-radio']); assert.deepEqual(p.transit, []); assert.equal(p.quests['dead-air'].step, 2); assert.equal(p.quests.fake, undefined);
});

test('all quest destinations, contacts and map pins resolve inside the playable world', () => {
  assert.equal(new Set(WORLD_OBJECTS.map(p => p.id)).size, WORLD_OBJECTS.length);
  assert.equal(new Set(MEMORIES.map(m => districtAt(m.x, m.z).id)).size, 8, 'every district has a memory to discover');
  for (const p of WORLD_OBJECTS) { assert.ok(Math.abs(p.x) < 275 && Math.abs(p.z) < 275); assert.ok(p.name && p.type); }
  for (const q of QUESTS) {
    assert.ok(placeById(q.giver));
    for (const step of q.steps) if (['talk', 'interact'].includes(step.type)) assert.ok(placeById(step.target));
  }
  for (const c of CONTACTS) assert.ok(dialogueFor(new Campaign(), c.id).choices.length >= 3);
  assert.equal(endingScene().choices.filter(c => c.kind === 'decision').length, 3);
  const game = new Campaign(); game.pin = 'rook'; assert.equal(game.objective().label, 'Rook'); assert.equal(game.objective().pinned, true);
});
