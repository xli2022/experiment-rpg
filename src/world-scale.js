// Keep the planning drawing and its procedural street graph in their authored
// 11 km frame. Only completed layout coordinates enter the compact runtime.
export const CITY_SCALE = .5;
export const AUTHORED_WORLD_LIMIT = 5500;
export const authoredToWorld = (x, z) => ({ x: x * CITY_SCALE, z: z * CITY_SCALE });

const eastpoint = {
  x: (762 - 45) / 952 * 11000 - AUTHORED_WORLD_LIMIT,
  z: (645 - 135) / 980 * 11000 - AUTHORED_WORLD_LIMIT,
};

// Authored Eastpoint templates predate the reference map's shared transform.
export const atEastpoint = (x, z) => authoredToWorld(x + eastpoint.x - 2550, z + eastpoint.z - 600);
