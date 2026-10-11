import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMasterPlan } from '../src/world/master-plan.js';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { AFTERLIGHT_LANDMARKS as LANDMARKS } from '../src/world/landmarks.js';
import { buildingVolumes } from '../src/world/building-design.js';
import { buildingBoxGeometry, buildingPrismGeometry } from '../src/world/building-geometry.js';
import { createFacadeMaterial, facadeUV } from '../src/world/building-materials.js';
import { FACADE_PANES, FACADE_BAY, FACADE_STOREY, facadeWalls, wallPanes, wallPoint, paneAt, createBrokenWindows } from '../src/world/facade-windows.js';
import { createWindowBreakage } from '../src/world/broken-windows.js';
import { interiorPlan, levelY, INTERIOR } from '../src/world/interior-plan.js';
import { interiorHull, toWorld } from '../src/world/interior-physics.js';
import { buildFloor } from '../src/world/interiors.js';
import { boxCoordinates } from '../src/core/physics.js';

const plan = createMasterPlan(), metro = new VerticalMetropolis(plan, LANDMARKS);
const sample = (() => {
  const found = new Map();
  for (let x = -12; x < 12; x += 3) for (let z = -12; z < 12; z += 3) for (const p of metro.block(x, z).buildings) {
    const kind = `${p.footprint ?? 'rectangle'}:${p.type}`;
    if (!found.has(kind)) found.set(kind, p);
  }
  return [...found.values()];
})();
const facadeBuilding = shape => sample.find(p => (p.footprint ?? 'rectangle') === shape && p.type !== 'warehouse' && p.type !== 'factory' && interiorPlan(p)?.levels > 1);
const world = (p, local) => toWorld({ origin: { x: p.x, z: p.z, yaw: p.yaw ?? 0 } }, local.x, local.z);

test('the facade atlas lights exactly the panes in the shared table', () => {
  const material = createFacadeMaterial(), image = material.emissiveMap.image;
  for (const [style, [x0, x1, y0, y1]] of FACADE_PANES.entries()) {
    const [u, v, w, h] = facadeUV(style, 'lit');
    for (let py = 0; py < 60; py++) for (let px = 0; px < 60; px++) {
      // The first bay of the style's lit tile, inside its gutter.
      const x = Math.round(u * image.width) + px, y = Math.round(v * image.height) + py, lit = image.data[(y * image.width + x) * 4] > 0;
      assert.equal(lit, px >= x0 && px < x1 && py >= y0 && py < y1, `style ${style} pixel ${px},${py}`);
    }
    assert.ok(w > 0 && h > 0);
  }
});

test('facade walls count their bays from the corner where the rendered texture starts', () => {
  // The shader repeats one 2.7 m bay per 60 px across a face's frontage and one
  // 3.6 m storey up its height; compare with each wall's own measure.
  for (const shape of ['rectangle', 'hexagon', 'circle']) {
    const p = facadeBuilding(shape), volume = buildingVolumes(p)[0], walls = facadeWalls(p).filter(w => w.volume === 0);
    const geometry = shape === 'rectangle' ? buildingBoxGeometry() : buildingPrismGeometry(shape);
    const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv, span = geometry.attributes.facadeSpan;
    let checked = 0;
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(normal.getY(i)) > .5) continue;
      const local = { x: volume.x + position.getX(i) * volume.w, z: volume.z + position.getZ(i) * volume.d };
      const frontage = span.getX(i) * volume.w + span.getY(i) * volume.d, u = uv.getX(i) * frontage, v = uv.getY(i) * volume.h;
      // The vertex belongs to the wall it lies on whose span covers it at this u.
      const matches = walls.filter(w => Math.abs((local.x - w.start.x) * w.normal.x + (local.z - w.start.z) * w.normal.z) < 1e-6).map(w => {
        const s = (local.x - w.start.x) * w.dir.x + (local.z - w.start.z) * w.dir.z;
        return s > -1e-6 && s < w.length + 1e-6 ? Math.abs(w.offset + s * w.scale - u) : Infinity;
      });
      assert.ok(Math.min(...matches) < 1e-6, `${shape} vertex ${i}: texture u ${u.toFixed(3)} is not on its wall's grid`);
      assert.ok(Math.abs((p.y + volume.y - volume.h / 2) + v - (walls[0].bottom + v)) < 1e-9);
      checked++;
    }
    assert.ok(checked >= 8, `${shape} has side vertices`);
  }
  assert.equal(FACADE_BAY, 2.7); assert.equal(FACADE_STOREY, INTERIOR.storey);
});

