import { traceResidentPath as trace } from './resident-path.js';
import { angleDelta, clamp } from '../core/physics.js';
import { RESIDENT_SIT } from '../core/resident-behaviors.js';
import { residentPlan, placePlan, compositePlan, describePlan, PLACE_ACTIONS } from './resident-plans.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = p => ({ x: p.x, y: p.y, z: p.z });
const reached = (a, b, radius = .03) => distance(a, b) < radius && Math.abs(a.y - b.y) < .12;
const STANDING_ACTIONS = ['follow', 'dance', 'guide', 'go_to', 'get_up'];
const FOLLOW_GAP = 1.65, TRAIL_LIMIT = 2048;
// Followers walk, and jog to catch up once the player gets ahead: the further
// behind along the player's footsteps, the faster, up to a little more than
// the player's own jog. They change to a jog above JOG_FROM and back to a
// walk below WALK_FROM, so the gait does not flicker at one speed.
const FOLLOW_WALK = 2.6, FOLLOW_JOG = 6.2, JOG_FROM = 3.2, WALK_FROM = 2.8;
// Turns that take a resident round someone in the way, smallest first; never
// backwards. They look this far ahead, so they bear off before reaching
// someone rather than walking into a gap too narrow to pass. A detour that
// gets them no nearer for DETOUR_PATIENCE seconds is given up.
const DETOURS = [Math.PI / 6, Math.PI / 3, Math.PI / 2], LOOKAHEAD = .6, DETOUR_PATIENCE = 1;

const reverseRoute = trail => [...trail].reverse().map(node => node.kind === 'lift' ? { ...node, from: point(node.to), to: point(node.from) } : point(node));
// Where a new footstep closes a loop in the route back: an earlier footstep
// right beside it, on the same floor and in reach. Cutting the loop there
// keeps the way home a simple path, so walking back and forth never fills it.
function loopBack(trail, next, navigation) {
  for (let i = 0; i < trail.length - 10; i++) {
    const node = trail[i];
    if (!node.kind && Math.abs(node.y - next.y) < .1 && distance(node, next) < .25 && trace(next, node, navigation.withoutPeople ?? navigation)) return i;
  }
  return -1;
}
function breadcrumb(trail, next) {
  const last = trail.at(-1), previous = trail.at(-2);
  if (!last || last.kind === 'lift') return true;
  const turn = previous && previous.kind !== 'lift' && Math.abs(angleDelta(Math.atan2(last.x - previous.x, last.z - previous.z), Math.atan2(next.x - last.x, next.z - last.z))) > .15;
  return distance(last, next) > .18 || Math.abs(last.y - next.y) > .1 || turn && distance(last, next) > .04;
}

export function residentActionContext(body, navigation) {
  const plan = body.residentAction?.plan;
  return { behavior: body.residentAction?.kind ?? 'routine', status: body.residentAction?.status ?? 'Going about my day',
    ...(plan && (plan.index + 1 < plan.steps.length || plan.repeat) ? { next: plan.steps.slice(plan.index + 1).map(step => step.action), repeat: plan.repeat } : {}),
    posture: body.residentAction?.sitProgress > 0 || body.pose === 'sit' ? 'seated' : 'standing',
    canWalk: navigation.mobile !== false, area: navigation.area,
    destinations: (navigation.destinations?.() ?? []).map(({ id, name, type, distance }) => ({ id, name, type, distance })) };
}

function roomToSitDown(start, yaw, player, navigation) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // Overlapping standing-radius samples cover the compact seated footprint;
  // equal support at each point rules out steps and ledges beneath the body.
  const acrossEdge = RESIDENT_SIT.width / 2 - .3, alongEdge = RESIDENT_SIT.length / 2 - .3;
  for (const across of [-acrossEdge, 0, acrossEdge]) for (let along = -alongEdge; along <= alongEdge + .01; along += .25) {
    const p = { x: start.x + c * across + s * along, y: start.y, z: start.z - s * across + c * along };
    const support = navigation.sample(p, p, true);
    if (!support || Math.abs(support.y - start.y) > .08 || Math.abs(player.y - start.y) < 1.3 && distance(p, player) < .75) return false;
  }
  return true;
}

/** Check an intention without changing the resident's current activity. */
export function previewResidentAction(body, action, player, navigation) {
  return requestResidentAction({ ...body }, action, player, navigation);
}

