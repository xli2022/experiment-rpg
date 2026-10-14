import { traceResidentPath as trace } from './resident-path.js';
import { angleDelta, clamp } from '../core/physics.js';
import { RESIDENT_BEHAVIORS, RESIDENT_REST } from '../core/resident-behaviors.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = p => ({ x: p.x, y: p.y, z: p.z });
const reached = (a, b, radius = .03) => distance(a, b) < radius && Math.abs(a.y - b.y) < .12;
const STANDING_ACTIONS = ['follow', 'move_aside', 'dance', 'guide', 'go_to', 'lie_down', 'get_up'];
const FOLLOW_GAP = 1.65, TRAIL_LIMIT = 2048;

const reverseRoute = trail => [...trail].reverse().map(node => node.kind === 'lift' ? { ...node, from: point(node.to), to: point(node.from) } : point(node));
function breadcrumb(trail, next) {
  const last = trail.at(-1), previous = trail.at(-2);
  if (!last || last.kind === 'lift') return true;
  const turn = previous && previous.kind !== 'lift' && Math.abs(angleDelta(Math.atan2(last.x - previous.x, last.z - previous.z), Math.atan2(next.x - last.x, next.z - last.z))) > .15;
  return distance(last, next) > .18 || Math.abs(last.y - next.y) > .1 || turn && distance(last, next) > .04;
}

export function residentActionContext(body, navigation) {
  return { behavior: body.residentAction?.kind ?? 'routine', status: body.residentAction?.status ?? 'Going about my day',
    posture: body.residentAction?.recline > 0 ? 'lying down' : body.pose === 'sit' ? 'seated' : 'standing',
    canWalk: navigation.mobile !== false, area: navigation.area,
    destinations: (navigation.destinations?.() ?? []).map(({ id, name, type, distance }) => ({ id, name, type, distance })) };
}

