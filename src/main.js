import { createGame } from './engine/game.js';
import { MODES } from './modes/index.js';

// Composition root: the engine (world, traffic, player, HUD) hosts one of the
// registered game modes, chosen from the start screen.
const $ = id => document.getElementById(id);
function showError(error) {
  console.error(error); $('loading').classList.add('hidden'); $('error').classList.remove('hidden');
  $('error-message').textContent = error?.message?.includes('WebGL') ? 'This city needs WebGL 2. Enable hardware acceleration or open it in a recent version of Chrome, Edge, Firefox, or Safari.' : `The city could not start: ${error.message || error}`;
}

createGame({ canvas: $('world'), modes: MODES }).then(game => {
  // Read-only diagnostics are exposed only in Vite's development mode.
  if (import.meta.env.DEV) window.__AFTERLIGHT__ = { snapshot: () => game.snapshot() };
}).catch(showError);
