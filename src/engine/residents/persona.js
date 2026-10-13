import { CROWD_PROFILES } from '../../actors/npc-profiles.js';
import { VISITOR_PROFILES } from '../../actors/npc-visitors.js';
import { BUILDING_SIGN_CATALOG } from '../../world/building-signs.js';
import { hash } from '../../world/building-design.js';
import { gameClock } from '../clock.js';

// Who a background resident is, written for a small language model: a name,
// job, mood and worry seeded from the person's own ID, so the same person is
// the same person every time, plus where they are and what they are doing
// right now. Story contacts never come here; they keep their written lines.

const NAMES = {
  woman: ['Ada', 'Bea', 'Carmen', 'Dara', 'Esi', 'Farah', 'Gwen', 'Hana', 'Ines', 'Joy', 'Kemi', 'Lena', 'Mei', 'Noor', 'Priya', 'Rosa', 'Suki', 'Tamsin', 'Yara', 'Zofia'],
  man: ['Abel', 'Bram', 'Caleb', 'Dev', 'Emre', 'Felix', 'Gus', 'Hiro', 'Ivo', 'Jonah', 'Kofi', 'Luca', 'Malik', 'Nico', 'Omar', 'Pavel', 'Rafi', 'Sol', 'Teo', 'Wen'],
  robot: ['Kestrel-4', 'Mender-12', 'Tally', 'Patch', 'Unit 88', 'Ledger-7', 'Sprocket', 'Beacon-2', 'Gauge-5', 'Rivet'],
  alien: ['Ixhel', 'Vorr', 'Seluun', 'Tavi-Oro', 'Quillan', 'Ekka', 'Moravi', 'Thessaly', 'Oun', 'Zhaar'],
};
// Day jobs by what people wear, for residents without an authored archetype.
const JOBS = {
  casual: ['noodle-bar cook', 'night-school student', 'data clerk', 'nurse', 'street musician', 'delivery dispatcher', 'repair-stall owner', 'barista'],
  scarf: ['schoolteacher', 'translator', 'archive clerk', 'radio producer', 'bookshop owner'],
  vest: ['market porter', 'street-food vendor', 'bike mechanic', 'scaffolder'],
  courier: ['bike courier', 'parcel runner'],
  coat: ['transit officer', 'building inspector', 'paramedic'],
  utility: ['electrician', 'dock loader', 'sanitation engineer'],
  pilot: ['airship deckhand', 'drone pilot'],
  vendor: ['market stallholder', 'fruit seller'],
};
const ARCHETYPE_ROLES = { 'Night watch': 'night-watch guard', 'Skyline runner': 'skyline runner, a rooftop courier' };
const VISITOR_ROLES = {
  'robot-scout': 'service robot who runs errands for the local shops',
  'robot-worker': 'utility mech who repairs pipes and street lights',
  'robot-courier': 'cargo courier robot',
  'robot-sentinel': 'district sentinel robot who keeps an eye on the neighborhood',
  'alien-scout': 'resident from another world, mapping the city for an expedition',
  'alien-resident': 'atmospheric traveler from another world, living here for now',
  'alien-envoy': 'ceremonial envoy from another world',
  'alien-navigator': 'crested navigator from another world who reads the city like a star chart',
};
const MOODS = {
  human: ['cheerful', 'tired', 'wary of strangers', 'chatty', 'distracted', 'grumpy', 'curious', 'relaxed', 'anxious', 'wry'],
  robot: ['cheerful', 'busy', 'curious', 'formal', 'puzzled'],
  alien: ['curious', 'homesick', 'amused', 'formal', 'cheerful'],
};
const STYLES = {
  human: ['speak in short, clipped sentences', 'talk warmly and a little too much', 'are dry and sarcastic', 'are polite but guarded', 'like to tease', 'are blunt'],
  robot: ['speak precisely and a little too literally', 'use service phrases even in small talk', 'count and measure things out loud'],
  alien: ['speak formally, with odd but charming phrasing', 'compare everything to your home world', 'ask questions back'],
};
const CONCERNS = {
  human: ['the trams running late again', 'rent going up on your block', 'a double shift tomorrow', 'a noodle stall that closed last week', 'the rain that never quite stops', 'a cat that keeps escaping', 'saving up for a better flat', 'a band playing nearby this weekend', 'the noise from the expressway', 'an old friend who stopped answering messages', 'learning to cook properly', 'the corporate towers buying up the neighborhood'],
  robot: ['a maintenance check that keeps being postponed', 'getting your route exactly right', 'rain in your joints', 'understanding human small talk', 'a scratch on your casing'],
  alien: ['how loud the city is', 'finding food that tastes like home', 'the tram map', 'a festival back home you are missing', 'learning local slang'],
};
// Installed device voices by name, as the story cast picks theirs.
const VOICE_NAMES = {
  woman: ['Zira', 'Samantha', 'Aria', 'Jenny', 'Hazel', 'Serena', 'Sonia', 'Susan', 'Victoria', 'Libby', 'Karen'],
  man: ['David', 'Daniel', 'Guy', 'Mark', 'George', 'Ryan', 'Alex'],
};
const BUILDING_KINDS = { office: 'office tower', apartment: 'apartment block', terrace: 'row of terraced homes', market: 'market building', civic: 'civic building', warehouse: 'warehouse', factory: 'factory' };
const DESK_ROLES = { office: 'office worker', civic: 'city clerk', warehouse: 'shift supervisor', factory: 'shift supervisor' };

