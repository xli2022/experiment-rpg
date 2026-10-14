// Separate intent from personality: this short decision chooses movement,
// and ordinary dialogue gets its own prompt. The game binds the resident.
export const RESIDENT_ACTIONS = Object.freeze(['none', 'follow', 'wait', 'move_aside', 'resume_routine']);
export const DECISION_FORMAT = Object.freeze({ type: 'json_object', schema: JSON.stringify({
  type: 'object', properties: { action: { type: 'string', enum: RESIDENT_ACTIONS } },
  required: ['action'], additionalProperties: false,
}) });

export function decisionMessages(line, context) {
  return [{ role: 'system', content: [
    'Classify the latest player message to a resident in a game. Return ONLY JSON: {"action":"..."}. Do not roleplay or write dialogue.',
    'Select the requested movement: follow = accompany the player; wait = stop and stay here; move_aside = get out of the way; resume_routine = return to normal activity; none = no supported movement request.',
    'Polite questions such as "could you walk with me?" ARE requests. Choose follow. "Come with me" and "keep me company while I walk" also mean follow.',
    '"Wait here", "stay put", "stop following me", and "do not follow me" mean wait.',
    '"Can I get past?", "make room", and "please step aside" mean move_aside.',
    '"Carry on with what you were doing", "back to work", and "go back to your routine" mean resume_routine.',
    'Choose none for greetings, small talk, unsupported actions, quoted commands, stories, hypothetical questions, or questions ABOUT an action. "What happens if I say follow me?" means none. "Tell me a story about someone saying wait here" means none.',
    'Only classify the player\'s latest request to THIS resident. Do not repeat any earlier command. Never invent another action or arguments. The game checks whether the request is possible.',
    `Current resident state: ${JSON.stringify(context)}.`,
  ].join('\n') }, { role: 'user', content: line }];
}

export function parseDecision(raw) {
  try {
    // Qwen's non-thinking template still emits this empty wrapper. Incomplete
    // thoughts, arbitrary prose, extra fields and extra JSON remain invalid.
    const value = JSON.parse(String(raw).replace(/^\s*<think>\s*<\/think>\s*/, ''));
    if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || !RESIDENT_ACTIONS.includes(value.action)) return null;
    return { action: value.action };
  } catch { return null; }
}
