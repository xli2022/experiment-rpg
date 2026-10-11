import * as THREE from 'three';

// The follow camera keeps its distance everywhere, indoors and out. Rather
// than closing in when walls, floors or furniture come between it and the
// player, it looks through them: building and interior materials discard
// whatever lies in a slot along the line from the camera to the player. The
// slot is widest at the camera and narrows to the player's shoulders, reaches
// from a little above the line of sight down to the player's feet, and stops
// just short of the player, so the floor they stand on and everything beyond
// them always stays.

export const CUTAWAY = Object.freeze({ eyeRadius: 1.8, focusRadius: 1, above: .8, below: 2.4, short: .4, behind: .5, floor: .05 });

export function viewCutawayUniforms() {
  return {
    // xyz: the camera; w: 1 while active.
    cutawayEye: { value: new THREE.Vector4(0, 0, 0, 0) },
    // xyz: the player at the camera's look height; w: the floor they stand on.
    cutawayFocus: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}

/** Cut from `eye` to `focus`, keeping everything at or below `floor`; or nothing when `eye` is null. */
export function setViewCutaway(uniforms, eye, focus, floor) {
  if (!eye) { uniforms.cutawayEye.value.w = 0; return; }
  uniforms.cutawayEye.value.set(eye.x, eye.y, eye.z, 1);
  uniforms.cutawayFocus.value.set(focus.x, focus.y, focus.z, floor);
}

/** Whether the cutaway hides a world point: the shaders' test, for checks and tests. */
export function cutsAway(point, eye, focus, floor) {
  if (point.y <= floor + CUTAWAY.floor) return false;
  const ax = focus.x - eye.x, ay = focus.y - eye.y, az = focus.z - eye.z, length = Math.hypot(ax, ay, az);
  if (length < 1e-6) return false;
  const s = ((point.x - eye.x) * ax + (point.y - eye.y) * ay + (point.z - eye.z) * az) / length;
  if (s < -CUTAWAY.behind || s > length - CUTAWAY.short) return false;
  const t = Math.min(1, Math.max(0, s / length)), radius = CUTAWAY.eyeRadius + (CUTAWAY.focusRadius - CUTAWAY.eyeRadius) * t;
  const ox = point.x - (eye.x + ax / length * s), oy = point.y - (eye.y + ay / length * s), oz = point.z - (eye.z + az / length * s);
  return Math.hypot(ox, oz) < radius && oy < CUTAWAY.above && oy > -CUTAWAY.below;
}

const number = value => value.toFixed(3);
/** Add the cutaway to a material's shaders, after any patch it already has. */
export function patchViewCutaway(material, uniforms) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
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
      ${shader.fragmentShader}`.replace('void main() {', `void main() {
      if (cutawayEye.w > .5 && vCutaway.y > cutawayFocus.w + ${number(CUTAWAY.floor)}) {
        vec3 cutawayAxis = cutawayFocus.xyz - cutawayEye.xyz;
        float cutawayLength = length(cutawayAxis);
        vec3 cutawayDir = cutawayAxis / max(cutawayLength, 1e-6);
        float cutawayS = dot(vCutaway - cutawayEye.xyz, cutawayDir);
        if (cutawayLength > 1e-6 && cutawayS > -${number(CUTAWAY.behind)} && cutawayS < cutawayLength - ${number(CUTAWAY.short)}) {
          vec3 cutawayOff = vCutaway - (cutawayEye.xyz + cutawayDir * cutawayS);
          float cutawayRadius = mix(${number(CUTAWAY.eyeRadius)}, ${number(CUTAWAY.focusRadius)}, clamp(cutawayS / cutawayLength, 0.0, 1.0));
          if (length(cutawayOff.xz) < cutawayRadius && cutawayOff.y < ${number(CUTAWAY.above)} && cutawayOff.y > -${number(CUTAWAY.below)}) discard;
        }
      }`);
  };
  material.customProgramCacheKey = () => `${key}|view-cutaway-v1`;
  return material;
}
