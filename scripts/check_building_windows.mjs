import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

// Requires a running Vite server and Playwright. Overrides match the layout
// check; CHROMIUM_EXECUTABLE optionally selects a locally installed browser.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = new URL('../test-results/building-windows/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('harness.html', output), `<!doctype html>
<html><head><link rel="icon" href="/favicon.svg"></head><body><script type="module">
import * as THREE from 'three';
import { createFacadeMaterial, facadeUV, FACADE_STYLES } from '/src/world/building-materials.js';
import { WorldStream } from '/src/world/world-stream.js';

window.runWindowChecks = () => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const columns = 32, floors = 96, width = columns * 10, height = floors * 10;
  const w = columns * 2.7, h = floors * 3.6, seed = 1234567;
  const scene = new THREE.Scene(), stream = new WorldStream(scene), material = createFacadeMaterial();
  // With no scene lights, readback measures only window emission, independently
  // of wall colors, lighting, fog, bloom and exposure in the playable city.
  material.emissiveIntensity = 1;
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(width, height); renderer.setClearColor(0x000000); document.body.append(renderer.domElement);
  const target = new THREE.WebGLRenderTarget(width, height);
  const camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, .1, 600);
  const cell = stream.cell(0, 0);
  stream.add(material, 0, 0, 0, w, h, w, 0, 0xffffff, false, 'box', cell, 0, 0, facadeUV(0), seed);
  stream.build(cell, 0);
  let lastPixels;
  const sample = (style = 0, state = 'dark', randomSeed = seed, face = 0, sectionY = 0) => {
    const mesh = cell.groups[0].children[0];
    mesh.geometry.attributes.instanceUvRect.array.set(facadeUV(style, state));
    mesh.geometry.attributes.instanceUvRect.needsUpdate = true;
    mesh.geometry.attributes.instanceWindowSeed.setX(0, randomSeed);
    mesh.geometry.attributes.instanceWindowSeed.needsUpdate = true;
    mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(0, sectionY, 0), new THREE.Quaternion(), new THREE.Vector3(w, h, w)));
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    camera.position.set(Math.sin(face * Math.PI / 2) * 200, sectionY, Math.cos(face * Math.PI / 2) * 200);
    camera.lookAt(0, sectionY, 0); camera.updateMatrixWorld();
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    lastPixels = pixels;
    return Array.from({ length: columns * floors }, (_, i) => {
      const x = (i % columns) * 10 + 4, y = Math.floor(i / columns) * 10 + 5;
      return pixels[(y * width + x) * 4] > 10 ? 1 : 0;
    });
  };
  const difference = (a, b) => a.reduce((count, value, i) => count + (value !== b[i]), 0) / a.length;
  const shifted = (pattern, dx, dy) => {
    let different = 0, total = 0;
    for (let y = 0; y < floors - dy; y++) for (let x = 0; x < columns - dx; x++) {
      different += pattern[y * columns + x] !== pattern[(y + dy) * columns + x + dx]; total++;
    }
    return different / total;
  };
  const results = [];
  try {
    for (let style = 0; style < FACADE_STYLES.length; style++) {
      const dark = sample(style), lit = sample(style, 'lit');
      const darkRatio = dark.reduce((a, b) => a + b) / dark.length;
      const litRatio = lit.reduce((a, b) => a + b) / lit.length;
      check(darkRatio > .03 && darkRatio < .1 && litRatio > .9 && litRatio < .97, 'Building light levels must remain strongly biased');
      check(difference(dark, lit) === 1, 'Both atlas banks must use the same per-window decisions');
      for (const period of [4, 8, 16, 32]) check(shifted(dark, 0, period) > .06, 'Floors must not repeat every ' + period + ' windows');
      for (const period of [4, 8, 16]) check(shifted(dark, period, 0) > .06, 'Columns must not repeat every ' + period + ' windows');
      check(difference(dark, sample(style, 'dark', seed + 1)) > .06, 'Neighbors need distinct patterns');
      for (const face of [1, 2, 3]) check(difference(dark, sample(style, 'dark', seed, face)) > .06, 'Walls must not mirror their lighting');
      check(difference(dark, sample(style, 'dark', seed, 0, 18)) > .06, 'Upper sections must not restart the same pattern');
      check(difference(dark, sample(style)) === 0, 'Moving the camera must not change the lights');
      stream.release(cell, 0); stream.build(cell, 0);
      check(difference(dark, sample(style)) === 0, 'Chunk eviction must not reshuffle windows');
      results.push({ style: FACADE_STYLES[style], darkRatio, litRatio, floorRepeatDifference: shifted(dark, 0, 4) });
    }
    for (const shape of ['circle', 'hexagon']) {
      stream.release(cell, 0); cell.recipes[0].clear();
      stream.add(material, 0, 0, 0, w, h, w, 0, 0xffffff, false, shape, cell, 0, 0, facadeUV(0), seed);
      stream.build(cell, 0); sample();
      const mesh = cell.groups[0].children[0], ray = new THREE.Raycaster(), panes = new Map();
      // Locate actual window interiors by raycasting the curved/hexagonal UVs.
      // This avoids counting the unlit wall material as a dark window.
      for (let x = 0; x < width; x++) {
        ray.setFromCamera(new THREE.Vector2((x + .5) / width * 2 - 1, 0), camera);
        const hit = ray.intersectObject(mesh)[0]; if (!hit) continue;
        const span = mesh.geometry.attributes.facadeSpan.getX(hit.face.a);
        const face = mesh.geometry.attributes.facadeFace.getX(hit.face.a);
        const bay = hit.uv.x * span * w / 2.7, fraction = bay - Math.floor(bay);
        if (fraction > .37 && fraction < .47) panes.set(face + ':' + Math.floor(bay), x);
      }
      check(panes.size > 10, shape + ' must have enough sampled panes');
      const readPattern = (state, randomSeed = seed) => {
        sample(0, state, randomSeed);
        return Array.from({ length: floors }, (_, y) => [...panes.values()].map(x => lastPixels[((y * 10 + 5) * width + x) * 4] > 10 ? 1 : 0)).flat();
      };
      const dark = readPattern('dark'), lit = readPattern('lit'), ratio = dark.reduce((a, b) => a + b) / dark.length;
      check(ratio > .03 && ratio < .1 && difference(dark, lit) === 1, shape + ' preserves dominant lighting across its perimeter');
      check(difference(dark, readPattern('dark', seed + 1)) > .06, shape + ' uses independent building seeds');
      const row = panes.size;
      const repeatDifference = dark.slice(row * 4).reduce((sum, value, i) => sum + (value !== dark[i]), 0) / (dark.length - row * 4);
      check(repeatDifference > .06, shape + ' floors do not repeat with the facade tile');
      stream.release(cell, 0); stream.build(cell, 0);
      check(difference(dark, readPattern('dark')) === 0, shape + ' retains its lights after streaming');
      results.push({ shape, sampledColumns: row, darkRatio: ratio, floorRepeatDifference: repeatDifference });
    }
    return results;
  } finally {
    stream.dispose(); target.dispose(); material.map.dispose(); material.emissiveMap.dispose(); material.dispose(); renderer.dispose();
  }
};
</script></body></html>`);

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(new URL('/test-results/building-windows/harness.html', process.env.LAYOUT_URL || 'http://127.0.0.1:5174').href);
  await page.waitForFunction(() => typeof window.runWindowChecks === 'function');
  const results = await page.evaluate(() => window.runWindowChecks());
  assert.deepEqual(errors, [], 'WebGL compilation and rendering must be error-free');
  await writeFile(new URL('results.json', output), JSON.stringify(results, null, 2));
  console.log('Verified nonrepeating window lighting, dominant light levels, independent faces and stable reloads for all six facades and three footprints.');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
