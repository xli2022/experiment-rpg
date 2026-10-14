import { RESIDENT_BEHAVIORS, RESIDENT_PLAN_STEPS, RESIDENT_STEP_ENDS, RESIDENT_STEP_SECONDS } from '../core/resident-behaviors.js';

// A resident's request is a plan: steps run in order, optionally repeated.
// These helpers read, complete and describe one; resident-actions runs it.
export const PLACE_ACTIONS = Object.freeze(['guide', 'go_to']);
// Steps with no end of their own get one when another step follows them,
// or when the plan repeats: wait until the player comes back, follow until
// they stop, dance for 30 s.
const OPEN_ENDED = { wait: { until: 'player_returns' }, follow: { until: 'player_stops' }, dance: { seconds: 30 } };

/** A request as a plan: an action name, `{ action, destination }`, or `{ steps, repeat }`; null if invalid. */
export function residentPlan(request) {
  const raw = typeof request === 'string' ? { steps: [{ action: request }] } : Array.isArray(request?.steps) ? request : request?.action ? { steps: [request] } : null;
  if (!raw?.steps.length || raw.steps.length > RESIDENT_PLAN_STEPS) return null;
  const repeat = raw.repeat === true, steps = [];
  for (const [i, s] of raw.steps.entries()) {
    const step = { action: s?.action, destination: s?.destination ?? '', until: s?.until ?? '', seconds: s?.seconds ?? 0 };
    if (!RESIDENT_BEHAVIORS.includes(step.action) || !RESIDENT_STEP_ENDS.includes(step.until) || !RESIDENT_STEP_SECONDS.includes(step.seconds)) return null;
    // Only following can last "until we reach" a place.
    if (step.until === 'place' && step.action !== 'follow') step.until = '';
    if ((repeat || i < raw.steps.length - 1) && !step.until && !step.seconds) Object.assign(step, OPEN_ENDED[step.action]);
    steps.push(step);
  }
  return { steps, repeat };
}

/**
 * Bind each step that needs a place to one of `places`, nearby now, so later
 * steps can still find it from wherever the resident has got to. Returns the
 * plan, or a reply asking which place.
 */
export function placePlan(plan, places) {
  for (const step of plan.steps) {
    if (!PLACE_ACTIONS.includes(step.action) && step.until !== 'place') continue;
    const place = places.find(p => p.id === step.destination);
    if (!place) return { reply: places.length ? `I can try to show you ${places.slice(0, 3).map(p => p.name).join(', ')}. Which one?` : 'I do not know a nearby place I can guide you to from here.' };
    step.place = { id: place.id, name: place.name, type: place.type, x: place.x, y: place.y, z: place.z };
  }
  return { plan };
}

/** Whether a plan needs describing, rather than its single step's usual reply. */
export const compositePlan = plan => plan.repeat || plan.steps.length > 1 || plan.steps.some(step => step.until || step.seconds);

const lasting = seconds => seconds < 60 ? `${seconds} seconds` : seconds === 60 ? 'a minute' : `${seconds / 60} minutes`;
const UNTIL = { player_returns: 'until you come back', player_leaves: 'until you leave', player_stops: 'until you stop' };
function phrase(step, previous) {
  const doing = { follow: 'follow you', wait: PLACE_ACTIONS.includes(previous?.action) ? 'wait there' : 'wait here', dance: 'dance',
    guide: `take you to ${step.place?.name}`, go_to: `go to ${step.place?.name}`, sit_down: 'sit down', get_up: 'get up',
    resume_routine: 'get back to what I was doing' }[step.action];
  const until = step.until === 'place' ? `until we reach ${step.place?.name}` : UNTIL[step.until];
  return [doing, step.seconds && `for ${lasting(step.seconds)}`, step.seconds && until && 'or', until].filter(Boolean).join(' ');
}

/** The spoken acknowledgement for a plan, step by step. */
export function describePlan(plan) {
  const parts = plan.steps.map((step, i) => phrase(step, plan.steps[i - 1]));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, then ${parts.at(-1)}` : parts[0];
  return `Sure. I will ${list}${plan.repeat ? ', and keep doing that until you ask me to stop' : ''}.`;
}