const article = text => /^[aeiou]/i.test(text) ? 'an' : 'a';
const titleCase = text => text.split(' ').map(word => word[0] + word.slice(1).toLowerCase()).join(' ');
const lowerFirst = text => text[0].toLowerCase() + text.slice(1);

// "Kōji (ramen bar)", or "an apartment block" for a building without a sign.
function buildingName({ name, type } = {}) {
  const sign = name && BUILDING_SIGN_CATALOG[type]?.find(s => s.title === name);
  if (name) return sign ? `${titleCase(name)} (${sign.subtitle.split(' / ')[0].toLowerCase()})` : titleCase(name);
  const kind = BUILDING_KINDS[type] ?? 'building';
  return `${article(kind)} ${kind}`;
}

function streetScene({ mode, gesture, jog, companion, crossing, deck } = {}) {
  if (crossing) return 'crossing the street';
  if (mode === 'wait') return 'waiting at the kerb for the crossing light';
  if (mode === 'pause') return gesture === 'phone' ? 'stopped on the pavement to check your phone' : 'stopped on the pavement, looking around';
  if (mode === 'chat') return 'chatting with friends on the pavement';
  if (companion) return 'out walking with a friend';
  if (jog) return 'out for a run';
  return deck ? 'walking along a raised walkway' : 'walking down the street';
}

// What someone indoors is doing, and their job when this is their workplace.
function indoorScene({ spot, activity, room, home, level, building }) {
  const at = buildingName(building), floor = level > 0 ? ` on floor ${level + 1}` : '';
  switch (spot) {
    case 'clerk': return room === 'shop' ? { role: 'shop clerk', doing: `working the counter at ${at}` } : { role: ['apartment', 'terrace'].includes(building?.type) ? 'concierge' : 'receptionist', doing: `on the front desk of ${at}` };
    case 'desk': return { role: DESK_ROLES[building?.type] ?? 'night-shift worker', doing: `working late at a desk in ${at}${floor}` };
    case 'meeting': return { role: DESK_ROLES[building?.type] ?? 'night-shift worker', doing: `in a late meeting at ${at}${floor}` };
    case 'shelf': case 'rack': return { doing: `browsing the shelves at ${at}` };
    case 'mailboxes': return { doing: `checking the mailboxes in the lobby of ${at}` };
    case 'lift': return { doing: `waiting for the lift in ${at}${floor}` };
    case 'wardrobe': return { doing: `picking out clothes at home in ${at}` };
    case 'counter': return { doing: `cooking a late meal at home in ${at}` };
    case 'table': return { doing: `standing at a table in ${at}${floor}` };
    case 'sofa': case 'bench': return { doing: `${activity === 'read' ? 'scrolling your phone' : 'resting'} on a ${spot} ${home ? 'at home ' : ''}in ${at}` };
  }
  return { doing: `inside ${at}` };
}

/**
 * How a resident sounds with the browser's voices, in the shape of the story
 * cast's VOICE_PROFILES: an order of preferred device voices, starting at a
 * different one for each person, then pitch and pace by build, age and kind.
 */
