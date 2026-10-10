import * as THREE from 'three';
import { createNPC } from '../../actors/npc-appearance.js';
import { NPC_PROFILES } from '../../actors/npc-profiles.js';
import { material } from '../../core/mesh-kit.js';
import { WORLD_OBJECTS } from './content.js';

export const SYMBOLS = { contact: '●', terminal: '◇', transit: 'T', rest: '+', board: '≡', memory: '◈', cache: '□' };
export const COLORS = { contact: '#deff7a', terminal: '#e8cd95', transit: '#7ee6e3', rest: '#7de5ad', board: '#e9ecbc', memory: '#c5a3ff', cache: '#a8bec9' };
export const WORLD_LABEL_LAYOUT = Object.freeze({ rootOffsetY: .07, offsetY: 3, width: 4.4, height: .83 });

export function createWorldLife(scene, asset, game, humanBases = {}) {
  const objects = [], people = [], avatars = {}, owned = [];
  // Geometry and materials made here (not mesh-kit's shared ones), released by dispose().
  const own = resource => { owned.push(resource); return resource; };
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), bounds = new THREE.Sphere(new THREE.Vector3(), 3.5);
  const ringGeometry = own(new THREE.TorusGeometry(.66, .025, 5, 28));
  const cacheGeometry = own(new THREE.BoxGeometry(.72, .48, .56));
  const chipGeometry = own(new THREE.OctahedronGeometry(.24));
  function labelTexture(text, color) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#091522de'; ctx.fillRect(2, 5, 508, 85);
    ctx.fillStyle = color; ctx.fillRect(2, 5, 4, 85); ctx.textAlign = 'center'; ctx.font = '600 26px Arial'; ctx.fillText(text.toUpperCase(), 256, 58, 480);
    const texture = own(new THREE.CanvasTexture(canvas)); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }
  for (const place of WORLD_OBJECTS) {
    const root = new THREE.Group(); root.position.set(place.x, (place.y ?? 0) + WORLD_LABEL_LAYOUT.rootOffsetY, place.z); scene.add(root);
    const color = place.color ?? COLORS[place.type];
    const mat = own(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8 }));
    const ring = new THREE.Mesh(ringGeometry, mat); ring.rotation.x = -Math.PI / 2; root.add(ring);
    let body;
    if (place.type === 'contact' && !place.terminal) {
      const profile = NPC_PROFILES[place.id], humanAsset = humanBases[profile.baseModel] ?? asset;
      const avatar = createNPC(humanAsset, profile); avatars[place.id] = avatar;
      avatar.root.userData.baseModel = humanAsset === asset ? 'citizen' : profile.baseModel;
      body = avatar.root; body.position.y = .008 - WORLD_LABEL_LAYOUT.rootOffsetY; body.rotation.y = place.yaw ?? 0;
      const { mixer, action } = avatar;
      if (action) { action.time = objects.length * .4 % action.getClip().duration; avatar.update(0); }
      people.push({ body, mixer, avatar, place }); root.add(body);
    } else if (place.type === 'memory') {
      body = new THREE.Mesh(chipGeometry, own(new THREE.MeshBasicMaterial({ color }))); body.position.y = 1; root.add(body);
    } else if (place.type === 'cache') {
      body = new THREE.Mesh(cacheGeometry, material(0x556777, 0x23475a, .4)); body.position.y = .3; root.add(body);
      const band = new THREE.Mesh(own(new THREE.BoxGeometry(.74, .055, .58)), mat); band.position.y = .48; root.add(band);
    } else {
      body = new THREE.Mesh(own(new THREE.BoxGeometry(place.type === 'transit' ? 1.05 : .72, 1.9, .4)), material(0x203a48)); body.position.y = .95; root.add(body);
      const screen = new THREE.Mesh(own(new THREE.BoxGeometry(.61, .6, .43)), mat); screen.position.y = 1.4; root.add(screen);
      if (place.type === 'rest') { const bench = new THREE.Mesh(own(new THREE.BoxGeometry(2.5, .45, .9)), material(0x39564e)); bench.position.set(0, .4, 1.2); root.add(bench); }
    }
    const label = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: labelTexture(`${SYMBOLS[place.type]}  ${place.name}`, color), transparent: true, depthTest: true })));
    label.position.y = place.labelHeight ?? WORLD_LABEL_LAYOUT.offsetY;
    label.scale.set(WORLD_LABEL_LAYOUT.width, WORLD_LABEL_LAYOUT.height, 1); root.add(label);
    objects.push({ ...place, root, body, ring, label });
  }
  return {
    objects, avatars,
    /** Remove everything from the scene and release what this module created. */
    dispose() {
      for (const object of objects) scene.remove(object.root);
      for (const avatar of Object.values(avatars)) avatar.dispose?.();
      for (const resource of owned.splice(0)) resource.dispose();
    },
    nearest(player) {
      if (player.climb) return null;
      return objects.filter(p => !game.data.collected.includes(p.id) && Math.abs(player.y - (p.y ?? 0)) < 2.5 && Math.hypot(player.x - p.x, player.z - p.z) < (p.type === 'contact' ? 3.7 : 2.8)).sort((a, b) => Math.hypot(player.x - a.x, player.z - a.z) - Math.hypot(player.x - b.x, player.z - b.z))[0] ?? null;
    },
    update(dt, time, player, radius = 65, camera) {
      const goal = game.objective(player);
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection);
      for (const p of objects) {
        const distance = Math.hypot(player.x - p.x, player.z - p.z);
        bounds.center.set(p.x, (p.y ?? 0) + 1.5, p.z);
        p.root.visible = !game.data.collected.includes(p.id) && distance < radius + 25 && frustum.intersectsSphere(bounds);
        if (!p.root.visible) { if (p.root.parent) scene.remove(p.root); continue; }
        if (!p.root.parent) scene.add(p.root);
        p.label.visible = distance < (p.id === goal.id ? 40 : 20);
        p.ring.material.opacity = .45 + Math.sin(time * 2 + p.x) * .15;
        if (p.type === 'memory') { p.body.rotation.y += dt; p.body.position.y = 1 + Math.sin(time * 2 + p.x) * .16; }
      }
      for (const p of people) {
        const distance = Math.hypot(player.x - p.place.x, player.z - p.place.z);
        p.elapsed = (p.elapsed ?? 0) + dt;
        if (distance > radius || !p.body.parent?.visible) { p.body.visible = false; continue; }
        p.body.visible = true;
        if (distance < 20 || p.elapsed >= .1) { p.avatar.update(p.elapsed); p.elapsed = 0; }
        if (distance < 5) {
          const yaw = Math.atan2(-(player.x - p.place.x), -(player.z - p.place.z));
          const delta = Math.atan2(Math.sin(yaw - p.body.rotation.y), Math.cos(yaw - p.body.rotation.y));
          p.body.rotation.y += delta * (1 - Math.exp(-5 * dt));
        }
      }
    },
  };
}
