import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { JUMP } from './jump.js';
import { animateClimb } from './climb-animation.js';
import { animateParachutePose } from './parachute.js';
import { VISITOR_PROFILES } from '../../actors/npc-visitors.js';
import { npcSurfaceTextures } from '../../actors/npc-surfaces.js';
import { HUMAN_BASE_MODELS } from '../../actors/npc-profiles.js';

let assets;
export function loadCharacterAssets() {
  if (!assets) {
    const loader = new GLTFLoader();
    const modelBase = `${import.meta.env?.BASE_URL ?? '/'}models/`;
    assets = Promise.all([loader.loadAsync(`${modelBase}vex.glb`), loader.loadAsync(`${modelBase}citizen.glb`),
      Promise.all(HUMAN_BASE_MODELS.map(profile => loader.loadAsync(`${modelBase}${profile.file}`).catch(error => {
        console.warn(`Could not load ${profile.id}; using the citizen base for its human profiles.`, error);
        return null;
      }))),
      Promise.all(VISITOR_PROFILES.map(profile => loader.loadAsync(`${modelBase}visitors/${profile.id}.glb`).catch(error => {
        console.warn(`Could not load ${profile.id}; using human pedestrians for its slots.`, error);
        return null;
      }))),
    ])
      .then(([player, citizen, humans, visitors]) => {
        citizen.userData.baseModel = 'citizen';
        for (const [index, human] of humans.entries()) if (human) human.userData.baseModel = HUMAN_BASE_MODELS[index].id;
        // Preserve the glTF loader's color-space assignments: base color and
        // emissive maps are sRGB, while normal/roughness data stays linear.
        // Modest anisotropy keeps woven cloth and panel lines clear at angles.
        for (const asset of [player, citizen, ...humans, ...visitors]) asset?.scene.traverse(object => {
          if (!object.isMesh) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            for (const value of Object.values(material)) if (value?.isTexture) value.anisotropy = Math.max(4, value.anisotropy);
          }
        });
        // Both exports use the same atlas. Reuse GPU materials/textures as well.
        const shared = new Map();
        player.scene.traverse(object => { if (object.isMesh) shared.set(object.material.name, object.material); });
        const unusedTextures = new Set();
        citizen.scene.traverse(object => {
          if (!object.isMesh || !shared.has(object.material.name)) return;
          const old = object.material;
          for (const value of Object.values(old)) if (value?.isTexture) unusedTextures.add(value);
          object.material = shared.get(old.name);
          old.dispose();
        });
        for (const texture of unusedTextures) texture.dispose();
        for (const asset of [player, citizen, ...humans]) asset?.scene.traverse(object => {
          if (!object.isMesh) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) polishCharacterMaterial(material);
        });
        return { player, citizen,
          humanBases: Object.fromEntries([['citizen', citizen], ...HUMAN_BASE_MODELS.map((profile, i) => [profile.id, humans[i] ?? citizen])]),
          visitors: Object.fromEntries(VISITOR_PROFILES.map((profile, i) => [profile.id, visitors[i]])),
        };
      });
  }
  return assets;
}

const weaponGeometry = new RoundedBoxGeometry(1, 1, 1, 2, .075);
function weaponPart(parent, size, pos, material) {
  const mesh = new THREE.Mesh(weaponGeometry, material);
  mesh.scale.set(...size); mesh.position.set(...pos); parent.add(mesh);
  return mesh;
}

function createWeapon() {
  const gun = new THREE.Group(); gun.name = 'GhostMachinePistol';
  const body = new THREE.MeshStandardMaterial({ color: 0x33414a, roughness: .48, metalness: .7 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x10151c, roughness: .86 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x90aea8, roughness: .3, metalness: .85 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x72dcc4, emissive: 0x43d4b7, emissiveIntensity: .9 });
  weaponPart(gun, [.045, .071, .205], [0, .050, -.048], body);
  weaponPart(gun, [.043, .038, .23], [0, .096, -.048], body);
  weaponPart(gun, [.037, .118, .049], [0, -.041, .031], rubber).rotation.x = -.22;
  weaponPart(gun, [.042, .016, .055], [0, -.104, .018], body);
  weaponPart(gun, [.043, .021, .061], [0, -.005, -.051], rubber);
  weaponPart(gun, [.005, .042, .061], [-.023, .013, -.053], trim);
  weaponPart(gun, [.005, .042, .061], [.023, .013, -.053], trim);
  weaponPart(gun, [.027, .026, .031], [0, .123, .014], trim);
  weaponPart(gun, [.005, .011, .059], [.025, .08, -.03], glow);
  for (let i = 0; i < 5; i++) weaponPart(gun, [.003, .023, .005], [.023, .093, .008 + i * .012], trim);
  const muzzle = new THREE.Object3D(); muzzle.name = 'Muzzle'; muzzle.position.set(0, .082, -.176); gun.add(muzzle);
  const flash = new THREE.Mesh(new THREE.OctahedronGeometry(.07), new THREE.MeshBasicMaterial({ color: 0xffec95 }));
  flash.scale.set(.5, .5, 2.3); flash.position.copy(muzzle.position); flash.visible = false; gun.add(flash);
  return { gun, muzzle, flash };
}

