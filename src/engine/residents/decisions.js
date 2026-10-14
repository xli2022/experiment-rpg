import { RESIDENT_BEHAVIORS } from '../../core/resident-behaviors.js';

// Separate intent from personality: this short decision chooses an activity,
// and ordinary dialogue gets its own prompt. The game binds the resident.
export const RESIDENT_ACTIONS = Object.freeze(['none', ...RESIDENT_BEHAVIORS]);
export const DECISION_FORMAT = Object.freeze({ type: 'json_object', schema: JSON.stringify({
  type: 'object', properties: { action: { type: 'string', enum: RESIDENT_ACTIONS }, destination: { type: 'string', maxLength: 160 } },
  required: ['action', 'destination'], additionalProperties: false,
}) });

export function decisionFormat(context = {}) {
  if (!context.destinations?.length) return DECISION_FORMAT;
  const schema = JSON.parse(DECISION_FORMAT.schema);
  schema.properties.destination = { type: 'string', enum: ['', ...context.destinations.map(place => place.id)] };
  return { ...DECISION_FORMAT, schema: JSON.stringify(schema) };
}

export function decisionMessages(line, context) {
  return [{ role: 'system', content: [
    'Classify the latest player message to a resident in a game. Return ONLY JSON with BOTH fields: {"action":"...","destination":"..."}. Do not roleplay or write dialogue.',
    'Select the requested activity: follow = accompany the player; wait = stop and stay here; move_aside = get out of the way; dance = keep dancing; guide = lead the player to a nearby destination; go_to = go to a destination alone and wait there; lie_down = lie down and rest here; get_up = stand up from lying or sitting; resume_routine = return to normal activity; none = no supported request.',
    'Polite questions such as "could you walk with me?" ARE requests. Choose follow. "Come with me" and "keep me company while I walk" also mean follow.',
    '"Dance", "can you dance for me?", and "show me your moves" mean dance.',
    '"Lie down", "lay down", "lie on the ground", and "stretch out here" mean lie_down. "Get up", "stand up", "on your feet", and "stop lying down" mean get_up. "Do not lie down" means wait; "do not get up" and "stay lying down" mean wait and preserve the current posture.',
    '"Guide me to a shop", "show me the way to the station", and "take me to the elevator" mean guide. "Go to the shop", "head to the station", and "meet me at the elevator" mean go_to: the resident goes alone. Only guide waits for the player to follow.',
    'For guide and go_to, "destination" is the matching ID from destinations below. Match the place name or type; choose the nearest matching place. If none matches or no place is specified, use "destination":"". For EVERY other action also use "destination":"". Always include both fields. Never invent a destination or coordinates.',
    '"Wait here", "stay put", "stop following me", "do not follow me", "stop dancing", "stop guiding me", and "do not dance" mean wait. A request to stop an activity must never start it.',
    '"Can I get past?", "make room", and "please step aside" mean move_aside.',
    '"Carry on with what you were doing", "back to work", and "go back to your routine" mean resume_routine.',
    'Choose none for greetings, small talk, quoted commands, stories, hypothetical questions, or questions ABOUT an action. "What happens if I say follow me?", "What happens if I say lay down?", "Tell me a story about dancing", and "What is your favorite dance?" mean none. These discuss actions without asking you to perform them.',
    'Waving, cheering, coming here, and facing the player are unsupported: "wave at me", "cheer for me", "come here", and "face me" mean none. Never substitute another activity for an unsupported request.',
    'Only classify the player\'s latest request to THIS resident. Do not repeat any earlier command. Never invent another action or arguments. The game checks whether the request is possible.',
    `Current resident state: ${JSON.stringify(context)}.`,
  ].join('\n') }, { role: 'user', content: line }];
}

// Bound the two cases the small model tends to substitute: explicitly removed
// commands, and a trip without a destination. Match the whole request so quotes,
// discussion and compound instructions still go through intent classification.
export function preliminaryDecision(line) {
  const phrase = String(line).trim().toLowerCase().replace(/[.!?]+$/, '').trim()
    .replace(/^(?:(?:can|could|would|will) you(?: please)?|please)\s+/, '').replace(/,?\s+please$/, '');
  if (/^(?:come (?:over )?here|face me|wave(?: at me)?|cheer(?: for me)?)$/.test(phrase)) return { action: 'none' };
  if (/^(?:guide me(?: somewhere| someplace)?|take me somewhere|show me the way)$/.test(phrase)) return { action: 'guide', destination: '' };
  if (/^(?:go to a place|go somewhere|head somewhere)$/.test(phrase)) return { action: 'go_to', destination: '' };
  return null;
}

export function parseDecision(raw) {
  try {
    // Qwen's non-thinking template still emits this empty wrapper. Incomplete
    // thoughts, arbitrary prose, extra fields and extra JSON remain invalid.
    const value = JSON.parse(String(raw).replace(/^\s*<think>\s*<\/think>\s*/, ''));
    if (!value || Array.isArray(value) || !RESIDENT_ACTIONS.includes(value.action)) return null;
    if (value.action === 'guide' || value.action === 'go_to') {
      if (Object.keys(value).length !== 2 || typeof value.destination !== 'string' || value.destination.length > 160) return null;
      return { action: value.action, destination: value.destination };
    }
    if (Object.keys(value).some(key => key !== 'action' && (key !== 'destination' || value.destination !== ''))) return null;
    return { action: value.action };
  } catch { return null; }
}
