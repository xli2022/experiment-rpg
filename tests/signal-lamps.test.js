import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LAMP_COLORS, RED_GLOW, createSignalProps, signalState } from '../src/traffic/signals.js';
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

test('a lit red lamp reaches the screen red, not orange', () => {
  for (const [name, color] of [['lens', LAMP_COLORS.red], ['glow', RED_GLOW]]) {
    const [r, g, b] = onScreen(color), h = hue([r, g, b]);
    assert.ok(r > 150 && g < 80 && b < 60, `${name}: ${[r, g, b].map(Math.round)}`);
    assert.ok(h < 12 || h > 345, `${name}: hue ${h.toFixed(0)}°`);
    // Bloom would add a bright, tone-mapped (so orange) core round it.
    assert.ok(luminance(color) < BLOOM, `${name} stays under the bloom threshold`);
  }
  // The old colour, for the record: bright enough to bloom, and salmon on screen.
  assert.ok(hue(onScreen([3.2, .16, .12])) > 15);
});

test('each signal head glows red only while it shows red', () => {
  const plan = createMasterPlan(), network = buildNetwork(plan), node = network.nodes.find(n => n.signalized && n.ground);
  const props = createSignalProps(new THREE.Scene(), network, plan);
  const glows = props.root.children.find(m => m.material.map?.name === 'signal-glow');
  const heads = props.root.children.find(m => m.geometry.parameters?.height === 1.02);
  let red = 0, other = 0;
  for (const time of [0, 7, 19, 31, 44]) {
    props.update(time, { x: node.x, y: node.y, z: node.z });
    assert.equal(glows.count, heads.count, 'one glow per head');
    // Heads come in pairs per approach (overhead and on the pole), in order.
    const approaches = network.nodesNear(node.x, node.z, 170).filter(n => n.kind === 'junction' && n.ground && n.signalized && Math.abs(n.y - node.y) <= 30)
      .flatMap(n => n.approaches.filter(a => a.arriving.length).map(a => ({ n, a })));
    for (let i = 0; i < Math.min(glows.count, approaches.length * 2); i++) {
      const { n, a } = approaches[Math.floor(i / 2)], c = new THREE.Color();
      glows.getColorAt(i, c);
      if (signalState(n, a, time).color === 'red') { assert.deepEqual(c.toArray(), [...RED_GLOW]); red++; }
      else { assert.deepEqual(c.toArray(), [0, 0, 0]); other++; }
    }
  }
  assert.ok(red > 10 && other > 10, `${red} red and ${other} other heads checked`);
  props.dispose();
});
