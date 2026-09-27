import test from 'node:test';
import assert from 'node:assert/strict';
import { DialogueVoice, speechChunks, selectVoice, VOICE_STORAGE_KEY } from '../src/voice.js';
import { VOICE_PROFILES } from '../src/npc-profiles.js';

function harness(storage) {
  const pending = new Map(), events = new Map(); let timer = 0;
  const synth = { voices: [], spoken: [], cancellations: 0,
    getVoices() { return this.voices; }, speak(line) { this.spoken.push(line); }, cancel() { this.cancellations++; },
    addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); },
  };
  class Utterance { constructor(text) { this.text = text; } }
  const voice = new DialogueVoice({ synth, Utterance, storage, timers: {
    setTimeout(fn) { pending.set(++timer, fn); return timer; }, clearTimeout(id) { pending.delete(id); },
  } });
  return { voice, synth, events, pending, latest: () => synth.spoken.at(-1) };
}

test('long spoken passages retain every word and stay within engine-safe chunks', () => {
  const text = 'First, a short sentence. ' + 'Vesper remembers every resident and says “Welcome home.” '.repeat(30);
  const chunks = speechChunks(text);
  assert.ok(chunks.length > 3); assert.ok(chunks.every(c => c.length <= 180));
  assert.equal(chunks.join(' '), text.trim());
  assert.deepEqual(speechChunks(' \n '), []);
  assert.equal(speechChunks('x'.repeat(500)).join(''), 'x'.repeat(500));
});

test('automatic cast uses real available English voices, with whole-word name matching', () => {
  const voices = [
    { name: 'Chinese David', lang: 'zh-CN', localService: true },
    { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true },
    { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true },
    { name: 'Microsoft Mark - English (United States)', lang: 'en-US', localService: true },
  ];
  assert.equal(selectVoice(voices, VOICE_PROFILES.mara), voices[1]);
  assert.equal(selectVoice(voices, VOICE_PROFILES.rook), voices[2]);
  assert.equal(selectVoice(voices, VOICE_PROFILES.jun), voices[3]);
  const generic = [{name:'English Female',lang:'en-US'}, {name:'English Male',lang:'en-US'}];
  assert.equal(selectVoice(generic, VOICE_PROFILES.orrin), generic[1]);
  assert.equal(selectVoice([], VOICE_PROFILES.mara), null);
});

test('late voice discovery works, while an empty inventory can use the browser default', () => {
  const {voice,synth,events,latest} = harness();
  voice.speak('Hello.', 'mara'); assert.equal(latest().voice, undefined);
  synth.voices = [{name:'Microsoft Zira',lang:'en-US',localService:true}]; events.get('voiceschanged')();
  voice.replay(); assert.equal(latest().voice, synth.voices[0]);
  assert.equal(voice.snapshot().status, 'starting'); latest().onstart(); assert.equal(voice.snapshot().status, 'speaking');
  latest().onend(); assert.equal(voice.snapshot().status, 'finished'); voice.dispose();
});

test('changing response, replaying and leaving prevent stale utterances from continuing', () => {
  const {voice,synth,latest,pending} = harness();
  voice.speak('Old line. '.repeat(80), 'mara'); const old = latest(); old.onstart();
  voice.speak('A new response.', 'rook'); const current = latest();
  old.onend(); old.onerror({error:'interrupted'}); old.onstart();
  assert.equal(latest(), current); assert.equal(synth.spoken.length, 2); assert.equal(voice.snapshot().contact, 'rook');
  current.onstart(); assert.equal(voice.snapshot().status, 'speaking');
  voice.stop(); current.onend(); assert.equal(synth.spoken.length, 2); assert.equal(pending.size, 0);
  voice.replay(); assert.equal(latest().text, 'A new response.'); assert.equal(latest().pitch, VOICE_PROFILES.rook.pitch);
  latest().onend(); assert.equal(voice.snapshot().status, 'finished'); voice.dispose();
});

test('one utterance at a time completes every chunk and clears its watchdog', () => {
  const {voice,synth,latest,pending} = harness();
  const text = 'You are part of this city. '.repeat(24); voice.speak(text, 'imani');
  const spoken = []; while (voice.snapshot().status !== 'finished') {
    const line = latest(); line.onstart(); spoken.push(line.text); line.onend(); assert.ok(spoken.length < 30);
  }
  assert.equal(spoken.join(' '), text.trim()); assert.equal(synth.spoken.length, speechChunks(text).length);
  assert.equal(pending.size, 0); voice.dispose();
});

test('muting cancels immediately, volume persists, and settings do not affect campaign saves', () => {
  const data = new Map([['afterlight.last-signal.v1','unchanged']]);
  const storage = {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const {voice,synth,latest} = harness(storage);
  voice.setVolume(.35); voice.speak('A line.', 'cass'); assert.equal(latest().volume, .35);
  voice.setEnabled(false); latest().onend(); voice.speak('Muted.', 'cass'); assert.equal(synth.spoken.length, 1);
  assert.equal(data.get('afterlight.last-signal.v1'), 'unchanged');
  const restored = harness(storage); assert.equal(restored.voice.enabled, false); assert.equal(restored.voice.volume, .35);
  restored.voice.setEnabled(true); restored.voice.setVolume(0); restored.voice.speak('Zero volume.', 'mara'); assert.equal(restored.synth.spoken.length, 0);
  restored.voice.setVolume(99); assert.equal(restored.voice.volume, 1);
  assert.ok(data.has(VOICE_STORAGE_KEY)); voice.dispose(); restored.voice.dispose();
});

test('missing engines, storage errors and blocked playback leave dialogue usable', () => {
  const storage = {getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
  const noVoice = new DialogueVoice({synth:null,Utterance:null,storage});
  assert.doesNotThrow(()=>{noVoice.speak('Readable text.', 'mara');noVoice.setEnabled(false);noVoice.setVolume(.5);});
  assert.equal(noVoice.snapshot().supported, false); noVoice.dispose();
  const {voice,latest,pending} = harness(storage);
  voice.speak('Playback must be authorized.', 'mara'); latest().onerror({error:'not-allowed'});
  assert.equal(voice.snapshot().status, 'error'); assert.match(voice.snapshot().message, /Replay/); assert.equal(pending.size, 0);
  voice.replay(); latest().onstart(); latest().onend(); assert.equal(voice.snapshot().status, 'finished'); voice.dispose();
});

test('unresponsive engines time out and can be retried without delayed old speech', () => {
  const {voice,synth,pending,latest} = harness();
  voice.speak('No callback.', 'mara'); const old = latest(); [...pending.values()][0]();
  assert.equal(voice.snapshot().status, 'error'); assert.ok(synth.cancellations >= 2);
  old.onstart(); old.onend(); assert.equal(voice.snapshot().status, 'error');
  voice.replay(); latest().onstart(); [...pending.values()][0](); assert.equal(voice.snapshot().status, 'error');
  voice.dispose(); assert.equal(pending.size, 0);
});
