import * as THREE from 'three';
import { createCityPlan, footprint } from './city-plan.js';
import { Metropolis } from './metropolis.js';
import { SpatialGrid } from './spatial-grid.js';
import { CHUNK_SIZE, WORLD_LIMIT } from './world-config.js';
import { WORLD_OBJECTS } from './content.js';
import { buildingStructure } from './architecture.js';
import { PUBLIC_SPACES, publicSpaceParts, publicSpaceColliders } from './public-spaces.js';
import { createGroundGeometry } from './ground.js';
import { createTerrainMaterials } from './terrain-materials.js';
import { CORE_ROADS } from './roads.js';

function palette() {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#626b70'; ctx.fillRect(0, 0, 128, 256);
  for (let y = 8; y < 256; y += 25) for (let x = 6; x < 128; x += 24) {
    ctx.fillStyle = (x * 7 + y * 3) % 11 > 4 ? '#e8d6a4' : '#273944'; ctx.fillRect(x, y, 12, 15);
    ctx.fillStyle = '#67737b'; ctx.fillRect(x, y + 14, 13, 2);
  }
  const atlas = new THREE.CanvasTexture(canvas); atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.wrapS = atlas.wrapT = THREE.RepeatWrapping;
  const facade = new THREE.MeshStandardMaterial({ color: 0xffffff, map: atlas, emissiveMap: atlas, emissive: 0xc2d4e1, emissiveIntensity: .32, roughness: .72, metalness: .17 });
  // Scale the shared atlas by each instance's dimensions: a 70 m tower should
  // have more floors than a 12 m terrace, not windows six metres high.
  facade.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_INSTANCING
        float frontage = abs(normal.x) > 0.5 ? length(instanceMatrix[2].xyz) : length(instanceMatrix[0].xyz);
        vec2 facadeScale = vec2(frontage / 12.0, length(instanceMatrix[1].xyz) / 30.0);
        vMapUv *= facadeScale;
        vEmissiveMapUv *= facadeScale;
      #endif`);
  };
  facade.customProgramCacheKey = () => 'facade-metres-v1';
  return {
    stone: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .88, metalness: .08 }),
    facade,
    glass: new THREE.MeshStandardMaterial({ color: 0x5c858c, emissive: 0x152d3b, emissiveIntensity: .6, roughness: .35, metalness: .6 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    road: new THREE.MeshStandardMaterial({ color: 0x263540, roughness: .86, metalness: 0 }),
  };
}
const districtColors = { sunset: 0xc8a892, cypress: 0x97b1a3, signal: 0x8396b1, civic: 0xc1beb0, foundry: 0x8c8274, southbank: 0x93a9b9, promenade: 0xacc3c0, lantern: 0xc39397 };

