import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { headDisplacement } from './npc-shape.js';
import { npcClothMaterial, npcSkinMaterial } from './npc-materials.js';

const shapeCache = new WeakMap();
const gaussian = (v, center, spread) => Math.exp(-(((v - center) / spread) ** 2));
const smooth = THREE.MathUtils.smoothstep;

// Morph in the exported rig's bind space. Keep joint weights and animation
// tracks intact, and use the same deformation for eyes, clothing and equipment.
export function shapePoint(point, profile) {
  if (profile.faceShape && point.y > 1.54 && Math.abs(point.x) < .2) {
    const weight = profile.faceShape * smooth(point.y, 1.54, 1.67);
    const d = headDisplacement(point); point.x += d[0] * weight; point.y += d[1] * weight; point.z += d[2] * weight;
  }
  const y = point.y, x = point.x;
  const torso = 1 - smooth(Math.abs(x), .18, .40);
  if (y < 1.64) {
    const shape = ((profile.waist - 1) * gaussian(y, 1.24, .14) + (profile.hips - 1) * gaussian(y, 1.03, .13)) * torso;
    point.x *= 1 + shape;
    point.z *= 1 + shape * .65;
    point.x *= 1 + ((profile.shoulders ?? 1) - 1) * gaussian(y, 1.525, .085) * (1 - smooth(Math.abs(x), .2, .42));
    point.z -= (profile.chest ?? 0) * gaussian(y, 1.447, .082) * smooth(-point.z, .07, .145) * torso;
  }
  if (y > 1.61) {
    const head = smooth(y, 1.61, 1.68) * (1 - smooth(Math.abs(x), .15, .23));
    point.x *= 1 + head * ((profile.jaw - 1) * gaussian(y, 1.705, .051) + (profile.cheeks - 1) * gaussian(y, 1.786, .038));
    point.y += (y - 1.83) * (profile.faceLength - 1) * head;
    point.z += profile.nose * gaussian(y, 1.766, .031) * gaussian(x, 0, .024) * smooth(-point.z, .10, .15);
  }
  return point;
}

function shapedGeometry(source, profile, materialName) {
  let profiles = shapeCache.get(source);
  if (!profiles) { profiles = new Map(); shapeCache.set(source, profiles); }
  if (profiles.has(profile.id)) return profiles.get(profile.id);
  const geometry = source.clone(), positions = geometry.getAttribute('position'), point = new THREE.Vector3();
  geometry.setAttribute('npcBindPosition', source.getAttribute('position'));
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i); const y = point.y, x = point.x;
    shapePoint(point, profile);
    if (materialName === 'Jacket' && profile.coatDrop) point.y -= profile.coatDrop * (1 - smooth(y, 1.03, 1.23)) * (1 - smooth(Math.abs(x), .18, .3));
    positions.setXYZ(i, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  profiles.set(profile.id, geometry); return geometry;
}

