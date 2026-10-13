// A small language model for background residents, run in the player's own
// browser on the graphics card (WebGPU). It stays off until the player turns
// it on in the pause menu; the weights (about 450 MB) then download once from
// Hugging Face into the browser's cache. Story contacts never use it.

export const RESIDENT_CHAT_KEY = 'afterlight.resident-chat.v1';
// Qwen3.5 0.8B in 4 bits. The f16 build needs the GPU's shader-f16 feature.
export const RESIDENT_MODELS = Object.freeze({ f16: 'Qwen3.5-0.8B-q4f16_1-MLC', f32: 'Qwen3.5-0.8B-q4f32_1-MLC' });
// Short, fairly focused replies: a person talking, not an essay.
export const SAMPLING = Object.freeze({ max_tokens: 80, temperature: .7, top_p: .8, presence_penalty: 1.5, frequency_penalty: 0 });

/** Which build this browser can run, or why it can run none. */
export async function detectGPU(gpu, { allowSoftware = false } = {}) {
  if (!gpu?.requestAdapter) return { supported: false, reason: 'this browser has no WebGPU.' };
  let adapter = null;
  try { adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch { /* No adapter. */ }
  if (!adapter) return { supported: false, reason: 'no WebGPU graphics adapter is available.' };
  // A software adapter emulates the GPU on the processor: far too slow to talk.
  if ((adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter) && !allowSoftware) return { supported: false, reason: 'only a software graphics adapter is available.' };
  return { supported: true, model: adapter.features?.has('shader-f16') ? RESIDENT_MODELS.f16 : RESIDENT_MODELS.f32 };
}

function readSettings(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(RESIDENT_CHAT_KEY) ?? 'null');
    return { enabled: saved?.enabled === true, downloaded: saved?.downloaded === true, allowSoftwareGpu: saved?.allowSoftwareGpu === true };
  } catch { return { enabled: false, downloaded: false, allowSoftwareGpu: false }; }
}

// What WebLLM is doing, from its progress text.
const phase = text => /^fetching/i.test(text) ? 'Downloading' : /shader/i.test(text) ? 'Preparing the graphics card' : /^loading/i.test(text) ? 'Loading' : 'Starting';
const reason = error => String(error?.message ?? error ?? 'unknown error').split('\n')[0].slice(0, 160);
// After a lost graphics device (or a hung one) nothing runs until the model loads again.
const deviceLost = error => /device (?:was )?lost|external instance reference|stopped responding|worker stopped/i.test(String(error?.message ?? error));

// Talks to model-worker.js. A request that hears nothing for `stall`
// milliseconds fails, so a hung graphics device cannot hold a reply forever.
function modelWorker() {
  const worker = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' }), pending = new Map();
  let next = 0;
  const failAll = message => { for (const handle of [...pending.values()]) handle({ type: 'error', message }); };
  worker.onmessage = ({ data }) => pending.get(data.id)?.(data);
  worker.onerror = event => { event.preventDefault(); failAll(event.message || 'the model worker stopped.'); };
  return {
    request(type, payload = {}, { onEvent = () => {}, stall = 0 } = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        let timer;
        const arm = () => { if (stall) { clearTimeout(timer); timer = setTimeout(() => finish({ type: 'error', message: 'the model stopped responding.' }), stall); } };
        const finish = data => { clearTimeout(timer); pending.delete(id); if (data.type === 'done') resolve(); else reject(new Error(data.message)); };
        pending.set(id, data => { if (data.type === 'done' || data.type === 'error') finish(data); else { arm(); onEvent(data); } });
        arm(); worker.postMessage({ id, type, ...payload });
      });
    },
    send(type) { worker.postMessage({ type }); },
    // Ending the worker frees the model and its graphics memory at once.
    terminate() { worker.terminate(); failAll('the model was unloaded.'); },
  };
}
async function webLLM(model, onProgress, signal) {
  const worker = modelWorker();
  // Turning the setting off mid-download stops it there.
  signal?.addEventListener('abort', () => worker.terminate(), { once: true });
  try { await worker.request('load', { model }, { onEvent: event => onProgress(event.progress, event.text) }); }
  catch (error) { worker.terminate(); throw error; }
  return {
    generate: (messages, onText) => worker.request('generate', { request: { messages, ...SAMPLING, extra_body: { enable_thinking: false } } }, { onEvent: event => onText(event.text), stall: 60000 }),
    interrupt: () => worker.send('interrupt'),
    unload: async () => worker.terminate(),
  };
}
async function forgetWebLLM() {
  const worker = modelWorker();
  try { await worker.request('forget', { models: Object.values(RESIDENT_MODELS) }); } finally { worker.terminate(); }
}