export function residentVoice({ key, species, gender, age }) {
  const unit = salt => hash(`${key}:voice:${salt}`) / 4294967296;
  const pool = species === 'human' && VOICE_NAMES[gender] ? gender : unit('pool') < .5 ? 'woman' : 'man', names = VOICE_NAMES[pool];
  const turn = Math.floor(unit('turn') * names.length);
  let pitch = { woman: 1.06, man: .86 }[species === 'human' && gender] ?? 1, rate = 1;
  if (age) { pitch -= (age - 35) * .004; rate -= (age - 35) * .003; }
  // Robots and aliens speak well above or below anyone in the crowd.
  if (species === 'robot') { pitch = unit('register') < .5 ? .62 : 1.38; rate = .9; }
  if (species === 'alien') { pitch = unit('register') < .5 ? .68 : 1.3; rate = .84; }
  pitch += (unit('pitch') - .5) * .16; rate += (unit('rate') - .5) * .12;
  return { id: key, pitch: Math.min(1.45, Math.max(.55, pitch)), rate: Math.min(1.2, Math.max(.75, rate)), voiceSlot: hash(`${key}:voice:slot`) % 16,
    preferred: [...names.slice(turn), ...names.slice(0, turn), pool === 'woman' ? 'Female' : 'Male'], label: 'Resident' };
}

const roomKind = id => typeof id === 'string' ? id.slice(id.lastIndexOf(':') + 1).replace(/-\d+$/, '') : null;

/** A pedestrian from traffic, as plain data for `residentPersona`. */
export function walkerResident(person, district) {
  return { key: `walker:${person.id}`, species: person.species, model: person.model, district,
    street: { mode: person.mode, gesture: person.gesture, jog: !!person.jog, companion: !!(person.leader || person.follower), crossing: person.edge?.kind === 'crossing', deck: person.edge?.kind === 'deck' } };
}

/** Someone inside a building (an occupant avatar), as plain data for `residentPersona`. */
export function occupantResident(person, district) {
  const o = person.occupant;
  return { key: `occupant:${o.id}:${person.model}`, species: person.species, model: person.model, district,
    indoors: { spot: o.kind, activity: o.activity, room: roomKind(o.room), home: !!o.unit, level: o.level ?? 0, building: { name: o.plan?.name ?? null, type: o.plan?.type ?? null } } };
}

export function residentPersona(resident, { time = 0 } = {}) {
  const { key } = resident, species = ['robot', 'alien'].includes(resident.species) ? resident.species : 'human';
  const pick = (list, salt) => list[hash(`${key}:${salt}`) % list.length];
  const profile = species === 'human' ? CROWD_PROFILES.find(p => p.id === resident.model) : null;
  const visitor = species === 'human' ? null : VISITOR_PROFILES.find(p => p.id === resident.model);
  const scene = resident.indoors ? indoorScene(resident.indoors) : { doing: streetScene(resident.street) };
  let title, role;
  if (scene.role) title = role = scene.role;
  else if (species !== 'human') { title = visitor?.name.toLowerCase() ?? `${species} resident`; role = VISITOR_ROLES[resident.model] ?? title; }
  else title = role = profile?.archetype ? ARCHETYPE_ROLES[profile.archetype] ?? profile.archetype.toLowerCase() : pick(JOBS[profile?.outfit] ?? JOBS.casual, 'job');
  const clock = gameClock(time), h = clock.hours;
  const part = h < 5 ? 'the small hours' : h < 8 ? 'early morning' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'late evening';
  const district = resident.district ?? { name: 'Afterlight', description: '' }, gender = profile?.gender ?? null, age = profile?.age ?? null;
  return {
    key, species, title: title.split(',')[0], role,
    name: pick(species === 'human' ? NAMES[gender] ?? [...NAMES.woman, ...NAMES.man] : NAMES[species], 'name'),
    gender, age, voice: residentVoice({ key, species, gender, age }),
    mood: pick(MOODS[species], 'mood'), style: pick(STYLES[species], 'style'), concern: pick(CONCERNS[species], 'concern'),
    doing: scene.doing,
    where: district.description ? `${district.name} (${lowerFirst(district.description).replace(/\.$/, '')})` : district.name,
    time: `${clock.text}, ${part}`,
  };
}

// The model is small: a short, concrete brief and plain rules keep it in character.
export function systemPrompt(p) {
  const who = `${p.name}, ${p.age ? `${p.age}, ` : ''}${article(p.role)} ${p.role}`;
  const being = p.species === 'robot' ? 'a robot who lives and works in this city' : p.species === 'alien' ? 'from another world, but Afterlight is where you live now' : 'a person who lives in this city';
  return [
    `You are ${who}, in Afterlight, a huge neon city where it rains most nights.`,
    `Right now you are ${p.doing} in ${p.where}. It is ${p.time}, with light rain.`,
    `You are ${p.mood}, and you ${p.style}. Lately you keep thinking about ${p.concern}.`,
    `A passer-by has started talking to you. Answer the way ${p.name} would say it out loud: one or two short sentences, casual, about your own life here. No narration, no actions in asterisks, no lists, no emoji.`,
    `You are ${being}, not a chatbot: never mention AI or language models, and never offer to help like an assistant. If you don't know something, say so in your own words.`,
  ].join('\n');
}

