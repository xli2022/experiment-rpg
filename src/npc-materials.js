import * as THREE from 'three';

// Paint in bind space so clothing details and makeup stay attached to a
// deformed, animated surface. No additional textures or draw calls are needed.
function bindPosition(shader, uniforms, declarations) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = `attribute vec3 npcBindPosition; varying vec3 vNpcBindPosition;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvNpcBindPosition = npcBindPosition;');
  shader.fragmentShader = `varying vec3 vNpcBindPosition;\n${declarations}\n${shader.fragmentShader}`;
}
const color = value => ({ value: new THREE.Color(value) });

export function npcClothMaterial(source, profile) {
  const jacket = source.name === 'Jacket', fashion = profile.fashion;
  const material = source.clone(); material.color.set(jacket ? profile.jacket : profile.trousers);
  material.roughness = fashion ? (jacket ? fashion.roughness : .55) : .83;
  material.metalness = fashion && jacket ? fashion.metalness : .02;
  material.onBeforeCompile = shader => {
    bindPosition(shader, {
      npcSkin: color(profile.skin), npcInner: color(fashion?.inner ?? profile.jacket),
      npcFashion: { value: jacket && fashion ? 1 : 0 }, npcNeckline: { value: fashion?.neckline ?? 2 },
      npcCrop: { value: jacket ? fashion?.crop ?? 0 : 0 }, npcStripe: { value: jacket && fashion?.pinstripe ? 1 : 0 },
      npcBoots: { value: !jacket && fashion?.boots ? 1 : 0 },
    }, 'uniform vec3 npcSkin, npcInner; uniform float npcFashion, npcNeckline, npcCrop, npcStripe, npcBoots;');
    const clothMap = THREE.ShaderChunk.map_fragment.replace('diffuseColor *= sampledDiffuseColor;', 'float clothLight = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); diffuseColor *= vec4(vec3(0.42 + clothLight * 0.58), sampledDiffuseColor.a);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `${clothMap}
      float npcFront = smoothstep(0.065, 0.13, -vNpcBindPosition.z);
      float npcOpening = clamp((vNpcBindPosition.y - 1.26) * 0.42, 0.0, 0.082);
      float npcPanel = (1.0 - smoothstep(npcOpening - 0.003, npcOpening, abs(vNpcBindPosition.x))) * npcFront * npcFashion;
      diffuseColor.rgb = mix(diffuseColor.rgb, npcInner * 0.8, npcPanel);
      float npcNeckWidth = clamp((vNpcBindPosition.y - npcNeckline) * 0.36, 0.0, 0.065);
      float npcSkinMask = (1.0 - smoothstep(npcNeckWidth - 0.003, npcNeckWidth, abs(vNpcBindPosition.x))) * smoothstep(npcNeckline, npcNeckline + 0.008, vNpcBindPosition.y) * npcFront * npcFashion;
      npcSkinMask = max(npcSkinMask, (1.0 - smoothstep(npcCrop - 0.006, npcCrop, vNpcBindPosition.y)) * npcFashion);
      diffuseColor.rgb = mix(diffuseColor.rgb, npcSkin * 0.65, npcSkinMask);
      float stripe = 1.0 - smoothstep(0.025, 0.09, abs(fract(vNpcBindPosition.x * 90.0) - 0.5));
      diffuseColor.rgb += vec3(0.032) * stripe * npcStripe * (1.0 - npcPanel);
      float npcBootMask = (1.0 - smoothstep(0.68, 0.7, vNpcBindPosition.y)) * npcBoots;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.016, 0.022, 0.031), npcBootMask);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', 'vec3 npcSmoothNormal = normal;\n#include <normal_fragment_maps>\nnormal = normalize(mix(normal, npcSmoothNormal, npcSkinMask));');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.65, npcSkinMask);\nroughnessFactor = mix(roughnessFactor, 0.3, npcBootMask);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - npcSkinMask;');
  };
  material.customProgramCacheKey = () => 'afterlight-npc-fashion-v2';
  return material;
}

export function npcSkinMaterial(source, profile) {
  const material = source.clone(); material.color.set(profile.skin);
  if (!profile.makeup && !profile.scar) return material;
  material.onBeforeCompile = shader => {
    bindPosition(shader, { npcLip: color(profile.makeup?.lips ?? profile.skin), npcLipStrength: { value: profile.makeup?.strength ?? 0 }, npcLiner: { value: profile.makeup?.liner ?? 0 }, npcScar: { value: profile.scar ? 1 : 0 } },
      'uniform vec3 npcLip; uniform float npcLipStrength, npcLiner, npcScar;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float faceFront = smoothstep(0.125, 0.15, -vNpcBindPosition.z);
      vec2 lipPoint = (vNpcBindPosition.xy - vec2(0.0, 1.735)) / vec2(0.03, 0.009);
      float lipMask = (1.0 - smoothstep(0.68, 1.0, length(lipPoint))) * faceFront * npcLipStrength;
      diffuseColor.rgb = mix(diffuseColor.rgb, npcLip, lipMask);
      float eyeX = abs(vNpcBindPosition.x) - 0.032;
      float linerShape = length(vec2(eyeX / 0.024, (vNpcBindPosition.y - 1.802 + abs(eyeX) * 0.17) / 0.0035));
      float linerMask = (1.0 - smoothstep(0.65, 1.1, linerShape)) * faceFront * npcLiner;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.012, 0.021), linerMask);
      float scarX = -0.052 + (vNpcBindPosition.y - 1.795) * 0.29;
      float scarMask = (1.0 - smoothstep(0.0008, 0.0024, abs(vNpcBindPosition.x - scarX))) * smoothstep(1.747, 1.762, vNpcBindPosition.y) * (1.0 - smoothstep(1.823, 1.836, vNpcBindPosition.y)) * faceFront * npcScar;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.35 + vec3(0.018, 0.006, 0.004), scarMask * 0.75);
    `);
  };
  material.customProgramCacheKey = () => 'afterlight-npc-face-finish-v1';
  return material;
}