/**
 * Accept a request: an action name, `{ action, destination }`, or a plan
 * `{ steps, repeat }`. The first step is checked fully and starts now; later
 * steps are checked when they start, from wherever the resident is then.
 */
export function requestResidentAction(body, request, player, navigation) {
  const denied = reply => ({ ok: false, reply });
  const plan = residentPlan(request);
  if (!plan) return denied('I cannot do that.');
  // A conversation can finish as the player walks away (at 4.5 m).
  if (!player || distance(body, player) > 6 || Math.abs(body.y - player.y) > 1.3) return denied('Come a little closer first.');
  if (navigation.crossing && !body.residentAction) return denied('Let me finish crossing the street first.');
  const placed = placePlan(plan, navigation.destinations?.() ?? []);
  if (placed.reply) return denied(placed.reply);
  const result = beginStep(body, plan, 0, player, navigation);
  return result.ok && compositePlan(plan) ? { ...result, reply: describePlan(plan) } : result;
}

function beginStep(body, plan, index, player, navigation) {
  const step = plan.steps[index], action = step.action;
  const denied = reply => ({ ok: false, reply });
  if (navigation.mobile === false && STANDING_ACTIONS.includes(action)) return denied('I need to stay seated here for now.');
  const gettingUp = body.pose === 'sit' && STANDING_ACTIONS.includes(action);
  const seat = gettingUp ? navigation.seatExit?.() : null;
  if (gettingUp && !seat) return denied('I need a little room to stand up first.');
  const start = seat?.path.at(-1) ?? body;
  if (action === 'sit_down' && body.pose !== 'sit' && !body.residentAction?.sitProgress && !roomToSitDown(start, body.yaw, player, navigation)) return denied('I need a clear, level space to sit down.');
  let guide = null;
  if (PLACE_ACTIONS.includes(action)) {
    guide = navigation.guide?.(start, step.place);
    if (!guide?.route?.length) return denied('I cannot find a clear walking route there from here.');
  }
  const prior = body.residentAction;
  if (action === 'resume_routine' && !prior) {
    if (index + 1 < plan.steps.length) return beginStep(body, plan, index + 1, player, navigation);
    return { ok: true, reply: 'All right. I will carry on.', status: 'Going about my day' };
  }
  plan.index = index;
  const state = body.residentAction = {
    kind: action, home: seat ? { ...point(start), yaw: body.yaw } : prior?.home ?? { ...point(body), yaw: body.yaw },
    // When interrupted on the way home, retain only the untraversed return
    // route. Reusing the old outbound endpoint could cross a wall or floor.
    trail: seat ? [point(start)] : prior?.kind === 'resume_routine' ? reverseRoute(prior.route) : prior?.trail ?? [point(body)],
    route: guide?.route.map(point) ?? [], target: guide ? point(guide.route.at(-1)) : null, repath: 0, status: '', followAt: point(player), elapsed: 0,
    destination: guide ? { id: guide.destination.id, name: guide.destination.name } : null,
    seat: seat ?? prior?.seat ?? null,
    transition: seat ? 'rise' : prior?.transition ?? null,
    sitProgress: prior?.sitProgress ?? 0,
    plan, time: 0, from: point(player),
  };
  if (state.transition === 'sit' && action !== 'resume_routine') state.transition = 'rise';
  if (body.pose === 'sit' && (action === 'wait' || action === 'sit_down')) state.transition = null;
  if (action === 'follow') state.route = [point(player)];
  if (action === 'resume_routine') state.route = reverseRoute(state.trail);
  body.speed = 0;
  const replies = {
    follow: 'Sure. I will follow you.',
    wait: 'All right. I will wait here.',
    dance: 'Sure. I will dance until you ask me to stop.',
    sit_down: body.pose === 'sit' ? 'All right. I will stay seated here.' : 'All right. I will sit down here.', get_up: 'All right. I will stand here.',
    guide: guide && `Follow me to ${guide.destination.name}. I will wait if you fall behind.`,
    go_to: guide && `Sure. I will go to ${guide.destination.name} and wait there.`,
    resume_routine: 'All right. I will get back to what I was doing.',
  };
  state.status = { follow: 'Following you', wait: 'Waiting here',
    dance: 'Dancing', sit_down: body.pose === 'sit' ? 'Seated here' : 'Sitting down', get_up: 'Getting up', guide: guide && `Guiding you to ${guide.destination.name}`, go_to: guide && `Going to ${guide.destination.name}`, resume_routine: 'Returning to my routine' }[action];
  return { ok: true, reply: replies[action], status: state.status };
}

