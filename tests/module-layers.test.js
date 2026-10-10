import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Each layer may only depend on the layers below it:
// core ← world ← traffic ← engine ← modes, with actors shared by traffic,
// engine and modes. main.js composes everything.
const ALLOWED = {
  core: ['core'],
  world: ['core', 'world'],
  actors: ['core', 'actors'],
  traffic: ['core', 'world', 'actors', 'traffic'],
  engine: ['core', 'world', 'actors', 'traffic', 'engine'],
};
const src = path.resolve('src');
function files(dir) {
  return readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.js') ? [full] : [];
  });
}
const layerOf = file => path.relative(src, file).split(path.sep)[0];
// Relative module specifiers from static (`from '…'`), side-effect (`import '…'`) and dynamic (`import('…')`) imports.
const imports = text => [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.[^'"]+)['"]/g)].map(match => match[1]);

test('layers only import from the layers beneath them', () => {
  const violations = [];
  for (const [layer, allowed] of Object.entries(ALLOWED)) for (const file of files(path.join(src, layer))) {
    const text = readFileSync(file, 'utf8');
    for (const spec of imports(text)) {
      const target = layerOf(path.resolve(path.dirname(file), spec));
      if (!allowed.includes(target)) violations.push(`${path.relative(src, file)} → ${spec}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('game modes are plug-ins: they never import another mode, and the engine imports none', () => {
  const violations = [];
  for (const file of files(path.join(src, 'modes'))) {
    const own = path.relative(path.join(src, 'modes'), file).split(path.sep);
    if (own.length < 2) continue; // modes/index.js is the registry
    for (const spec of imports(readFileSync(file, 'utf8'))) {
      const target = path.relative(src, path.resolve(path.dirname(file), spec)).split(path.sep);
      if (target[0] === 'modes' && target[1] !== own[0]) violations.push(`${path.relative(src, file)} → ${spec}`);
      if (target[0] === 'tools') violations.push(`${path.relative(src, file)} → ${spec}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('the layer check sees every form of import', () => {
  assert.deepEqual(imports(`import a from './a.js';\nimport './side.css';\nconst b = await import('../b.js');\nexport { c } from "./c.js";`), ['./a.js', './side.css', '../b.js', './c.js']);
});
