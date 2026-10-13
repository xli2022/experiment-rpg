import * as THREE from 'three';
import { boxContainsPoint, rayBoxDistance } from '../core/physics.js';

// The follow camera keeps its distance everywhere, indoors and out. Rather
// than closing in when walls, floors or furniture come between it and the
// player, it fades them, whole, and only as far as they are in the way:
//
// - Each frame, 64 sight lines run from the camera to points scattered evenly
//   over the player's body, in a pattern with no rows or columns. How much of
//   the player a building volume, wall, slab, stair or piece of furniture
//   hides is the share of them it cuts. An edge sweeping across the body
//   crosses the lines one at a time, so that share changes in small steps as
//   the camera moves, never by a whole row at once.
// - How much a surface fades follows how much it hides: nothing for one that
//   only clips an elbow or a foot, fully for one that hides a good share of
//   the body, and in between in between. The fade eases toward that, so a
//   surface never snaps or flickers between states.
// - A surface fades as a whole, never in a hole round the player.
// - The floor the player stands on, and anything at its level, stays solid.
// - A surface the camera is inside hides the whole body. A building shell the
//   camera dips into keeps its fade: dropping it there and taking it up again
//   as the camera came out flashed the facade, and the lobby behind it, solid.
//
// The fade is dithered: an ordered screen-space pattern drops a share of each
// surface's pixels, so materials stay opaque, keep writing depth and need no
// sorting.

export const CUTAWAY = Object.freeze({
  slots: 8, // surfaces faded at once
  ghost: 0, // how much of a fully faded surface still shows; any more leaves a screen-door pattern over the view
  lines: 64, // sight lines over the body
  from: .1, to: .3, // share of the body a surface must hide to start fading, and to fade fully
  rate: 12, // how quickly a fade follows, per second
  clear: .3, // sight lines stop this short of the body, so what it touches doesn't count
  pad: .01, skin: .05, // a fading box takes in surfaces this close outside it; a building's outer walls, their facade too
  floor: .05,
  // The part of the body the camera should see, as a width across the view
  // and heights above the feet; per framing.
  foot: Object.freeze({ width: .5, bottom: .45, top: 1.85 }),
  drive: Object.freeze({ width: 1.9, bottom: .3, top: 1.5 }),
  glide: Object.freeze({ width: 4.6, bottom: .4, top: 4.5 }),
});

// An even scatter over the unit square with no rows or columns (the R2 sequence).
const SCATTER = Array.from({ length: CUTAWAY.lines }, (_, i) => [(.5 + i * .7548776662466927) % 1, (.5 + i * .5698402909980532) % 1]);
/** The points of a body standing at `base` as seen from `eye`, for a framing from CUTAWAY. */
export function cutawayTargets(eye, base, framing = CUTAWAY.foot) {
  const dx = base.x - eye.x, dz = base.z - eye.z, l = Math.hypot(dx, dz) || 1, sx = -dz / l, sz = dx / l;
  return SCATTER.map(([u, v]) => {
    const across = (u - .5) * framing.width;
    return { x: base.x + sx * across, y: base.y + framing.bottom + v * (framing.top - framing.bottom), z: base.z + sz * across };
  });
}

// Only building shells and interiors use the faded materials.
const fadeable = box => !!box.interior || !!box.id?.startsWith('building:');
const within = (box, p) => p.y >= (box.minY ?? -Infinity) && p.y <= (box.maxY ?? Infinity) && boxContainsPoint(p.x, p.z, box);
/**
 * How much of the body each of `boxes` hides from `eye`, as a Map from box to
 * the share of the sight lines to `targets` it cuts. Boxes that hide nothing
 * are left out.
 */
