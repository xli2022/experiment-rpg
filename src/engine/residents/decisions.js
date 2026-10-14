import { RESIDENT_BEHAVIORS, RESIDENT_PLAN_STEPS, RESIDENT_STEP_ENDS, RESIDENT_STEP_SECONDS } from '../../core/resident-behaviors.js';

// Separate intent from personality: this short decision chooses what to do,
// and ordinary dialogue gets its own prompt. The game binds the resident.
// A decision is a plan of one or more steps, run in order and optionally
// repeated; the model only fills in fixed choices, never free text.
export const RESIDENT_ACTIONS = Object.freeze(['none', ...RESIDENT_BEHAVIORS]);
// Actions that take a place; follow takes one only to stop on reaching it.
const PLACE_ACTIONS = ['guide', 'go_to'];
const STEP_KEYS = ['action', 'destination', 'until', 'seconds'];

// Only the action is required: a step names a place, an end or a duration
// only when the player asked for one, which keeps a plain request as short
// to write, and as quick to decide, as a single action.
function planSchema(destination, parts = 0) {
  const step = { type: 'object', properties: {
    action: { type: 'string', enum: RESIDENT_ACTIONS }, destination,
    until: { type: 'string', enum: RESIDENT_STEP_ENDS.filter(Boolean) }, seconds: { type: 'integer', enum: RESIDENT_STEP_SECONDS.filter(Boolean) },
  }, required: ['action'], additionalProperties: false };
  return JSON.stringify({ type: 'object', properties: {
    steps: { type: 'array', items: step, minItems: parts || 1, maxItems: parts || RESIDENT_PLAN_STEPS }, repeat: { type: 'boolean' },
  }, required: ['steps'], additionalProperties: false });
}
export const DECISION_FORMAT = Object.freeze({ type: 'json_object', schema: planSchema({ type: 'string', maxLength: 160 }) });

/** The decision schema: nearby place IDs only, and exactly one step per part of a message with several. */
export function decisionFormat(context = {}, request = null) {
  const parts = request?.parts.length > 1 ? request.parts.length : 0;
  if (!context.destinations?.length && !parts) return DECISION_FORMAT;
  const destination = context.destinations?.length ? { type: 'string', enum: ['', ...context.destinations.map(place => place.id)] } : { type: 'string', maxLength: 160 };
  return { ...DECISION_FORMAT, schema: planSchema(destination, parts) };
}

const example = (line, steps, repeat = false) => `"${line}" -> ${JSON.stringify({ steps, ...(repeat ? { repeat } : {}) })}`;

export function decisionMessages(line, context, request = null) {
  const parts = request?.parts.length > 1 ? request.parts : null;
  return [{ role: 'system', content: [
    'Classify the latest player message to a resident in a game. Return ONLY JSON: {"steps":[{"action":"..."}]}. Do not roleplay or write dialogue.',
    'Actions: follow = walk with the player; wait = stop and stay here; dance = dance; guide = lead the player to a destination, the player comes too; go_to = go to a destination alone; sit_down = sit down here; get_up = stand up; resume_routine = go back to normal activity; none = no request.',
    `One step for each activity the player asks for, in the order asked, at most ${RESIDENT_PLAN_STEPS}. Most messages ask for one. Never add a step the player did not ask for.`,
    'Add "destination" only for guide, go_to, or follow "until we reach" a place: the matching ID from destinations below, by place name or type, or "" if none matches. Never invent one.',
    'Add "until" only when the player says until: "player_returns" = until I come back; "player_leaves" = until I leave; "player_stops" = until I stop; "place" = until we reach the destination.',
    'Add "seconds" only for a duration: 30 for "for 30 seconds", 60 for "for a minute", 120 for "two minutes". Add "repeat":true only for "back and forth", "keep doing that", "again and again" or "patrol".',
    'Polite questions are requests: "could you walk with me?" and "come with me" mean follow. "Take a seat" and "sit on the ground" mean sit_down. "Stand up" and "on your feet" mean get_up. "Guide me to", "show me the way to" and "take me to" a place mean guide; "go to", "head to" and "meet me at" a place mean go_to.',
    '"Stop following me", "don\'t dance", "do not sit down", "stay seated" and "stay put" mean wait. "Stop sitting" means get_up. "Carry on" and "back to work" mean resume_routine.',
    'Greetings, small talk, stories, and questions about an action are none: "tell me a story about dancing" and "what happens if I say follow me?" mean none.',
    'Examples, where <station> and <bar> stand for the matching destination IDs:',
    example('Follow me.', [{ action: 'follow' }]),
    example('Take me to the bar.', [{ action: 'guide', destination: '<bar>' }]),
    example('Meet me at the station.', [{ action: 'go_to', destination: '<station>' }]),
    example('Dance for 30 seconds, then sit down.', [{ action: 'dance', seconds: 30 }, { action: 'sit_down' }]),
    example('Wait here until I come back.', [{ action: 'wait', until: 'player_returns' }]),
    example('Go to the station, then wait there until I come back.', [{ action: 'go_to', destination: '<station>' }, { action: 'wait', until: 'player_returns' }]),
    example('Follow me until we reach the bar.', [{ action: 'follow', destination: '<bar>', until: 'place' }]),
    example('Walk back and forth between the station and the bar.', [{ action: 'go_to', destination: '<station>' }, { action: 'go_to', destination: '<bar>' }], true),
    example('Tell me about your day.', [{ action: 'none' }]),
    ...(parts ? [`This message has ${parts.length} parts. Write exactly one step for each part, in order: ${parts.map((part, i) => `${i + 1}) "${part.text}"`).join('; ')}.`] : []),
    `Current resident state: ${JSON.stringify(context)}.`,
  ].join('\n') }, { role: 'user', content: line }];
}

