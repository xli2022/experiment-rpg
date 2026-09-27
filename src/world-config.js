// 121 square kilometres, just below San Francisco's 2020 Census land area.
export const WORLD_LIMIT = 5500;
export const MAP_SPAN = WORLD_LIMIT * 2 + 60;
export const CHUNK_SIZE = 96;
export const METRO_BLOCK_SIZE = 192;

export const OUTER_DISTRICTS = [
  { id: 'sunset', name: 'Sunset Terraces', x: -570, z: 0, color: '#e9b394', description: 'Bay-window terraces, corner cafés and cypress-lined neighborhood streets.' },
  { id: 'cypress', name: 'Cypress Commons', x: -520, z: -510, color: '#9bc99b', description: 'A great urban park threaded with garden lanes and glass conservatories.' },
  { id: 'signal', name: 'Signal Heights', x: 0, z: -580, color: '#bba9e4', description: 'Art deco apartments and slender broadcast towers above the old city.' },
  { id: 'civic', name: 'Civic Campus', x: 510, z: -510, color: '#e4d7ae', description: 'Libraries, research halls and generous tree-lined public squares.' },
  { id: 'foundry', name: 'Foundry Bay', x: 590, z: 0, color: '#cfac82', description: 'Sawtooth factories, freight sheds and workshops on curving industrial avenues.' },
  { id: 'southbank', name: 'Southbank', x: 520, z: 510, color: '#97c4d3', description: 'New apartment blocks, offices and neighborhood markets.' },
  { id: 'promenade', name: 'Bay Promenade', x: 0, z: 620, color: '#8bd5ce', description: 'A long waterfront boulevard, palms, ferry halls and places to watch the water.' },
  { id: 'lantern', name: 'Lantern Ward', x: -520, z: 510, color: '#eba2b8', description: 'Painted row houses, bright shopfronts and pocket gardens.' },
].map(d => ({ ...d, x: Math.round(d.x * 6 / 192) * 192, z: Math.round(d.z * 6 / 192) * 192 }));

export function outerDistrictAt(x, z) {
  // Wards extend from the inner ring to the boundary; compare bearings, not center distances.
  const score = d => (x * d.x + z * d.z) / Math.hypot(d.x, d.z);
  return OUTER_DISTRICTS.reduce((best, d) => score(d) > score(best) ? d : best);
}
