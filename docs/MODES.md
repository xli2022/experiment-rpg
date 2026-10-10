# Game modes

Afterlight is a city engine that hosts plug-in game modes. The engine owns everything that stays the same between games:

- the static city ([`src/world/`](../src/world/index.js))
- living streets ([`src/traffic/`](../src/traffic/index.js))
- the player on foot, climbing, gliding and driving
- the camera, HUD, map and menus
- saving cadence, and an optional weapon

A mode adds the game on top: goals, rules, characters, its own HUD panels and its own save slot. Two modes ship:

| Mode | Source | What it shows |
| --- | --- | --- |
| **The Last Signal** | [`src/modes/story/`](../src/modes/story/index.js) | The full RPG: six chapters, contacts and dialogue, quests, drones, the weapon, shops, the journal and endings. See [STORY.md](STORY.md). |
| **Free roam** | [`src/modes/free-roam/index.js`](../src/modes/free-roam/index.js) | The smallest complete mode, about 60 lines: a save slot, a HUD panel and map markers. No quests and no weapon. |

Each registered mode gets a card on the start screen, with its title, tagline, description and save summary, plus **Continue** (or **Start**) and **New game**. The last mode played is preselected. **Change mode** in the pause menu saves, disposes the current mode and returns to the cards without reloading the page.

## Adding a mode

1. Create `src/modes/<id>/index.js` with a default-exported definition.
2. Add it to `MODES` in [`src/modes/index.js`](../src/modes/index.js). Picker order follows the array.

A mode imports from `core`, `world`, `actors` and the engine helpers it needs, but **never from another mode**. The engine never imports a mode. [`tests/module-layers.test.js`](../tests/module-layers.test.js) enforces both rules.

### Definition

```js
export default {
  id: 'courier',                       // stable: used for the last-played key
  title: 'Night courier',
  tagline: 'TIMED / DELIVERIES',
  description: 'Race parcels across the districts before the drones notice.',
  accent: '#ff9e5e',                   // card and button colour
  saveSummary(storage) { /* → 'Best run 4:12' or null when there is no save */ },
  async create(host, { fresh }) { /* → mode instance; fresh means New game */ },
};
```

`create` runs once per session of the mode. It may be async, for example to lazy-load CSS: the story does `await import('./npc.css')`, which keeps Node tests free of CSS imports.

### Instance hooks

Every hook is optional. The engine calls them as follows.

| Hook | Called | Purpose |
| --- | --- | --- |
| `spawn()` | After `create` | Starting spot `{ x, y, z, yaw?, cameraYaw? }`. Defaults to `world.spawn`. |
| `welcome()` | After spawning | Notification text. |
| `label` | Every HUD update | Mode name in the status line. |
| `update(dt, { now, time, player, driving, camera })` | Every unpaused frame | The game's simulation. |
| `hud({ player, goal, time })` | About 12 times a second | Refresh the mode's panels. |
| `interactable(player)` | Every HUD update and on E | `{ caption, label, use() }` for the nearest usable thing, or `null`. |
| `interactHint()` | E with nothing nearby | Help text. |
| `objective()` | Every frame | Waypoint `{ x, y, z, label, text, hidden? }` or `null`. |
| `mapMarkers({ player, expanded })` | Map draws | `[{ x, z, color, symbol?, radius?, dim? }]` |
| `districtKnown(id)` | Map draws | Fog for undiscovered districts. |
| `mapOpened()`, `mapPick(x, y)` | Map opened, map clicked | Select places on the full map. |
| `onAction(name)` | J (`'journal'`) and Q (`'medkit'`) | Mode actions on fixed keys. |
| `onMenu(id)` | A menu opens or the page hides | Pause speech, close dialogue, and so on. |
| `onVehicleImpact(speed)` | The player's car hits something | Damage, for example. |
| `sprintSpeed()` | Each movement step | Sprint upgrades. |
| `safeSpot()` | Saving while driving with no clear exit | Fallback save position. |
| `save({ position, time })` | Every 12 s, on menus, mode changes and page hide | Write your save slot. |
| `snapshot()` | Dev diagnostics | Merged into `window.__AFTERLIGHT__.snapshot()`. |
| `dispose()` | Change mode | Release anything not registered through the host. |

