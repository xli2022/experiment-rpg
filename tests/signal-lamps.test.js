import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LAMP_COLORS, LAMP_GLOWS, createSignalProps, signalState } from '../src/traffic/signals.js';
import { buildNetwork } from '../src/traffic/network.js';
import { createMasterPlan } from '../src/world/master-plan.js';

// The renderer's settings in engine/game.js: ACES filmic tone mapping at an
// exposure of 1.18, and bloom for pixels brighter than a luminance of 1.03.
const EXPOSURE = 1.18, BLOOM = 1.03;
// three.js's ACESFilmicToneMapping, then the sRGB transfer curve.
function onScreen([r, g, b]) {
  const fit = v => (v * (v + .0245786) - .000090537) / (v * (.983729 * v + .432951) + .238081), k = EXPOSURE / .6;
  [r, g, b] = [r * k, g * k, b * k];
  const i = [.59719 * r + .35458 * g + .04823 * b, .076 * r + .90834 * g + .01566 * b, .0284 * r + .13383 * g + .83777 * b].map(fit);
  const o = [1.60475 * i[0] - .53108 * i[1] - .07367 * i[2], -.10208 * i[0] + 1.10813 * i[1] - .00605 * i[2], -.00327 * i[0] - .07276 * i[1] + 1.07602 * i[2]];
  return o.map(c => Math.min(1, Math.max(0, c))).map(c => 255 * (c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055));
}
const luminance = ([r, g, b]) => .299 * r + .587 * g + .114 * b;
const hue = ([r, g, b]) => { const max = Math.max(r, g, b), d = max - Math.min(r, g, b); const h = max === r ? (g - b) / d % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };

test('lit signal lamps reach the screen in their own colours, alike', () => {
  const hues = { red: h => h < 12 || h > 345, amber: h => h > 30 && h < 50, green: h => h > 140 && h < 175 };
  for (const name of ['red', 'amber', 'green']) for (const [part, color] of [['lens', LAMP_COLORS[name]], ['glow', LAMP_GLOWS[name]]]) {
    const rgb = onScreen(color), max = Math.max(...rgb), saturation = (max - Math.min(...rgb)) / max, h = hue(rgb);
    assert.ok(hues[name](h), `${name} ${part}: hue ${h.toFixed(0)}° (${rgb.map(Math.round)})`);
    assert.ok(saturation > .5 && max > 150, `${name} ${part}: saturated and bright (${rgb.map(Math.round)})`);
    // Bloom would add a bright, tone-mapped (so bleached) core round it.
    assert.ok(luminance(color) < BLOOM, `${name} ${part} stays under the bloom threshold`);
  }
  // The old red, for the record: bright enough to bloom, and salmon on screen.
  assert.ok(hue(onScreen([3.2, .16, .12])) > 15);
});

test('each lamp glows only while it is lit', () => {
  const plan = createMasterPlan(), network = buildNetwork(plan), node = network.nodes.find(n => n.signalized && n.ground);
  const props = createSignalProps(new THREE.Scene(), network, plan);
  const glows = props.root.children.find(m => m.material.map?.name === 'signal-glow');
  const heads = props.root.children.find(m => m.geometry.parameters?.height === 1.02);
  const lit = { red: 0, amber: 0, green: 0 };
  let dark = 0;
  for (const time of [0, 7, 15, 19, 31, 44, 52]) {
    props.update(time, { x: node.x, y: node.y, z: node.z });
    assert.equal(glows.count, heads.count * 3, 'one glow per lamp');
    // Heads come in pairs per approach (overhead and on the pole), in order;
    // each has red, amber and green.
    const approaches = network.nodesNear(node.x, node.z, 170).filter(n => n.kind === 'junction' && n.ground && n.signalized && Math.abs(n.y - node.y) <= 30)
      .flatMap(n => n.approaches.filter(a => a.arriving.length).map(a => ({ n, a })));
    for (let i = 0; i < Math.min(glows.count, approaches.length * 6); i++) {
      const { n, a } = approaches[Math.floor(i / 6)], name = ['red', 'amber', 'green'][i % 3], c = new THREE.Color();
      glows.getColorAt(i, c);
      const near = expected => c.toArray().every((v, k) => Math.abs(v - expected[k]) < 1e-6);
      if (signalState(n, a, time).color === name) { assert.ok(near(LAMP_GLOWS[name]), `${name} glows`); lit[name]++; }
      else { assert.ok(near([0, 0, 0]), `${name} is dark`); dark++; }
    }
  }
  assert.ok(lit.red > 10 && lit.green > 10 && lit.amber > 0 && dark > 30, `lit ${JSON.stringify(lit)}, ${dark} dark`);
  props.dispose();
});