/**
 * The player's resident-chat setting and the model behind it. Status is
 * `off`, `idle` (on, not loaded yet), `checking`, `loading`, `ready`,
 * `unsupported` or `error`. `backend(model, onProgress, signal)` resolves to
 * `{ generate(messages, onText), interrupt(), unload() }`, and gives up when
 * `signal` aborts; tests pass their own.
 */
export class ResidentModel {
  constructor({ storage, gpu = globalThis.navigator?.gpu, backend = webLLM, forget = forgetWebLLM } = {}) {
    Object.assign(this, { storage, gpu, backend, forgetDownload: forget }, readSettings(storage));
    this.listeners = new Set(); this.engine = null; this.loading = null; this.queue = Promise.resolve(); this.attempt = 0; this.cancel = null;
    this.status = this.enabled ? 'idle' : 'off'; this.progress = 0; this.message = ''; this.model = null;
  }
  get ready() { return this.status === 'ready'; }
  snapshot() { const { enabled, downloaded, status, progress, message, model } = this; return { enabled, downloaded, status, progress, message, model }; }
  subscribe(listener) { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener); }
  update(changes) { Object.assign(this, changes); for (const listener of this.listeners) listener(this.snapshot()); }
  save() {
    const { enabled, downloaded, allowSoftwareGpu } = this;
    try { this.storage?.setItem(RESIDENT_CHAT_KEY, JSON.stringify({ enabled, downloaded, ...(allowSoftwareGpu ? { allowSoftwareGpu } : {}) })); }
    catch { /* The choice lasts for this session. */ }
  }
  setEnabled(enabled) {
    this.enabled = !!enabled; this.save();
    if (this.enabled) return this.load();
    this.unload(); return Promise.resolve(false);
  }
  /** Load the model if the player turned it on. Safe to call again while loading or loaded. */
  load() {
    if (!this.enabled) return Promise.resolve(false);
    if (this.engine) return Promise.resolve(true);
    if (!this.loading) { const loading = this.start().finally(() => { if (this.loading === loading) this.loading = null; }); this.loading = loading; }
    return this.loading;
  }
  async start() {
    const attempt = ++this.attempt, current = () => attempt === this.attempt;
    this.update({ status: 'checking', progress: 0, message: '' });
    const gpu = await detectGPU(this.gpu, { allowSoftware: this.allowSoftwareGpu });
    if (!current()) return false;
    if (!gpu.supported) { this.enabled = false; this.save(); this.update({ status: 'unsupported', message: gpu.reason }); return false; }
    this.update({ status: 'loading', model: gpu.model, message: 'Starting' });
    const cancel = this.cancel = new AbortController();
    try {
      const engine = await this.backend(gpu.model, (progress, text) => { if (current()) this.update({ progress, message: phase(text) }); }, cancel.signal);
      if (!current()) { engine.unload().catch(() => {}); return false; }
      this.engine = engine; this.downloaded = true; this.save();
      this.update({ status: 'ready', progress: 1, message: '' });
      return true;
    } catch (error) {
      if (current()) this.update({ status: 'error', message: reason(error) });
      return false;
    }
  }
  /** Release the model (and cancel a load in progress). */
  unload() {
    this.attempt++; this.loading = null; this.cancel?.abort(); this.cancel = null;
    const engine = this.engine; this.engine = null;
    this.update({ status: this.enabled ? 'idle' : 'off', progress: 0, message: '' });
    return engine?.unload().catch(() => {}) ?? Promise.resolve();
  }
  /** Stream a reply to `messages`; `onText` sees the text so far. Generations run one at a time. */
  generate(messages, { onText = () => {} } = {}) {
    const run = async () => {
      const engine = this.engine;
      if (!engine) throw new Error('The resident model is not loaded.');
      let text = '';
      try { await engine.generate(messages, delta => { text += delta; onText(text); }); }
      catch (error) {
        if (deviceLost(error) && this.engine === engine) { this.engine = null; engine.unload().catch(() => {}); this.update({ status: 'error', message: reason(error) }); }
        throw error;
      }
      return text;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
  /** Stop the reply being written now; it resolves with what it has so far. */
  interrupt() { try { this.engine?.interrupt(); } catch { /* Nothing to stop. */ } }
  /** Turn off and delete the downloaded weights. */
  async forget() {
    this.enabled = false; await this.unload();
    try { await this.forgetDownload(); this.downloaded = false; this.save(); this.update({ message: 'The downloaded model was deleted.' }); }
    catch (error) { this.save(); this.update({ message: `The download could not be deleted: ${reason(error)}` }); }
  }
  dispose() { this.unload(); this.listeners.clear(); }
}
