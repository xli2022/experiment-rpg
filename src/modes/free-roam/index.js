import { WORLD_REVISION } from '../../world/world-config.js';

// Free roam is the smallest complete game mode and a template for new ones:
// it owns a save slot, a HUD panel and map markers, and uses only the engine
// host (world, player, HUD, storage). No quests, enemies or weapon.
const SAVE_KEY = 'afterlight.free-roam.v1';

function readProgress(storage) {
  try {
    const save = JSON.parse(storage.getItem(SAVE_KEY));
    if (!save || save.version !== 1) return null;
    const ids = list => Array.isArray(list) ? [...new Set(list.filter(id => typeof id === 'string'))] : [];
    const p = save.position, valid = p && [p.x, p.y, p.z].every(Number.isFinite) && save.worldRevision === WORLD_REVISION;
    return { position: valid ? { x: p.x, y: p.y, z: p.z } : null, time: Number.isFinite(save.time) ? Math.max(0, save.time) : 0, districts: ids(save.districts), buildings: ids(save.buildings) };
  } catch { return null; }
}

export default {
  id: 'free-roam',
  title: 'Free roam',
  tagline: 'SANDBOX / NO MISSIONS',
  description: 'Just the city. Walk, climb, glide and drive anywhere, step into any building and ride its lifts, or borrow a car stopped at a red light.',
  accent: '#7ee6e3',
  saveSummary(storage) {
    const progress = readProgress(storage);
    return progress && `${progress.districts.length} districts · ${progress.buildings.length} buildings entered`;
  },
  async create(host, { fresh = false } = {}) {
    const { world, storage } = host, you = host.player;
    const progress = (!fresh && readProgress(storage)) || { position: null, time: 0, districts: [], buildings: [] };
    const districts = new Set(progress.districts), buildings = new Set(progress.buildings);
    host.clock.time = progress.time;
    const panel = document.createElement('section');
    panel.className = 'roam-panel';
    panel.innerHTML = '<div class="eyebrow"><span class="diamond"></span> FREE ROAM</div><p><b id="roam-districts">0</b> / ' + world.districts.length + ' districts &nbsp;·&nbsp; <b id="roam-buildings">0</b> buildings entered</p>';
    host.hud.mount(panel);
    host.ui.legend('<span>T STATION</span>');
    const stations = world.landmarks.filter(p => p.station);
    return {
      label: 'FREE ROAM',
      spawn() { return progress.position && you.canStandAt(progress.position) ? progress.position : world.spawn; },
      welcome: () => 'FREE ROAM // The city is yours. Enter any door; press E beside a stopped car to drive.',
      update() {
        const p = you.state;
        districts.add(world.districtAt(p.x, p.z).id);
        if (p.interior?.inside) buildings.add(p.interior.id);
      },
      mapMarkers: () => stations.map(p => ({ x: p.x, z: p.z, color: '#7ee6e3', symbol: 'T', radius: 2.5 })),
      districtKnown: id => districts.has(id),
      hud() {
        panel.querySelector('#roam-districts').textContent = districts.size;
        panel.querySelector('#roam-buildings').textContent = buildings.size;
      },
      save({ position, time }) {
        try { storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, worldRevision: WORLD_REVISION, position, time, districts: [...districts], buildings: [...buildings] })); } catch { /* Session-only when storage is blocked. */ }
      },
      snapshot: () => ({ roam: { districts: districts.size, buildings: buildings.size } }),
      dispose() {},
    };
  },
};
