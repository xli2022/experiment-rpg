import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_LIMIT } from '../src/world/world-config.js';
import { Campaign, writeSave, readSave } from '../src/modes/story/campaign.js';

test('saves retain metropolitan positions and still read original city saves', () => {
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  for (const position of [{ x: -2.5, z: 30 }, { x: WORLD_LIMIT - 500, z: -WORLD_LIMIT + 600 }]) {
    writeSave(storage, new Campaign().data, position); assert.deepEqual(readSave(storage).position, position);
  }
  writeSave(storage, new Campaign().data, { x: WORLD_LIMIT + 5, z: 0 }); assert.equal(readSave(storage).position, null);
});
