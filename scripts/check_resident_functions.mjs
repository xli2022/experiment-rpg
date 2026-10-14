import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

// Focused native-rig previews and real-model paraphrases. Reuses the existing
// resident test profile's model cache; never changes the player's browser.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.RESIDENT_URL || 'http://127.0.0.1:5174';
const output = new URL('../test-results/resident-actions/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launchPersistentContext(new URL('browser-real/', output).pathname, {
  executablePath: process.env.CHROME_PATH, headless: true, viewport: { width: 1600, height: 1000 },
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface'],
});
const page = await browser.newPage(), results = { errors: [], poses: {}, decisions: [] };
page.on('pageerror', error => results.errors.push(error.message));
await page.route(`${origin}/resident-functions-check`, route => route.fulfill({ contentType: 'text/html',
  body: '<html><body style="margin:0;background:#263b43"><div id="label" style="position:absolute;color:white;font:24px sans-serif;left:25px;top:20px"></div></body></html>' }));
try {
  await page.goto(`${origin}/resident-functions-check`);
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { loadCharacterAssets } = await import('/src/engine/player/characters.js');
    const { createNPC } = await import('/src/actors/npc-appearance.js');
    const { createVisitor, VISITOR_PROFILES } = await import('/src/actors/npc-visitors.js');
    const { CROWD_PROFILES } = await import('/src/actors/npc-profiles.js');
    const assets = await loadCharacterAssets();
    const profiles = [...new Map(CROWD_PROFILES.map(p => [p.baseModel, p])).values()];
    const actors = profiles.map(p => createNPC(assets.humanBases[p.baseModel] ?? assets.citizen, p));
    actors.push(...VISITOR_PROFILES.map(p => createVisitor(assets.visitors[p.id], p)));
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#263b43');
    scene.add(new THREE.HemisphereLight(0xe9f3ff, 0x65775e, 2.8));
    const key = new THREE.DirectionalLight(0xffe7cd, 3.2); key.position.set(-4, 8, -6); scene.add(key);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(innerWidth, innerHeight); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; document.body.append(renderer.domElement);
    const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, .1, 100);
    camera.position.set(0, 11, -15); camera.lookAt(0, 0, 0);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 25), new THREE.MeshStandardMaterial({ color: '#42565a', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; scene.add(floor);
    actors.forEach((actor, i) => { actor.root.position.set((i % 4 - 1.5) * 3.2, 0, (Math.floor(i / 4) - 1) * 3.5); scene.add(actor.root); });
    window.preview = (kind, elapsed = .7) => {
      document.querySelector('#label').textContent = `${kind} — four human bases, eight visitor designs`;
      actors.forEach(actor => {
        actor.setAnimation('Idle');
        for (let frame = 0; frame < 80; frame++) actor.update(1 / 60, 0, { kind, elapsed, sitProgress: kind === 'sit_down' ? Math.min(1, (frame + 1) / 72) : 0 });
      });
      renderer.render(scene, camera);
      return actors.map(actor => {
        const bounds = new THREE.Box3().setFromObject(actor.root, true), size = bounds.getSize(new THREE.Vector3());
        return { id: actor.profile.id, width: size.x, height: size.y, length: size.z, ground: bounds.min.y };
      });
    };
    window.preview('dance');
  });
  for (const kind of ['dance', 'sit_down', 'get_up']) {
    results.poses[kind] = await page.evaluate(kind => window.preview(kind), kind);
    await page.screenshot({ path: new URL(`functions-${kind}.png`, output).pathname });
  }
  console.log('Rendered dance, sit-down and get-up poses for all 12 body designs.');
  if (process.env.RESIDENT_REAL === '1') {
    const modelState = await page.evaluate(async () => {
      const { ResidentModel } = await import('/src/engine/residents/model.js');
      window.intentModel = new ResidentModel();
      await window.intentModel.setEnabled(true); return window.intentModel.snapshot();
    });
    assert.equal(modelState.status, 'ready', modelState.message);
    const cases = [
      ['Dance.', 'dance'], ['Show me your moves.', 'dance'], ['Could you dance for me?', 'dance'],
      ['Stop dancing.', 'wait'], ['Do not dance.', 'wait'], ['What is your favorite dance?', 'none'],
      ['Guide me to the station.', 'guide', 'station'], ['Show me the way to the station.', 'guide', 'station'], ['Take me to the ramen bar.', 'guide', 'ramen'],
      ['Go to the station.', 'go_to', 'station'], ['Head to KŌJI.', 'go_to', 'ramen'], ['Meet me at the ramen bar.', 'go_to', 'ramen'],
      ['Go to the moon.', 'go_to', ''], ['Guide me somewhere.', 'guide', ''],
      ['Sit down.', 'sit_down'], ['Take a seat.', 'sit_down'], ['Sit on the ground.', 'sit_down'], ['Have a seat.', 'sit_down'],
      ['Get up.', 'get_up'], ['Stand up.', 'get_up'], ['On your feet.', 'get_up'], ['Stop sitting down.', 'get_up'],
      ['Do not sit down.', 'wait'], ['Do not get up.', 'wait'], ['Stay seated.', 'wait'],
      ['What happens if I say sit down?', 'none'], ['Tell me a story about dancing.', 'none'], ['Hello.', 'none'],
      ['Lie down.', 'none'], ['Lay down.', 'none'], ['Wave at me.', 'none'], ['Cheer for me.', 'none'], ['Face me.', 'none'], ['Come here.', 'none'],
      ['Come with me.', 'follow'], ['Can I get past?', 'move_aside'], ['Carry on with your day.', 'resume_routine'],
      ['Could you walk with me?', 'follow'], ['Stop following me.', 'wait'], ['Do not follow me.', 'wait'],
      ['What happens if I say follow me?', 'none'], ['Tell me a story about someone saying "wait here".', 'none'],
      ['Can you give me a thousand credits?', 'none'],
    ];
    for (const [line, action, destination] of cases) {
      const result = await page.evaluate(async line => {
        const { decisionMessages, decisionFormat, parseDecision, preliminaryDecision } = await import('/src/engine/residents/decisions.js');
        const context = { behavior: 'routine', posture: 'standing', canWalk: true, area: 'outside', destinations: [
          { id: 'station', name: 'Neonward station', type: 'tram station', distance: 24 },
          { id: 'ramen', name: 'KŌJI', type: 'ramen bar', distance: 36 },
        ] };
        const start = performance.now();
        const preliminary = preliminaryDecision(line);
        if (preliminary) return { line, parsed: preliminary, source: 'request check', ms: 0 };
        const raw = await window.intentModel.generate(decisionMessages(line, context), { responseFormat: decisionFormat(context) });
        return { line, raw, parsed: parseDecision(raw), source: 'model', ms: Math.round(performance.now() - start) };
      }, line);
      result.expected = { action, ...(destination === undefined ? {} : { destination }) };
      result.pass = JSON.stringify(result.parsed) === JSON.stringify(result.expected);
      results.decisions.push(result); console.log(JSON.stringify(result));
    }
    await page.evaluate(() => window.intentModel.dispose());
  }
  await writeFile(new URL('functions-results.json', output), JSON.stringify(results, null, 2));
  assert.deepEqual(results.errors, []);
  assert.ok(results.decisions.every(result => result.pass), 'some real-model paraphrases were misclassified; see functions-results.json');
} finally { await browser.close(); }
