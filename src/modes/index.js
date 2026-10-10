import freeRoam from './free-roam/index.js';
import story from './story/index.js';

/**
 * Registered game modes, in picker order. The first is the default until a
 * mode has been played in this browser. A mode is a plain object:
 *
 *   { id, title, tagline, description, accent,
 *     saveSummary(storage) → string | null,          // shown on the picker card
 *     async create(host, { fresh }) → instance }      // fresh = start over
 *
 * The instance may implement any of: spawn(), welcome(), update(dt, frame),
 * interactable(player), interactHint(), objective(), mapMarkers({ player, expanded }),
 * districtKnown(id), mapOpened(), mapPick(x, y), onAction(name), onMenu(),
 * onVehicleImpact(speed), sprintSpeed(), hud(frame), safeSpot(), save({ position, time }),
 * snapshot(), dispose(). See docs/MODES.md and the free-roam mode for a minimal example.
 */
export const MODES = [freeRoam, story];