function makeWardrobe(body, bones, profile) {
  const groups = new Map(), ownedGeometry = [], ownedMaterials = [];
  const mat = (color, metalness = 0, roughness = .82) => {
    const m = new THREE.MeshStandardMaterial({ color, metalness, roughness }); ownedMaterials.push(m); return m;
  };
  const hair = mat(profile.hair, 0, .53), cloth = mat(profile.jacket), accent = mat(profile.accent), leather = mat('#202a30', .05, .4);
  const trim = mat(profile.fashion ? profile.accent : '#a9aaa0', .72, .28), beard = hair;
  const piece = (bone, material, geometry, at, scale = [1, 1, 1], rotation = [0, 0, 0]) => {
    const quaternion = rotation.isQuaternion ? rotation : new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), quaternion, new THREE.Vector3(...scale)));
    const attr = geometry.getAttribute('position'), point = new THREE.Vector3();
    for (let i = 0; i < attr.count; i++) { shapePoint(point.fromBufferAttribute(attr, i), profile); attr.setXYZ(i, point.x, point.y, point.z); }
    geometry.computeVertexNormals();
    const key = `${bone}:${material.uuid}`;
    if (!groups.has(key)) groups.set(key, { bone, material, geometry: [] });
    groups.get(key).geometry.push(geometry);
  };
  const ball = (bone, material, at, size) => piece(bone, material, new THREE.SphereGeometry(1, 14, 10), at, size);
  const box = (bone, material, at, size, rotation) => piece(bone, material, new THREE.BoxGeometry(1, 1, 1), at, size, rotation);
  const tube = (bone, material, points, radius) => piece(bone, material, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 14, radius, 5, false), [0, 0, 0]);
  const cap = (material, top = 1.82, size = [.101, .117, .104]) => piece('Head', material, new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * .55), [0, top, -.035], size);
  if (!['shaved', 'cap', 'beanie'].includes(profile.hairstyle)) cap(hair, 1.831, [.108, .112, .145]);
  if (['bob', 'bun'].includes(profile.hairstyle)) {
    for (const side of [-1, 1]) ball('Head', hair, [side * .087, 1.779, -.02], [.037, .124, .1]);
    ball('Head', hair, [0, 1.786, .036], [.095, .106, .045]);
    if (profile.hairstyle === 'bun') ball('Head', hair, [0, 1.909, .055], [.066, .064, .066]);
    if (profile.hairstyle === 'bob') tube('Head', hair, [[-.053, 1.913, -.13], [-.09, 1.84, -.149], [-.092, 1.744, -.09], [-.082, 1.666, -.043]], .022);
  }
  if (profile.hairstyle === 'swept') {
    for (let i = 0; i < 4; i++) tube('Head', hair, [[.062 - i * .019, 1.928, -.078], [-.033 - i * .012, 1.891, -.168], [-.095 - i * .005, 1.795, -.086], [-.097 - i * .003, 1.665 + i * .017, -.007]], .019);
    ball('Head', hair, [.09, 1.791, .005], [.033, .109, .07]);
  }
  if (profile.hairstyle === 'coils') {
    for (let i = 0; i < 95; i++) {
      const angle = i * 2.399963, y = .10 + (i / 95) * .87, radial = Math.sqrt(1 - y * y);
      ball('Head', hair, [Math.cos(angle) * radial * .108, 1.815 + y * .137, -.036 + Math.sin(angle) * radial * .123], [.018, .019, .019]);
    }
    ball('Head', hair, [0, 1.955, .024], [.048, .045, .049]);
  }
  if (['undercut', 'pixie'].includes(profile.hairstyle)) {
    for (let i = 0; i < 6; i++) piece('Head', hair, new THREE.SphereGeometry(1, 12, 8), [-.025 + i * .013, 1.927 + Math.sin(i) * .005, -.044], [.026, .047, .085], [0, 0, -.35]);
    if (profile.hairstyle === 'pixie') tube('Head', hair, [[-.046, 1.925, -.08], [.03, 1.9, -.158], [.073, 1.838, -.151], [.086, 1.788, -.065]], .021);
  }
  if (profile.hairstyle === 'beanie') {
    cap(cloth, 1.842, [.112, .125, .116]);
    piece('Head', accent, new THREE.TorusGeometry(.106, .012, 6, 30), [0, 1.837, -.029], [1, 1.05, 1], [Math.PI / 2, 0, 0]);
  }
  if (profile.hairstyle === 'cap') {
    cap(cloth, 1.862, [.112, .075, .108]);
    ball('Head', cloth, [0, 1.864, -.137], [.112, .009, .086]);
    box('Head', accent, [0, 1.895, -.128], [.045, .016, .006]);
  }
  if (profile.beard) {
    ball('Head', beard, [0, 1.689, -.123], [.071, profile.beard === 'full' ? .062 : .035, .043]);
    for (const side of [-1, 1]) ball('Head', beard, [side * .064, 1.723, -.096], [.021, .05, .04]);
    ball('Head', beard, [0, 1.734, -.145], [.046, .009, .008]);
    if (profile.beard === 'braided') {
      for (let i = 0; i < 6; i++) ball('Head', beard, [Math.sin(i * Math.PI / 2) * .005, 1.677 - i * .01, -.139], [.014 - i * .001, .012, .014]);
      piece('Head', accent, new THREE.TorusGeometry(.009, .0025, 5, 14), [0, 1.63, -.139], [1, 1, 1], [Math.PI / 2, 0, 0]);
    }
  }
  // Eyebrows remain attached to the head and follow each face's proportions.
  for (const side of [-1, 1]) box('Head', hair, [side * .035, 1.816, -.153], [.042, .006, .005], [0, 0, side * .07]);
  if (profile.glasses) {
    const y = profile.glasses === 'goggles' ? 1.858 : 1.795;
    const z = profile.glasses === 'goggles' ? -.167 : -.169;
    for (const side of [-1, 1]) {
      if (profile.glasses === 'square') {
        for (const t of [-1, 1]) {
          box('Head', trim, [side * .035, y + t * .016, z], [.057, .003, .004]);
          box('Head', trim, [side * .035 + t * .027, y, z], [.003, .033, .004]);
        }
      } else piece('Head', profile.glasses === 'goggles' ? leather : trim, new THREE.TorusGeometry(.027, profile.glasses === 'goggles' ? .007 : .002, 6, 20), [side * .036, y, z]);
      box('Head', trim, [side * .066, y, -.09], [.003, .004, .15]);
    }
    box('Head', trim, [0, y, z], [.019, .003, .004]);
  }
  if (profile.outfit === 'radio') {
    for (const side of [-1, 1]) ball('Head', leather, [side * .112, 1.787, -.006], [.018, .036, .034]);
    tube('Head', trim, [[-.117, 1.82, -.008], [-.084, 1.938, -.007], [.084, 1.938, -.007], [.117, 1.82, -.008]], .006);
    tube('Head', leather, [[-.112, 1.765, -.019], [-.119, 1.736, -.143], [-.045, 1.731, -.2]], .005);
    ball('Head', accent, [-.045, 1.731, -.2], [.01, .009, .012]);
    box('Chest', leather, [.12, 1.39, -.17], [.064, .107, .03]);
    box('Chest', accent, [.12, 1.409, -.188], [.046, .033, .003]);
  }
  if (profile.outfit === 'medic' || profile.outfit === 'archivist') {
    if (!profile.fashion) for (const side of [-1, 1]) box('Chest', cloth, [side * .062, 1.462, -.166], [.082, .24, .025], [0, 0, side * .23]);
    box('Chest', accent, [-.116, 1.409, -.168], [.053, .063, .009]);
    if (profile.outfit === 'medic') {
      box('Chest', cloth, [-.116, 1.409, -.175], [.012, .044, .006]); box('Chest', cloth, [-.116, 1.409, -.176], [.036, .012, .006]);
      tube('Chest', leather, [[-.052, 1.583, -.089], [-.105, 1.417, -.187], [0, 1.34, -.203], [.079, 1.44, -.18], [.048, 1.583, -.089]], .004);
    }
  }
  if (['mechanic', 'vest'].includes(profile.outfit)) {
    for (const side of [-1, 1]) box('Chest', leather, [side * .111, 1.401, -.161], [.055, .31, .024]);
    box('Hips', leather, [0, 1.04, -.019], [.355, .051, .281]);
    for (let i = 0; i < 4; i++) box('Hips', trim, [-.12 + i * .081, 1.025, -.174], [.025, .115, .022], [0, 0, (i - 1) * .05]);
  }
  if (profile.outfit === 'gardener') {
    box('Chest', accent, [0, 1.364, -.161], [.245, .24, .032]);
    box('Hips', cloth, [0, 1.079, -.162], [.33, .26, .039]);
    for (const side of [-1, 1]) {
      box('Chest', accent, [side * .096, 1.506, -.147], [.026, .17, .018]);
      box('Hips', accent, [side * .079, 1.08, -.193], [.091, .103, .015]);
    }
  }
  if (['sailor', 'scarf'].includes(profile.outfit)) {
    const scarf = profile.signature === 'navigator' ? mat('#8b4d39') : accent;
    piece('Chest', scarf, new THREE.TorusGeometry(.084, .021, 8, 24), [0, 1.606, -.027], [1, 1.1, 1], [Math.PI / 2, 0, 0]);
    box('Chest', scarf, [.061, 1.457, -.175], [.062, .25, .018], [0, 0, -.14]);
  }
  if (profile.outfit === 'courier') {
    box('Chest', leather, [0, 1.4, -.178], [.038, .47, .021], [0, 0, -.55]);
    box('Hips', cloth, [.216, 1.068, .02], [.126, .264, .24]);
    box('Hips', accent, [.28, 1.109, .02], [.008, .063, .2]);
  }
  if (profile.fashion) {
    const beltY = profile.fashion.crop ? 1.069 : 1.181;
    piece('Hips', leather, new THREE.CylinderGeometry(1, 1, 1, 32, 1, true), [0, beltY, -.005], [.192, .027, .185]);
    box('Hips', trim, [0, beltY, -.198], [.044, .036, .012]);
    for (const side of [-1, 1]) tube('Chest', trim, [[side * .096, 1.59, -.121], [side * .087, 1.48, -.179], [side * .025, 1.325, -.175]], .0022);
  }
  if (profile.jewelry === 'hoops' || profile.jewelry === 'drops') for (const side of [-1, 1]) {
    const earringX = side * .111;
    if (profile.jewelry === 'hoops') piece('Head', trim, new THREE.TorusGeometry(.017, .0024, 6, 22), [earringX, 1.735, -.023]);
    else { tube('Head', trim, [[earringX, 1.76, -.016], [earringX, 1.719, -.018]], .0018); ball('Head', trim, [earringX, 1.713, -.018], [.006, .012, .004]); }
  }
  if (profile.jewelry === 'pendant') {
    tube('Chest', trim, [[-.05, 1.585, -.09], [-.048, 1.543, -.154], [0, 1.474, -.201], [.048, 1.543, -.154], [.05, 1.585, -.09]], .0015);
    piece('Chest', accent, new THREE.OctahedronGeometry(.015), [0, 1.467, -.209], [.6, 1, .4]);
  }
  if (profile.jewelry === 'choker') {
    piece('Chest', leather, new THREE.TorusGeometry(.07, .008, 6, 28), [0, 1.612, -.026], [1, 1.03, 1], [Math.PI / 2, 0, 0]);
    piece('Chest', accent, new THREE.OctahedronGeometry(.012), [0, 1.608, -.103]);
    piece('Head', trim, new THREE.TorusGeometry(.012, .002, 6, 18), [-.113, 1.745, -.02]);
  }
  if (profile.signature === 'mechanist') {
    // One industrial optic, one human eye; the repair brace uses the actual
    // rig's elbow and wrist, so it remains fitted through animated movement.
    piece('Head', leather, new THREE.TorusGeometry(.03, .007, 8, 24), [-.035, 1.795, -.17]);
    ball('Head', accent, [-.035, 1.795, -.178], [.023, .023, .008]);
    ball('Head', trim, [-.035, 1.795, -.187], [.009, .009, .002]);
    tube('Head', leather, [[-.062, 1.8, -.161], [-.102, 1.812, -.057], [-.112, 1.77, .005]], .007);
    box('UpperArmL', leather, [-.226, 1.588, .004], [.13, .035, .19], [0, 0, -.15]);
    for (let i = 0; i < 3; i++) box('UpperArmL', trim, [-.24 + i * .027, 1.61, -.029], [.013, .006, .13], [0, 0, -.15]);
    body.updateMatrixWorld(true);
    const elbow = body.worldToLocal(bones.get('ForearmR').getWorldPosition(new THREE.Vector3()));
    const wrist = body.worldToLocal(bones.get('HandR').getWorldPosition(new THREE.Vector3()));
    const axis = wrist.clone().sub(elbow), rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
    for (const t of [.25, .52, .8]) {
      const center = elbow.clone().lerp(wrist, t);
      piece('ForearmR', trim, new THREE.CylinderGeometry(.047, .049, .034, 12), center.toArray(), [1, 1, 1], rotation);
    }
    const cableStart = elbow.clone().lerp(wrist, .17), cableEnd = elbow.clone().lerp(wrist, .91);
    for (const z of [-.04, .04]) tube('ForearmR', accent, [[cableStart.x, cableStart.y, cableStart.z + z], [(elbow.x + wrist.x) / 2, (elbow.y + wrist.y) / 2 + .028, (elbow.z + wrist.z) / 2 + z], [cableEnd.x, cableEnd.y, cableEnd.z + z]], .006);
    // A brass bird made by his daughter, worn beside the old service harness.
    ball('Chest', accent, [.105, 1.492, -.18], [.018, .009, .007]);
    for (const side of [-1, 1]) box('Chest', accent, [.105 + side * .021, 1.504, -.18], [.032, .007, .006], [0, 0, side * .4]);
  }
  if (profile.signature === 'navigator') {
    for (const side of [-1, 1]) {
      const shoulder = side < 0 ? 'UpperArmL' : 'UpperArmR';
      box(shoulder, leather, [side * .21, 1.572, -.018], [.08, .016, .16]);
      for (let i = 0; i < 3; i++) box(shoulder, accent, [side * .21, 1.585, -.063 + i * .036], [.065, .005, .008]);
      tube('Chest', accent, [[side * .09, 1.571, -.139], [side * .137, 1.419, -.17], [side * .086, 1.309, -.174]], .003);
      for (let i = 0; i < 3; i++) ball('Chest', accent, [side * .092, 1.366 - i * .073, -.181], [.007, .007, .003]);
    }
    tube('Chest', accent, [[-.123, 1.43, -.181], [-.104, 1.32, -.195], [-.025, 1.278, -.19], [.043, 1.327, -.19]], .0025);
    piece('Chest', accent, new THREE.TorusGeometry(.025, .004, 6, 24), [-.118, 1.421, -.197]);
    ball('Chest', leather, [-.118, 1.421, -.198], [.022, .022, .005]);
    box('Chest', trim, [-.118, 1.421, -.205], [.003, .033, .003], [0, 0, -.5]);
    piece('Head', accent, new THREE.TorusGeometry(.013, .0025, 6, 20), [.112, 1.745, -.019]);
  }
  body.updateMatrixWorld(true);
  for (const { bone, material, geometry } of groups.values()) {
    const parts = geometry.map(g => g.index ? g.toNonIndexed() : g);
    const geometryMerged = mergeGeometries(parts);
    for (const g of new Set([...geometry, ...parts])) g.dispose();
    geometryMerged.computeBoundingSphere(); ownedGeometry.push(geometryMerged);
    const mesh = new THREE.Mesh(geometryMerged, material); mesh.name = `Wardrobe_${profile.id}_${bone}`;
    body.add(mesh); body.updateMatrixWorld(true); bones.get(bone)?.attach(mesh);
  }
  return { ownedGeometry, ownedMaterials, batches: groups.size };
}

