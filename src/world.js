import * as THREE from 'three';
import { createNPC } from './npc-appearance.js';
import { NPC_PROFILES } from './npc-profiles.js';
import { Batches, signTexture } from './city.js';
import { material, createCar } from './models.js';
import { WORLD_OBJECTS, DISTRICTS, districtAt } from './content.js';

export const MAP_SPAN = 590;
export const SYMBOLS = { contact: '●', terminal: '◇', transit: 'T', rest: '+', board: '≡', memory: '◈', cache: '□' };
export const COLORS = { contact: '#deff7a', terminal: '#e8cd95', transit: '#7ee6e3', rest: '#7de5ad', board: '#e9ecbc', memory: '#c5a3ff', cache: '#a8bec9' };

export function expandCity(scene, city) {
  const b = new Batches(scene);
  const steel = material(0x304654), concrete = material(0x263946), dark = material(0x162734);
  const amber = material(0xeeaa65, 0xf09a42, .8), teal = material(0x77ddd5, 0x36b8c5, 1.5);
  const green = material(0x365b43, 0x153d29, .2), glass = material(0x477974, 0x19443e, .5, .3, .5);
  const paint = material(0x849598), road = material(0x1e2d38, 0, 0, .48, .4);
  function solid(mat, x, z, w, h, d, y = h / 2) {
    b.add(mat, x, y, z, w, h, d);
    city.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, maxY: y + h / 2 });
    city.mapInfo.push({ x, z, w, d, h });
  }
  function sign(title, subtitle, color, x, y, z, width = 17, yaw = 0) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 3.4), new THREE.MeshBasicMaterial({ map: signTexture(title, subtitle, color), side: THREE.DoubleSide, toneMapped: false }));
    mesh.position.set(x, y, z); mesh.rotation.y = yaw; scene.add(mesh);
  }
  // Continuous radial avenues and a perimeter road connect the four new districts.
  for (const s of [-192, 0, 192]) {
    b.add(road, s, .006, 0, 15, .01, 550);
    b.add(road, 0, .007, s, 550, .01, 15);
    for (let t = -270; t < 275; t += 9) {
      if (Math.abs(s) < 1 && Math.abs(t) < 142) continue;
      b.add(paint, s, .023, t, .12, .02, 4);
      b.add(paint, t, .024, s, 4, .02, .12);
    }
  }
  for (const [x, z] of [[0, 154], [0, -154], [154, 0], [-154, 0]]) {
    const horizontal = x !== 0;
    for (const side of [-1, 1]) b.add(steel, horizontal ? x : side * 10, 5.5, horizontal ? side * 10 : z, .4, 11, .4);
    b.add(steel, x, 11, z, horizontal ? .4 : 21, .4, horizontal ? 21 : .4);
    const d = districtAt(x * 1.05, z * 1.05);
    sign(d.name.toUpperCase(), 'VESPER / OUTER DISTRICTS', d.color, x, 9, z, 17, horizontal ? Math.PI / 2 : 0);
  }
  // Glass Gardens: greenhouse halls, cultivation beds and luminous trees.
  for (const x of [-242, -210, -178]) for (const z of [-65, 65]) {
    solid(glass, x, z, 22, 7, 23);
    for (let dx = -9; dx <= 9; dx += 6) b.add(steel, x + dx, 4, z, .17, 8, 23.4);
    b.add(teal, x, 7.15, z, 22.2, .15, 23.2);
  }
  for (const x of [-238, -212, -174]) for (const z of [-38, 40]) {
    solid(concrete, x, z, 8, .65, 9);
    b.add(green, x, .8, z, 7.6, .5, 8.6);
    for (let i = 0; i < 3; i++) b.add(material(0x81b774, 0x284b29, .3), x - 2 + i * 2, 1.4, z, .8, 1.2, 7);
  }
  for (const [x, z] of [[-258, -15], [-250, 33], [-163, 38], [-162, -33]]) {
    b.add(steel, x, 3, z, .45, 6, .45);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(3.5, 0), green); crown.position.set(x, 6, z); scene.add(crown);
  }
  sign('GLASS GARDENS', 'GROW SOMETHING THAT MATTERS', '#7de5ad', -208, 6, -44, 25);
  // Freightworks: stacked containers with generous routes between them.
  const containerMats = [material(0x966850), material(0x3b6574), material(0x777b56)];
  for (const x of [177, 202, 231, 259]) for (const z of [-57, 59]) {
    const h = x === 231 ? 8 : 4;
    solid(containerMats[Math.abs(x) % 3], x, z, 15, h, 13);
    for (let dx = -6; dx <= 6; dx += 2) b.add(steel, x + dx, h / 2, z + 6.6, .14, h, .12);
    b.add(amber, x, h + .1, z, 15, .13, 13);
  }
  solid(concrete, 246, 0, 13, 9, 14);
  b.add(amber, 246, 9.1, 0, 13.4, .15, 14.4);
  // A gantry crane frames the yard without blocking the road.
  for (const x of [175, 258]) solid(steel, x, -39, 1.5, 25, 2);
  b.add(amber, 216, 25, -39, 86, 2, 2);
  b.add(steel, 215, 18, -39, .18, 14, .18);
  sign('ROOK / REPAIR & REUSE', 'NOTHING IS BEYOND REPAIR', '#ffc077', 210, 7, 33, 27);
  // Rustwater: a broad public quay, mooring piers, cargo and a seawall.
  b.add(material(0x102f43, 0x092837, .3, .12, .75), 0, -.03, 280, 330, .03, 50);
  b.add(material(0x535857), 0, .025, 222, 128, .05, 68);
  for (const x of [-48, 0, 48]) {
    b.add(concrete, x, .07, 252, 20, .14, 40);
    for (const side of [-1, 1]) for (const z of [240, 253, 268]) b.add(steel, x + side * 9, 1, z, .3, 2, .3);
  }
  for (const x of [-68, 67]) solid(steel, x, 216, 19, 8, 36);
  for (const x of [-39, 35]) solid(containerMats[1], x, 181, 13, 4, 10);
  solid(steel, 0, 274, 150, 1, .5);
  // A low ferry silhouette, beyond the accessible pier.
  b.add(dark, 90, 1, 267, 20, 2.6, 36); b.add(concrete, 90, 4, 261, 14, 4, 16); b.add(teal, 90, 4.7, 252.8, 12, 1.4, .1);
  sign('RUSTWATER', 'EVERYONE DESERVES A WAY HOME', '#76e0e8', 0, 8, 186, 24);
  // Relay Ridge: a monumental mast, signal dishes and two breaker shelters.
  for (const x of [-49, 49]) {
    solid(concrete, x, -217, 15, 7, 26);
    b.add(material(0xbd659a, 0xb14591, 1.3), x, 7.15, -217, 15.3, .15, 26.3);
  }
  solid(dark, 0, -267, 17, 6, 17);
  for (const side of [-1, 1]) {
    b.add(steel, side * 5, 28, -267, .7, 50, .7);
    for (let y = 12; y < 51; y += 9) b.add(teal, 0, y, -267, 10, .18, .5);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(9, 20, 12, 0, Math.PI * 2, 0, Math.PI * .43), material(0x667c8b, 0x19384c, .5, .4, .65));
  dish.position.set(0, 47, -267); dish.rotation.x = Math.PI * .7; scene.add(dish);
  const beacon = new THREE.PointLight(0xf393c9, 120, 55, 2); beacon.position.set(0, 15, -245); scene.add(beacon);
  sign('CROWN / 09', 'CIVIC BROADCAST ARRAY', '#f393c9', 0, 11, -260, 23);
  // Low service architecture and lights give the linking roads scale.
  for (const [x, z] of [[-130, -185], [129, -195], [-128, 191], [126, 201], [-204, 128], [203, -126]]) {
    solid(concrete, x, z, 25, 14, 24);
    b.add(teal, x, 10, z + 12.1, 21, .3, .1);
  }
  for (let t = -262; t <= 270; t += 28) {
    if (Math.abs(t) < 145) continue;
    for (const [x, z] of [[10, t], [t, 10]]) {
      b.add(steel, x, 3.7, z, .18, 7.4, .18); b.add(teal, x, 7.4, z, 2.8, .15, .5);
    }
  }
  // Visible perimeter markers make the edge of the explorable world legible.
  for (let t = -270; t <= 270; t += 18) for (const [x, z] of [[t, -279], [t, 279], [-279, t], [279, t]]) {
    b.add(steel, x, .6, z, .4, 1.2, .4); b.add(amber, x, 1.3, z, .5, .15, .5);
  }
  for (const [x, z, yaw, color] of [[6, 155, Math.PI, 0x727d9a], [-155, -5, -Math.PI / 2, 0x659783], [156, -5, Math.PI / 2, 0xc28c64], [6, -160, 0, 0x98728d]]) {
    const car = createCar(color); car.root.position.set(x, .04, z); car.root.rotation.y = yaw; scene.add(car.root);
    city.cars.push({ ...car, x, z, yaw, speed: 0, spawn: { x, z, yaw } });
  }
  b.finish();
}

