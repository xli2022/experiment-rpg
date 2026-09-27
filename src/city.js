import * as THREE from 'three';
import { material, createCar } from './models.js';
import { seededRandom } from './physics.js';

export const BLOCKS = [-96, -32, 32, 96];
export const STREETS = [-128, -64, 0, 64, 128];
const rand = seededRandom(93827);
const pick = a => a[Math.floor(rand() * a.length)];
const range = (a, b) => a + rand() * (b - a);
const box = new THREE.BoxGeometry(1, 1, 1);
const temp = new THREE.Object3D();

export class Batches {
  constructor(scene) { this.scene = scene; this.groups = new Map(); }
  add(mat, x, y, z, w, h, d, yaw = 0, tint) {
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push({ x, y, z, w, h, d, yaw, tint });
  }
  finish() {
    for (const [mat, entries] of this.groups) {
      const mesh = new THREE.InstancedMesh(box, mat, entries.length);
      entries.forEach((v, i) => {
        temp.position.set(v.x, v.y, v.z); temp.scale.set(v.w, v.h, v.d); temp.rotation.set(0, v.yaw, 0); temp.updateMatrix();
        mesh.setMatrixAt(i, temp.matrix);
        if (v.tint) mesh.setColorAt(i, new THREE.Color(v.tint));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.scene.add(mesh);
    }
  }
}

function windowTexture(style) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 512;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = ['#19212c', '#18252e', '#252333'][style]; ctx.fillRect(0, 0, 256, 512);
  for (let y = 5; y < 512; y += 22) for (let x = 7; x < 256; x += 24) {
    const lit = rand() > .44;
    ctx.fillStyle = lit ? pick(style === 1 ? ['#79a6ac', '#526e7e', '#91b9b6', '#667c89'] : ['#c3a16d', '#7e8fa0', '#b49770', '#465767', '#687890']) : '#0c1420';
    ctx.globalAlpha = lit ? range(.45, .95) : 1;
    ctx.fillRect(x, y, 13, 11);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0c1320'; ctx.fillRect(x + 6, y, 1, 11);
  }
  for (let y = 20; y < 512; y += 22) { ctx.fillStyle = '#090f1744'; ctx.fillRect(0, y, 256, 2); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function noiseTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 65 + rand() * 65; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(100, 100);
  return tex;
}

export function signTexture(title, subtitle, color, vertical = false) {
  const canvas = document.createElement('canvas'); canvas.width = vertical ? 256 : 1024; canvas.height = vertical ? 1024 : 384;
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#09131c'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color + '19'; ctx.fillRect(8, 8, w - 16, h - 16);
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(12, 12, w - 24, h - 24);
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 15; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (vertical) {
    ctx.font = '700 150px "Barlow Condensed", sans-serif';
    [...title].forEach((ch, i) => ctx.fillText(ch, w / 2, 110 + i * ((h - 210) / Math.max(title.length - 1, 1))));
  } else {
    ctx.font = `${title.length > 12 ? 100 : 146}px "Barlow Condensed", sans-serif`;
    ctx.fillText(title, w / 2, h * .43, w - 90);
    ctx.shadowBlur = 0; ctx.font = '28px "Barlow", sans-serif'; ctx.fillText(subtitle, w / 2, h * .77, w - 70);
    ctx.fillRect(35, h - 32, 95, 4); ctx.fillRect(w - 130, h - 32, 95, 4);
  }
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

function glowTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d'); const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(.25, 'rgba(255,255,255,0.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function createCity(scene) {
  const batches = new Batches(scene), colliders = [], buildings = [], cars = [], signs = [];
  const facadeMats = [0, 1, 2].map(i => {
    const tex = windowTexture(i);
    return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0xbacbdb), emissiveIntensity: .67, roughness: .8, metalness: .2 });
  });
  const concrete = material(0x202c3b, 0x070d18, .15);
  const roofMat = material(0x192331);
  const metal = material(0x334453, 0, 0, .45, .7);
  const sidewalk = material(0x2c3b46, 0x102126, .16, .72, .25);
  const curb = material(0x495253);
  const cyan = material(0x79e9e5, 0x1fbec9, 2.5);
  const pink = material(0xff549e, 0xdc126c, 2.4);
  const yellow = material(0xf4db89, 0xdfb65b, .7);
  const white = material(0x9baaa3, 0x667c7e, .15);
  const noise = noiseTexture();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: 0x202e3d, roughness: .34, metalness: .58, roughnessMap: noise, bumpMap: noise, bumpScale: .035 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.02; ground.receiveShadow = true; scene.add(ground);
  const glow = glowTexture();
  function reflection(x, z, color, sx = 9, sz = 19, opacity = .23) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshBasicMaterial({ map: glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, .026 + rand() * .005, z); scene.add(mesh);
  }
  const mapInfo = [];
  // Four-by-four walkable blocks, with streets at every 64 metres.
  for (const bx of BLOCKS) for (const bz of BLOCKS) {
    batches.add(sidewalk, bx, .12, bz, 47, .24, 47);
    for (const side of [-1, 1]) {
      batches.add(curb, bx + side * 23.6, .14, bz, .22, .28, 47.4);
      batches.add(curb, bx, .14, bz + side * 23.6, 47.4, .28, .22);
      for (let t = -22; t <= 22; t += 4) {
        batches.add(roofMat, bx + side * 21.6, .247, bz + t, 3.7, .008, .04);
        batches.add(roofMat, bx + t, .247, bz + side * 21.6, .04, .008, 3.7);
      }
    }
    for (const ox of [-10.5, 10.5]) for (const oz of [-10.5, 10.5]) {
      const x = bx + ox, z = bz + oz;
      const w = range(16, 19), d = range(16, 19), h = range(23, 69) + (rand() > .84 ? 32 : 0);
      const facade = pick(facadeMats);
      batches.add(facade, x, h / 2, z, w, h, d);
      batches.add(concrete, x, 2.6, z, w + .4, 5.2, d + .4);
      batches.add(roofMat, x, h + .25, z, w + .5, .5, d + .5);
      batches.add(concrete, x, h + 2, z, w * .63, 3.5, d * .7);
      batches.add(metal, x + w * .2, h + 4.3, z, 2.4, 2.2, 3.6);
      if (rand() > .55) { batches.add(metal, x, h + 7, z, .23, 14, .23); batches.add(pink, x, h + 14, z, .3, .3, .3); }
      for (const s of [-1, 1]) {
        for (const s2 of [-1, 1]) batches.add(concrete, x + s * (w / 2 + .045), h / 2, z + s2 * (d / 2 + .045), .28, h, .28);
        // Facade buttresses and exposed conduits give the towers a strong silhouette.
        batches.add(metal, x + s * w * .34, h / 2, z + d / 2 + .14, .24, h, .32);
        batches.add(metal, x + w / 2 + .14, h / 2, z + s * d * .34, .32, h, .24);
      }
      if (rand() > .52) {
        const neon = rand() > .5 ? cyan : pink;
        batches.add(neon, x + w / 2 + .19, h * .63, z - d * .4, .05, h * .7, .13);
        batches.add(neon, x - w * .4, h * .63, z + d / 2 + .19, .13, h * .7, .05);
      }
      for (let floor = 8; floor < h - 3; floor += 10) batches.add(concrete, x, floor, z, w + .24, .3, d + .24);
      const collider = { minX: x - w / 2 - .3, maxX: x + w / 2 + .3, minZ: z - d / 2 - .3, maxZ: z + d / 2 + .3, maxY: h + 4 };
      colliders.push(collider); buildings.push(collider); mapInfo.push({ x, z, w, d, h });
    }
  }
  // Horizon architecture is cheap instanced geometry, beyond the playable streets.
  for (let i = 0; i < 94; i++) {
    const angle = i / 94 * Math.PI * 2; const radius = range(365, 465);
    const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius, h = range(45, 145);
    const w = range(15, 34), d = range(14, 31);
    batches.add(pick(facadeMats), x, h / 2, z, w, h, d);
    batches.add(roofMat, x, h + 3, z, w * .6, 6, d * .6);
    if (i % 5 === 0) batches.add(pink, x, h + 6.1, z, w * .6, .1, .3);
  }
  // Road paint, crossings, parking bays, manholes, and repeated street furniture.
  for (const street of STREETS) {
    for (let t = -145; t <= 145; t += 5.8) {
      if (STREETS.some(s => Math.abs(t - s) < 10)) continue;
      for (const side of [-1, 1]) {
        batches.add(yellow, street + side * .13, .015, t, .085, .02, 3.6);
        batches.add(yellow, t, .016, street + side * .13, 3.6, .02, .085);
        batches.add(white, street + side * 5.1, .018, t, .1, .025, 2.5);
        batches.add(white, t, .018, street + side * 5.1, 2.5, .025, .1);
      }
    }
    for (const cross of STREETS) {
      for (let i = -6; i <= 6; i += 1.5) for (const side of [-1, 1]) {
        batches.add(white, street + i, .019, cross + side * 9.8, .7, .025, 2.7);
        batches.add(white, street + side * 9.8, .019, cross + i, 2.7, .025, .7);
      }
    }
    for (let t = -115; t < 130; t += 32) for (const side of [-1, 1]) {
      const x = street + side * 9.5;
      batches.add(metal, x, 4.2, t, .16, 8.4, .16);
      batches.add(metal, x - side * 1.6, 8.25, t, 3.3, .16, .15);
      batches.add(cyan, x - side * 2.4, 8.1, t, 1.5, .08, .35);
      batches.add(roofMat, x - side * 2.4, 8.23, t, 1.6, .18, .5);
      if (Math.abs(street) < 1) reflection(x - side * 3, t, side > 0 ? 0x42b5c9 : 0xff339b, 11, 15, .29);
      if (Math.abs(street) < 70 && Math.abs(t) < 100) {
        for (let k = -1; k <= 1; k++) batches.add(metal, x + side * .3, .7, t + 3 + k * 1.4, .14, 1.4, .14);
      }
    }
  }
  function sign(title, subtitle, color, x, y, z, w, h, yaw = 0, vertical = false) {
    const tex = signTexture(title, subtitle, color, vertical);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }));
    mesh.position.set(x, y, z); mesh.rotation.y = yaw; scene.add(mesh); signs.push(mesh);
    batches.add(roofMat, x - Math.sin(yaw) * .22, y, z - Math.cos(yaw) * .22, w + .3, h + .3, .22, yaw);
    return mesh;
  }
  const shops = [['SYNAPSE', 'A BETTER VERSION OF YOU', '#5ff4df'], ['AFTER HOURS', 'NO SLEEP. NO LIMITS.', '#fa58ab'], ['NOVA', 'SYNTHETIC DREAMS / REAL CONNECTION', '#bd9fff'], ['KŌJI', 'RAMEN BAR / OPEN ALL NIGHT', '#ffab65'], ['VOLT', 'CHARGE YOUR OTHER LIFE', '#dcf994'], ['HALO', 'AUGMENTATION CLINIC', '#7dccfa'], ['DEEP BLUE', 'SOUND FROM THE UNDERGROUND', '#60b3ff'], ['NEURO', 'REWRITE YOUR REALITY', '#fc779f']];
  for (const bx of BLOCKS) for (const bz of BLOCKS) {
    const info = pick(shops); const facing = bx < 0 ? 1 : -1;
    const x = bx + facing * 20.3;
    sign(...info, x, 5.0, bz + 10, 10.5, 3.1, facing * Math.PI / 2);
    const info2 = pick(shops);
    sign(...info2, bx + 10, 5.1, bz + (bz < 0 ? 20.4 : -20.4), 11, 3.1, bz < 0 ? 0 : Math.PI);
    // Shop shutters, awnings and entry lamps.
    for (let i = -1; i <= 1; i++) {
      batches.add(metal, x + facing * .04, 1.7, bz + 10 + i * 3.3, .1, 2.9, 2.7);
      batches.add(cyan, x + facing * .1, 3.05, bz + 10 + i * 3.3, .1, .07, 2.5);
    }
    batches.add(roofMat, x + facing * .8, 3.65, bz + 10, 2, .14, 11.3);
    if (Math.abs(bx) === 32) {
      sign(pick(['HOTEL', 'NEON', 'OPEN', 'NOVA']), '', pick(['#fd569d', '#6ce8e2', '#cced92']), x + facing * 1.1, 17, bz - 7, 2.2, 11, facing * Math.PI / 2, true);
      reflection(x + facing * 5, bz + 10, new THREE.Color(info[2]), 11, 27, .46);
    }
  }
  // Hero billboards frame the starting boulevard.
  sign('夢を見る', 'DREAM BEYOND YOUR BODY', '#fa59ab', -11.2, 20, -26, 16, 8, Math.PI / 2);
  sign('SYN / APSE', 'UPGRADE YOUR EXISTENCE', '#67f0df', 11.2, 16, -18, 13, 6, -Math.PI / 2);
  sign('夜 市', 'NIGHT MARKET / 24 HOURS', '#e9ee97', -11.1, 7, 18, 10, 3.4, Math.PI / 2);
  sign('09', 'NEON QUARTER', '#b796e9', 11.2, 26, 17, 9, 11, -Math.PI / 2);
  sign('KŌJI', 'RAMEN / OPEN 24 HOURS', '#ffb378', -11.2, 4.7, 37, 9, 2.6, Math.PI / 2);
  sign('VESPER RADIO', '98.4 FM / STAY AWAKE', '#77eee4', 11.2, 6.4, 32, 9, 3.2, -Math.PI / 2);
  sign('VESPER', '夜 の 街  /  NEON QUARTER', '#e8f1ac', 0, 11.4, -6, 12.5, 3.3, 0);
  batches.add(metal, -8, 9, -6.2, .17, 18, .17);
  batches.add(metal, 8, 9, -6.2, .17, 18, .17);
  batches.add(metal, 0, 13.3, -6.2, 16.2, .18, .2);
  batches.add(cyan, 0, 9.68, -6.0, 12.5, .04, .08);
  sign('THE FUTURE FEELS DIFFERENT.', 'VESPER CITY / MAKE YOUR MARK', '#8fe3d4', -29, 44, -12.1, 23, 6, 0);
  sign('NO SIGNAL', 'TUNE OUT. DROP IN.', '#fa9c83', 27, 9, -12.1, 12, 4, 0);
  // An elevated service bridge and cables break up the skyline.
  batches.add(metal, 0, 24, -48, 28, 1.15, 4);
  batches.add(facadeMats[1], 0, 26, -48, 26, 3.2, 3.5);
  batches.add(cyan, 0, 23.48, -46.1, 26, .065, .1);
  batches.add(metal, 0, 28, -48, 28, .4, 4.5);
  for (const z of [-10, 58]) {
    const pts = [];
    for (let i = 0; i <= 20; i++) pts.push(new THREE.Vector3(-16 + i * 1.6, 13 - Math.sin(i / 20 * Math.PI) * 2.5, z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x1b2636 })); scene.add(line);
  }
  // Street kiosks, cargo and utility boxes.
  for (const z of [-94, -37, 39, 84]) for (const side of [-1, 1]) {
    const x = side * 10.8;
    batches.add(metal, x, 1.25, z, 1, 2.5, .7);
    batches.add(cyan, x - side * .52, 1.7, z, .03, .7, .47);
    batches.add(roofMat, x - side * .53, .9, z, .03, .15, .4);
    colliders.push({ minX: x - .55, maxX: x + .55, minZ: z - .4, maxZ: z + .4, maxY: 2.5 });
  }
  for (let i = 0; i < 34; i++) {
    const x = pick([-11, 11, -53, 53]), z = range(-115, 115);
    if (STREETS.some(s => Math.abs(z - s) < 14)) continue;
    batches.add(roofMat, x, .55, z, .75, 1.1, .7);
    batches.add(metal, x, 1.13, z, .82, .06, .75);
  }
  // A bright starting car, plus cars around every district.
  const carSpecs = [[4.4, 21, 0, 0xa5c0b9], [-6.4, -26, Math.PI, 0x845077], [6, -78, 0, 0x3b727c], [69.5, 35, 0, 0x8c6e43], [-59, 14, Math.PI, 0x415886], [-28, -58, Math.PI / 2, 0xb29280], [26, 69.5, -Math.PI / 2, 0x455164], [6, 91, Math.PI, 0x647d64]];
  for (const [x, z, yaw, color] of carSpecs) {
    const model = createCar(color); model.root.position.set(x, .04, z); model.root.rotation.y = yaw; scene.add(model.root);
    cars.push({ ...model, x, z, yaw, speed: 0, spawn: { x, z, yaw } });
    reflection(x, z, 0x4cd5e5, 4, 7, .35);
  }
  batches.finish();
  // Cheap neon light pools; only a handful of real lights are used for the whole city.
  [[-9, 6, 19, 0xf13b87, 95], [10, 7, -13, 0x2ad9dd, 110], [-10, 9, -30, 0xee318e, 95], [9, 10, 27, 0x789aec, 75]].forEach(([x, y, z, c, power]) => {
    const light = new THREE.PointLight(c, power, 35, 1.8); light.position.set(x, y, z); scene.add(light);
  });
  // Ground mist particles and rain are animated in the main loop.
  const rainCount = 1100, positions = new Float32Array(rainCount * 6);
  for (let i = 0; i < rainCount; i++) {
    const x = range(-45, 45), y = range(0, 37), z = range(-45, 45);
    positions.set([x, y, z, x - .055, y + .52, z], i * 6);
  }
  const rainGeom = new THREE.BufferGeometry(); rainGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const rain = new THREE.LineSegments(rainGeom, new THREE.LineBasicMaterial({ color: 0x8db3ce, transparent: true, opacity: .19, depthWrite: false })); rain.frustumCulled = false; scene.add(rain);
  const motesGeometry = new THREE.BufferGeometry(); const motesArray = new Float32Array(160 * 3);
  for (let i = 0; i < 160; i++) motesArray.set([range(-50, 50), range(.3, 9), range(-50, 50)], i * 3);
  motesGeometry.setAttribute('position', new THREE.BufferAttribute(motesArray, 3));
  const motes = new THREE.Points(motesGeometry, new THREE.PointsMaterial({ color: 0xc3ffe4, size: .055, transparent: true, opacity: .55, depthWrite: false })); scene.add(motes);
  return { colliders, buildings, cars, mapInfo, rain, motes, signs, reflection };
}

export function addSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vWorld; void main(){vWorld=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vWorld; void main(){float h=normalize(vWorld).y; vec3 col=mix(vec3(.087,.13,.20),vec3(.016,.023,.055),smoothstep(0.,.72,h)); float glow=pow(max(0.,1.-abs(h-.07)),15.); col+=vec3(.065,.018,.07)*glow; gl_FragColor=vec4(col,1.);}`,
  })); scene.add(sky);
}