test('rooms open the panes the facade paints, at the same places and heights', () => {
  let openings = 0;
  for (const p of sample) {
    const interior = interiorPlan(p);
    if (!interior || interior.industrial) continue;
    for (const [index, template] of interior.templates.entries()) for (const seg of template.perimeter) for (const o of seg.openings.filter(o => o.window)) {
      const level = index, length = Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z), ux = (seg.b.x - seg.a.x) / length, uz = (seg.b.z - seg.a.z) / length;
      for (const t of [o.from + .02, (o.from + o.to) / 2, o.to - .02]) {
        const local = { x: seg.a.x + ux * t, z: seg.a.z + uz * t }, y = levelY(interior, level) + (o.bottom + o.top) / 2;
        const pane = paneAt(p, local, y, 0);
        assert.ok(pane, `${p.id} level ${level}: window ${o.pane} has no facade pane behind it`);
        assert.equal(pane.key, `${o.pane}:${level}`);
        assert.ok(levelY(interior, level) + o.bottom >= pane.wall.bottom + pane.v0 - 1e-6, 'the sill is the pane\'s');
      }
      openings++;
    }
  }
  assert.ok(openings > 200, `${openings} windows checked`);
});

test('a window breaks once, from outside or in, opens through the hull and loses its glass', () => {
  for (const shape of ['rectangle', 'circle']) {
    const p = facadeBuilding(shape), interior = interiorPlan(p), scene = new THREE.Scene();
    const windows = createWindowBreakage(scene, metro);
    const wall = facadeWalls(p).find(w => w.volume === 0 && wallPanes(w, 1).length), pane = wallPanes(wall, 1)[0];
    const s = (pane.s0 + pane.s1) / 2, y = wall.bottom + (pane.v0 + pane.v1) / 2;
    const outside = { ...world(p, wallPoint(wall, s)), y }, inside = { ...world(p, wallPoint(wall, s, -INTERIOR.hull)), y };
    // Cladding between panes never breaks.
    const cladding = { ...world(p, wallPoint(wall, s)), y: wall.bottom + FACADE_STOREY + pane.v0 - .3 };
    assert.equal(windows.breakAt(cladding), null, 'a spandrel is not a window');
    const within = world(p, wallPoint(wall, s, -INTERIOR.hull / 2)), hull = interiorHull(interior), opening = box => {
      const local = boxCoordinates(within.x, within.z, box);
      return Math.abs(local.x) < box.w / 2 && Math.abs(local.z) < box.d / 2 && box.minY < y && box.maxY > y;
    };
    assert.ok(hull.some(b => b.w && opening(b)), 'the intact pane is solid');
    const broke = windows.breakAt(shape === 'rectangle' ? outside : inside);
    assert.ok(broke?.fresh && broke.key === pane.key, `${shape}: the pane breaks`);
    assert.equal(windows.breakAt(outside).fresh, false, 'a broken pane stays broken');
    assert.ok(!interiorHull(interior, windows.of(p.id)).some(b => b.w && opening(b)), `${shape}: the hull opens`);
    const intact = buildFloor(interior, 1), shattered = buildFloor(interior, 1, windows.of(p.id));
    assert.ok(shattered.glass.position.length < intact.glass.position.length && shattered.shattered.position.length > 0, 'glass gives way to shards');
    windows.update({ x: outside.x, z: outside.z });
    assert.equal(windows.mesh.count, windows.of(p.id).get(pane.key).pieces.length, 'each piece is drawn on the facade');
    windows.update({ x: outside.x + 1000, z: outside.z });
    assert.equal(windows.mesh.count, 0, 'far away, none are drawn');
    windows.dispose();
  }
});

test('the session keeps a bounded set of broken windows and versions each building', () => {
  const p = facadeBuilding('rectangle'), panes = facadeWalls(p).flatMap(w => [0, 1, 2].flatMap(row => wallPanes(w, row)));
  const broken = createBrokenWindows({ limit: 3 });
  for (const pane of panes.slice(0, 5)) assert.ok(broken.add(p, pane.key));
  assert.equal([...broken.all()].length, 3, 'the oldest are glazed again');
  assert.ok(!broken.has(p.id, panes[0].key) && broken.has(p.id, panes[4].key));
  assert.equal(broken.version(p.id), 7, 'every change bumps the building');
  assert.equal(broken.add(p, 'not:a:real:pane'), false);
});
