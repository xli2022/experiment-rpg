// Shared timing keeps the authored takeoff, the physical arc, and landing in sync.
export const JUMP = Object.freeze({
  anticipation: .12,
  takeoff: .25,
  airbornePose: .55,
  velocity: 6.2,
  gravity: 18,
  landing: .94,
  landingLead: .15,
  startSample: .07,
  startPlayback: .6,
  impactDuration: .26,
  landingPlayback: .9,
  recoveryPlayback: 1.6,
});

export function beginJump(player) {
  const recovered = player.jumpPhase === 'land' && player.jumpTime >= .36;
  if (player.y > .01 || (player.jumpPhase && !recovered)) return false;
  player.jumpPhase = 'start'; player.jumpTime = player.jumpElapsed = 0;
  player.velocityY = 0; player.launched = false;
  return true;
}

export function stepJump(player, dt) {
  if (!player.jumpPhase) return;
  if (player.jumpPhase === 'land') {
    player.jumpTime += dt;
    if (player.jumpTime >= JUMP.landing) { player.jumpPhase = ''; player.jumpTime = 0; }
    return;
  }
  player.jumpElapsed += dt;
  const airTime = Math.max(0, player.jumpElapsed - JUMP.takeoff);
  const flightDuration = 2 * JUMP.velocity / JUMP.gravity;
  player.launched = player.jumpElapsed >= JUMP.takeoff;
  player.y = Math.max(0, JUMP.velocity * airTime - .5 * JUMP.gravity * airTime * airTime);
  player.velocityY = player.launched ? JUMP.velocity - JUMP.gravity * airTime : 0;
  if (airTime >= flightDuration) {
    player.y = player.velocityY = 0; player.launched = false;
    player.jumpPhase = 'land'; player.jumpTime = airTime - flightDuration;
  } else {
    player.jumpPhase = player.jumpElapsed < JUMP.airbornePose ? 'start' : 'air';
    player.jumpTime = player.jumpElapsed - (player.jumpPhase === 'air' ? JUMP.airbornePose : 0);
  }
}
