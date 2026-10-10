import * as THREE from 'three';

// One controller for the human and visitor rigs. Native clips retain their
// own bones and timing; navigation supplies distance per second, never a
// permanently configured playback rate that becomes stale after a turn/stop.
export function createNPCAnimation(mixer, clips, { initial = 'Idle', walk = 'Walk', walkSpeed = 1 } = {}) {
  const available = new Map(clips.map(clip => [clip.name, clip]));
  if (!available.has('Idle') || !available.has(walk)) throw new Error(`NPC requires Idle and ${walk} animation clips`);
  if (!(walkSpeed > 0)) throw new Error('NPC walk speed must be positive');
  const actions = {};
  function actionFor(name) {
    const clip = available.get(name);
    if (!clip) throw new Error(`Unknown NPC animation: ${name}`);
    return actions[name] ??= mixer.clipAction(clip).setEffectiveWeight(0).play();
  }
  const idle = actionFor('Idle'), walking = actionFor(walk);
  let selected, walkWeight = initial === walk ? 1 : 0;
  const controller = {
    actions,
    get action() { return selected; },
    get animation() { return selected.getClip().name; },
    setAnimation(name) {
      const next = actionFor(name);
      for (const action of Object.values(actions)) action.setEffectiveWeight(action === next ? 1 : 0);
      next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveTimeScale(1).play();
      next.clampWhenFinished = false;
      selected = next; walkWeight = name === walk ? 1 : 0;
      mixer.update(0);
    },
    update(dt, speed = 0) {
      const movingSpeed = Math.abs(speed), moving = movingSpeed > .04;
      walkWeight = THREE.MathUtils.damp(walkWeight, moving ? 1 : 0, 12, dt);
      for (const action of Object.values(actions)) action.setEffectiveWeight(0);
      idle.setEffectiveWeight(1 - walkWeight).setEffectiveTimeScale(1);
      walking.setEffectiveWeight(walkWeight).setEffectiveTimeScale(moving ? movingSpeed / walkSpeed : 0);
      selected = moving ? walking : idle;
      mixer.update(dt);
    },
  };
  controller.setAnimation(available.has(initial) ? initial : 'Idle');
  return controller;
}