const upperBody = /^(Spine|Chest|Neck|Head|Clavicle|UpperArm|Forearm|Hand|Finger)/;
const motionSpeed = { Walk: 1.084589, Jog: 5.959281, Run: 9.177293 };
const locomotion = ['Idle', 'Walk', 'Jog', 'Run'];
const required = [...locomotion, 'JumpStart', 'JumpLoop', 'JumpLand', 'ArmedIdle', 'Aim', 'AimUp', 'AimDown', 'Reload', 'Fire'];

function polishCharacterMaterial(material) {
  const surface = { Skin: 'skin', Jacket: 'cloth', Trousers: 'cloth', BootsAndGloves: 'leather', Hardware: 'metal' }[material.name];
  if (surface) {
    const maps = npcSurfaceTextures(surface);
    // Preserve the authored skin and garment atlases. Only untextured leather
    // and hardware receive a new color tile; all get subtle material relief.
    if (!material.map && surface !== 'skin') material.map = maps.map;
    material.normalMap ??= maps.normalMap;
    material.roughnessMap ??= maps.roughnessMap;
    material.normalScale.setScalar(surface === 'skin' ? .18 : .35);
    material.userData.surface = surface;
    material.needsUpdate = true;
  }
  for (const texture of Object.values(material)) if (texture?.isTexture) texture.anisotropy = Math.max(4, texture.anisotropy);
  material.envMapIntensity = .48;
}

function footContactPoints(body) {
  const points = [], seen = new Set();
  body.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < position.count; i++) {
      const joint = joints.getX(i), bone = mesh.skeleton.bones[joint];
      if (!/^Foot[LR]$/.test(bone.name) || weights.getX(i) < .999) continue;
      const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[joint]);
      const key = bone.name + point.toArray().map(v => v.toFixed(4)).join(',');
      if (!seen.has(key)) { seen.add(key); points.push({ bone, point }); }
    }
  });
  return points;
}

export function createCharacter(asset) {
  const root = new THREE.Group(); root.name = 'Vex';
  const body = clone(asset.scene); root.add(body);
  const bones = new Map();
  body.traverse(object => {
    if (object.isBone) bones.set(object.name, object);
    if (object.isMesh) {
      object.frustumCulled = false;
      object.castShadow = true; object.receiveShadow = true;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) polishCharacterMaterial(material);
    }
  });
  const clips = Object.fromEntries(asset.animations.map(clip => [clip.name, clip]));
  const contacts = footContactPoints(body);
  for (const name of required) if (!clips[name]) throw new Error(`Missing authored character clip: ${name}`);
  const mixer = new THREE.AnimationMixer(body);
  // The gun socket is calibrated in the downloaded neutral aiming pose.
  const calibration = mixer.clipAction(clips.Aim).play(); mixer.update(0);
  root.updateMatrixWorld(true);
  const hand = bones.get('HandR');
  const { gun, muzzle, flash } = createWeapon();
  const handWorld = hand.getWorldQuaternion(new THREE.Quaternion());
  gun.quaternion.copy(handWorld.clone().invert());
  gun.position.copy(new THREE.Vector3(0, -.028, -.035).applyQuaternion(handWorld.clone().invert()));
  hand.add(gun); calibration.stop();
  const lower = {}, upper = {};
  for (const name of required.filter(name => !name.startsWith('Aim'))) {
    const split = isUpper => new THREE.AnimationClip(`${name}_${isUpper ? 'upper' : 'lower'}`, clips[name].duration,
      clips[name].tracks.filter(track => upperBody.test(track.name) === isUpper));
    for (const [layer, isUpper] of [[lower, false], [upper, true]]) {
      layer[name] = mixer.clipAction(split(isUpper)).setEffectiveWeight(0).setEffectiveTimeScale(0).play();
    }
  }
  const aim = {};
  for (const direction of ['Up', 'Down']) {
    const clip = clips['Aim' + direction].clone();
    THREE.AnimationUtils.makeClipAdditive(clip, 0, clips.Aim, 30);
    clip.tracks = clip.tracks.filter(track => upperBody.test(track.name));
    aim[direction] = mixer.clipAction(clip).setEffectiveWeight(0).setEffectiveTimeScale(0).play();
  }
  const model = { root, body, bones, mixer, lower, upper, aim, clips, gun, muzzle, flash,
    time: 0, phase: 0, shotAge: 100, combatTimer: 0, combatWeight: 0,
    baseWeights: { Idle: 1, Walk: 0, Jog: 0, Run: 0, JumpStart: 0, JumpLoop: 0, JumpLand: 0, ArmedIdle: 0 },
    reloadAge: 0, wasReloading: false, animation: 'Idle', aimPitch: 0,
    jumpTimes: { JumpStart: 0, JumpLoop: 0, JumpLand: 0 }, previousJump: '',
    contacts, groundLift: 0, baseBodyY: body.position.y, contactPoint: new THREE.Vector3(),
  };
  // An actor can be rendered before its first simulation tick (portraits,
  // pause screens, and gallery previews). Start in the real idle, not bind pose.
  animateCharacter(model, false, 0);
  return model;
}