export function createNPC(asset, profile, clipName = 'Idle') {
  const root = new THREE.Group(); root.name = `NPC_${profile.id}`;
  const body = clone(asset.scene); root.add(body); const bones = new Map(), materials = [];
  body.traverse(object => {
    if (object.isBone) bones.set(object.name, object);
    if (!object.isMesh) return;
    object.frustumCulled = false;
    if (object.material.name === 'Hair' || object.material.name === 'Hardware') { object.visible = false; return; }
    object.geometry = shapedGeometry(object.geometry, profile, object.material.name);
    const original = object.material;
    if (original.name === 'Jacket' || original.name === 'Trousers') object.material = npcClothMaterial(original, profile);
    else if (original.name === 'Skin') object.material = npcSkinMaterial(original, profile);
    else {
      object.material = original.clone();
      if (original.name === 'Iris') object.material.color.set(profile.iris);
      if (original.name === 'CyberLight') { object.material.color.set(profile.accent); object.material.emissive.set(profile.accent); object.material.emissiveIntensity = .35; }
      if (original.name === 'ReflectiveTrim') object.material.color.set(profile.accent);
    }
    materials.push(object.material);
  });
  const wardrobe = makeWardrobe(body, bones, profile);
  const scale = profile.height / 1.9331; root.scale.set(scale * profile.width, scale, scale * profile.depth);
  const mixer = new THREE.AnimationMixer(body), clip = asset.animations.find(c => c.name === clipName) ?? asset.animations.find(c => c.name === 'Idle');
  const action = clip ? mixer.clipAction(clip).play() : null;
  if (clipName === 'Idle' && profile.stance) {
    const tracks = ['Chest', 'Head'].map(name => {
      const angles = profile.stance[name.toLowerCase()], values = [];
      for (const sway of [0, 1, 0]) {
        const rotation = new THREE.Euler(angles[0] + sway * .009, angles[1] + sway * .012, angles[2]);
        values.push(...new THREE.Quaternion().setFromEuler(rotation).toArray());
      }
      return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 2.8, 5.6], values);
    });
    mixer.clipAction(new THREE.AnimationClip(`Presence_${profile.id}`, 5.6, tracks, THREE.AdditiveAnimationBlendMode)).play();
  }
  mixer.update(0);
  root.userData.appearance = profile.id;
  return { root, body, bones, mixer, action, scale, profile, wardrobeBatches: wardrobe.batches,
    dispose() { wardrobe.ownedGeometry.forEach(g => g.dispose()); [...wardrobe.ownedMaterials, ...materials].forEach(m => m.dispose()); mixer.stopAllAction(); mixer.uncacheRoot(body); },
  };
}