export function createWorldLife(scene, asset, game) {
  const objects = [], people = [], avatars = {};
  const ringGeometry = new THREE.TorusGeometry(.66, .025, 5, 28);
  const cacheGeometry = new THREE.BoxGeometry(.72, .48, .56);
  const chipGeometry = new THREE.OctahedronGeometry(.24);
  function labelTexture(text, color) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#091522de'; ctx.fillRect(2, 5, 508, 85);
    ctx.fillStyle = color; ctx.fillRect(2, 5, 4, 85); ctx.textAlign = 'center'; ctx.font = '600 26px Arial'; ctx.fillText(text.toUpperCase(), 256, 58, 480);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }
  for (const place of WORLD_OBJECTS) {
    const root = new THREE.Group(); root.position.set(place.x, .07, place.z); scene.add(root);
    const color = place.color ?? COLORS[place.type];
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8 });
    const ring = new THREE.Mesh(ringGeometry, mat); ring.rotation.x = -Math.PI / 2; root.add(ring);
    let body;
    if (place.type === 'contact' && !place.terminal) {
      const avatar = createNPC(asset, NPC_PROFILES[place.id]); avatars[place.id] = avatar;
      body = avatar.root; body.position.y = .08; body.rotation.y = place.yaw ?? 0;
      const { mixer, action } = avatar;
      if (action) { action.time = objects.length * .4 % action.getClip().duration; mixer.update(0); }
      people.push({ body, mixer, place }); root.add(body);
    } else if (place.type === 'memory') {
      body = new THREE.Mesh(chipGeometry, new THREE.MeshBasicMaterial({ color })); body.position.y = 1; root.add(body);
    } else if (place.type === 'cache') {
      body = new THREE.Mesh(cacheGeometry, material(0x556777, 0x23475a, .4)); body.position.y = .3; root.add(body);
      const band = new THREE.Mesh(new THREE.BoxGeometry(.74, .055, .58), mat); band.position.y = .48; root.add(band);
    } else {
      body = new THREE.Mesh(new THREE.BoxGeometry(place.type === 'transit' ? 1.05 : .72, 1.9, .4), material(0x203a48)); body.position.y = .95; root.add(body);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(.61, .6, .43), mat); screen.position.y = 1.4; root.add(screen);
      if (place.type === 'rest') { const bench = new THREE.Mesh(new THREE.BoxGeometry(2.5, .45, .9), material(0x39564e)); bench.position.set(0, .4, 1.2); root.add(bench); }
    }
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(`${SYMBOLS[place.type]}  ${place.name}`, color), transparent: true, depthTest: true }));
    label.position.y = 3; label.scale.set(4.4, .83, 1); root.add(label);
    objects.push({ ...place, root, body, ring, label });
  }
  return {
    objects, avatars,
    nearest(player) {
      return objects.filter(p => p.root.visible && Math.hypot(player.x - p.x, player.z - p.z) < (p.type === 'contact' ? 3.7 : 2.8)).sort((a, b) => Math.hypot(player.x - a.x, player.z - a.z) - Math.hypot(player.x - b.x, player.z - b.z))[0] ?? null;
    },
    update(dt, time, player) {
      const goal = game.objective(player);
      for (const p of objects) {
        p.root.visible = !game.data.collected.includes(p.id);
        const distance = Math.hypot(player.x - p.x, player.z - p.z);
        p.label.visible = distance < (p.id === goal.id ? 40 : 20);
        p.ring.material.opacity = .45 + Math.sin(time * 2 + p.x) * .15;
        if (p.type === 'memory') { p.body.rotation.y += dt; p.body.position.y = 1 + Math.sin(time * 2 + p.x) * .16; }
      }
      for (const p of people) {
        if (Math.hypot(player.x - p.place.x, player.z - p.place.z) > 65) { p.body.visible = false; continue; }
        p.body.visible = true; p.mixer.update(dt);
        if (Math.hypot(player.x - p.place.x, player.z - p.place.z) < 5) p.body.rotation.y = Math.atan2(-(player.x - p.place.x), -(player.z - p.place.z));
      }
    },
  };
}
