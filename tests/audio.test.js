import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio.js';

function harness(t) {
  const contexts = [], previous = globalThis.window;
  const parameter = (value = 0) => ({ value, setTargetAtTime(value) { this.value = value; }, setValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; } });
  const node = () => ({ connect() {}, start() {}, stop() {}, gain: parameter(), frequency: parameter() });
  class AudioContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 10; this.oscillators = []; this.resumes = 0; contexts.push(this); }
    createGain() { return node(); }
    createOscillator() { const oscillator = node(); this.oscillators.push(oscillator); return oscillator; }
    createBiquadFilter() { return node(); }
    createBuffer() { return { getChannelData: () => new Float32Array(20) }; }
    createBufferSource() { return node(); }
    resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  return { audio: new GameAudio(), contexts };
}

test('sound defaults on but preference changes do not start audio before the start gesture', t => {
  const { audio, contexts } = harness(t);
  assert.equal(audio.enabled, true);
  audio.shot(); audio.update(12, true);
  assert.equal(contexts.length, 0);
  assert.equal(audio.toggle(), false);
  audio.init();
  assert.equal(contexts.length, 0, 'muting before starting must suppress audio initialization');
  assert.equal(audio.toggle(), true);
  assert.equal(contexts.length, 0, 'enabling the preference alone must not start playback');
  audio.init();
  assert.equal(contexts.length, 1);
  assert.equal(audio.context.state, 'running');
  assert.equal(audio.master.gain.value, .23);
});

test('muting suppresses effects and engine sound while unmuting reuses the initialized context', t => {
  const { audio, contexts } = harness(t);
  audio.init(); audio.update(15, true); audio.hit();
  assert.ok(audio.engineGain.gain.value > 0);
  assert.equal(audio.context.oscillators.length, 2);
  audio.toggle(); audio.update(15, true); audio.shot(); audio.init();
  assert.equal(audio.master.gain.value, 0);
  assert.equal(audio.engineGain.gain.value, 0);
  assert.equal(audio.context.oscillators.length, 2, 'muted effects should not schedule oscillators');
  audio.context.state = 'suspended';
  audio.toggle(); audio.init(); audio.update(15, true); audio.hit();
  assert.equal(contexts.length, 1);
  assert.equal(audio.context.resumes, 2);
  assert.equal(audio.master.gain.value, .23);
  assert.ok(audio.engineGain.gain.value > 0);
  assert.equal(audio.context.oscillators.length, 3);
});

test('a browser without Web Audio can start and keep its sound preference without errors', t => {
  const { audio } = harness(t);
  delete globalThis.window.AudioContext;
  assert.doesNotThrow(() => { audio.init(); audio.shot(); audio.update(20, true); audio.toggle(); audio.init(); });
  assert.equal(audio.context, null);
  assert.equal(audio.enabled, false);
});
