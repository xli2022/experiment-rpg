import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

// Run with Vite serving the repository. Uses real WebGL/image decoding; the
// Node rig tests separately verify locomotion blends and exported loop seams.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = new URL('../test-results/characters/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning' && /THREE\.|Could not load/.test(message.text())) errors.push(message.text());
  });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.goto(new URL('tools/characters.html', process.env.CHARACTERS_URL || 'http://127.0.0.1:5173/').href);
  await page.waitForFunction(() => window.__CHARACTER_STUDIO__, { timeout: 90000 });
  const collections = await page.evaluate(() => window.__CHARACTER_STUDIO__.collections);
  for (const [collection, ids] of Object.entries(collections)) {
    for (let index = 0; index < Math.ceil(ids.length / 4); index++) {
      await page.evaluate(({ collection, index }) => window.__CHARACTER_STUDIO__.show(collection, index), { collection, index });
      const clips = await page.evaluate(() => window.__CHARACTER_STUDIO__.clips());
      const applicable = collection === 'player' ? clips : clips.filter(clip => ['Idle', 'Walk', 'WalkFormal'].includes(clip.name));
      for (const clip of applicable) for (const phase of [0, .37, .83]) {
        const result = await page.evaluate(({ name, time }) => window.__CHARACTER_STUDIO__.sample(name, time), { name: clip.name, time: clip.duration * phase });
        for (const actor of result.actors) {
          const label = `${actor.id}/${clip.name}/${phase}`;
          assert.equal(actor.invalid, 0, `${label}: finite skinned vertices`);
          assert.equal(actor.missingUV, 0, `${label}: textured geometry has UVs`);
          assert.ok(actor.textured > 0, `${label}: textures present`);
          assert.ok(actor.materials.every(material => material.imagesReady), `${label}: texture image decoded`);
          if (actor.requestedBase) assert.equal(actor.baseModel, actor.requestedBase, `${label}: requested human base loaded without fallback`);
          const size = actor.bounds.max.map((v, i) => v - actor.bounds.min[i]);
          assert.ok(size.every(value => value > 0 && value < 5), `${label}: bounded animated geometry`);
        }
        results.push({ collection, index, clip: clip.name, phase, ...result });
      }
      await page.evaluate(() => window.__CHARACTER_STUDIO__.sample('Idle', .4));
      await page.screenshot({ path: new URL(`${collection}-${index + 1}.png`, output).pathname });
    }
    console.log(`Rendered and sampled ${ids.length} ${collection} models.`);
  }
  const humanBases = new Set(results.filter(result => result.collection === 'human').flatMap(result => result.actors.map(actor => actor.baseModel)));
  assert.equal(humanBases.size, 4, 'residents actually use four human base meshes');
  const residents = new Map(results.filter(result => result.collection === 'human').flatMap(result => result.actors.map(actor => [actor.id, actor])));
  assert.equal([...residents.values()].filter(actor => actor.gender === 'man').length, 10, 'ten male human residents');
  assert.equal([...residents.values()].filter(actor => actor.gender === 'woman').length, 10, 'ten female human residents');
  // Real city shader compilation and crowd integration are exercised on their
  // own page so gallery environment lighting cannot hide game-only failures.
  await page.goto(process.env.CHARACTERS_URL || 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__AFTERLIGHT__, { timeout: 90000 });
  await page.locator('#start-button').click();
  await page.waitForFunction(() => window.__AFTERLIGHT__.snapshot().started);
  await page.keyboard.down('w');
  await page.waitForTimeout(1200);
  await page.keyboard.up('w');
  await page.waitForTimeout(500);
  const game = await page.evaluate(() => window.__AFTERLIGHT__.snapshot());
  assert.equal(game.crowdArchetypes, collections.human.length + collections.robot.length + collections.alien.length, 'entire expanded roster is instantiated in the real city');
  assert.deepEqual(game.population.rosterHumanBases, { citizen: 5, flight: 5, utility: 5, tailored: 5 }, 'the city instantiates five residents from every real human base');
  assert.ok(game.character.bones >= 49, 'player rig loaded');
  await page.screenshot({ path: new URL('in-city.png', output).pathname });
  await writeFile(new URL('results.json', output), JSON.stringify({ collections, results, game, errors }, null, 2));
  assert.deepEqual(errors, [], 'browser asset and shader errors');
  const designs = Object.entries(collections).filter(([name]) => name !== 'bases').flatMap(([, ids]) => ids).length;
  console.log(`Verified ${results.length} pose samples across ${designs} character designs and ${collections.bases.length} base previews; screenshots in test-results/characters.`);
} finally { await browser.close(); }
