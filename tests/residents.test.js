import test from 'node:test';
import assert from 'node:assert/strict';
import { residentPersona, residentVoice, walkerResident, occupantResident, systemPrompt, chatMessages, cleanReply, previewReply, fallbackReply, opener, TOPICS, HISTORY_TURNS } from '../src/engine/residents/persona.js';
import { ResidentModel, detectGPU, passesSelfCheck, RESIDENT_CHAT_KEY, RESIDENT_MODELS } from '../src/engine/residents/model.js';
import { ResidentConversation, facingResident, settingsNote, MAX_LINE } from '../src/engine/residents/conversation.js';
import { createStorage } from '../src/engine/save.js';
import { gameClock } from '../src/engine/clock.js';
import { CROWD_PROFILES } from '../src/actors/npc-profiles.js';
import { VISITOR_PROFILES } from '../src/actors/npc-visitors.js';
import { MASTER_DISTRICTS } from '../src/world/master-plan.js';
import { VerticalMetropolis } from '../src/world/vertical-city.js';
import { interiorPlan, floorOccupants } from '../src/world/interior-plan.js';

const district = MASTER_DISTRICTS.find(d => d.id === 'east-reach');
const walker = (id, model, species = 'human', extra = {}) => walkerResident({ id, model, species, mode: 'walk', ...extra }, district);
const indoors = (occupant, plan, model = 'resident-3') => occupantResident({ species: 'human', model, occupant: { id: `${plan.name}#${occupant.level ?? 0}:s1`, level: 0, unit: null, plan, ...occupant } }, district);
const memoryStorage = () => { const map = new Map(); return createStorage({ getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }); };
const gpu = (features = ['shader-f16'], info = {}) => ({ async requestAdapter() { return { features: new Set(features), info }; } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// A stand-in for WebLLM: reports progress, then streams canned replies.
function fakeBackend({ fail = null, replies = [] } = {}) {
  const engines = [];
  async function backend(model, progress) {
    progress(.5, 'Fetching param cache[5/11]: 200MB fetched. 50% completed');
    progress(1, 'Loading GPU shader modules[9/9]: 100% completed');
    if (fail) throw new Error(fail);
    const engine = { model, unloads: 0, interrupts: 0, streams: [],
      async generate(messages, onText) { engine.streams.push(messages); const reply = replies.shift() ?? ['Busy night.', ' Trams are late.']; if (reply instanceof Error) throw reply; for (const part of reply) onText(part); },
      interrupt() { engine.interrupts++; }, async unload() { engine.unloads++; } };
    engines.push(engine);
    return engine;
  }
  return { backend, engines };
}

test('the game clock starts at 23:48 and keeps the HUD’s minute every 45 seconds', () => {
  assert.equal(gameClock(0).text, '23:48');
  assert.equal(gameClock(44).text, '23:48');
  assert.equal(gameClock(45 * 12).text, '00:00');
  assert.deepEqual([gameClock(45 * 12).hours, gameClock(45 * (12 + 1440)).text], [0, '00:00']);
});

test('each resident is the same person every time, with a name and job of their own', () => {
  const people = [...CROWD_PROFILES.map((p, i) => walker(i, p.id)), ...VISITOR_PROFILES.map((p, i) => walker(40 + i, p.id, p.species))];
  const personas = people.map(r => residentPersona(r, { time: 600 }));
  assert.deepEqual(people.map(r => residentPersona(r, { time: 600 })), personas, 'seeded from the ID, not from chance');
  for (const p of personas) {
    for (const field of ['name', 'title', 'role', 'mood', 'style', 'concern', 'doing', 'where', 'time']) assert.ok(typeof p[field] === 'string' && p[field].length > 1, `${p.key}: ${field}`);
    assert.doesNotMatch(systemPrompt(p), /undefined|null|NaN/);
  }
  assert.ok(new Set(personas.map(p => p.name)).size >= 15, 'a crowd, not one name');
  assert.ok(new Set(personas.map(p => p.title)).size >= 20, 'and many walks of life');
  assert.equal(residentPersona(walker(12, 'resident-12')).title, 'airship pilot', 'authored archetypes are kept');
  assert.equal(residentPersona(walker(17, 'resident-17')).title, 'skyline runner');
  for (const visitor of VISITOR_PROFILES) {
    const p = residentPersona(walker(1, visitor.id, visitor.species));
    assert.equal(p.title, visitor.name.toLowerCase());
    assert.equal(p.species, visitor.species);
    assert.equal(p.age, null, 'robots and aliens have no human age');
  }
  assert.notEqual(residentPersona(walker(1, 'resident-1')).name + residentPersona(walker(1, 'resident-1')).concern, residentPersona(walker(2, 'resident-1')).name + residentPersona(walker(2, 'resident-1')).concern);
});

test('what a passer-by is doing comes from what the street simulation shows', () => {
  const doing = extra => residentPersona(walker(3, 'resident-3', 'human', extra)).doing;
  assert.equal(doing({ mode: 'wait' }), 'waiting at the kerb for the crossing light');
  assert.equal(doing({ mode: 'pause', gesture: 'phone' }), 'stopped on the pavement to check your phone');
  assert.equal(doing({ mode: 'chat' }), 'chatting with friends on the pavement');
  assert.equal(doing({ mode: 'walk', edge: { kind: 'crossing' } }), 'crossing the street');
  assert.equal(doing({ mode: 'walk', follower: {} }), 'out walking with a friend');
  assert.equal(doing({ mode: 'walk', jog: true }), 'out for a run');
  assert.match(residentPersona(walker(3, 'resident-3')).where, /^East Reach \(commercial terraces overlooking Blackwater Bay\)$/);
});

test('people indoors are where the building says they are', () => {
  const p = (occupant, plan) => residentPersona(indoors(occupant, plan));
  const shop = p({ kind: 'clerk', activity: 'clerk', room: 'b1/1:shop' }, { name: 'KŌJI', type: 'market' });
  assert.equal(shop.title, 'shop clerk'); assert.match(shop.doing, /counter at Kōji \(ramen bar\)/);
  const desk = p({ kind: 'desk', activity: 'type', room: 'b2/3:office', level: 2 }, { name: 'SYNAPSE', type: 'office' });
  assert.equal(desk.title, 'office worker'); assert.match(desk.doing, /desk in Synapse \(neural systems\) on floor 3/);
  const home = p({ kind: 'sofa', activity: 'read', room: 'b3/2A:living', unit: 'b3/2A' }, { name: null, type: 'apartment' });
  assert.equal(home.doing, 'scrolling your phone on a sofa at home in an apartment block');
  assert.ok(JOBS_FREE(home.title), 'someone at home keeps their own job');
  assert.match(p({ kind: 'clerk', activity: 'clerk', room: 'b4/1:lobby' }, { name: 'AURORA', type: 'apartment' }).title, /concierge/);
  // Every spot in real interiors gets a scene of its own.
  const metropolis = new VerticalMetropolis(), seen = new Set();
  const blueprints = metropolis.area(district.x - 90, district.z - 90, district.x + 90, district.z + 90).flatMap(block => block.buildings);
  for (const plan of blueprints.map(interiorPlan).filter(Boolean).slice(0, 24)) for (const o of floorOccupants(plan, 0)) {
    const persona = residentPersona(indoors({ ...o, level: 0 }, plan));
    seen.add(o.kind);
    assert.doesNotMatch(persona.doing, /^inside /, `${plan.id} ${o.kind}`);
    assert.doesNotMatch(systemPrompt(persona), /undefined|null/);
  }
  assert.ok(seen.size >= 4, `several kinds of spot checked (${[...seen]})`);
});
const JOBS_FREE = title => !['shop clerk', 'receptionist', 'concierge', 'office worker'].includes(title);

test('the brief is short, concrete and keeps the model in the city', () => {
  const person = residentPersona(walker(12, 'resident-12'), { time: 45 * 30 });
  const prompt = systemPrompt(person);
  assert.ok(prompt.length < 1100, `small models need a short brief (${prompt.length})`);
  for (const part of [person.name, person.role, 'East Reach', '00:18, the small hours', 'never mention AI', 'one or two short sentences']) assert.ok(prompt.includes(part), part);
  assert.match(systemPrompt(residentPersona(walker(1, 'robot-scout', 'robot'))), /a robot who lives and works in this city/);
  assert.match(systemPrompt(residentPersona(walker(1, 'alien-envoy', 'alien'))), /from another world/);
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
  const messages = chatMessages(person, history, 'What do you do?');
  assert.deepEqual(messages.map(m => m.role), ['system', ...history.slice(-HISTORY_TURNS * 2).map(m => m.role), 'user']);
  assert.equal(messages[1].content, 'line 4', 'only the latest exchanges');
  assert.equal(messages.at(-1).content, 'What do you do?');
  assert.ok(['Hey there.', 'Hi.', 'Hello.', 'Got a minute?'].includes(opener(person)));
  assert.equal(TOPICS.length, 3);
});

test('replies are cleaned into a few spoken sentences, or rejected', () => {
  const dara = { name: 'Dara' };
  assert.equal(cleanReply('Dara: *shrugs* Not much. Trams are late again.', dara), 'Not much. Trams are late again.');
  assert.equal(cleanReply('Not much.\nYou: And you?\nDara: Fine.', dara), 'Not much.', 'the model does not write the player’s lines');
  assert.equal(cleanReply('Not much. Stranger: why?', dara), 'Not much.');
  assert.equal(cleanReply('“Busy night. Kōji never closes.”', dara), 'Busy night. Kōji never closes.');
  assert.equal(cleanReply('<think>\nshould I?\n</think>\n\nHi! 😀 Nice to meet you. (waves) Really. Truly.', dara), 'Hi! Nice to meet you. Really.');
  assert.equal(cleanReply('Rain again, and the trams are', dara), 'Rain again, and the trams are…', 'a cut-off line still reads as speech');
  assert.equal(cleanReply('First thing. Second thing. And a fragment that ran out of tok', dara), 'First thing. Second thing.', 'a cut-off fragment is dropped');
  const long = cleanReply(`${'Word '.repeat(70)}end. Short one.`, dara);
  assert.ok(long.length <= 281 && long.endsWith('…'), long);
  for (const bad of ['As an AI language model, I cannot.', 'I am an AI assistant here to help.', '   ', '*nods*', 'Qwen here!']) assert.equal(cleanReply(bad, dara), null, bad);
  for (const broken of ['ĠtheĠrainĠisĠcold.', 'Not much.Ċ', 'Busy \uFFFD night.']) assert.equal(cleanReply(broken, dara), null, `broken tokens: ${broken}`);
  for (const other of ['Busy night. 今天下雨了。', 'Привет. Busy night.', '今天下雨了！电车又晚了。']) assert.equal(cleanReply(other, dara), other, `another language is still speech: ${other}`);
  assert.equal(cleanReply('今天下雨了。电车又晚了。还有', dara), '今天下雨了。电车又晚了。', 'a cut-off Chinese fragment is dropped');
  assert.equal(cleanReply('Café’s shut. Señora Ruiz went home — try Kōji’s.', dara), 'Café’s shut. Señora Ruiz went home — try Kōji’s.', 'accented Latin letters are speech');
  assert.equal(previewReply('Dara: Hey th', dara), 'Hey th');
  const robot = residentPersona(walker(1, 'robot-scout', 'robot'));
  assert.equal(fallbackReply(robot, 0), fallbackReply(robot, 0));
  assert.ok(['Input unclear. Please rephrase, slowly.', 'Processing. Ask me again in a moment.'].includes(fallbackReply(robot, 2)), 'robots keep a robot’s voice');
});

test('only someone close, in front and in sight can be talked to', () => {
  const player = { x: 0, y: 0, z: 0, yaw: 0 }; // facing -z
  const at = (x, z, y = 0) => ({ x, y, z });
  assert.equal(facingResident(player, []), null);
  const ahead = at(0, -2), nearer = at(.4, -1.5);
  assert.equal(facingResident(player, [ahead]), ahead);
  assert.equal(facingResident(player, [ahead, nearer]), nearer);
  assert.equal(facingResident(player, [at(0, 2)]), null, 'behind');
  assert.equal(facingResident(player, [at(0, -3)]), null, 'too far');
  assert.equal(facingResident(player, [at(0, -1.5, 2.5)]), null, 'another floor');
  assert.ok(facingResident(player, [at(.6, .6)]), 'right beside you counts');
  assert.equal(facingResident(player, [ahead, nearer], p => p !== nearer), ahead, 'not through a wall');
  assert.equal(facingResident({ ...player, yaw: Math.PI / 2 }, [at(-2, 0)]).x, -2, 'follows where the player faces');
});

test('the browser’s graphics decide whether the model runs, or say why not', async () => {
  assert.equal((await detectGPU(undefined)).supported, false);
  assert.equal((await detectGPU({ requestAdapter: async () => null })).supported, false);
  assert.equal((await detectGPU({ requestAdapter: async () => { throw new Error('blocked'); } })).supported, false);
  assert.deepEqual(await detectGPU(gpu()), { supported: true });
  assert.deepEqual(await detectGPU(gpu([])), { supported: true }, 'the 32-bit builds need no shader-f16');
  const software = gpu([], { isFallbackAdapter: true });
  assert.equal((await detectGPU(software)).supported, false, 'a software renderer is too slow to talk');
  assert.equal((await detectGPU(software, { allowSoftware: true })).supported, true);
});

test('resident chat stays off until the player turns it on, then remembers', async () => {
  const storage = memoryStorage(), { backend, engines } = fakeBackend(), seen = [];
  const model = new ResidentModel({ storage, gpu: gpu(), backend });
  model.subscribe(s => seen.push(`${s.status}${s.message ? `:${s.message}` : ''}`));
  assert.equal(model.status, 'off');
  assert.equal(await model.load(), false, 'nothing loads while off');
  assert.equal(engines.length, 0);
  assert.equal(await model.setEnabled(true), true);
  assert.equal(model.status, 'ready');
  assert.equal(engines[0].model, RESIDENT_MODELS.small.id, 'the lighter model unless the player picks the other');
  assert.deepEqual(seen, ['off', 'checking', 'loading:Starting', 'loading:Downloading', 'loading:Preparing the graphics card', 'ready']);
  assert.deepEqual(JSON.parse(storage.getItem(RESIDENT_CHAT_KEY)), { enabled: true, downloaded: true, size: 'small' });
  // The next visit loads it again when play starts.
  const later = new ResidentModel({ storage, gpu: gpu(), backend });
  assert.equal(later.status, 'idle');
  assert.equal(await Promise.all([later.load(), later.load()]).then(r => r.every(Boolean)), true);
  assert.equal(engines.length, 2, 'one load at a time');
  model.setEnabled(false); await tick();
  assert.equal(engines[0].unloads, 1);
  assert.equal(model.status, 'off');
  assert.equal(JSON.parse(storage.getItem(RESIDENT_CHAT_KEY)).enabled, false);
  // Blocked storage keeps the choice for this session.
  const blocked = new ResidentModel({ storage: createStorage({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} }), gpu: gpu(), backend });
  assert.equal(await blocked.setEnabled(true), true);
});

test('without WebGPU, or when loading fails, the setting explains and the game plays on', async () => {
  const storage = memoryStorage(), { backend, engines } = fakeBackend();
  const none = new ResidentModel({ storage, gpu: undefined, backend });
  assert.equal(await none.setEnabled(true), false);
  assert.equal(none.status, 'unsupported');
  assert.equal(none.enabled, false, 'switches itself back off');
  assert.equal(JSON.parse(storage.getItem(RESIDENT_CHAT_KEY)).enabled, false);
  assert.equal(engines.length, 0);
  assert.match(settingsNote(none.snapshot()), /^Not available here: this browser has no WebGPU\./);
  const failing = new ResidentModel({ storage: memoryStorage(), gpu: gpu(), backend: fakeBackend({ fail: 'Network error\nstack' }).backend });
  assert.equal(await failing.setEnabled(true), false);
  assert.deepEqual([failing.status, failing.message, failing.enabled], ['error', 'Network error', true]);
  assert.match(settingsNote(failing.snapshot()), /stopped: Network error Turn it off and on/);
});

test('the player picks the model size, and a loaded or loading model gives way to the other', async () => {
  const storage = memoryStorage(), { backend, engines } = fakeBackend();
  const model = new ResidentModel({ storage, gpu: gpu(), backend });
  assert.equal(model.snapshot().size, 'small');
  assert.equal(await model.setSize('large'), false, 'while off the choice is only remembered');
  assert.equal(engines.length, 0);
  assert.equal(new ResidentModel({ storage }).size, 'large', 'and kept for the next visit');
  assert.equal(await model.setEnabled(true), true);
  assert.equal(engines[0].model, RESIDENT_MODELS.large.id);
  assert.equal(await model.setSize('small'), true);
  assert.equal(engines[0].unloads, 1, 'the other size is released');
  assert.deepEqual([engines[1].model, model.status, model.snapshot().size], [RESIDENT_MODELS.small.id, 'ready', 'small']);
  assert.equal(await model.setSize('huge'), true, 'an unknown size changes nothing');
  assert.deepEqual([model.size, engines.length], ['small', 2]);
  storage.setItem(RESIDENT_CHAT_KEY, JSON.stringify({ enabled: true, size: 'huge' }));
  assert.equal(new ResidentModel({ storage }).size, 'small');
  // Picking again mid-download stops that download and fetches the new pick.
  const loads = [], idle = new ResidentModel({ storage: memoryStorage(), gpu: gpu(), backend: (id, progress, signal) => new Promise((resolve, reject) => {
    // As WebLLM's worker does, an aborted download ends in an error.
    signal.addEventListener('abort', () => reject(new Error('the model was unloaded.')));
    loads.push({ id, signal, done: () => resolve({ async unload() {} }) });
  }) });
  const first = idle.setEnabled(true);
  await tick(); await tick();
  const second = idle.setSize('large');
  await tick(); await tick();
  assert.deepEqual(loads.map(l => [l.id, l.signal.aborted]), [[RESIDENT_MODELS.small.id, true], [RESIDENT_MODELS.large.id, false]]);
  loads[1].done();
  assert.deepEqual([await first, await second, idle.status, idle.model], [false, true, 'ready', RESIDENT_MODELS.large.id]);
  // After a failed load, picking the other size tries again with it.
  const failing = new ResidentModel({ storage: memoryStorage(), gpu: gpu(), backend: fakeBackend({ fail: 'Out of memory' }).backend });
  await failing.setEnabled(true);
  assert.equal(failing.status, 'error');
  failing.backend = backend;
  assert.equal(await failing.setSize('large'), true);
});

test('a loaded model must repeat a plain sentence before residents use it', () => {
  for (const text of ['The rain is cold tonight.', '<think>\n\n</think>\n\nThe rain is cold tonight.', '"The rain is cold tonight."']) assert.ok(passesSelfCheck(text), text);
  for (const text of ['', null, 'ĠtheĠrainĠisĠcold', 'The rain is coldtonight', '雨很冷 tonight', 'theRAINis cold toni ght']) assert.equal(passesSelfCheck(text), false, String(text));
});

test('turning it off mid-download releases the model when it arrives', async () => {
  let finish, signal;
  const engine = { unloads: 0, async unload() { this.unloads++; } };
  const model = new ResidentModel({ storage: memoryStorage(), gpu: gpu(), backend: (id, progress, abort) => new Promise(resolve => { signal = abort; finish = () => resolve(engine); }) });
  const loading = model.setEnabled(true);
  await tick(); await tick();
  assert.equal(model.status, 'loading');
  model.setEnabled(false);
  assert.equal(model.status, 'off');
  assert.equal(signal.aborted, true, 'the download stops');
  finish();
  assert.equal(await loading, false);
  await tick();
  assert.equal(engine.unloads, 1);
  assert.equal(model.ready, false);
});

test('replies stream one at a time, and a lost graphics device stops the model', async () => {
  const { backend, engines } = fakeBackend({ replies: [['One', '.'], ['Two', '.'], new Error('Device was lost.')] });
  const model = new ResidentModel({ storage: memoryStorage(), gpu: gpu(), backend });
  await model.setEnabled(true);
  const texts = [];
  const [a, b] = await Promise.all([model.generate([{ role: 'user', content: 'a' }], { onText: t => texts.push(t) }), model.generate([{ role: 'user', content: 'b' }])]);
  assert.deepEqual([a, b, texts], ['One.', 'Two.', ['One', 'One.']]);
  assert.deepEqual(engines[0].streams.map(m => m[0].content), ['a', 'b']);
  await assert.rejects(model.generate([]), /Device was lost/);
  assert.equal(model.status, 'error');
  assert.equal(engines[0].unloads, 1);
  await assert.rejects(model.generate([]), /not loaded/);
});

test('deleting the download turns the setting off', async () => {
  const storage = memoryStorage(), deleted = [];
  const model = new ResidentModel({ storage, gpu: gpu(), backend: fakeBackend().backend, forget: async () => deleted.push(true) });
  await model.setEnabled(true);
  await model.forget();
  assert.deepEqual([deleted.length, model.enabled, model.downloaded, model.status], [1, false, false, 'off']);
  assert.deepEqual(JSON.parse(storage.getItem(RESIDENT_CHAT_KEY)), { enabled: false, downloaded: false, size: 'small' });
  assert.match(settingsNote(model.snapshot()), /^The downloaded model was deleted\. Chat with people/);
});

test('each resident has a voice of their own, in the shape the story cast uses', () => {
  const personas = [...CROWD_PROFILES.map((p, i) => residentPersona(walker(i, p.id))), ...VISITOR_PROFILES.map((p, i) => residentPersona(walker(40 + i, p.id, p.species)))];
  for (const { key, species, gender, voice } of personas) {
    assert.equal(voice.id, key);
    assert.ok(voice.pitch >= .55 && voice.pitch <= 1.45 && voice.rate >= .75 && voice.rate <= 1.2, `${key}: ${voice.pitch} / ${voice.rate}`);
    assert.ok(Number.isInteger(voice.voiceSlot) && voice.preferred.length > 3);
    assert.ok(['Female', 'Male'].includes(voice.preferred.at(-1)), 'any installed voice of the right kind will do last');
    if (species === 'human') assert.equal(voice.preferred.at(-1), gender === 'woman' ? 'Female' : 'Male');
    else assert.ok(voice.pitch < .8 || voice.pitch > 1.2, `${key}: robots and aliens sound unlike the crowd`);
  }
  assert.deepEqual(residentPersona(walker(3, 'resident-3')).voice, residentPersona(walker(3, 'resident-3')).voice, 'the same person keeps one voice');
  assert.ok(new Set(personas.map(p => p.voice.preferred[0])).size >= 6, 'people start from different device voices');
  assert.ok(new Set(personas.map(p => p.voice.pitch.toFixed(2))).size >= 20, 'and pitch their voices differently');
  const at = age => residentVoice({ key: 'walker:9', species: 'human', gender: 'man', age });
  assert.ok(at(64).pitch < at(27).pitch && at(64).rate < at(27).rate, 'with the same seed, an older voice is lower and slower');
});

test('residents speak each finished reply and fall silent when interrupted or left', async () => {
  const spoken = [], stops = [];
  const voice = { speak: (text, profile) => spoken.push([text, profile.id]), stop: () => stops.push(true) };
  let release;
  const model = { generate: (messages, { onText }) => new Promise(resolve => { release = text => { onText(text); resolve(text); }; }), interrupt() {} };
  const conversation = new ResidentConversation({ model, view: { show() {}, said() {}, reply() {} }, voice });
  const persona = residentPersona(walker(8, 'resident-8'));
  const greeting = conversation.open(persona);
  release('Evening. Rain again.'); await greeting;
  assert.deepEqual(spoken, [['Evening. Rain again.', persona.key]], 'spoken once, when finished, in their voice');
  const before = stops.length, next = conversation.say('What do you do?');
  assert.equal(stops.length, before + 1, 'saying something new stops the line being spoken');
  conversation.close();
  assert.equal(stops.length, before + 2, 'leaving stops it too');
  release('I fix trams.'); await next;
  assert.equal(spoken.length, 1, 'nothing is spoken after leaving');
  const failing = new ResidentConversation({ model: { generate: async () => { throw new Error('Device was lost.'); }, interrupt() {} }, view: { show() {}, said() {}, reply() {} }, voice });
  await failing.open(persona);
  assert.deepEqual(spoken.at(-1), [fallbackReply(persona, 0), persona.key], 'fallback lines are spoken as well');
});

function harness(generate) {
  const calls = [], interrupts = [];
  const view = { show: (p, topics) => calls.push(['show', p.name, topics.length]), said: line => calls.push(['said', line]), reply: (line, pending) => calls.push(['reply', line, pending]) };
  const model = { generate, interrupt: () => interrupts.push(true) };
  return { conversation: new ResidentConversation({ model, view }), calls, interrupts };
}

test('a conversation greets, streams each reply and remembers the last few lines', async () => {
  const sent = [];
  const { conversation, calls } = harness(async (messages, { onText }) => {
    sent.push(messages);
    onText('Hey'); onText('Hey. Rain again.');
    return `Hey. Rain again. ${messages.at(-1).content === 'What do you do?' ? 'I fix trams.' : ''}`;
  });
  const persona = residentPersona(walker(5, 'resident-5'));
  assert.equal(await conversation.open(persona), 'Hey. Rain again.');
  assert.deepEqual(calls, [['show', persona.name, 3], ['said', opener(persona)], ['reply', '', true], ['reply', 'Hey', true], ['reply', 'Hey. Rain again.', true], ['reply', 'Hey. Rain again.', false]]);
  assert.deepEqual(sent[0].map(m => m.role), ['system', 'user']);
  assert.equal(await conversation.say('What do you do?'), 'Hey. Rain again. I fix trams.');
  assert.deepEqual(sent[1].map(m => m.role), ['system', 'user', 'assistant', 'user'], 'the greeting is remembered');
  assert.equal(await conversation.say('   '), null, 'nothing to say');
  await conversation.say('x'.repeat(400));
  assert.equal(sent.at(-1).at(-1).content.length, MAX_LINE);
  assert.equal(conversation.snapshot().turns, 3);
});

test('a reply in progress blocks another; closing stops it and drops late text', async () => {
  let release;
  const { conversation, calls, interrupts } = harness((messages, { onText }) => new Promise(resolve => { release = text => { onText(text); resolve(text); }; }));
  const persona = residentPersona(walker(6, 'resident-6'));
  const greeting = conversation.open(persona);
  assert.equal(await conversation.say('Anyone home?'), null, 'one reply at a time');
  conversation.close();
  assert.equal(interrupts.length, 1);
  const shown = calls.length;
  release('Too late.');
  assert.equal(await greeting, null);
  assert.equal(calls.length, shown, 'nothing reaches a closed panel');
  assert.equal(conversation.snapshot().open, false);
});

test('a failed or unusable reply becomes a fallback line in the resident’s voice', async () => {
  const replies = [Promise.reject(new Error('Device was lost.')), Promise.resolve('As an AI language model, I cannot chat.')];
  const { conversation } = harness(() => replies.shift());
  const persona = residentPersona(walker(41, 'alien-resident', 'alien'));
  const first = await conversation.open(persona), second = await conversation.say('Hello?');
  assert.equal(first, fallbackReply(persona, 0));
  assert.equal(second, fallbackReply(persona, 1));
  assert.match(first, /words|word/);
});

test('the setting note says what turning it on costs and what it is doing', () => {
  assert.match(settingsNote({ status: 'off' }), /downloads about 450 MB once\. Story contacts keep their own dialogue\./);
  assert.match(settingsNote({ status: 'off', size: 'large' }), /downloads about 1\.1 GB once\./, 'the size the player picked');
  assert.doesNotMatch(settingsNote({ status: 'off' }), /phones/);
  assert.match(settingsNote({ status: 'off' }, true), /phones and tablets may run out of memory/);
  assert.equal(settingsNote({ status: 'loading', progress: .42, message: 'Downloading' }), 'Downloading… 42%. You can keep playing.');
  assert.match(settingsNote({ status: 'ready' }), /press E to talk/);
  assert.match(settingsNote({ status: 'idle' }), /^On\. The resident model loads when you start playing\.$/);
});