function roomToLieDown(start, yaw, player, navigation) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // Overlapping standing-radius samples cover the full resting footprint;
  // equal support at each point rules out steps and ledges beneath the body.
  for (const across of [-.4, 0, .4]) for (let along = -1; along <= 1.01; along += .25) {
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

export function requestResidentAction(body, request, player, navigation) {
  const action = typeof request === 'string' ? request : request?.action;
  const denied = reply => ({ ok: false, reply });
  if (!RESIDENT_BEHAVIORS.includes(action)) return denied('I cannot do that.');
  // A conversation can finish as the player walks away (at 4.5 m).
  if (!player || distance(body, player) > 6 || Math.abs(body.y - player.y) > 1.3) return denied('Come a little closer first.');
  if (navigation.mobile === false && STANDING_ACTIONS.includes(action)) return denied('I need to stay seated here for now.');
  if (navigation.crossing && !body.residentAction) return denied('Let me finish crossing the street first.');
  const gettingUp = body.pose === 'sit' && STANDING_ACTIONS.includes(action);
  const seat = gettingUp ? navigation.seatExit?.() : null;
  if (gettingUp && !seat) return denied('I need a little room to stand up first.');
  const start = seat?.path.at(-1) ?? body;
  if (action === 'lie_down' && !roomToLieDown(start, body.yaw, player, navigation)) return denied('I need a clear, level space to lie down.');
  let destination = null;
  let guide = null;
  if (action === 'guide' || action === 'go_to') {
    const places = navigation.destinations?.() ?? [];
    if (!places.some(place => place.id === request.destination)) {
      return denied(places.length ? `I can try to show you ${places.slice(0, 3).map(p => p.name).join(', ')}. Which one?` : 'I do not know a nearby place I can guide you to from here.');
    }
    guide = navigation.guide?.(start, request.destination);
    if (!guide?.route?.length) return denied('I cannot find a clear walking route there from here.');
    destination = point(guide.route.at(-1));
  }
  if (action === 'move_aside') {
    // Prefer a step perpendicular to the player's facing, away from their
    // walking line. Try both sides and diagonals, never through an obstacle.
    const right = { x: Math.cos(player.yaw), z: -Math.sin(player.yaw) };
    const preferred = (body.x - player.x) * right.x + (body.z - player.z) * right.z >= 0 ? 1 : -1;
    for (const length of [1.4, 1, .75]) for (const side of [preferred, -preferred]) for (const back of [0, .55, -.55]) {
      if (destination) break;
      const candidate = { x: start.x + right.x * side * length - Math.sin(player.yaw) * back,
        y: start.y, z: start.z + right.z * side * length - Math.cos(player.yaw) * back };
      if (distance(candidate, player) > 1 && trace(start, candidate, navigation)) destination = candidate;
    }
    if (!destination) return denied('There is no room for me to step aside here.');
  }
  const prior = body.residentAction;
  if (action === 'resume_routine' && !prior) return { ok: true, reply: 'All right. I will carry on.', status: 'Going about my day' };
  const state = body.residentAction = {
    kind: action, home: seat ? { ...point(start), yaw: body.yaw } : prior?.home ?? { ...point(body), yaw: body.yaw },
    // When interrupted on the way home, retain only the untraversed return
    // route. Reusing the old outbound endpoint could cross a wall or floor.
    trail: seat ? [point(start)] : prior?.kind === 'resume_routine' ? reverseRoute(prior.route) : prior?.trail ?? [point(body)],
    route: guide?.route.map(point) ?? [], target: destination, repath: 0, status: '', followAt: point(player), elapsed: 0,
    destination: guide ? { id: guide.destination.id, name: guide.destination.name } : null,
    seat: seat ?? prior?.seat ?? null,
    transition: seat ? 'rise' : prior?.transition ?? null,
    recline: prior?.recline ?? 0,
  };
  if (state.transition === 'sit' && action !== 'resume_routine') state.transition = 'rise';
  if (body.pose === 'sit' && action === 'wait') state.transition = null;
  if (action === 'follow') state.route = [point(player)];
  if (action === 'resume_routine') state.route = reverseRoute(state.trail);
  body.speed = 0;
  const replies = {
    follow: 'Sure. I will follow you.',
    wait: 'All right. I will wait here.', move_aside: 'Of course. I will step aside.',
    dance: 'Sure. I will dance until you ask me to stop.',
    lie_down: 'All right. I will lie down here.', get_up: 'All right. I will stand here.',
    guide: guide && `Follow me to ${guide.destination.name}. I will wait if you fall behind.`,
    go_to: guide && `Sure. I will go to ${guide.destination.name} and wait there.`,
    resume_routine: 'All right. I will get back to what I was doing.',
  };
  state.status = { follow: 'Following you', wait: 'Waiting here', move_aside: 'Moving aside',
    dance: 'Dancing', lie_down: 'Lying down', get_up: 'Getting up', guide: guide && `Guiding you to ${guide.destination.name}`, go_to: guide && `Going to ${guide.destination.name}`, resume_routine: 'Returning to my routine' }[action];
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

/** Record a real player elevator trip; model decisions never supply trip coordinates. */
export function queueResidentLift(body, from, to, navigation) {
  const state = body.residentAction;
  if (state?.kind !== 'follow' || distance(body, from) > 24 || Math.abs(state.followAt.y - from.y) > .6 || !navigation.liftValid?.(from, to)) return false;
  if (state.route.length + 3 > TRAIL_LIMIT) return false;
  state.route.push(point(from), { kind: 'lift', from: point(from), to: point(to) }, point(to));
  state.followAt = point(to); state.repath = 0;
  return true;
}

/** Advance a resident's accepted intention using ordinary game time, never an LLM call. */
export function stepResidentAction(body, dt, player, navigation) {
  const state = body.residentAction;
  if (!state || dt <= 0) return 0;
  body.speed = 0;
  if (body.talking) return 0;
  if (!state.transition && state.kind === 'lie_down') {
    if (state.recline === 0 && !roomToLieDown(body, body.yaw, player, navigation)) { state.status = 'Waiting for space to lie down'; return 0; }
    state.recline = Math.min(1, state.recline + dt / RESIDENT_REST.duration);
    state.status = state.recline === 1 ? 'Resting here' : 'Lying down'; return 0;
  }
  if (state.recline > 0) {
    if (state.kind === 'wait') { state.recline = Math.min(1, state.recline + dt / RESIDENT_REST.duration); state.status = 'Resting here'; return 0; }
    state.recline = Math.max(0, state.recline - dt / RESIDENT_REST.duration);
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
      state.status = 'Following you'; state.route = [point(player)]; state.routeIndex = 0; return 0;
    }
  }
  if (state.transition) return stepSeat(body, dt, player, navigation);
  if (state.kind === 'get_up') { state.kind = 'wait'; state.status = 'Standing here'; return 0; }
  if (state.kind === 'wait') return 0;
  if (state.kind === 'dance') { state.elapsed += dt; state.status = 'Dancing'; return 0; }
  if (traveling && reached(body, state.target, .35)) {
    state.kind = 'wait'; state.status = `Arrived at ${state.destination.name}`; state.route = []; return 0;
  }
  if (state.kind === 'resume_routine' && body.pose === 'sit') { body.residentAction = null; return 0; }
  if (state.kind === 'move_aside' && distance(body, state.target) < .06) {
    state.kind = 'wait'; state.status = 'Waiting out of your way'; return 0;
  }
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
  if (!traveling && state.route.length && state.repath <= 0 && !state.shortcutBlocked) {
    state.repath = .25;
    state.routeIndex = 0;
    const lift = state.route.findIndex(node => node.kind === 'lift');
    const end = Math.min(12, (lift < 0 ? state.route.length : lift) - 1);
    for (let i = end; i > 0; i--) if (trace(body, state.route[i], navigation)) { state.routeIndex = i; break; }
  }
  const routeIndex = state.routeIndex ?? 0;
  const target = state.kind === 'move_aside' ? state.target : state.route[routeIndex] ?? (following ? player : traveling ? state.target : state.home);
  const gap = following && routeIndex >= state.route.length - 1 && Math.abs(body.y - target.y) < .3 ? FOLLOW_GAP : 0;
  const remaining = Math.max(0, distance(body, target) - gap);
  if (!remaining) return 0;
  const angle = Math.atan2(-(target.x - body.x), -(target.z - body.z)), error = angleDelta(body.yaw, angle);
  body.yaw += clamp(error, -2.6 * dt, 2.6 * dt);
  const step = Math.min(remaining, (following ? 2.6 : 1.5) * dt * Math.max(0, Math.cos(error)));
  if (step < 1e-6) return 0;
  const before = point(body), ratio = step / distance(body, target);
  const desired = { x: body.x + (target.x - body.x) * ratio, y: body.y, z: body.z + (target.z - body.z) * ratio };
  const next = trace(body, desired, navigation);
  if (!next || Math.abs(body.y - player.y) < 1.3 && distance(next, player) < .8 && distance(next, player) < distance(body, player)) {
    // Keep the original footsteps until a shortcut is actually traversed.
    // A moving obstacle or a grazing corner can invalidate it mid-step.
    if (routeIndex > 0) { state.routeIndex = 0; state.shortcutBlocked = true; }
    state.status = 'The way is blocked; waiting here'; return 0;
  }
  if (state.kind !== 'resume_routine') {
    // Record the actual safe route back, including turns. Never evict its
    // beginning: reaching the bound stops movement instead of losing home.
    if (breadcrumb(state.trail, before)) {
      if (state.trail.length >= TRAIL_LIMIT) { state.status = 'Waiting here; too far from my routine'; return 0; }
      state.trail.push(before);
    }
  }
  Object.assign(body, next); body.speed = distance(before, body) / dt;
  if (state.route.length && reached(body, target)) { state.route.splice(0, routeIndex + 1); state.routeIndex = 0; state.shortcutBlocked = false; state.repath = 0; }
  state.status = following ? 'Following you' : traveling ? `${guiding ? 'Guiding you to' : 'Going to'} ${state.destination.name}` : state.kind === 'move_aside' ? 'Moving aside' : 'Returning to my routine';
  return distance(before, body);
}
