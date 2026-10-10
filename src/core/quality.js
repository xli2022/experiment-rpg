// Shared quality budgets. Streaming, actors, renderer and weather read
// RENDER_PROFILES; the throttled moon shadow map reads SHADOW_PROFILES.
export const RENDER_PROFILES = {
  high: { far: 510, detail: 135, actors: 65, dpr: 1.5, minScale: .7, rain: 1100, budget: 2.5 },
  low: { far: 340, detail: 85, actors: 42, dpr: 1, minScale: .65, rain: 250, budget: 1.5 },
};
export const SHADOW_PROFILES = {
  high: { radius: 72, size: 2048, hz: 20, casters: 100 },
  low: { radius: 48, size: 1024, hz: 10, casters: 72 },
};
