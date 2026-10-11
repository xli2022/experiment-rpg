import * as THREE from 'three';

// The follow camera keeps its distance everywhere, indoors and out. Rather
// than closing in when walls, floors or furniture come between it and the
// player, it looks through them: building and interior materials fade out in
// a slot along the line from the camera to the player. The slot is widest at
// the camera and narrows to the player's shoulders, reaches from a little
// above the line of sight down to the player's feet, and stops just short of
// the player, so the floor they stand on and everything beyond them always
// stay solid. Its edges are soft.
//
// The fade is dithered: an ordered screen-space pattern drops a share of each
// surface's pixels, so materials stay opaque, keep writing depth and need no
// sorting. Close to the camera the slot clears completely; nearer the player,
// walls stay as a faint ghost, so the room around them still reads.

export const CUTAWAY = Object.freeze({ eyeRadius: 1.8, focusRadius: 1, above: .8, below: 2.4, short: .4, behind: .5, floor: .05, edge: .35, ghost: .3 });

export function viewCutawayUniforms() {
  return {
    // xyz: the camera; w: 1 while active.
    cutawayEye: { value: new THREE.Vector4(0, 0, 0, 0) },
    // xyz: the player at the camera's look height; w: the floor they stand on.
    cutawayFocus: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}

/** Fade from `eye` to `focus`, keeping everything at or below `floor`; or nothing when `eye` is null. */
export function setViewCutaway(uniforms, eye, focus, floor) {
  if (!eye) { uniforms.cutawayEye.value.w = 0; return; }
  uniforms.cutawayEye.value.set(eye.x, eye.y, eye.z, 1);
  uniforms.cutawayFocus.value.set(focus.x, focus.y, focus.z, floor);
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/**
 * How much of a world point's surface still shows, from 1 (solid) down to 0
 * (gone): the shaders' own sum, for checks and tests.
 */
export function cutawayOpacity(point, eye, focus, floor) {
  const { eyeRadius, focusRadius, above, below, short, behind, edge, ghost } = CUTAWAY;
  const ax = focus.x - eye.x, ay = focus.y - eye.y, az = focus.z - eye.z, length = Math.hypot(ax, ay, az);
  if (length < 1e-6) return 1;
  const s = ((point.x - eye.x) * ax + (point.y - eye.y) * ay + (point.z - eye.z) * az) / length, t = Math.min(1, Math.max(0, s / length));
  const ox = point.x - (eye.x + ax / length * s), oy = point.y - (eye.y + ay / length * s), oz = point.z - (eye.z + az / length * s);
  const radius = eyeRadius + (focusRadius - eyeRadius) * t;
  const inside = smoothstep(floor + CUTAWAY.floor, floor + CUTAWAY.floor + .07, point.y) *
    smoothstep(-behind - edge, -behind, s) * (1 - smoothstep(length - short, length - short + .15, s)) *
    (1 - smoothstep(radius, radius + edge, Math.hypot(ox, oz))) * (1 - smoothstep(above, above + edge, oy)) * (1 - smoothstep(below, below + edge, -oy));
  return 1 - inside * (1 - ghost * smoothstep(.25, .6, t));
}

const number = value => value.toFixed(3);
/** Add the fade to a material's shaders, after any patch it already has. */
export function patchViewCutaway(material, uniforms) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  const { eyeRadius, focusRadius, above, below, short, behind, floor, edge, ghost } = CUTAWAY;
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
      uniform vec4 cutawayEye;
      uniform vec4 cutawayFocus;
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
      if (cutawayEye.w > .5) {
        vec3 cutawayAxis = cutawayFocus.xyz - cutawayEye.xyz;
        float cutawayLength = max(length(cutawayAxis), 1e-4);
        vec3 cutawayDir = cutawayAxis / cutawayLength;
        float cutawayS = dot(vCutaway - cutawayEye.xyz, cutawayDir), cutawayT = clamp(cutawayS / cutawayLength, 0.0, 1.0);
        vec3 cutawayOff = vCutaway - (cutawayEye.xyz + cutawayDir * cutawayS);
        float cutawayRadius = mix(${number(eyeRadius)}, ${number(focusRadius)}, cutawayT);
        float cutawayInside = smoothstep(cutawayFocus.w + ${number(floor)}, cutawayFocus.w + ${number(floor + .07)}, vCutaway.y)
          * smoothstep(-${number(behind + edge)}, -${number(behind)}, cutawayS) * (1.0 - smoothstep(cutawayLength - ${number(short)}, cutawayLength - ${number(short - .15)}, cutawayS))
          * (1.0 - smoothstep(cutawayRadius, cutawayRadius + ${number(edge)}, length(cutawayOff.xz)))
          * (1.0 - smoothstep(${number(above)}, ${number(above + edge)}, cutawayOff.y)) * (1.0 - smoothstep(${number(below)}, ${number(below + edge)}, -cutawayOff.y));
        float cutawayOpacity = 1.0 - cutawayInside * (1.0 - ${number(ghost)} * smoothstep(.25, .6, cutawayT));
        if (cutawayOpacity < cutawayThreshold(gl_FragCoord.xy)) discard;
      }`);
  };
  material.customProgramCacheKey = () => `${key}|view-cutaway-v2`;
  return material;
}