export function blockingSurfaces(eye, targets, boxes) {
  const shares = new Map(), rays = targets.map(t => {
    const x = t.x - eye.x, y = t.y - eye.y, z = t.z - eye.z, length = Math.hypot(x, y, z) || 1, reach = Math.max(0, length - CUTAWAY.clear);
    const end = { x: eye.x + x / length * reach, y: eye.y + y / length * reach, z: eye.z + z / length * reach };
    return { direction: { x: x / length, y: y / length, z: z / length }, reach,
      minX: Math.min(eye.x, end.x), maxX: Math.max(eye.x, end.x), minY: Math.min(eye.y, end.y), maxY: Math.max(eye.y, end.y), minZ: Math.min(eye.z, end.z), maxZ: Math.max(eye.z, end.z) };
  });
  const all = rays.reduce((a, r) => ({ minX: Math.min(a.minX, r.minX), maxX: Math.max(a.maxX, r.maxX), minY: Math.min(a.minY, r.minY), maxY: Math.max(a.maxY, r.maxY), minZ: Math.min(a.minZ, r.minZ), maxZ: Math.max(a.maxZ, r.maxZ) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const apart = (r, box) => r.maxX < box.minX || r.minX > box.maxX || r.maxZ < box.minZ || r.minZ > box.maxZ || r.maxY < (box.minY ?? -Infinity) || r.minY > (box.maxY ?? Infinity);
  for (const collider of boxes) {
    if (!fadeable(collider)) continue;
    // Some pieces are drawn taller than they collide (a counter's wall cupboard).
    const box = collider.viewMaxY ? { ...collider, maxY: collider.viewMaxY } : collider;
    if (apart(all, box)) continue;
    const inside = within(box, eye);
    let hidden = 0;
    for (const ray of rays) if (ray.reach > 0 && (inside || (!apart(ray, box) && rayBoxDistance(eye, ray.direction, box, ray.reach) < ray.reach))) hidden++;
    if (hidden) shares.set(collider, hidden / rays.length);
  }
  return shares;
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Ids are stable while a surface is rebuilt (a window breaks) or moves (a door swings).
const keyOf = box => box.id ?? `${box.x ?? box.minX}|${box.z ?? box.minZ}|${box.minY}`;
/**
 * Eases surfaces in and out of the fade. `update(shares, dt)` takes
 * blockingSurfaces' shares and returns the surfaces to fade, as
 * [{ box, fade }], most faded first. A long `dt` (a cut) settles at once.
 */
export function createCutawayFader() {
  const surfaces = new Map();
  return {
    update(shares, dt) {
      const seen = new Map([...shares].map(([box, share]) => [keyOf(box), { box, share }])), follow = 1 - Math.exp(-CUTAWAY.rate * dt);
      for (const [key, { box }] of seen) if (!surfaces.has(key)) surfaces.set(key, { box, fade: 0 });
      for (const [key, surface] of surfaces) {
        const target = smoothstep(CUTAWAY.from, CUTAWAY.to, seen.get(key)?.share ?? 0);
        if (seen.has(key)) surface.box = seen.get(key).box;
        surface.fade += (target - surface.fade) * follow;
        if (target === 0 && surface.fade < .004) surfaces.delete(key);
      }
      return [...surfaces.values()].filter(s => s.fade >= .004).sort((a, b) => b.fade - a.fade).slice(0, CUTAWAY.slots).map(({ box, fade }) => ({ box, fade }));
    },
    clear() { surfaces.clear(); },
  };
}

/** A collider's oriented bounds: centre, half sizes, and its yaw's cosine and sine. */
export function cutawayVolume(box) {
  const yaw = box.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw), y0 = box.minY ?? -1e4, y1 = box.viewMaxY ?? box.maxY ?? 1e4;
  let x = box.x, z = box.z, hx = box.w / 2, hz = box.d / 2;
  if (box.vertices) {
    // A convex slab or footprint: its own outline, not the frame it shares.
    const xs = box.vertices.map(v => v.x), zs = box.vertices.map(v => v.z), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    hx = (Math.max(...xs) - Math.min(...xs)) / 2; hz = (Math.max(...zs) - Math.min(...zs)) / 2;
    x += cx * c + cz * s; z += -cx * s + cz * c;
  } else if (box.w === undefined) {
    x = (box.minX + box.maxX) / 2; z = (box.minZ + box.maxZ) / 2; hx = (box.maxX - box.minX) / 2; hz = (box.maxZ - box.minZ) / 2;
  }
  return { x, y: (y0 + y1) / 2, z, cos: c, sin: s, hx, hy: (y1 - y0) / 2, hz };
}

// How far beyond its box a surface's fade reaches.
const reachOf = box => box.id?.startsWith('building:') || box.id?.includes(':hull:') ? CUTAWAY.skin : CUTAWAY.pad;

export function viewCutawayUniforms() {
  return {
    // x: the floor the player stands on; y: how many surfaces fade.
    cutawayState: { value: new THREE.Vector4(0, 0, 0, 0) },
    // Per surface: centre and cos(yaw); half sizes and sin(yaw); fade and reach.
    cutawaySurfaces: { value: Array.from({ length: CUTAWAY.slots * 3 }, () => new THREE.Vector4()) },
  };
}

/** Fade `view.surfaces` ([{ box, fade }]), keeping everything at or below `view.floor`; null fades nothing. */
export function setViewCutaway(uniforms, view) {
  const surfaces = view?.surfaces.slice(0, CUTAWAY.slots) ?? [], slots = uniforms.cutawaySurfaces.value;
  uniforms.cutawayState.value.set(view?.floor ?? 0, surfaces.length, 0, 0);
  surfaces.forEach(({ box, fade }, i) => {
    const v = cutawayVolume(box);
    slots[i * 3].set(v.x, v.y, v.z, v.cos); slots[i * 3 + 1].set(v.hx, v.hy, v.hz, v.sin); slots[i * 3 + 2].set(fade, reachOf(box), 0, 0);
  });
}

/**
 * How much of a surface still shows at a world point, from 1 (solid) down to
 * the ghost: the shaders' own sum, for checks and tests.
 */
export function cutawayOpacity(point, view) {
  let fade = 0;
  for (const { box, fade: amount } of view?.surfaces.slice(0, CUTAWAY.slots) ?? []) {
    const v = cutawayVolume(box), dx = point.x - v.x, dz = point.z - v.z;
    const lx = dx * v.cos - dz * v.sin, lz = dx * v.sin + dz * v.cos;
    if (Math.max(Math.abs(lx) - v.hx, Math.abs(point.y - v.y) - v.hy, Math.abs(lz) - v.hz) < reachOf(box)) fade = Math.max(fade, amount);
  }
  const floor = view?.floor ?? 0;
  return 1 - fade * smoothstep(floor + CUTAWAY.floor, floor + CUTAWAY.floor + .07, point.y) * (1 - CUTAWAY.ghost);
}

const number = value => value.toFixed(3);
/** Add the fade to a material's shaders, after any patch it already has. */
export function patchViewCutaway(material, uniforms) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  const { slots, ghost, floor } = CUTAWAY;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec3 vCutaway;\n${shader.vertexShader}`.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 cutawayWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        cutawayWorld = instanceMatrix * cutawayWorld;
      #endif
      vCutaway = (modelMatrix * cutawayWorld).xyz;`);
    shader.fragmentShader = `varying vec3 vCutaway;
      uniform vec4 cutawayState;
      uniform vec4 cutawaySurfaces[${slots * 3}];
      // An 8 × 8 ordered-dither (Bayer) threshold for this pixel, in (0, 1):
      // 64 steps, so a fade moves through the surface finely.
      float cutawayThreshold(vec2 pixel) {
        ivec2 q = ivec2(mod(floor(pixel), 8.0));
        int x = q.x ^ q.y, y = q.y;
        int m = ((x & 1) << 5) | ((y & 1) << 4) | ((x & 2) << 2) | ((y & 2) << 1) | ((x & 4) >> 1) | ((y & 4) >> 2);
        return (float(m) + 0.5) / 64.0;
      }
      ${shader.fragmentShader}`.replace('void main() {', `void main() {
      if (cutawayState.y > .5) {
        // Inside a fading surface's box: the whole surface fades together.
        float cutawayFade = 0.0;
        for (int i = 0; i < ${slots}; i++) {
          if (float(i) >= cutawayState.y) break;
          vec4 cutawayA = cutawaySurfaces[i * 3], cutawayB = cutawaySurfaces[i * 3 + 1];
          vec3 cutawayD = vCutaway - cutawayA.xyz;
          vec3 cutawayOut = abs(vec3(cutawayD.x * cutawayA.w - cutawayD.z * cutawayB.w, cutawayD.y, cutawayD.x * cutawayB.w + cutawayD.z * cutawayA.w)) - cutawayB.xyz;
          vec4 cutawayC = cutawaySurfaces[i * 3 + 2];
          if (max(cutawayOut.x, max(cutawayOut.y, cutawayOut.z)) < cutawayC.y) cutawayFade = max(cutawayFade, cutawayC.x);
        }
        cutawayFade *= smoothstep(cutawayState.x + ${number(floor)}, cutawayState.x + ${number(floor + .07)}, vCutaway.y);
        if (1.0 - cutawayFade * ${number(1 - ghost)} < cutawayThreshold(gl_FragCoord.xy)) discard;
      }`);
  };
  material.customProgramCacheKey = () => `${key}|view-cutaway-v5`;
  return material;
}
