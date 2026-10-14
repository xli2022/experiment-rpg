// Shared by intent decoding and the simulation.
export const RESIDENT_BEHAVIORS = Object.freeze([
  'follow', 'wait', 'dance', 'guide', 'go_to', 'sit_down', 'get_up', 'resume_routine',
]);

// A request is a short plan: up to RESIDENT_PLAN_STEPS steps, each ending
// on its own (arriving, sitting, getting home), after a duration from
// RESIDENT_STEP_SECONDS, or when one of RESIDENT_STEP_ENDS happens.
export const RESIDENT_PLAN_STEPS = 4;
export const RESIDENT_STEP_ENDS = Object.freeze(['', 'player_returns', 'player_leaves', 'player_stops', 'place']);
export const RESIDENT_STEP_SECONDS = Object.freeze([0, 10, 30, 60, 120, 300]);

// Room for the largest resident's seated silhouette and its transition.
export const RESIDENT_SIT = Object.freeze({ width: 1.4, length: 1.6, height: 1.7, duration: 1.2 });