export function createCityScenery(scene, city, stream) {
  const mats = palette(), plan = createCityPlan(WORLD_OBJECTS), metro = new Metropolis(WORLD_OBJECTS);
  // One resident floor owns each location. Overlaid streamed tiles could expose a
  // different-colored base or compete with it in the depth buffer while driving.
  const terrain = createTerrainMaterials();
  const groundTerrain = ['paving', 'grass'].map(kind => {
    const material = terrain[kind].clone(); material.vertexColors = true;
    material.onBeforeCompile = terrain[kind].onBeforeCompile;
    material.customProgramCacheKey = terrain[kind].customProgramCacheKey;
    return material;
  });
  const isGreen = (x, z) => metro.hasParkInArea(x, z, x + CHUNK_SIZE, z + CHUNK_SIZE) || x < -320 && z < -250 && z > -760;
  city.ground.geometry.dispose();
  city.ground.geometry = createGroundGeometry({ colorAt: (x, z) => {
    return isGreen(x, z) ? 0x304d45 : 0x42545c;
  }, surfaceAt: (x, z) => isGreen(x, z) ? 'grass' : 'paving' });
  city.ground.rotation.set(0, 0, 0); city.ground.position.y = 0;
  city.ground.material = [city.ground.material, ...groundTerrain];
  plan.features = [];
  // Pocket parks fill the original region's unused corners and repeat throughout
  // the metropolis. Keep story actors, driveable avenues and landmarks clear.
  for (const [i, [x, z]] of [[-245, -137], [135, 245], [-246, 137], [132, -247], [-135, 244]].entries()) {
    const feature = { x, z, type: PUBLIC_SPACES[i] };
    plan.features.push(feature); plan.colliders.push(...publicSpaceColliders(feature));
  }
  for (const bx of [-96, -32, 32, 96]) for (const bz of [-96, -32, 32, 96]) for (const side of [-1, 1]) {
    const x = bx + side * 22, z = bz + side * 22;
    if (WORLD_OBJECTS.some(p => Math.hypot(p.x - x, p.z - z) < 4)) continue;
    plan.trees.push({ x, z, size: .72, type: (bx + bz) % 64 === 0 ? 'cypress' : 'broadleaf' });
    plan.colliders.push(footprint(x, z, .28, .28, 0, 3.75));
  }
  const baseColliders = [...city.colliders, ...plan.colliders], index = new SpatialGrid(baseColliders);
  city.colliders = baseColliders; city.metropolis = metro; city.plan = plan;
  city.spatial = {
    query(minX, minZ, maxX, maxZ) { return index.query(minX, minZ, maxX, maxZ).concat(metro.collidersIn(minX, minZ, maxX, maxZ)); },
    near(x, z, radius) { return this.query(x - radius, z - radius, x + radius, z + radius); },
    along(origin, direction, distance) { const x = origin.x + direction.x * distance, z = origin.z + direction.z * distance; return this.query(Math.min(origin.x, x) - .5, Math.min(origin.z, z) - .5, Math.max(origin.x, x) + .5, Math.max(origin.z, z) + .5); },
  };
  city.mapInfo.push(...plan.buildings);
  city.mapRoads = plan.roads; city.mapView = { x: 0, z: 0, span: 1200 };
  city.roadIndex = new SpatialGrid([], 96);
  for (const road of [...CORE_ROADS, ...plan.roads]) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i];
    city.roadIndex.add({ a, b, width: road.width, authored: road.authored, minX: Math.min(a.x, b.x) - 14, maxX: Math.max(a.x, b.x) + 14, minZ: Math.min(a.z, b.z) - 14, maxZ: Math.max(a.z, b.z) + 14 });
  }
  const inCell = (p, c) => Math.floor(p.x / CHUNK_SIZE) === c.cx && Math.floor(p.z / CHUNK_SIZE) === c.cz;
  const core = new Map();
  for (const kind of ['buildings', 'trees', 'props', 'features']) for (const item of (kind === 'buildings' ? [...city.buildings, ...plan.buildings] : plan[kind])) {
    const key = `${Math.floor(item.x / CHUNK_SIZE)},${Math.floor(item.z / CHUNK_SIZE)}`;
    if (!core.has(key)) core.set(key, { buildings: [], trees: [], props: [], features: [] });
    core.get(key)[kind].push(item);
  }
  function builder(c) {
    return (mat, x, y, z, w, h, d, yaw = 0, tint, detail = false, shape = 'box') => stream.add(mat, x, y, z, w, h, d, yaw, tint, detail, shape, c);
  }
  function building(p, add) {
    const { x, z, w, d, h, yaw, type } = p;
    const tint = new THREE.Color(districtColors[p.district]).offsetHSL((p.variation - .5) * .08, 0, (p.variation - .5) * .16).getHex();
    const part = (mat, lx, y, lz, sw, sh, sd, color, detail = true, shape = 'box') => add(mat, x + lx * Math.cos(yaw) + lz * Math.sin(yaw), y, z - lx * Math.sin(yaw) + lz * Math.cos(yaw), sw, sh, sd, yaw, color, detail, shape);
    for (const piece of buildingStructure(p)) part(mats[piece.mat], piece.x, piece.y, piece.z, piece.w, piece.h, piece.d, piece.tint ?? tint, false);
    part(mats.glass, 0, 1.5, d / 2 + .2, 2, 2.8, .3);
    // Shared storefronts and light strips carry the old quarter's night-city
    // language into every neighborhood, using the same instanced materials.
    const neon = p.variation > .5 ? 0x79d5cb : 0xda8bab;
    part(mats.glow, 0, 3.4, d / 2 + .16, w * .72, .24, .12, neon);
    for (const side of [-1, 1]) part(mats.stone, side * w * .4, h / 2, d / 2 + .12, .2, h, .2, 0x455966);
    if (type === 'terrace') {
      for (let y = 4; y < h - 1; y += 3.2) for (const s of [-1, 0, 1]) {
        part(mats.stone, s * w * .29, y, d / 2 + .28, w * .23, 2.5, .65, tint);
        part(mats.glass, s * w * .29, y + .08, d / 2 + .65, w * .16, 1.8, .12);
        part(mats.stone, s * w * .29, y - 1.14, d / 2 + .7, w * .27, .18, 1, 0xd6c5af);
      }
      part(mats.stone, 0, h - .2, d / 2 + .3, w + .6, .3, .65, 0xcab89f);
    } else if (type === 'apartment') {
      for (let y = 5; y < h - 2; y += 4.5) {
        part(mats.stone, 0, y, d / 2 + .35, w * .9, .22, 1.5, 0x899eaa);
        part(mats.stone, 0, y + .8, d / 2 + 1, w * .9, .65, .13, 0x415c69);
      }
    } else if (type === 'office') {
      for (const s of [-1, 1]) part(mats.glow, s * w * .48, h * .5, d / 2 + .05, .15, h * .84, .14, 0x70b9bd);
      part(mats.stone, 0, h + 11, 0, .3, 8, .3, 0x9cb9c4, false);
      part(mats.glow, 0, h + 15, 0, .4, .4, .4, 0xec9895, false);
    } else if (type === 'warehouse' || type === 'factory') {
      for (let i = -1; i <= 1; i++) {
        part(mats.glass, i * w * .29, 2.8, d / 2 + .1, w * .22, 5, .2);
      }
    } else if (type === 'civic') {
      for (let i = -2; i <= 2; i++) part(mats.stone, i * w * .18, h * .42, d / 2 + .5, .7, h * .8, .7, 0xe0cfb0, true, 'trunk');
    } else if (type === 'greenhouse') {
      for (let i = -2; i <= 2; i++) part(mats.stone, i * w * .2, h / 2, 0, .16, h + .7, d + .1, 0x9fb7b1);
    } else if (type === 'market') {
      for (let i = -2; i <= 2; i++) {
        part(mats.stone, i * w * .19, 3.1, d / 2 + .4, w * .18, .25, 1.8, i % 2 ? 0x8bada0 : 0xe7c39d);
        part(mats.glow, i * w * .19, 4.2, d / 2 + .07, w * .15, .45, .1, 0xeab16a);
      }
    }
  }
  function tree(p, add) {
    const s = p.size, { x, z } = p;
    add(mats.stone, x, 2.6 * s, z, .28 * s, 5.2 * s, .28 * s, 0, 0x605d51, false, 'trunk');
    if (p.type === 'cypress') {
      add(mats.stone, x, 5.5 * s, z, 2 * s, 7.5 * s, 2 * s, 0, 0x476f66, false, 'cone');
      add(mats.stone, x, 4.1 * s, z, 2.4 * s, 5 * s, 2.4 * s, 0, 0x34574f, true, 'cone');
    } else if (p.type === 'palm') {
      for (let i = 0; i < 5; i++) add(mats.stone, x, 5.7 * s, z, 3.1 * s, .38 * s, .8 * s, i * Math.PI / 5, 0x729581, false, 'crown');
    } else {
      add(mats.stone, x, 5.7 * s, z, 3 * s, 2.6 * s, 2.8 * s, 0, 0x638977, false, 'crown');
      add(mats.stone, x - 1.1 * s, 4.5 * s, z + .7 * s, 2 * s, 1.8 * s, 2 * s, 0, 0x405e54, true, 'crown');
      add(mats.stone, x + s, 5.1 * s, z - .8 * s, 2 * s, 2.2 * s, 1.8 * s, .4, 0x79977a, true, 'crown');
    }
  }
  function prop(p, add) {
    const { x, z, yaw = 0 } = p;
    const box = (y, w, h, d, tint, mat = mats.stone) => add(mat, x, y, z, w, h, d, yaw, tint, false);
    if (p.type === 'lamp') { box(3.5, .15, 7, .15, 0x597581); box(7, 2.5, .22, .55, 0x769096); box(6.84, 2.1, .05, .4, 0xf1d5a2, mats.glow); }
    else if (p.type === 'bench') { box(.55, 2.5, .18, .75, 0x92735d); box(.25, 1.9, .5, .4, 0x334f5d); box(1.05, 2.5, .5, .15, 0x92735d); }
    else if (p.type === 'planter') { box(.42, 1.1, .84, 1.1, 0x778f8d); box(.95, 1, .45, 1, 0x658e69); }
    else if (p.type === 'kiosk') { box(1.1, .65, 2.2, .65, 0x506b7d); box(1.5, .67, .55, .67, 0x81c4bd, mats.glow); }
    else { box(.55, .65, 1.1, .65, 0x516a65); box(1.14, .75, .13, .75, 0x91a59a); }
  }
  function roadSegment(s, add) {
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, length = Math.hypot(dx, dz);
    const x = (s.a.x + s.b.x) / 2, z = (s.a.z + s.b.z) / 2, yaw = Math.atan2(dx, dz);
    add(mats.stone, x, .006, z, s.width + 5, .016, length + .4, yaw, 0x57686d);
    add(mats.road, x, .02, z, s.width, .014, length + .4, yaw);
    const crossing = city.roadIndex.query(s.minX, s.minZ, s.maxX, s.maxZ)
      .concat(metro.roadIndex.query(s.minX, s.minZ, s.maxX, s.maxZ)).filter(q => {
        const qx = q.b.x - q.a.x, qz = q.b.z - q.a.z;
        return Math.abs(dx * qx + dz * qz) < .92 * length * Math.hypot(qx, qz);
      });
    const atJunction = (px, pz) => crossing.some(q => {
      const qx = q.b.x - q.a.x, qz = q.b.z - q.a.z;
      const t = Math.max(0, Math.min(1, ((px - q.a.x) * qx + (pz - q.a.z) * qz) / (qx * qx + qz * qz)));
      return Math.hypot(px - q.a.x - t * qx, pz - q.a.z - t * qz) < q.width / 2 + 1.5;
    });
    for (let t = 3; t < length; t += 10) {
      const px = s.a.x + dx * t / length, pz = s.a.z + dz * t / length;
      if (!atJunction(px, pz)) add(mats.stone, px, .035, pz, .15, .01, Math.min(4, length - t), yaw, 0xd8c89b, true);
    }
    // Leave intersections open instead of painting lane edges across crossing traffic.
    for (const side of [-1, 1]) for (let t = 0; t < length; t += 3) {
      const size = Math.min(3, length - t), along = (t + size / 2) / length;
      const px = s.a.x + dx * along + Math.cos(yaw) * (s.width / 2 - .5) * side;
      const pz = s.a.z + dz * along - Math.sin(yaw) * (s.width / 2 - .5) * side;
      if (!atJunction(px, pz)) add(mats.stone, px, .032, pz, .12, .01, size + .015, yaw, 0x9eaeb0, true);
    }
  }
  stream.populate = c => {
    const add = builder(c), local = core.get(c.key);
    const blocks = metro.area(c.x, c.z, c.x + CHUNK_SIZE, c.z + CHUNK_SIZE);
    for (const data of [local, ...blocks]) {
      if (!data) continue;
      for (const b of data.buildings) if (inCell(b, c)) building(b, add);
      for (const t of data.trees) if (inCell(t, c)) tree(t, add);
      for (const p of data.props) if (inCell(p, c)) prop(p, add);
      for (const f of data.features) if (inCell(f, c)) for (const p of publicSpaceParts(f.type)) {
        let mat = mats[p.mat];
        if (p.mat === 'stone' && p.h < .13 && Math.min(p.w, p.d) >= 2) {
          mat = p.y > .5 ? terrain.soil : f.type === 'garden' && p.w === 40 && p.d === 40 ? terrain.grass : terrain.paving;
        }
        add(mat, f.x + p.x, p.y, f.z + p.z, p.w, p.h, p.d, 0, p.tint, p.detail, p.shape);
      }
    }
    const segments = city.roadIndex.query(c.x - 1, c.z - 1, c.x + CHUNK_SIZE + 1, c.z + CHUNK_SIZE + 1)
      .concat(metro.roadIndex.query(c.x - 30, c.z - 30, c.x + CHUNK_SIZE + 30, c.z + CHUNK_SIZE + 30));
    for (const s of segments) if (!s.authored && inCell({ x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 }, c)) roadSegment(s, add);
    // Perimeter fence is generated only in the boundary cells.
    for (let t = 0; t < CHUNK_SIZE; t += 12) for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
      const edge = sign * (WORLD_LIMIT - 1), x = axis === 'x' ? edge : c.x + t, z = axis === 'z' ? edge : c.z + t;
      if (inCell({ x, z }, c) && Math.abs(x) < WORLD_LIMIT && Math.abs(z) < WORLD_LIMIT) {
        add(mats.stone, x, .8, z, .3, 1.6, .3, 0, 0x9bafa8); add(mats.glow, x, 1.7, z, .4, .14, .4, 0, 0xe6c68a);
        add(mats.stone, x + (axis === 'z' ? 6 : 0), 1.1, z + (axis === 'x' ? 6 : 0), axis === 'x' ? .18 : 12, .18, axis === 'x' ? 12 : .18, 0, 0x9bafa8);
      }
    }
  };
  return { plan, metro };
}
