import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LAMP_COLORS, LAMP_GLOWS, createSignalProps, signalPoles, signalState } from '../src/traffic/signals.js';
import { buildNetwork, rightOf } from '../src/traffic/network.js';
import { createTraffic } from '../src/traffic/index.js';
import { createMasterPlan } from '../src/world/master-plan.js';
import { createVerticalCity } from '../src/world/vertical-city.js';
import { WorldStream } from '../src/world/world-stream.js';
import { AFTERLIGHT_LANDMARKS } from '../src/world/landmarks.js';
import { moveWithCollisions, rayObstructionDistance } from '../src/core/physics.js';
import { crowdAsset } from './helpers/street-grid.js';

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

test('walk lamps ride on the signal poles, facing across their crossings, with no posts of their own', () => {
  const plan = createMasterPlan(), network = buildNetwork(plan), node = network.nodes.find(n => n.signalized && n.ground);
  const props = createSignalProps(new THREE.Scene(), network, plan);
  props.update(0, { x: node.x, y: node.y, z: node.z });
  const poles = props.root.children.find(m => m.geometry.type === 'CylinderGeometry');
  const arms = props.root.children.find(m => m.geometry.parameters?.width === 1 && m.geometry.parameters?.height === .09);
  const walkers = props.root.children.find(m => m.geometry.parameters?.width === .22);
  assert.equal(poles.count, arms.count, 'every post carries a signal arm');
  assert.ok(walkers.count > poles.count, `${walkers.count} walk lamps on ${poles.count} poles`);
  const at = (mesh, i) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(mesh.instanceMatrix.array, i * 16));
  const bases = Array.from({ length: poles.count }, (_, i) => at(poles, i));
  for (let i = 0; i < walkers.count; i++) {
    const lamp = at(walkers, i), pole = bases.find(b => Math.hypot(b.x - lamp.x, b.z - lamp.z) < .3);
    assert.ok(pole && lamp.y - pole.y > 1.8 && lamp.y - pole.y < 2.5, `walk lamp ${i} is mounted on a signal pole`);
  }
  // Each faces the people waiting at the far end of its crossing.
  for (const n of network.nodes.filter(n => n.signalized && n.ground)) for (const p of signalPoles(n, plan)) for (const w of p.walks) {
    const a = w.approach, across = a.width / 2 + .4, dx = n.x + a.dir.x * a.crosswalk + w.face.x * across - w.x, dz = n.z + a.dir.z * a.crosswalk + w.face.z * across - w.z;
    assert.ok((dx * w.face.x + dz * w.face.z) / Math.hypot(dx, dz) > .8, `${n.id} walk lamp faces across its crossing`);
  }
  props.dispose();
});

test('signal poles are solid for anyone the world is asked about, while traffic is there', () => {
  const scene = new THREE.Scene(), stream = new WorldStream(scene), city = createVerticalCity(scene, stream, AFTERLIGHT_LANDMARKS);
  const traffic = createTraffic({ scene, world: city, assets: { citizen: crowdAsset() } });
  const node = traffic.network.nodes.find(n => n.signalized && n.ground), pole = signalPoles(node, city.masterPlan)[0];
  // From the street, straight at the post: the walker stops against it, and so does a shot.
  const r = rightOf(pole.approach.dir), walker = { x: pole.x + r.x * 2, y: pole.ground, z: pole.z + r.z * 2 };
  for (let i = 0; i < 20; i++) moveWithCollisions(walker, -r.x * .1, -r.z * .1, .43, city.spatial.near(walker.x, walker.z, 3));
  const gap = Math.hypot(walker.x - pole.x, walker.z - pole.z);
  assert.ok(gap > .55 && gap < .7, `stopped ${gap.toFixed(2)} m from the post`);
  const shot = rayObstructionDistance({ x: pole.x + r.x * 5, y: pole.ground + 1.2, z: pole.z + r.z * 5 }, { x: -r.x, y: 0, z: -r.z }, 10, city.spatial);
  assert.ok(shot > 4.8 && shot < 4.95, `a shot hits the post ${shot.toFixed(2)} m away`);
  assert.ok(city.spatial.near(pole.x, pole.z, 1).some(b => b.kind === 'signal' && b.walkable === false));
  traffic.dispose();
  assert.ok(!city.spatial.near(pole.x, pole.z, 1).some(b => b.kind === 'signal'), 'gone with the traffic');
  stream.dispose();
});