### The host

`create(host)` receives the engine API. Everything mounted or registered through the host is removed automatically when the mode is disposed.

| Area | Members |
| --- | --- |
| Rendering | `THREE`, `scene`, `camera`, `renderer`, `assets` (character GLBs), `actorRange()` |
| World | `world`: the static city. Landmarks, districts, terrain and surface heights, buildings, interiors and spatial collision. See [CITY-RENDERING.md](CITY-RENDERING.md#modules-and-apis). |
| Traffic | `traffic`: cars, pedestrians, signals, `owned` cars, `hijackable()`, `takeOver()`, `hit()`. |
| Player | `player.state` (position, velocity and interior), `driving`, `cameraYaw`, `character`, `teleport(spot, { cameraYaw, cameraPitch, playerYaw, cut })`, `spawnNear(point)`, `canStandAt(point)`, `groundAt(x, z)`, `colliders(x, z, r)`, `scenery()`, `allCars()`, `releaseVehicles()`, `exitPoint()` |
| HUD | `hud.notify(text, seconds)`, `hud.mount(element)` |
| UI | `ui.open(id, handler)`, `ui.close()`, `ui.panel({ kicker, title, html, onAction })`, `ui.register(id, closeKey)`, `ui.menu(items, settingsElement)` (pause menu buttons), `ui.legend(html)` (map legend), `ui.mapSidebar(element)`, `ui.controls(html)` (extra control rows), `ui.openMap()` |
| Combat | `weapon.enable({ damage(), targets() })`, where targets are spheres `{ position, radius, hit(amount, point) }`; also `weapon.disable()` and `weapon.refill()`. A shot also stops traffic cars: three hits hand one to the player. |
| Effects | `effects` (tracers, sparks, hit markers), `audio`, `shadows.addCasters(root)`, `shadows.addDynamic(root)`, `contactShadows.add(source)` |
| State | `storage` (a `localStorage` that tolerates blocked storage), `state`, `clock.time` (the in-game time of day), `save()` |

Use your own storage key, and include `WORLD_REVISION` from [`world-config.js`](../src/world/world-config.js) so saves from an older city layout drop their coordinates. The story keeps its original `afterlight.last-signal.v1` save; Free roam uses `afterlight.free-roam.v1`.

## Worked example: Free roam

[`free-roam/index.js`](../src/modes/free-roam/index.js) shows the whole contract in miniature:

- **Save slot.** `readProgress` validates its own JSON (`version`, `worldRevision`, finite coordinates, unique ID lists). `saveSummary` turns it into the card text, for example *“5 districts · 12 buildings entered”*. `save()` writes it back.
- **New game.** `create(host, { fresh })` ignores the save when `fresh` is true, and restores the time of day through `host.clock.time`.
- **HUD.** It builds one small panel and gives it to `host.hud.mount`. `hud()` refreshes the two counters; no cleanup code is needed.
- **Map.** `ui.legend` adds a *T station* key. `mapMarkers()` returns every transit station from `world.landmarks`, and `districtKnown()` reveals districts as they are visited.
- **Simulation.** `update()` reads `you.state` (`host.player`): the district at the player's position and the building they are inside.
- **Spawning.** `spawn()` resumes the saved spot when `you.canStandAt` still accepts it, otherwise `world.spawn`.

It never enables the weapon, so the player is unarmed and the weapon panel is hidden. Traffic still runs: pressing E beside a car waiting at a light takes it over. That is engine behaviour, available to every mode.

A timed courier mode would add little to this:

```js
async create(host) {
  const drops = host.world.landmarks.filter(p => p.station), pick = () => drops[Math.floor(Math.random() * drops.length)];
  let target = pick(), clock = 90;
  return {
    label: 'COURIER',
    objective: () => ({ ...target, label: 'DROP POINT', text: `Deliver in ${Math.ceil(clock)} s` }),
    update(dt, { player }) {
      clock -= dt;
      if (Math.hypot(player.x - target.x, player.z - target.z) < 6) { host.hud.notify('Delivered!', 2); target = pick(); clock = 90; }
      else if (clock <= 0) { host.hud.notify('Too late. New parcel.', 3); target = pick(); clock = 90; }
    },
  };
}
```
