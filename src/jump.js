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
  if (player.y > (player.groundY ?? 0) + .03 || player.climb || (player.jumpPhase && !recovered)) return false;
  player.jumpOriginY = player.y;
  player.jumpPhase = 'start'; player.jumpTime = player.jumpElapsed = 0;
  player.velocityY = 0; player.launched = false;
  return true;
}

export function stepJump(player, dt, groundY = 0) {
  player.groundY = groundY;
  // Walking down a graded surface must not alternate between falling and
  // landing just because a 30 FPS step spans more slope than a 120 FPS step.
  // Airborne jumps still follow their complete arc; only grounded feet snap.
  if (!player.jumpPhase && player.y > groundY + .35) { player.jumpPhase = 'fall'; player.jumpTime = 0; player.velocityY = 0; }
  if (!player.jumpPhase) { player.y = groundY; return; }
  if (player.jumpPhase === 'fall') {
    player.jumpTime += dt;
    player.y += player.velocityY * dt - .5 * JUMP.gravity * dt * dt;
    player.velocityY -= JUMP.gravity * dt;
    if (player.y <= groundY) { player.y = groundY; player.velocityY = 0; player.jumpPhase = 'land'; player.jumpTime = 0; }
    return;
  }
  if (player.jumpPhase === 'land') {
    if (player.y > groundY + .35) { player.jumpPhase = 'fall'; player.jumpTime = 0; player.velocityY = 0; return; }
    player.y = groundY;
    player.jumpTime += dt;
    if (player.jumpTime >= JUMP.landing) { player.jumpPhase = ''; player.jumpTime = 0; }
    return;
  }
  player.jumpElapsed += dt;
  const airTime = Math.max(0, player.jumpElapsed - JUMP.takeoff);
  const origin = player.jumpOriginY ?? 0;
  const flightDuration = (JUMP.velocity + Math.sqrt(Math.max(0, JUMP.velocity ** 2 + 2 * JUMP.gravity * (origin - groundY)))) / JUMP.gravity;
  player.launched = player.jumpElapsed >= JUMP.takeoff;
  player.y = origin + JUMP.velocity * airTime - .5 * JUMP.gravity * airTime * airTime;
  player.velocityY = player.launched ? JUMP.velocity - JUMP.gravity * airTime : 0;
  if (airTime >= flightDuration || player.launched && player.velocityY < 0 && player.y <= groundY) {
    player.y = groundY; player.velocityY = 0; player.launched = false;
    player.jumpPhase = 'land'; player.jumpTime = Math.max(0, airTime - flightDuration);
  } else {
    player.jumpPhase = player.jumpElapsed < JUMP.airbornePose ? 'start' : 'air';
    player.jumpTime = player.jumpElapsed - (player.jumpPhase === 'air' ? JUMP.airbornePose : 0);
  }
}
