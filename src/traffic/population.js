// Local targets share the same district/quality policy. These are upper bounds;
// sidewalks and road space decide how many actors can actually fit nearby.
const DISTRICT_POPULATION = {
  core: [24, 10, 6, 25],
  citadel: [20, 10, 7, 27],
  'east-reach': [24, 10, 6, 25],
  shadowmarket: [24, 8, 6, 29],
  'west-end': [20, 9, 7, 28],
  stacks: [20, 8, 7, 28],
  southward: [18, 8, 8, 30],
  'ember-heights': [18, 8, 8, 30],
  cut: [20, 6, 7, 32],
  'void-port': [12, 10, 9, 30],
  'north-ridge': [12, 9, 9, 30],
  foundry: [12, 10, 9, 30],
  'silver-delta': [12, 10, 9, 30],
};

export function populationFor(city, player, quality = 'high') {
  const district = city?.masterPlan?.districtAt?.(player.x, player.z)?.id ?? null;
  const [pedestrians, cars, pedestrianSpacing, carSpacing] = DISTRICT_POPULATION[district] ?? [26, 12, 7, 25];
  return {
    district, pedestrianSpacing, carSpacing,
    pedestrians: quality === 'low' ? Math.round(pedestrians * .65) : pedestrians,
    cars: quality === 'low' ? Math.ceil(cars * .6) : cars,
  };
}
