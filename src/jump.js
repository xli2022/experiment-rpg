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

export const PARACHUTE = Object.freeze({ deployDistance: 12, descentSpeed: 5, inflationTime: .55 });

export function resetFall(player) {
  player.fallPeakY = null;
  player.parachute = null;
  player.parachuteStartVelocityY = 0;
}

function land(player, groundY, time = 0) {
  player.y = groundY; player.velocityY = 0; player.launched = false;
  player.jumpPhase = 'land'; player.jumpTime = Math.max(0, time);
  resetFall(player);
}

function glide(player, dt) {
  const chute = player.parachute, start = player.parachuteStartVelocityY;
  const end = -PARACHUTE.descentSpeed, duration = PARACHUTE.inflationTime;
  // Integrate the smoothstep velocity curve exactly: deployment is continuous
  // and the same fall covers the same distance at every frame rate.
  const distance = time => {
    const u = Math.min(1, time / duration);
    return start * Math.min(time, duration) + (end - start) * duration * (u ** 3 - .5 * u ** 4) + end * Math.max(0, time - duration);
  };
  const previous = chute.elapsed;
  chute.elapsed += dt;
  const u = Math.min(1, chute.elapsed / duration);
  chute.openness = u * u * (3 - 2 * u);
  player.y += distance(chute.elapsed) - distance(previous);
  player.velocityY = start + (end - start) * chute.openness;
}

function advanceFall(player, dt, nextY, nextVelocity) {
  if (player.parachute) { glide(player, dt); return; }
  const threshold = player.fallPeakY - PARACHUTE.deployDistance;
  if (nextVelocity < 0 && nextY <= threshold) {
    // Split the frame at the actual 12 m crossing instead of opening one
    // whole frame late. Ordinary jumps retain their authored arc up to here.
    const velocity = player.velocityY ?? 0;
    const time = player.y <= threshold ? 0 : Math.min(dt,
      (velocity + Math.sqrt(velocity ** 2 + 2 * JUMP.gravity * (player.y - threshold))) / JUMP.gravity);
    player.y = Math.min(player.y, threshold);
    player.velocityY = velocity - JUMP.gravity * time;
    player.parachuteStartVelocityY = player.velocityY;
    player.parachute = { elapsed: 0, openness: 0 };
    glide(player, Math.max(0, dt - time));
  } else {
    player.y = nextY; player.velocityY = nextVelocity;
  }
}

export function beginJump(player) {
  const recovered = player.jumpPhase === 'land' && player.jumpTime >= .36;
  if (player.y > (player.groundY ?? 0) + .03 || player.climb || (player.jumpPhase && !recovered)) return false;
  resetFall(player);
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
  if (!player.jumpPhase && player.y > groundY + .35) {
    resetFall(player); player.jumpPhase = 'fall'; player.jumpTime = 0; player.velocityY = 0;
  }
  if (!player.jumpPhase) { player.y = groundY; resetFall(player); return; }
  if (player.jumpPhase === 'fall') {
    // A wall push can begin with upward speed. Its ballistic apex, rather than
    // the release height, is the start of the subsequent downward drop.
    if (!Number.isFinite(player.fallPeakY)) player.fallPeakY = player.y + Math.max(0, player.velocityY ?? 0) ** 2 / (2 * JUMP.gravity);
    player.jumpTime += dt;
    advanceFall(player, dt, player.y + player.velocityY * dt - .5 * JUMP.gravity * dt * dt, player.velocityY - JUMP.gravity * dt);
    if (player.y <= groundY) land(player, groundY);
    return;
  }
  if (player.jumpPhase === 'land') {
    if (player.y > groundY + .35) {
      resetFall(player); player.jumpPhase = 'fall'; player.jumpTime = 0; player.velocityY = 0; return;
    }
    resetFall(player);
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
  player.fallPeakY = origin + JUMP.velocity ** 2 / (2 * JUMP.gravity);
  advanceFall(player, dt, origin + JUMP.velocity * airTime - .5 * JUMP.gravity * airTime * airTime,
    player.launched ? JUMP.velocity - JUMP.gravity * airTime : 0);
  if (player.parachute) {
    player.jumpPhase = 'fall'; player.jumpTime = 0; player.launched = false;
    if (player.y <= groundY) land(player, groundY);
    return;
  }
  if (airTime >= flightDuration || player.launched && player.velocityY < 0 && player.y <= groundY) {
    land(player, groundY, airTime - flightDuration);
  } else {
    player.jumpPhase = player.jumpElapsed < JUMP.airbornePose ? 'start' : 'air';
    player.jumpTime = player.jumpElapsed - (player.jumpPhase === 'air' ? JUMP.airbornePose : 0);
  }
}
