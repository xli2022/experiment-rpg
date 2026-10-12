import * as THREE from 'three';
import { boxContainsPoint, rayBoxDistance } from '../core/physics.js';

// The follow camera keeps its distance everywhere, indoors and out. Rather
// than closing in when walls, floors or furniture come between it and the
// player, it fades them, whole, and only those really in the way:
//
// - Each frame, sight lines run from the camera to points spread over the
//   player's body. A building volume, wall, slab, stair or piece of furniture
//   fades once it hides a good share of them (a quarter), and stays faded
//   until it hides less; one that only clips an elbow or a foot stays solid.
// - A surface fades as a whole, never in a hole round the player. It eases
//   out over a fraction of a second and back in when it no longer blocks.
// - The floor the player stands on, and anything at its level, stays solid.
// - A building shell the camera is inside is skipped: its facade faces away
//   and is not drawn from there anyway.
//
// The fade is dithered: an ordered screen-space pattern drops a share of each
// surface's pixels, so materials stay opaque, keep writing depth and need no
// sorting.

export const CUTAWAY = Object.freeze({
  slots: 8, // surfaces faded at once
  ghost: 0, // how much of a faded surface still shows; any more leaves a screen-door pattern over the view
  enough: .25, keep: .15, // share of the sight lines a surface must hide to fade, and to stay faded
  clear: .3, // sight lines stop this short of the body, so what it touches doesn't count
  fadeIn: .2, fadeOut: .3, // seconds
  pad: .01, skin: .05, // a fading box takes in surfaces this close outside it; a building's outer walls, their facade too
  floor: .05,
  // Points over the body the camera should see, as rows of heights above the
  // feet and offsets across the view; per framing.
  foot: Object.freeze({ heights: [.6, 1, 1.35, 1.7], across: [-.22, 0, .22] }),
  drive: Object.freeze({ heights: [.5, 1, 1.4], across: [-.85, 0, .85] }),
  glide: Object.freeze({ heights: [.6, 1.2, 1.7, 4.1], across: [-2.2, 0, 2.2] }),
});

/** The points of a body standing at `base` as seen from `eye`, for a framing from CUTAWAY. */
export function cutawayTargets(eye, base, framing = CUTAWAY.foot) {
  const dx = base.x - eye.x, dz = base.z - eye.z, l = Math.hypot(dx, dz) || 1, sx = -dz / l, sz = dx / l;
  return framing.heights.flatMap(h => framing.across.map(a => ({ x: base.x + sx * a, y: base.y + h, z: base.z + sz * a })));
}

// Only building shells and interiors use the faded materials.
const fadeable = box => !!box.interior || !!box.id?.startsWith('building:');
const within = (box, p) => p.y >= (box.minY ?? -Infinity) && p.y <= (box.maxY ?? Infinity) && boxContainsPoint(p.x, p.z, box);
/**
 * How many of the sight lines from `eye` to `targets` each of `boxes` cuts,
 * as a Map from box to count; boxes that cut none are left out.
 */
export function blockingSurfaces(eye, targets, boxes) {
  const counts = new Map(), rays = targets.map(t => {
    const x = t.x - eye.x, y = t.y - eye.y, z = t.z - eye.z, length = Math.hypot(x, y, z) || 1;
    return { direction: { x: x / length, y: y / length, z: z / length }, reach: length - CUTAWAY.clear };
  });
  for (const collider of boxes) {
    if (!fadeable(collider)) continue;
    // Some pieces are drawn taller than they collide (a counter's wall cupboard).
    const box = collider.viewMaxY ? { ...collider, maxY: collider.viewMaxY } : collider, inside = within(box, eye);
    if (inside && !box.interior) continue;
    let count = 0;
    for (const { direction, reach } of rays) if (reach > 0 && (inside || rayBoxDistance(eye, direction, box, reach) < reach)) count++;
    if (count) counts.set(collider, count);
  }
  return counts;
}

// Ids are stable while a surface is rebuilt (a window breaks) or moves (a door swings).
const keyOf = box => box.id ?? `${box.x ?? box.minX}|${box.z ?? box.minZ}|${box.minY}`;
/**
 * Eases surfaces in and out of the fade. `update(counts, total, dt)` takes
 * blockingSurfaces' counts out of `total` sight lines and returns the
 * surfaces to fade, as [{ box, fade }], most faded first.
 */
export function createCutawayFader() {
  const surfaces = new Map();
  return {
    update(counts, total, dt) {
      const seen = new Map([...counts].map(([box, count]) => [keyOf(box), { box, share: count / Math.max(1, total) }]));
      for (const [key, { box }] of seen) if (!surfaces.has(key)) surfaces.set(key, { box, fade: 0, on: false });
      for (const [key, surface] of surfaces) {
        const share = seen.get(key)?.share ?? 0;
        if (seen.has(key)) surface.box = seen.get(key).box;
        surface.on = share >= (surface.on ? CUTAWAY.keep : CUTAWAY.enough);
        surface.fade = surface.on ? Math.min(1, surface.fade + dt / CUTAWAY.fadeIn) : Math.max(0, surface.fade - dt / CUTAWAY.fadeOut);
        if (!surface.on && surface.fade === 0) surfaces.delete(key);
      }
      return [...surfaces.values()].filter(s => s.fade > 0).sort((a, b) => b.fade - a.fade).slice(0, CUTAWAY.slots).map(({ box, fade }) => ({ box, fade }));
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

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
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
      // A 4 × 4 ordered-dither threshold for this pixel, in (0, 1).
      float cutawayThreshold(vec2 pixel) {
        vec2 q = mod(floor(pixel), 4.0);
        float m = q.y < 1.0 ? (q.x < 1.0 ? 0.0 : q.x < 2.0 ? 8.0 : q.x < 3.0 ? 2.0 : 10.0)
          : q.y < 2.0 ? (q.x < 1.0 ? 12.0 : q.x < 2.0 ? 4.0 : q.x < 3.0 ? 14.0 : 6.0)
          : q.y < 3.0 ? (q.x < 1.0 ? 3.0 : q.x < 2.0 ? 11.0 : q.x < 3.0 ? 1.0 : 9.0)
          : (q.x < 1.0 ? 15.0 : q.x < 2.0 ? 7.0 : q.x < 3.0 ? 13.0 : 5.0);
        return (m + 0.5) / 16.0;
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
  material.customProgramCacheKey = () => `${key}|view-cutaway-v4`;
  return material;
}