// Render the actual in-world models into portraits using the existing WebGL
// context. Restore parent/transform/render target so this cannot alter the city.
export function createNPCPortraits(renderer, avatars) {
  const portraits = {}, scene = new THREE.Scene(); scene.background = new THREE.Color('#172a32');
  scene.add(new THREE.HemisphereLight(0xe9f3ff, 0x565b54, 2.5));
  const key = new THREE.DirectionalLight(0xffe9d4, 3.2); key.position.set(-2, 3, -4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x88cecf, 1.7); rim.position.set(2, 2, 1); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(27, 4 / 5, .1, 10);
  const target = new THREE.WebGLRenderTarget(192, 240), previous = renderer.getRenderTarget();
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const pixels = new Uint8Array(192 * 240 * 4), canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 240;
  const ctx = canvas.getContext('2d'), output = ctx.createImageData(192, 240);
  try {
    for (const [id, avatar] of Object.entries(avatars)) {
      const model = avatar.root, parent = model.parent, position = model.position.clone(), rotation = model.quaternion.clone(), visible = model.visible;
      try {
        scene.add(model); model.position.set(0, 0, 0); model.quaternion.identity(); model.visible = true; model.updateMatrixWorld(true);
        const focus = new THREE.Vector3(0, (avatar.profile.hairstyle === 'coils' ? 1.70 : 1.66) * avatar.scale, 0);
        camera.position.set(.025, focus.y + .025, -1.16); camera.lookAt(focus.x, focus.y, -.03);
        renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 192, 240, pixels);
        for (let row = 0; row < 240; row++) output.data.set(pixels.subarray((239 - row) * 192 * 4, (240 - row) * 192 * 4), row * 192 * 4);
        ctx.putImageData(output, 0, 0); portraits[id] = canvas.toDataURL('image/png');
      } finally { if (parent) parent.add(model); else scene.remove(model); model.position.copy(position); model.quaternion.copy(rotation); model.visible = visible; model.updateMatrixWorld(true); }
    }
  } finally { renderer.setRenderTarget(previous); target.dispose(); }
  return portraits;
}
