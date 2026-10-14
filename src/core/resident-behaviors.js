// Shared by intent decoding and the simulation.
export const RESIDENT_BEHAVIORS = Object.freeze([
  'follow', 'wait', 'move_aside', 'dance', 'guide', 'go_to', 'sit_down', 'get_up', 'resume_routine',
]);

// Room for the largest resident's seated silhouette and its transition.
export const RESIDENT_SIT = Object.freeze({ width: 1.4, length: 1.6, height: 1.7, duration: 1.2 });
