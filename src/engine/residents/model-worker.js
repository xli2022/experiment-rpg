// Runs the resident language model off the game's thread (see model.js). Each
// request carries an id; the answer is progress or text events, then `done`
// or `error`. Only this worker loads WebLLM.
import { CreateMLCEngine, deleteModelAllInfoInCache } from '@mlc-ai/web-llm';

let engine = null;
const handlers = {
  async load({ id, model }) { engine = await CreateMLCEngine(model, { initProgressCallback: ({ progress, text }) => self.postMessage({ id, type: 'progress', progress, text }) }); },
  async generate({ id, request }) {
    const chunks = await engine.chat.completions.create({ ...request, stream: true });
    for await (const chunk of chunks) { const text = chunk.choices[0]?.delta?.content; if (text) self.postMessage({ id, type: 'text', text }); }
  },
  async interrupt() { engine?.interruptGenerate(); },
  async forget({ models }) { for (const model of models) await deleteModelAllInfoInCache(model); },
};
self.onmessage = async ({ data }) => {
  try { await handlers[data.type]?.(data); if (data.id) self.postMessage({ id: data.id, type: 'done' }); }
  catch (error) { if (data.id) self.postMessage({ id: data.id, type: 'error', message: String(error?.message ?? error) }); }
};
