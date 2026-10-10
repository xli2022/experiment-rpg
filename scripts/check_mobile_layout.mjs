import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

// Run against the dev server with Playwright installed, or point
// PLAYWRIGHT_MODULE at an existing Playwright installation.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = new URL('../test-results/mobile-layout/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const views = [[320,568],[360,640],[390,664],[390,844],[568,320],[667,375],[844,390],[800,600],[768,1024],[1024,768]];

try {
  for (const touch of [true, false]) {
    const context = await browser.newContext({ isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // Exercise the real HTML/CSS without allocating a WebGL city per viewport:
    // the real mode cards on the title screen, then each mode's own HUD panels in play.
    // Block web fonts too: fallback typography must not make text overlap.
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    // The touch class is set before the mode modules load, as the game's input does.
    await page.route('**/src/main.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
      document.body.classList.toggle('touch', navigator.maxTouchPoints > 0);
      document.querySelector('#loading').remove();
      const [{ MODES }, { modeCards }, { createStoryHud }] = await Promise.all(['/src/modes/index.js', '/src/engine/mode-picker.js', '/src/modes/story/hud.js'].map(path => import(path)));
      document.querySelector('#mode-cards').innerHTML = modeCards(MODES, localStorage);
      const mount = element => document.getElementById('hud').append(element);
      createStoryHud({ hud: { mount }, renderer: { domElement: document.body } }, { journal() {}, medkit() {} });
      await MODES.find(mode => mode.id === 'free-roam').create({ world: { districts: Array(13), landmarks: [] }, storage: localStorage, player: { state: {} },
        clock: {}, hud: { mount }, ui: { legend() {} } }, {});
      window.__layoutReady = true;
    ` }));
    for (const [width, height] of views) {
      if (!touch && width > 900) continue;
      await page.setViewportSize({ width, height });
      await page.goto(process.env.LAYOUT_URL || 'http://127.0.0.1:5174', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__layoutReady);
      for (const view of ['title', 'story', 'roam']) {
        const playing = view !== 'title';
        await page.evaluate(view => {
          document.body.classList.toggle('playing', view !== 'title');
          document.querySelector('#welcome').classList.toggle('hidden', view !== 'title');
          // Only the active mode's panels are mounted during play.
          // Free roam is unarmed and has no journal.
          for (const element of document.querySelectorAll('.mission-panel, .player-panel, #journal-button, .weapon-panel')) element.style.display = view === 'story' ? '' : 'none';
          document.querySelector('.roam-panel').style.display = view === 'roam' ? '' : 'none';
          document.querySelector('#district').textContent = 'COMMERCIAL HEIGHTS';
          document.querySelector('#map-district').textContent = 'EAST REACH';
        }, view);
        const panels = { title: ['.welcome-tag','.welcome-kicker','.welcome h2','.mode-cards','.start-hint'], story: ['.mission-panel', '.map-panel'], roam: ['.roam-panel', '.map-panel'] };
        const selectors = ['.brand', '.top-actions', '.world-status', ...panels[view]];
        const rectangles = await page.evaluate(selectors => selectors.flatMap(selector => {
          const element = document.querySelector(selector), style = getComputedStyle(element), bounds = element.getBoundingClientRect();
          if (style.display === 'none' || style.visibility === 'hidden' || !bounds.width || !bounds.height) return [];
          return [{ selector, x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height }];
        }), selectors);
        const label = `${width}x${height}-${touch ? 'touch' : 'pointer'}-${playing ? `hud-${view}` : 'title'}`;
        for (const rectangle of rectangles) {
          assert.ok(rectangle.x >= 0 && rectangle.y >= 0 && rectangle.right <= width + .5 && rectangle.bottom <= height + .5, `${label}: ${rectangle.selector} stays in viewport: ${JSON.stringify(rectangle)}`);
        }
        for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
          const a = rectangles[i], b = rectangles[j];
          const overlap = Math.min(a.right,b.right) - Math.max(a.x,b.x) > 1 && Math.min(a.bottom,b.bottom) - Math.max(a.y,b.y) > 1;
          assert.ok(!overlap, `${label}: ${a.selector} overlaps ${b.selector}: ${JSON.stringify([a,b])}`);
        }
        if (!playing) {
          const titleOverflow = await page.locator('.welcome').evaluate(element => ({
            scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
            scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
          }));
          assert.ok(titleOverflow.scrollWidth <= titleOverflow.clientWidth + 1 && titleOverflow.scrollHeight <= titleOverflow.clientHeight + 1, `${label}: title content and backdrop do not create scrollbars: ${JSON.stringify(titleOverflow)}`);
          const hiddenReadouts = await page.locator('.map-panel,.player-panel,.weapon-panel').evaluateAll(elements => elements.every(element => getComputedStyle(element).display === 'none'));
          assert.ok(hiddenReadouts, `${label}: gameplay readouts wait until play`);
          const starts = await page.locator('[data-mode-start]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
          assert.ok(starts.length >= 2 && starts.every(start => start.height >= 44 && start.bottom <= height + .5), `${label}: every mode's start button is usable: ${JSON.stringify(starts)}`);
        }
        if (touch) {
          const controls = await page.locator('.top-actions button:visible').evaluateAll(elements => elements.map(element => ({ id: element.id || element.className, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
          assert.ok(controls.every(control => control.width >= 44 && control.height >= 44), `${label}: touch targets remain 44px: ${JSON.stringify(controls)}`);
        }
        const textOverflow = await page.evaluate(() => ['.brand h1','.welcome h2','.mode-card h3','.mode-card p','.start-hint','.world-status'].flatMap(selector => [...document.querySelectorAll(selector)].flatMap(element => {
          if (!element.getClientRects().length) return [];
          const bounds = element.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element);
          return [...range.getClientRects()].filter(rectangle => rectangle.width && (rectangle.left < bounds.left - 1 || rectangle.right > bounds.right + 1)).map(() => selector);
        })));
        assert.deepEqual(textOverflow, [], `${label}: text fits its own region`);
        await page.screenshot({ path: new URL(`${label}.png`, output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
        results.push({ label, rectangles });
      }
    }
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(new URL('results.json', output), JSON.stringify(results, null, 2));
console.log(`Verified ${results.length} title/HUD layouts with fallback fonts; screenshots in test-results/mobile-layout.`);