export function characterShot(model) {
  model.shotAge = 0;
  model.combatTimer = 2.2;
}

export function animateCharacter(model, aiming, dt, options = {}) {
  model.time += dt; model.shotAge += dt;
  model.combatTimer = Math.max(0, model.combatTimer - dt);
  const parachute = options.climb ? null : options.parachute;
  const reloading = !parachute && options.reloading > 0;
  if (reloading && !model.wasReloading) model.reloadAge = 0;
  if (reloading) { model.reloadAge += dt; model.combatTimer = 2.2; }
  model.wasReloading = reloading;
  const speed = options.climb || parachute ? 0 : options.speed ?? 0;
  const moving = speed > .08;
  const combat = !options.climb && !parachute && (aiming || reloading || model.combatTimer > 0);
  model.combatWeight = THREE.MathUtils.damp(model.combatWeight, combat ? 1 : 0, combat ? 18 : 7, dt);
  const armed = parachute ? 0 : model.combatWeight;
  const jump = options.jumpPhase === 'fall' ? 'air' : options.jumpPhase;
  const jumpTime = options.jumpTime || 0;
  // Each outgoing clip keeps its last sample during the crossfade. Reusing the
  // new phase's clock here used to rewind the old pose to frame zero mid-blend.
  if (jump === 'start') {
    model.jumpTimes.JumpStart = JUMP.startSample + Math.max(0, jumpTime - JUMP.anticipation) * JUMP.startPlayback;
    if (model.previousJump !== 'start') model.jumpTimes.JumpLoop = 0;
  }
  if (jump === 'air') {
    model.jumpTimes.JumpLoop = jumpTime;
    if (model.previousJump !== 'air') model.jumpTimes.JumpLand = 0;
  }
  if (jump === 'land') model.jumpTimes.JumpLand = Math.min(jumpTime, JUMP.impactDuration) * JUMP.landingPlayback + Math.max(0, jumpTime - JUMP.impactDuration) * JUMP.recoveryPlayback;
  model.previousJump = jump;
  const gait = moving ? speed > 6.3 ? 'Run' : speed > 2.5 ? 'Jog' : 'Walk' : 'Idle';
  const target = parachute ? 'Idle' : jump === 'start' ? 'JumpStart' : jump === 'air' ? 'JumpLoop' : jump === 'land' ? 'JumpLand' : gait;
  model.animation = reloading ? 'Reload' : jump ? target : combat ? (moving ? 'Armed' + gait : 'ArmedIdle') : target;
  const targetWeights = { [target]: 1 };
  if (!parachute && jump === 'air' && options.verticalSpeed < 0) {
    const v = options.verticalSpeed, h = Math.max(0, options.height || 0);
    const contactIn = (v + Math.sqrt(v * v + 2 * JUMP.gravity * h)) / JUMP.gravity;
    const prepare = THREE.MathUtils.smoothstep(JUMP.landingLead - contactIn, 0, JUMP.landingLead);
    targetWeights.JumpLoop = 1 - prepare; targetWeights.JumpLand = prepare;
  }
  if (!parachute && jump === 'land') {
    // A moving character steps out of the impact instead of sliding through the
    // entire planted recovery. Standing jumps keep the full authored recovery.
    const recover = THREE.MathUtils.smoothstep(jumpTime, moving ? .08 : JUMP.landing - .25, moving ? .34 : JUMP.landing);
    targetWeights.JumpLand = 1 - recover; targetWeights[gait] = recover;
  }
  if (!jump && !moving) { targetWeights.Idle = 1 - armed; targetWeights.ArmedIdle = armed; }
  const rate = jump === 'start' ? 18 : jump === 'air' ? 14 : jump === 'land' ? 16 : moving ? 13 : 10;
  let total = 0;
  for (const name of Object.keys(model.baseWeights)) {
    model.baseWeights[name] = THREE.MathUtils.damp(model.baseWeights[name], targetWeights[name] || 0, rate, dt);
    total += model.baseWeights[name];
  }
  if (moving) model.phase = (model.phase + dt * speed / (motionSpeed[gait] * model.clips[gait].duration)) % 1;
  for (const action of [...Object.values(model.lower), ...Object.values(model.upper)]) action.setEffectiveWeight(0);
  const reloadWeight = reloading ? Math.min(1, model.reloadAge / .07) : 0;
  const fireDuration = .25;
  const fireWeight = !reloading && model.shotAge < fireDuration ? Math.min(1, (fireDuration - model.shotAge) / .06) : 0;
  for (const [name, rawWeight] of Object.entries(model.baseWeights)) {
    const weight = rawWeight / total;
    const duration = model.clips[name].duration;
    let time = model.time % duration;
    if (motionSpeed[name]) time = model.phase * duration;
    if (name in model.jumpTimes) time = name === 'JumpLoop'
      ? model.jumpTimes[name] % duration
      : Math.min(duration - .001, model.jumpTimes[name]);
    model.lower[name].time = model.upper[name].time = time;
    model.lower[name].setEffectiveWeight(weight);
    model.upper[name].setEffectiveWeight(weight * (1 - armed));
  }
  // Weapon clips are true moving upper-body layers. They no longer freeze the
  // arms at a single sample or overwrite the walk animation with a static pose.
  model.upper.ArmedIdle.time = model.time % model.clips.ArmedIdle.duration;
  model.upper.ArmedIdle.setEffectiveWeight(model.baseWeights.ArmedIdle / total * (1 - armed) + armed * (1 - reloadWeight) * (1 - fireWeight));
  model.upper.Reload.time = Math.min(model.clips.Reload.duration - .001, model.reloadAge);
  model.upper.Reload.setEffectiveWeight(armed * reloadWeight);
  model.upper.Fire.time = Math.min(model.clips.Fire.duration - .001, model.shotAge / fireDuration * model.clips.Fire.duration);
  model.upper.Fire.setEffectiveWeight(armed * fireWeight * (1 - reloadWeight));
  model.aimPitch = THREE.MathUtils.damp(model.aimPitch, options.pitch || 0, 16, dt);
  const pitch = model.aimPitch / (Math.PI / 2);
  model.aim.Up.setEffectiveWeight(Math.max(0, -pitch) * armed * (1 - reloadWeight));
  model.aim.Down.setEffectiveWeight(Math.max(0, pitch) * armed * (1 - reloadWeight));
  model.mixer.update(dt);
  model.body.position.y = model.baseBodyY;
  animateClimb(model, options.climb, dt);
  animateParachutePose(model, parachute, dt);
  model.root.updateMatrixWorld(true);
  // Rotational crossfades can put a boot below the pavement even when both
  // source clips are grounded. Correct the blended body using the actual boot
  // vertices; retain airborne poses and release the correction smoothly.
  if (model.contacts.length && !options.climb && !parachute) {
    let minimum = Infinity;
    for (const { bone, point } of model.contacts) {
      minimum = Math.min(minimum, model.contactPoint.copy(point).applyMatrix4(bone.matrixWorld).y);
    }
    const lift = Math.max(0, (options.groundHeight || 0) + .008 - minimum);
    model.groundLift = Math.max(lift, THREE.MathUtils.damp(model.groundLift, lift, 18, dt));
    model.body.position.y += model.groundLift;
    model.root.updateMatrixWorld(true);
  }
}
