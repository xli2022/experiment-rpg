// Shared by intent decoding and the simulation.
export const RESIDENT_BEHAVIORS = Object.freeze([
  'follow', 'wait', 'move_aside', 'dance', 'guide', 'go_to', 'lie_down', 'get_up', 'resume_routine',
]);

// Room for the largest resident's resting silhouette and its transition.
export const RESIDENT_REST = Object.freeze({ width: 1.4, length: 2.6, height: .8, duration: 1.2 });