/** Quick lines the player can say instead of typing. */
export const TOPICS = ['What is it like around here?', 'What do you do?', 'Heard anything interesting lately?'];
const OPENERS = ['Hey there.', 'Hi.', 'Hello.', 'Got a minute?'];
export const opener = persona => OPENERS[hash(`${persona.key}:opener`) % OPENERS.length];

/** Exchanges the model sees: older ones fall away to keep replies quick. */
export const HISTORY_TURNS = 3;
export function chatMessages(persona, history, line) {
  return [{ role: 'system', content: systemPrompt(persona) }, ...history.slice(-HISTORY_TURNS * 2), { role: 'user', content: line }];
}

const NOT_IN_WORLD = /\b(?:language model|as an ai|ai assistant|virtual assistant|i(?:'|’)?m an ai|i am an ai|chatgpt|openai|qwen|alibaba)\b/i;
// Broken tokens: raw byte-level pieces or undecodable bytes. A slide into
// another language still reads as speech, so it stays.
const BROKEN = /[\uFFFD\u0120\u010A]/;
const LABELS = '(?:you|me|stranger|passer-?by|player|user|resident|assistant)';
// A name as a regular expression that matches it literally (or nothing, without one).
const literal = text => String(text ?? '').replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') || '\\b\\B';
// The model now and then writes the passer-by's next line too, on a new line
// or after a sentence, or opens with a name label.
function trimTurn(text, name) {
  const label = `(?:${LABELS}|${literal(name)})\\s*:`;
  const s = String(text ?? '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, ' ').split(new RegExp(`(?:\\n|(?<=[.!?…]["”’']?)[ \\t]+)\\s*${label}`, 'i'))[0];
  return s.replace(new RegExp(`^\\s*["“]?\\s*${label}\\s*`, 'i'), '');
}

/** Text to show while a reply is still arriving. */
export function previewReply(text, persona = {}) {
  return trimTurn(text, persona.name).replace(/\s+/g, ' ').trim();
}

/**
 * The finished reply as one or two spoken sentences (three at most), or null
 * when nothing usable is left: then the caller shows a fallback line.
 */
export function cleanReply(text, persona = {}, { sentences = 3, length = 280 } = {}) {
  let s = trimTurn(text, persona.name)
    .replace(/\*[^*]*\*?/g, ' ').replace(/\([^)]*\)?/g, ' ').replace(/\[[^\]]*\]?/g, ' ')
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').replace(/\s+/g, ' ').trim();
  if (/^["“][^"“”]*["”]$/.test(s)) s = s.slice(1, -1).trim();
  if (NOT_IN_WORLD.test(s) || BROKEN.test(s) || !/\p{L}.*\p{L}/u.test(s)) return null;
  // Whole sentences only: a reply cut off by the token limit loses its last
  // fragment. Chinese and Japanese end sentences with their own marks.
  const parts = s.match(/[^.!?…。！？]+(?:[.!?…。！？]+["”’'」』]?|$)/g) ?? [];
  const whole = parts.filter(part => /[.!?…。！？]["”’'」』]?$/.test(part.trim())), kept = [];
  for (const part of whole.length ? whole : parts) {
    if (kept.length >= sentences || (kept.length && kept.join('').length + part.length > length)) break;
    kept.push(part);
  }
  let reply = kept.join('').trim();
  if (!whole.length) reply = `${reply.replace(/[,;:\s-]+$/, '')}…`;
  if (reply.length > length) reply = `${reply.slice(0, length).replace(/\s+\S*$/, '')}…`;
  return reply;
}

const FALLBACKS = {
  human: ['Sorry, miles away tonight. What were you saying?', 'Hm? The rain is loud. Say that again?', 'Long day. Ask me another time, yeah?'],
  robot: ['Input unclear. Please rephrase, slowly.', 'Processing. Ask me again in a moment.'],
  alien: ['Your words run fast for me. Again, slower?', 'Hm. I do not have the right word for that yet.'],
};
export const fallbackReply = (persona, turn = 0) => {
  const lines = FALLBACKS[persona.species] ?? FALLBACKS.human;
  return lines[hash(`${persona.key}:fallback:${turn}`) % lines.length];
};
