import * as THREE from 'three';

// One controller for the human and visitor rigs. Native clips retain their
// own bones and timing; navigation supplies distance per second, never a
// permanently configured playback rate that becomes stale after a turn/stop.
export function createNPCAnimation(mixer, clips, { initial = 'Idle', walk = 'Walk', walkSpeed = 1, speeds = {} } = {}) {
  const available = new Map(clips.map(clip => [clip.name, clip]));
  if (!available.has('Idle') || !available.has(walk)) throw new Error(`NPC requires Idle and ${walk} animation clips`);
  if (!(walkSpeed > 0)) throw new Error('NPC walk speed must be positive');
  const actions = {};
  function actionFor(name) {
    const clip = available.get(name);
    if (!clip) throw new Error(`Unknown NPC animation: ${name}`);
    return actions[name] ??= mixer.clipAction(clip).setEffectiveWeight(0).play();
  }
  const idle = actionFor('Idle');
  let walking = actionFor(walk), gaitSpeed = walkSpeed, gait = walk, selected, walkWeight = initial === walk ? 1 : 0;
  const controller = {
    actions,
    get action() { return selected; },
    get animation() { return selected.getClip().name; },
    setAnimation(name) {
      const next = actionFor(name);
      for (const action of Object.values(actions)) action.setEffectiveWeight(action === next ? 1 : 0);
      next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveTimeScale(1).play();
      next.clampWhenFinished = false;
      selected = next; walkWeight = name === gait ? 1 : 0;
      mixer.update(0);
    },
    get gait() { return gait; },
    /** Swap the moving clip (for example Walk to Jog); its own speed calibrates playback. */
    setGait(name) {
      if (name === gait) return true;
      // The avatar's own walk is always available; other gaits need a calibrated speed.
      const speed = name === walk ? walkSpeed : speeds[name];
      if (!available.has(name) || !(speed > 0)) return false;
      const previous = walking;
      walking = actionFor(name); walking.time = previous.time / previous.getClip().duration * walking.getClip().duration;
      gait = name; gaitSpeed = speed;
      return true;
    },
    update(dt, speed = 0) {
      const movingSpeed = Math.abs(speed), moving = movingSpeed > .04;
      walkWeight = THREE.MathUtils.damp(walkWeight, moving ? 1 : 0, 12, dt);
      for (const action of Object.values(actions)) action.setEffectiveWeight(0);
      idle.setEffectiveWeight(1 - walkWeight).setEffectiveTimeScale(1);
      walking.setEffectiveWeight(walkWeight).setEffectiveTimeScale(moving ? movingSpeed / gaitSpeed : 0);
      selected = moving ? walking : idle;
      mixer.update(dt);
    },
  };
  controller.setAnimation(available.has(initial) ? initial : 'Idle');
  return controller;
}
