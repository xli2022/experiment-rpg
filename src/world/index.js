import { WorldStream } from './world-stream.js';
import { createVerticalCity } from './vertical-city.js';
import { createInteriors } from './interiors.js';
import { createAtmosphere } from './atmosphere.js';
import { AFTERLIGHT_LANDMARKS } from './landmarks.js';
import { MASTER_DISTRICTS, districtAt, terrainHeight, isWater, SHOWCASE } from './master-plan.js';
import { WORLD_LIMIT, CHUNK_SIZE } from './world-config.js';

export { AFTERLIGHT_LANDMARKS, landmarkById, roadside } from './landmarks.js';
export { WORLD_LIMIT, CHUNK_SIZE } from './world-config.js';

/**
 * The static Afterlight city as one reusable module: terrain, roads, decks,
 * streamed buildings with walkable interiors, vegetation, signs, sky, lights
 * and weather, plus the queries gameplay and traffic need. It never imports
 * traffic, the engine runtime or any game mode.
 *
 * `landmarks` are sites the city keeps clear; the default set makes the
 * layout identical for every mode.
 */
export function createWorld({ scene, renderer = null, quality = 'high', landmarks = AFTERLIGHT_LANDMARKS } = {}) {
  const stream = new WorldStream(scene);
  const city = createVerticalCity(scene, stream, landmarks);
  const atmosphere = createAtmosphere(scene, { renderer, quality });
  const interiors = createInteriors(scene, city);
  const byId = new Map(landmarks.map(p => [p.id, p]));
  const spawn = Object.freeze({ ...SHOWCASE.spawn, y: terrainHeight(SHOWCASE.spawn.x, SHOWCASE.spawn.z), yaw: SHOWCASE.cameraYaw, pitch: SHOWCASE.cameraPitch });
  stream.setQuality(quality);
  return {
    // Compatibility with modules written against the city object.
    ...city,
    limit: WORLD_LIMIT, chunkSize: CHUNK_SIZE, districts: MASTER_DISTRICTS, districtAt, isWater,
    stream, atmosphere, interiors, landmarks, spawn,
    landmark: id => byId.get(id) ?? null,
    buildingsNear: (x, z, radius = 1) => city.metropolis.buildingsNear(x, z, radius),
    /** Per frame: weather and interiors follow `focus` (no interiors are built while `driving`); streaming follows the camera view. */
    update({ camera, focus, interior = null, now, dt = 0, paused = false, force = false, driving = false }) {
      if (!paused) { atmosphere.update({ camera, focus, interior, dt }); interiors.update(focus, interior, now, dt, { build: !driving }); }
      else atmosphere.sky.position.copy(camera.position);
      stream.update(camera, focus, now, force);
    },
    setQuality(value, { far } = {}) { stream.setQuality(value); atmosphere.setQuality(value, far); },
    snapshot: () => ({ streaming: { ...stream.stats }, blueprints: city.metropolis.blocks.size, interiors: interiors.snapshot() }),
    dispose() { interiors.dispose(); atmosphere.dispose(); stream.dispose(); city.dispose(); },
  };
}
