// Heights are metres above the foundation, before small roof fixtures. Each
// district samples around its explicit mean; building use never overrides it.
export const SKYSCRAPER_HEIGHT = 100;
export const BUILDING_FOOTPRINTS = Object.freeze(['rectangle', 'circle', 'hexagon']);
const profile = (footprint, averageHeight, spread) => Object.freeze({
  footprint, averageHeight, heightRange: Object.freeze([averageHeight - spread, averageHeight + spread]),
  skyscrapers: averageHeight + spread >= SKYSCRAPER_HEIGHT,
});
export const DISTRICT_ARCHITECTURE = Object.freeze({
  core: profile('mixed', 114, 106),
  citadel: profile('hexagon', 140, 60),
  'east-reach': profile('circle', 88, 64),
  'void-port': profile('rectangle', 18, 8),
  stacks: profile('circle', 102, 54),
  'north-ridge': profile('rectangle', 30, 16),
  'ember-heights': profile('hexagon', 26, 14),
  'west-end': profile('rectangle', 44, 26),
  shadowmarket: profile('hexagon', 19, 11),
  cut: profile('rectangle', 14, 6),
  southward: profile('circle', 32, 18),
  foundry: profile('rectangle', 28, 14),
  'silver-delta': profile('circle', 20, 8),
});

export function sampleArchitecture(districtId, random) {
  const profile = DISTRICT_ARCHITECTURE[districtId];
  if (!profile) throw new Error(`Missing architecture for district ${districtId}`);
  const footprint = profile.footprint === 'mixed'
    ? BUILDING_FOOTPRINTS[Math.floor(random() * BUILDING_FOOTPRINTS.length)] : profile.footprint;
  // Core deliberately spans the entire skyline evenly. Elsewhere a triangular
  // distribution clusters buildings near their district's average height.
  const t = profile.footprint === 'mixed' ? random() : (random() + random()) / 2;
  const [low, high] = profile.heightRange;
  return { footprint, h: low + (high - low) * t };
}

export function buildingUseAtHeight(type, h) {
  if ((type === 'market' && h > 26) || (type === 'terrace' && h > 38)) return 'apartment';
  if (type === 'warehouse' && h > 30) return 'factory';
  return type;
}
