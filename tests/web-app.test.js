import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const links = [...html.matchAll(/<link\b[^>]*>/g)].map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
const manifestLink = links.find(link => link.rel === 'manifest');
const publicFile = path => new URL(`public/${path.replace(/^\//, '')}`, root);
const manifest = JSON.parse(readFileSync(publicFile(manifestLink.href), 'utf8'));

function pngDimensions(path) {
  const png = readFileSync(path);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'File must be a PNG, not an SVG renamed as PNG');
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.equal(png[24], 8, 'Install icons use ordinary 8-bit channels');
  const channels = ({ 2: 3, 6: 4 })[png[25]];
  assert.ok(channels, 'Install icons use RGB or RGBA pixels');
  assert.equal(png[28], 0, 'Icons use non-interlaced PNG encoding');
  const imageData = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    assert.ok(offset + size + 12 <= png.length, 'PNG chunk must not be truncated');
    if (type === 'IDAT') imageData.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  assert.equal(inflateSync(Buffer.concat(imageData)).length, height * (width * channels + 1), 'Pixel data must match the declared dimensions');
  return `${width}x${height}`;
}

test('installed app URLs remain inside both root and repository-path deployments', () => {
  assert.ok(manifest.name && manifest.short_name);
  assert.equal(manifest.display, 'fullscreen');
  for (const directory of ['/', '/afterlight/']) {
    // Vite prefixes the HTML manifest link with its deployment base; URLs
    // inside the public manifest must then resolve relative to that location.
    const manifestURL = new URL(`${directory}${manifestLink.href.replace(/^\//, '')}`, 'https://example.test');
    for (const field of ['id', 'start_url', 'scope']) {
      const resolved = new URL(manifest[field], manifestURL);
      assert.equal(resolved.origin, manifestURL.origin);
      assert.equal(resolved.pathname, directory, `${field} must remain inside the deployed app`);
    }
    for (const icon of manifest.icons) {
      const resolved = new URL(icon.src, manifestURL);
      assert.equal(resolved.origin, manifestURL.origin);
      assert.ok(resolved.pathname.startsWith(`${directory}icons/`), 'Icon URLs must retain the repository prefix');
    }
  }
});

test('Android and Apple installation icons link to real PNGs at their advertised dimensions', () => {
  assert.deepEqual(manifest.icons.map(icon => icon.sizes).sort(), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    assert.equal(pngDimensions(publicFile(icon.src)), icon.sizes);
  }
  const apple = links.find(link => link.rel === 'apple-touch-icon');
  assert.ok(apple, 'Apple installation has its own touch icon link');
  assert.equal(pngDimensions(publicFile(apple.href)), '180x180');
  assert.match(html, /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"/);
});