/** A one-line description of a plan, such as "go_to, wait, resume_routine". */
export function planSummary(plan) {
  return plan ? `${plan.steps.map(s => s.action).join(', ')}${plan.repeat ? ' (repeating)' : ''}` : null;
}

// The game reads a message's control flow itself: its parts in order, and
// any duration, condition or repeat they name. These are fixed phrases that
// a small model often drops; it only names each part's activity and place.
// When every part is an exact command, such as "dance for 30 seconds, then
// sit down", no model call is needed at all.
const SHORTCUTS = [
  ['follow', /^(?:follow me|come with me|walk with me|come along)$/],
  ['wait', /^(?:wait|wait (?:here|there|for me)|stay|stay (?:here|there|put|seated)|stop following me|(?:do not|don't) (?:follow me|dance|sit down|get up)|stop dancing)$/],
  ['dance', /^(?:dance|dance (?:here|there|for me)|show me your moves)$/],
  ['sit_down', /^(?:sit|sit (?:down|here|there)|sit down (?:here|there)|take a seat|have a seat|sit on the ground)$/],
  ['get_up', /^(?:get up|stand up|on your feet|stop sitting(?: down)?|get off the ground)$/],
  ['resume_routine', /^(?:carry on|back to work|as you were|go back to (?:your routine|what you were doing)|carry on with (?:your day|what you were doing))$/],
  // A trip that names no place gets asked which place.
  ['guide', /^(?:guide me(?: somewhere| someplace)?|take me somewhere|show me the way)$/],
  ['go_to', /^(?:go to a place|go somewhere|head somewhere)$/],
];
// "then" and "after that" always start a new part; "and" or a comma only
// before another activity, so "back and forth" or "the station and the bar"
// stay whole.
const SEQUENCE = /\s*,?\s*\b(?:and\s+)?then\b\s*|\s*,?\s*\bafter that\b,?\s*|(?:\s*,\s*(?:and\s+)?|\s+and\s+)(?=(?:wait|dance|follow|go|head|sit|stand|get|guide|take|show|meet|walk|stay|carry)\b)/i;
const DURATION = /\s*\bfor (\d+|a|an|one|two|three|five|ten|thirty) (second|minute)s?\b/;
const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, thirty: 30 };
const ENDS = [
  ['player_returns', /\b(?:until|till) i(?:'m| am)? (?:come back|get back|return|back)\b/],
  ['player_leaves', /\b(?:until|till) i (?:leave|go|walk away)\b/],
  ['player_stops', /\b(?:until|till) i stop\b/],
  ['place', /\b(?:until|till) we (?:reach|get to|arrive at)\b/],
];
const REPEAT = /\s*\b(?:back and forth|again and again|over and over|keep (?:doing that|going back and forth)|patrol(?:ling)?)\b/;
const durations = RESIDENT_STEP_SECONDS.filter(Boolean);

// The message without its closing punctuation or polite wording, in its own
// letters: the model matches place names as written.
const phrase = line => String(line).trim().replace(/’/g, "'").replace(/[.!?]+$/, '').trim()
  .replace(/^(?:(?:can|could|would|will) you(?: please)?|please)\s+/i, '').replace(/,?\s+please$/i, '');
// A part without its duration, condition or repeat, to match an exact command.
const bare = part => part.replace(DURATION, '').replace(/\s*\b(?:until|till)\b.*$/, '').replace(REPEAT, '').replace(/[\s,;]+$/, '').trim();

/** The game's own reading of a message: its parts, each with the exact command, end and duration it names, and whether it repeats. */
export function readRequest(line) {
  const text = phrase(line);
  let parts = text.split(SEQUENCE).map(part => part.replace(/^[\s,;]+|[\s,;]+$/g, '')).filter(Boolean);
  if (!parts.length || parts.length > RESIDENT_PLAN_STEPS) parts = [text];
  return { repeat: REPEAT.test(text.toLowerCase()), parts: parts.map(text => {
    const part = text.toLowerCase(), time = part.match(DURATION), seconds = time ? Number(NUMBERS[time[1]] ?? time[1]) * (time[2] === 'minute' ? 60 : 1) : 0;
    return { text, action: SHORTCUTS.find(([, pattern]) => pattern.test(bare(part)))?.[0] ?? null,
      until: ENDS.find(([, pattern]) => pattern.test(part))?.[0] ?? '',
      seconds: seconds && durations.reduce((best, value) => Math.abs(value - seconds) < Math.abs(best - seconds) ? value : best) };
  }) };
}

// Finish a plan with the request's own reading: each part's command, end and
// duration when the steps line up with the parts, and the repeat. The same
// step twice in a row is one step, and a repeated pattern is one pass.
function completePlan(steps, request) {
  if (!request) return steps;
  const aligned = steps.length === request.parts.length;
  let read = steps.map((step, i) => {
    const part = aligned ? request.parts[i] : null, action = part?.action ?? step.action;
    const until = part ? part.until : step.until === 'place' ? 'place' : '';
    return { action, destination: step.destination ?? '', until, seconds: part?.seconds ?? 0 };
  });
  read = read.filter((step, i) => !(i + 1 < read.length && read[i + 1].action === step.action && read[i + 1].destination === step.destination && !step.until && !step.seconds));
  if (request.repeat) for (let period = 1; period < read.length; period++) {
    if (read.length % period === 0 && read.every((step, i) => JSON.stringify(step) === JSON.stringify(read[i % period]))) { read = read.slice(0, period); break; }
  }
  return read;
}

export function preliminaryDecision(line, request = readRequest(line)) {
  if (!request.parts.every(part => part.action && part.until !== 'place')) return null;
  return readPlan({ steps: completePlan(request.parts.map(part => ({ action: part.action, destination: '' })), request), repeat: request.repeat });
}

// A decision as a plan with `none` steps dropped. A plan without steps means
// no request. A single legacy `{action, destination}` reads as one step.
function readPlan(value, request = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!('steps' in value)) {
    if (Object.keys(value).some(key => key !== 'action' && key !== 'destination')) return null;
    return readPlan({ steps: [value], repeat: false }, request);
  }
  let { steps, repeat = false } = value;
  if (Object.keys(value).some(key => key !== 'steps' && key !== 'repeat') || typeof repeat !== 'boolean') return null;
  if (!Array.isArray(steps) || !steps.length || steps.length > RESIDENT_PLAN_STEPS) return null;
  for (const raw of steps) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !STEP_KEYS.includes(key))) return null;
    const { action, destination = '', until = '', seconds = 0 } = raw;
    if (!RESIDENT_ACTIONS.includes(action) || typeof destination !== 'string' || destination.length > 160) return null;
    if (!RESIDENT_STEP_ENDS.includes(until) || !RESIDENT_STEP_SECONDS.includes(seconds)) return null;
    if (PLACE_ACTIONS.includes(action) && !('destination' in raw)) return null;
  }
  if (request) { steps = completePlan(steps, request); repeat = request.repeat; }
  const read = [];
  for (const { action, destination = '', until = '', seconds = 0 } of steps) {
    if (action === 'none') continue;
    // A small model may name a place for an action that does not use one;
    // only trips and following "until we reach" keep it.
    const place = PLACE_ACTIONS.includes(action) || action === 'follow' && until === 'place';
    read.push({ action, ...(place ? { destination } : {}), ...(until && (until !== 'place' || action === 'follow') ? { until } : {}), ...(seconds ? { seconds } : {}) });
  }
  return { steps: read, repeat: read.length ? repeat : false };
}

/** A model decision as a plan, completed with the request's own reading when given. */
export function parseDecision(raw, request = null) {
  try {
    // Qwen's non-thinking template still emits this empty wrapper. Incomplete
    // thoughts, arbitrary prose, extra fields and extra JSON remain invalid.
    return readPlan(JSON.parse(String(raw).replace(/^\s*<think>\s*<\/think>\s*/, '')), request);
  } catch { return null; }
}