function stepSeat(body, dt, player, navigation) {
  const state = body.residentAction, seat = state.seat, sitting = state.transition === 'sit';
  const target = sitting ? seat.origin : seat.path.at(-1);
  body.pose = 'stand';
  state.status = sitting ? 'Returning to my seat' : 'Getting up';
  if (reached(body, target)) {
    Object.assign(body, point(target)); body.speed = 0;
    if (sitting) { body.pose = 'sit'; body.yaw = seat.origin.yaw; body.residentAction = null; }
    else state.transition = null;
    return 0;
  }
  const angle = Math.atan2(-(target.x - body.x), -(target.z - body.z)), error = angleDelta(body.yaw, angle);
  body.yaw += clamp(error, -2.6 * dt, 2.6 * dt);
  const step = Math.min(distance(body, target), 1.2 * dt * Math.max(0, Math.cos(error)));
  if (step < 1e-6) return 0;
  const ratio = step / distance(body, target), next = navigation.sampleSeat?.(body, {
    x: body.x + (target.x - body.x) * ratio, y: body.y, z: body.z + (target.z - body.z) * ratio,
  }, seat);
  if (!next || Math.abs(player.y - body.y) < 1.3 && distance(next, player) < .8 && distance(next, player) < distance(body, player)) {
    state.status = sitting ? 'Waiting for room at my seat' : 'Waiting for room to stand up'; return 0;
  }
  const moved = distance(body, next);
  Object.assign(body, next); body.speed = moved / dt;
  return moved;
}

// How far a follower still has to walk along the player's footsteps.
function trailLength(body, state, player) {
  let length = 0, at = body;
  for (let i = state.routeIndex ?? 0; i < state.route.length; i++) {
    const node = state.route[i];
    if (node.kind === 'lift') { at = node.to; continue; }
    length += distance(at, node); at = node;
  }
  return length + distance(at, player);
}

function followSpeed(body, state, player) {
  const behind = trailLength(body, state, player) - FOLLOW_GAP;
  const speed = clamp(FOLLOW_WALK + (behind - 1.5) * 1.6, FOLLOW_WALK, FOLLOW_JOG);
  state.jog = speed > JOG_FROM || !!state.jog && speed > WALK_FROM;
  return speed;
}

const crowdsPlayer = (body, next, player) => Math.abs(body.y - player.y) < 1.3 && distance(next, player) < .8 && distance(next, player) < distance(body, player);

// The heading to walk: straight at the target, or, when only people are in
// the way, the smallest turn round them, keeping to the side last taken so
// two residents in each other's way part instead of both waiting. Someone
// who is not getting any nearer their goal waits rather than circling.
function heading(body, target, remaining, step, dt, state, player, navigation) {
  const ahead = Math.atan2(-(target.x - body.x), -(target.z - body.z)), reach = Math.min(remaining, LOOKAHEAD);
  const to = (angle, length) => ({ x: body.x - Math.sin(angle) * length, y: body.y, z: body.z - Math.cos(angle) * length });
  const clear = (angle, length) => { const next = trace(body, to(angle, length), navigation); return next && !crowdsPlayer(body, next, player); };
  const open = angle => clear(angle, step) && (reach <= step || clear(angle, reach));
  if (!navigation.withoutPeople || open(ahead)) { state.detour = null; return ahead; }
  const side = state.side ?? 1;
  if (!trace(body, to(ahead, reach), navigation.withoutPeople)) {
    // A wall's end or a door jamb just in the way of someone who walked round
    // people, off their footsteps: slide past it while still getting nearer.
    if (!clear(ahead, step)) for (const turn of DETOURS.slice(0, 2)) for (const s of [side, -side]) if (clear(ahead + s * turn, step)) return ahead + s * turn;
    return ahead;
  }
  const end = state.route.at(-1), goal = end && !end.kind ? end : target, near = distance(body, goal);
  if (state.detour?.goal !== goal) state.detour = { goal, best: near, time: 0 };
  const detour = state.detour;
  if (near < detour.best - .1) { detour.best = near; detour.time = 0; }
  if ((detour.time += dt) > DETOUR_PATIENCE) return ahead;
  // A way round that stays clear for the whole look ahead; failing that, the
  // next step only, straight on first.
  for (const turn of DETOURS) for (const s of [side, -side]) if (open(ahead + s * turn)) { state.side = s; return ahead + s * turn; }
  if (clear(ahead, step)) return ahead;
  for (const turn of DETOURS) for (const s of [side, -side]) if (clear(ahead + s * turn, step)) { state.side = s; return ahead + s * turn; }
  return ahead;
}

/** Record a real player elevator trip; model decisions never supply trip coordinates. */
export function queueResidentLift(body, from, to, navigation) {
  const state = body.residentAction;
  if (state?.kind !== 'follow' || distance(body, from) > 24 || Math.abs(state.followAt.y - from.y) > .6 || !navigation.liftValid?.(from, to)) return false;
  if (state.route.length + 3 > TRAIL_LIMIT) return false;
  state.route.push(point(from), { kind: 'lift', from: point(from), to: point(to) }, point(to));
  state.followAt = point(to); state.repath = 0;
  return true;
}

// When a plan's step is over: its own end (arriving, sitting down, standing,
// getting home), its duration, or its condition. Waiting until the player
// comes back counts only after they have been away; following until they
// stop, only after they have walked off.
function stepEnded(body, state, step, dt, player, navigation) {
  if (body.residentAction !== state) return true;
  if (step.seconds && state.time >= step.seconds) return true;
  const gap = distance(body, player), level = Math.abs(player.y - body.y) < 1.3, away = navigation.onFoot === false || !level;
  switch (step.until) {
    case 'player_returns':
      if (away || gap >= 8) state.armed = true;
      return !!state.armed && !away && gap < 3;
    case 'player_leaves': return away || gap >= 10;
    case 'player_stops': {
      const moved = state.lastPlayer ? distance(state.lastPlayer, player) : Infinity;
      state.lastPlayer = point(player);
      state.still = moved < .5 * dt ? (state.still ?? 0) + dt : 0;
      if (distance(state.from, player) > 3) state.armed = true;
      return !!state.armed && state.still >= 3 && level && gap < FOLLOW_GAP + 1.5;
    }
    case 'place': return distance(body, step.place) < 4 && Math.abs(body.y - step.place.y) < 1.3;
  }
  return !!state.arrived || !!state.stood || step.action === 'sit_down' && (body.pose === 'sit' || state.sitProgress === 1);
}

// Start the step after one that has ended, from the top again for a repeating
// plan, at most one a frame. A step that cannot start leaves the resident
// waiting where they are.
function continuePlan(body, state, dt, player, navigation) {
  const plan = state.plan, step = plan.steps[plan.index];
  plan.time = (plan.time ?? 0) + dt;
  if (!stepEnded(body, state, step, dt, player, navigation)) return;
  let index = plan.index + 1;
  if (index === plan.steps.length) {
    // A pass that took no time would run every step at once, forever.
    if (!plan.repeat || plan.time < 1) return finishPlan(body, state, step);
    index = 0; plan.time = 0;
  }
  const next = beginStep(body, plan, index, player, navigation);
  if (!next.ok) finishPlan(body, state, step, next.reply);
}

// A last step with its own end leaves the resident waiting where they are,
// seated if they sat down, until asked to go back to their routine.
function finishPlan(body, state, step, status = null) {
  state.plan = null;
  if (body.residentAction !== state || !status && !step.until && !step.seconds) return;
  state.kind = 'wait'; state.route = [];
  state.status = status ?? (state.sitProgress || body.pose === 'sit' ? 'Seated here' : 'Waiting here');
}

/** Advance a resident's accepted intention using ordinary game time, never an LLM call. */
export function stepResidentAction(body, dt, player, navigation) {
  const state = body.residentAction;
  if (!state || dt <= 0) return 0;
  body.speed = 0;
  if (body.talking) return 0;
  state.time = (state.time ?? 0) + dt;
  const moved = stepActivity(body, dt, player, navigation);
  if (state.plan) continuePlan(body, state, dt, player, navigation);
  return moved;
}

function stepActivity(body, dt, player, navigation) {
  const state = body.residentAction;
  if (!state.transition && state.kind === 'sit_down') {
    if (body.pose === 'sit') { state.status = 'Seated here'; return 0; }
    if (state.sitProgress === 0 && !roomToSitDown(body, body.yaw, player, navigation)) { state.status = 'Waiting for space to sit down'; return 0; }
    state.sitProgress = Math.min(1, state.sitProgress + dt / RESIDENT_SIT.duration);
    state.status = state.sitProgress === 1 ? 'Seated here' : 'Sitting down'; return 0;
  }
  if (state.sitProgress > 0) {
    if (state.kind === 'wait') { state.sitProgress = Math.min(1, state.sitProgress + dt / RESIDENT_SIT.duration); state.status = 'Seated here'; return 0; }
    state.sitProgress = Math.max(0, state.sitProgress - dt / RESIDENT_SIT.duration);
    state.status = 'Getting up'; return 0;
  }
  const following = state.kind === 'follow';
  const guiding = state.kind === 'guide';
  const traveling = guiding || state.kind === 'go_to';
  if (guiding) {
    const gap = distance(body, player);
    state.waitingForPlayer = navigation.onFoot === false || Math.abs(body.y - player.y) > 1.3 || gap > (state.waitingForPlayer ? 4 : 7);
    if (state.waitingForPlayer) { state.status = 'Waiting for you to catch up'; return 0; }
  }
  if (following) {
    // Stairs supply continuous footsteps, even while the follower is floors
    // behind. Only an explicitly recorded elevator trip bridges a height jump.
    const heightJump = Math.abs(state.followAt.y - player.y) > .6;
    if (navigation.onFoot === false || player.climb || player.vault || player.parachute || Math.abs(player.velocityY ?? 0) > .3 || distance(body, player) > 24 || heightJump && !trace(state.followAt, player, navigation) && !trace(body, player, navigation)) {
      state.status = 'Waiting for you to come back on foot';
      return state.transition ? stepSeat(body, dt, player, navigation) : 0;
    }
    state.followAt = point(player);
    if (breadcrumb(state.route, player)) {
      if (state.route.length >= TRAIL_LIMIT) { state.status = 'Waiting for you to come closer'; return 0; }
      state.route.push(point(player));
    }
    if (!state.transition && Math.abs(body.y - player.y) < .3 && distance(body, player) < FOLLOW_GAP && trace(body, player, navigation)) {
      state.status = 'Following you'; state.route = [point(player)]; state.routeIndex = 0; state.jog = false; return 0;
    }
  }
  if (state.transition) return stepSeat(body, dt, player, navigation);
  if (state.kind === 'get_up') { state.kind = 'wait'; state.stood = true; state.status = 'Standing here'; return 0; }
  if (state.kind === 'wait') return 0;
  if (state.kind === 'dance') { state.elapsed += dt; state.status = 'Dancing'; return 0; }
  if (traveling && reached(body, state.target, .35)) {
    state.kind = 'wait'; state.arrived = true; state.status = `Arrived at ${state.destination.name}`; state.route = []; return 0;
  }
  if (state.kind === 'resume_routine' && body.pose === 'sit') { body.residentAction = null; return 0; }
  if (state.kind === 'resume_routine' && distance(body, state.home) < .06 && Math.abs(body.y - state.home.y) < .1) {
    const home = trace(body, state.home, navigation);
    if (home) {
      Object.assign(body, home); body.yaw = state.home.yaw;
      if (state.seat) { state.transition = 'sit'; return stepSeat(body, dt, player, navigation); }
      body.residentAction = null; return 0;
    }
  }
  while (state.route.length && state.route[0].kind !== 'lift' && reached(body, state.route[0])) { state.route.shift(); state.routeIndex = 0; state.shortcutBlocked = false; }
  if (state.route[0]?.kind === 'lift') {
    const trip = state.route[0];
    if (!reached(body, trip.from, .08) || !navigation.liftValid?.(trip.from, trip.to)) { state.status = 'Waiting at the elevator'; return 0; }
    state.liftWait = (state.liftWait ?? 0) + dt;
    state.status = 'Taking the elevator';
    if (state.liftWait < .65) return 0;
    const arrival = navigation.sample(trip.to, trip.to, true);
    if (!arrival || Math.abs(arrival.y - trip.to.y) > .12 || Math.abs(player.y - arrival.y) < 1.3 && distance(player, arrival) < .85) {
      state.status = 'Waiting for space in the elevator'; return 0;
    }
    if (following) {
      if (state.trail.length + 3 > TRAIL_LIMIT) { state.status = 'Waiting here; too far from my routine'; return 0; }
      state.trail.push(point(body), { ...trip }, point(arrival));
    }
    Object.assign(body, arrival); state.route.shift(); state.routeIndex = 0; state.repath = 0; state.liftWait = 0;
    return 0;
  }
  // Shortcuts are checked against geometry; otherwise follow the recorded
  // footsteps round the corner. Replanning is bounded and runs four times/s.
  state.repath -= dt;
  if (!traveling && state.route.length && state.repath <= 0) {
    state.repath = .25;
    // Walking round people leaves a resident beside their footsteps rather
    // than on them: the ones they have drawn level with count as reached.
    while (state.route.length > 1 && !state.route[0].kind && !state.route[1].kind) {
      const [a, b] = state.route;
      if ((body.x - a.x) * (b.x - a.x) + (body.z - a.z) * (b.z - a.z) < 0 || Math.abs(body.y - a.y) > .3 || !trace(body, b, navigation.withoutPeople ?? navigation)) break;
      state.route.shift(); state.routeIndex = 0; state.shortcutBlocked = false;
    }
    if (!state.shortcutBlocked) {
      state.routeIndex = 0;
      const lift = state.route.findIndex(node => node.kind === 'lift');
      const end = Math.min(12, (lift < 0 ? state.route.length : lift) - 1);
      for (let i = end; i > 0; i--) if (trace(body, state.route[i], navigation.withoutPeople ?? navigation)) { state.routeIndex = i; break; }
    }
  }
  const routeIndex = state.routeIndex ?? 0;
  const target = state.route[routeIndex] ?? (following ? player : traveling ? state.target : state.home);
  const gap = following && routeIndex >= state.route.length - 1 && Math.abs(body.y - target.y) < .3 ? FOLLOW_GAP : 0;
  const remaining = Math.max(0, distance(body, target) - gap);
  if (!remaining) return 0;
  const pace = (following ? followSpeed(body, state, player) : 1.5) * dt, turn = (state.jog ? 3.4 : 2.6) * dt;
  const angle = heading(body, target, remaining, Math.min(remaining, pace), dt, state, player, navigation), error = angleDelta(body.yaw, angle);
  body.yaw += clamp(error, -turn, turn);
  const step = Math.min(remaining, pace * Math.max(0, Math.cos(error)));
  if (step < 1e-6) return 0;
  const before = point(body);
  const desired = { x: body.x - Math.sin(angle) * step, y: body.y, z: body.z - Math.cos(angle) * step };
  const next = trace(body, desired, navigation);
  if (!next || crowdsPlayer(body, next, player)) {
    // Keep the original footsteps until a shortcut is actually traversed.
    // A car or a grazing corner can invalidate it mid-step; people can move
    // on, so shortcuts are tried again while they stand in the way.
    if (routeIndex > 0 && !(navigation.withoutPeople && trace(body, desired, navigation.withoutPeople))) { state.routeIndex = 0; state.shortcutBlocked = true; }
    state.status = 'The way is blocked; waiting here'; return 0;
  }
  if (state.kind !== 'resume_routine') {
    // Record the actual safe route back, including turns. Never evict its
    // beginning: reaching the bound stops movement instead of losing home.
    if (breadcrumb(state.trail, before)) {
      const loop = loopBack(state.trail, before, navigation);
      if (loop >= 0) state.trail.length = loop + 1;
      else if (state.trail.length >= TRAIL_LIMIT) { state.status = 'Waiting here; too far from my routine'; return 0; }
      else state.trail.push(before);
    }
  }
  Object.assign(body, next); body.speed = distance(before, body) / dt;
  if (state.route.length && reached(body, target)) { state.route.splice(0, routeIndex + 1); state.routeIndex = 0; state.shortcutBlocked = false; state.repath = 0; }
  state.status = following ? 'Following you' : traveling ? `${guiding ? 'Guiding you to' : 'Going to'} ${state.destination.name}` : 'Returning to my routine';
  return distance(before, body);
}
