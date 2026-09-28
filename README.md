# AFTERLIGHT: THE LAST SIGNAL

A playable cyberpunk open-world RPG for desktop and mobile browsers. Investigate a blackout that erased thousands of residents from Afterlight’s civic network, meet the people keeping the city alive, and decide who controls its future. Built with Three.js and Vite, with a procedural city, characters using CC0 MakeHuman assets, and downloaded CC0 Quaternius animations retargeted in Blender. There are no proprietary game assets or paid runtime services. See [character sources](assets/characters/SOURCES.md), [animation sources](assets/animations/quaternius/SOURCES.md), and the [story and world guide](docs/STORY.md).

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev -- --port 5173
```

Open **http://localhost:5173**. Click **Enter the city**.

To play on a phone, connect it to the same Wi-Fi as the computer and open the **Network** URL printed by Vite. The server listens on all interfaces. The computer's firewall must allow the development server on the private network. Landscape is recommended; portrait also works. A public deployment requires serving the `dist` directory over HTTPS.

```sh
npm test          # Campaign, economy, saves, simulation and character checks
npm run build     # Production files in dist/
npm run preview   # Serve the production build locally
```

## Deploy master to GitHub Pages

The [deployment workflow](.github/workflows/deploy-pages.yml) runs on pushes to `master`. It installs the locked dependencies, runs the tests, builds the game, and publishes `dist/`. The checked-in GLBs are ready to serve; Blender is not needed in CI.

1. Open [repository Settings → Pages](https://github.com/xli2022/experiment-rpg/settings/pages). Under **Build and deployment**, select **GitHub Actions** as the source.
2. Commit these deployment changes and push `master` to GitHub. Check the **Deploy to GitHub Pages** run in the repository's **Actions** tab. The workflow can also be run manually against `master`.
3. After deployment succeeds, play at **https://xli2022.github.io/experiment-rpg/** (unless you configure a custom domain).

Vite gets `PAGES_BASE_PATH` from the Pages configuration, and the model loader uses Vite's `BASE_URL`. This puts scripts, styles, the favicon, and character models under the correct repository path. Local development defaults to `/`. No additional deployment secret is needed; the workflow uses GitHub's built-in token. See the [official Vite deployment guide](https://vite.dev/guide/static-deploy.html#github-pages).

To preview the Pages path locally in PowerShell:

```powershell
$env:PAGES_BASE_PATH = '/experiment-rpg/'
npm run build
npm run preview
# Open http://localhost:4173/experiment-rpg/
# After stopping preview, restore the local default:
Remove-Item Env:PAGES_BASE_PATH
```

## Play

Explore a **5.5 × 5.5 kilometre city across thirteen districts**, from western hills and dense central neighborhoods to Blackwater Bay. The original street connections, district arrangement and coastline fit within one quarter of the former area. Building heights retain the varied skyline, while closer footprints create downward jumps from taller roofs to nearby lower ones. Start at the Eastpoint hideout and follow the pedestrian ramp south to **Mara on the Upper Market**, four metres above the street. Moving traffic cars can be stopped and taken over for longer journeys.

- **Six campaign chapters, two evidence paths, and three playable endings.** Meet eight named contacts, ask about their lives, accept local work, and make the final broadcast.
- **A varied, voiced cast.** Women, men and a nonbinary gardener have individual facial shapes, builds, skin tones, hairstyles, outfits, portraits and personalities. A pool of up to twenty-six pedestrians draws from sixteen visual archetypes: twelve human designs, a walking service robot, a utility mech, and two alien variants. Active counts follow district, quality and available space. Every named contact has personal conversation topics, characteristic job replies and individual reactions to all three endings.
- **Seven side stories and a repeatable delivery contract.** Recover medical supplies, repair irrigation, reunite a family, rebuild radios, reclaim stolen freight, collect memories, and survey the city. Multiple quests can be active together; track one in the journal.
- **Vertical exploration.** Most building walls can be climbed, including rotated facades. Ascend, descend, shimmy, jump away and pull onto clear rooftops. A parachute automatically opens during long falls, slowing your descent while you steer toward a roof or street. Walkable ramps connect the Upper Market, Citadel concourse and Stacks terrace gardens; equipment and taller penthouses add rooftop obstacles.
- **Neighborhood variety.** Buildings face real streets, with district-specific towers, residential slabs, terraces, markets, factories and warehouses. Every building carries a street-facing sign matched to its use, from neon shops to residential nameplates and freight depots. Textured non-road ground, facade details and street furniture distinguish neighborhoods while leaving roads clear.
- **Exploration with rewards.** Discover districts, recover eight written memory fragments, search twelve salvage caches, and clear five drone patrol groups. Cleared patrols stay cleared, including after loading a save.
- **Equipment and supplies.** Buy medkits from Imani, Orrin or Rook. Rook installs three tiers each of weapon damage, armor and sprint upgrades in exchange for credits and salvage. Neighborhood trust earns discounts; the final choice changes patrol behavior or community prices.
- **Nineteen transit stops and two refuges.** Discover a stop on foot, then select it on the map to take the tram. Travel requires leaving your car and escaping combat. Refuges restore health, armor and ammo and set your return point.
- **Automatic browser saves.** Quests, choices, inventory, upgrades, reputation, discoveries, patrol clears and position persist. Health and ammo refill on loading; acquired cars do not persist between sessions. Saves from older city layouts return to the remapped refuge while retaining campaign progress. A blocked or full browser store produces a visible warning. Start over through the pause menu’s explicit new-story confirmation.

| Desktop | Action |
| --- | --- |
| WASD / arrow keys | Move; accelerate, reverse, and steer in a car |
| Mouse | Look while captured; click and drag if pointer capture is unavailable |
| Left mouse | Fire; hold for automatic fire |
| Right mouse | Aim; can be held together with left mouse |
| Shift / Alt | Sprint / walk; default movement is a brisk jog |
| C | Grab or release a nearby wall; WASD climbs up/down and sideways |
| Space | Jump; grab a wall ahead; jump away while climbing; handbrake in a car |
| E | Talk, use terminals, collect items, rest, or enter/exit a nearby car |
| R | Reload the 24-round magazine; unlimited reserve ammo |
| J | Open/close the field journal: quests, inventory, contacts and memories |
| Q | Use a field medkit (+60 health) |
| M | Open/close city map |
| Escape | Pause/resume and release the mouse |

Jogging is 5.8 m/s, sprinting starts at 10.8 m/s, deliberate walking is 2.4 m/s, and aiming moves at 2.6 m/s. Acceleration, braking and animation playback follow actual movement. Climbing is 3.4 m/s, or 5.1 m/s with Shift, with no stamina limit; keep moving up to pull onto an unobstructed roof. Rooftop position persists in saves. Loading a save made while hanging on a wall resumes falling.

Your reusable parachute opens automatically after a 12 m drop from the highest point of a fall or jump. It inflates over 0.55 seconds and slows descent to 5 m/s. Short jumps keep their usual arc. Use the normal movement controls to steer; weapons stay stowed while gliding, and landing or grabbing a wall packs the canopy away. No extra button or equipment purchase is needed.

On mobile, move with the left stick and look by dragging the open right side of the screen. The buttons at the bottom right provide fire, reload, jump/brake, and use/exit. Pushing the movement stick fully sprints. Movement, drag-look and the action buttons support simultaneous touches and reset when a menu opens or the app loses focus. A CLIMB button appears beside reachable walls and becomes LET GO while hanging; the movement stick controls ascent, descent and sideways movement, and the jump button pushes away. The climb panel shows height and progress to the roof. Touch aiming has a small aim assist. Tap the minimap for the map, the notebook icon for the journal, or the medkit count to heal. Dialogue choices and all journal/shop actions support touch.

The top-right full-screen button expands the game and its interface together, requesting hidden browser controls where supported. Browsers that block direct fullscreen show Home Screen instructions instead of a disabled button. On iPhone, use Safari’s Share → Add to Home Screen, keep Open as Web App enabled if offered, and launch Afterlight from its icon. A web app manifest and Apple metadata support launching without browser bars; the operating system may retain its status bar or home indicator. The Home Screen app may use separate save storage from Safari. This does not add offline support.

The city map supports dragging and zooming within the city boundary; Entire city centers the complete map. Mobile layouts account for portrait, landscape and screen safe areas, with the full map fitting within the landscape popup.

Sound effects default to on and begin when you start playing; the speaker button mutes or unmutes them. **Spoken NPC dialogue starts enabled**, using the browser’s available English voices with per-character voice selection, pitch and pacing. Conversations have Replay and Voice on/off controls, and settings include a separate voice volume slider. Voice preferences persist independently of your story. Subtitles always remain visible. Selecting another response, leaving a conversation or hiding the page cancels playback. A missing or blocked speech service shows a message and leaves every dialogue choice usable. Device voices and quality vary; this is synthesized speech, not recorded voice acting. The game uses the [Web Speech synthesis API](https://webaudio.github.io/web-speech-api/#tts-section), needs no microphone or API key, and the browser may use local or network speech services.

Traffic cars can be taken over: hit one three times to stop it, then approach and press **E** (or **USE** on touch) to drive. There are no designated parked cars. Pedestrian and traffic targets vary with the district, available street space and graphics quality.

High quality adds neon bloom; Performance mode uses shorter scenery/detail distances, fewer animated actors and rain particles, and a lower resolution cap. Mobile selects Performance mode automatically, and resolution adapts to sustained frame pressure. Scenery loads in nearby and visible cells, with distant instance buffers released as you travel. The map supports drag-to-pan, zoom buttons, and neighborhood/city views. See [city scale, rendering research and measured results](docs/CITY-RENDERING.md).

Health and armor slowly recover out of combat. Defeat returns you to your last refuge without erasing quest progress. Menus and conversations pause the world. Map destination lines indicate a bearing, not an obstacle-avoiding driving route.

## Project layout

- `src/main.js` — simulation, camera, combat, vehicles, interactions and persistence integration
- `src/content.js` — authored districts, contacts, quests, items, encounters and endings
- `src/campaign.js` — renderer-independent quest/economy engine and validated versioned saves
- `src/dialogue.js` — branching conversations, quest replies and final decisions
- `src/world.js` — interactable objects and named NPCs, plus retained legacy landmarks
- `src/rpg-ui.js` / `src/rpg.css` — journal, conversations, shops, transit map and ending panels
- `src/master-plan.js` / `src/world-scale.js` — compact runtime terrain, roads and shared coordinate transform
- `src/authored-plan.js` / `src/neighborhood-plan.js` / `src/infill-plan.js` — original road graph, district streets and connected infill
- `src/vertical-city.js` — current city geometry, street-facing buildings, raised spaces and collision
- `src/building-signs.js` — building-specific tenants, street-facing placement and shared neon sign atlas
- `src/infrastructure-clearance.js` / `src/wayfinding.js` — shared rendered slab volumes and bridge-safe wayfinding placement
- `src/city.js` / `src/city-scenery.js` — shared batching, signs, scenery materials and retained legacy city helpers
- `src/city-plan.js` / `src/metropolis.js` — retained legacy downtown and regional generation
- `src/world-stream.js` — spatial streaming, detail levels and quality budgets
- `src/population.js` / `src/traffic.js` — district population targets, NPC road traffic and vehicle takeovers
- `src/spatial-grid.js` / `src/world-config.js` — collision broad phase and metropolitan scale
- `src/models.js` — procedural cars, drones, and shared mesh helpers
- `src/characters.js` — GLB loading, skeletal animation blending, weapon attachment
- `src/crowd.js` — full skeletal pedestrians with authored walk cycles
- `src/npc-profiles.js` / `src/npc-appearance.js` — cast and crowd designs, fitted geometry, bone-attached wardrobe, individual idle poses and rendered portraits
- `src/npc-visitors.js` — imported robot and alien pedestrians, independent native rigs, size and facing normalization
- `src/npc-materials.js` — animated-surface clothing finishes, necklines, makeup and scars
- `src/npc-shape.js` / `src/npc-head-shape.js` — shared CC0 facial deformation field and fitting of eyes/accessories
- `src/voice.js` — speech synthesis, automatic cast, cancellation, recovery and saved voice preferences
- `src/npc.css` — portrait and voice-control layouts
- `src/input.js` — keyboard/mouse and multi-touch controls
- `src/jump.js` — shared jump arc and authored-animation timing
- `src/physics.js` — oriented collision, height-aware movement, vehicle handling, and ray tests
- `src/locomotion.js` / `src/climbing.js` / `src/climb-animation.js` — responsive movement, wall traversal and procedural hand/foot IK
- `src/architecture.js` / `src/public-spaces.js` — shared structural geometry for rendering and collision, and neighborhood public spaces
- `src/ui.js` / `src/style.css` — responsive HUD, minimap, and menus
- `src/mobile.css` — touch controls and title/HUD layouts for compact screens
- `src/audio.js` — locally synthesized weapon, vehicle, and interface audio
- `tests/physics.test.js` — simulation regression tests
- `tests/campaign.test.js` — all campaign branches, side quests, economy, persistence and content integrity
- `tests/characters.test.js` — exported skinning, authored motion, loop continuity, and runtime blending checks
- `tests/npc.test.js` / `tests/voice.test.js` — character diversity, source/rig integrity, accessory fitting, personalities and speech lifecycle checks
- `assets/characters/afterlight-characters.blend` — editable character source with packed textures
- `scripts/build_characters.py` — reproducible Blender authoring and export pipeline
- `scripts/build_visitors.py` — exports the downloaded Quaternius robot and alien models with their native idle and movement animations
- `scripts/retarget_animations.py` — transfers the downloaded animations to the character rig
- `assets/animations/quaternius/` — original animation download, GLBs, and CC0 license
- `public/models/` — self-contained player and crowd GLBs

Vex has anatomical proportions, a textured face, eyes and hair, a utility jacket with folds and normal maps, jeans, gloves, boots, and cybernetic details. The 49-bone rig uses Quaternius Universal Animation Library Standard v3 clips for idle, walking, jogging, sprinting, jump anticipation/flight/landing, pistol stance, recoil, and reloading. Locomotion blends with the upper-body weapon motion; playback follows actual travel speed to reduce foot sliding. The H-9 Ghost machine pistol follows the right hand and fits the downloaded two-handed pistol grip.

Jumping synchronizes takeoff with leg extension and prepares the feet before contact. Outgoing clips hold their sampled pose while fading, and blended boot contact prevents the feet from sinking into the road. Standing landings retain the full recovery; moving characters step back into their gait after impact. Another jump is available after the initial landing recovery.

The human pedestrian pool uses the detailed source rig and complete skeletal walk animations, with twelve variants of faces, builds, clothing and hair, varied timing, and two walk styles. Named contacts have seven bespoke combinations of those features. Runtime geometry fitting changes the face, waist, hips, shoulders and garment volume while preserving skin weights. Original hair, beards, glasses, hats and occupational accessories follow the head/chest/hip bones. Cached shapes and merged wardrobe parts limit duplicated work. The player’s original model is unchanged. Blender is only needed to edit or regenerate the base assets; it is not required to run the game. Run `node scripts/build_npc_shapes.mjs` to regenerate the facial field from bundled source data.

Four downloaded [Quaternius CC0 robot and alien models](assets/characters/quaternius/SOURCES.md) join the street crowd: a service robot, a utility mech, an alien resident, and a helmeted alien traveler. Their native skeletal animations are retained, with separate skeletons and playback phases for every instance. Models are fitted to pedestrian height and facing, and interleaved early in the pool so both quality settings include nonhuman residents. These actors share the existing population and navigation budgets; named story contacts retain their designs. The self-contained GLBs load locally from `public/models/visitors/`; unavailable visitor files fall back to human pedestrians. Run `scripts/build_visitors.py` with Blender 4.5 to rebuild them from the preserved sources.

The adult women have fitted leather, tailoring and cropped jackets, with individual makeup, jewelry and poses. Rook’s optical implant, arm brace and brass bird and Orrin’s braided beard, long coat and compass connect to new optional stories about their pasts. Their local quests unlock personal follow-ups. The People journal shows the updated portraits, descriptions and biographies.

## Scope and verification

This remains a browser-scale RPG: exterior exploration, arcade vehicles, voiced text dialogue and drone combat. Buildings are scenery. Humans share a common animated rig; robots and aliens use their source rigs. Speech has no lip synchronization or prerecorded performances. There is no multiplayer. Saves are local to this browser and origin, not synchronized across devices. UI fonts use Google Fonts with system fallbacks; game assets load locally.

The automated suite covers traversal, city generation, campaign state and characters. Traversal checks include prompt acceleration/braking, rotated wall and roof collision, climbing and mantling at 30/60/120 FPS, blocked ledges, cancelling a mantle without getting stuck, raised-surface landings, jump-off/roof falls, the actual skeletal climbing pose, and rooftop saves. City tests cover connected roads, sloped support, building/road clearance, street-facing geometry, bounded streaming, district populations and traffic takeovers. Arrival checks include cars blocking tram and refuge destinations. Input and physics regressions cover popup focus restoration, held menu keys, cancelled touch gestures, vehicle exits at every heading, and cars blocking weapon fire. Campaign tests walk all six combinations of evidence and ending choices, reload between chapters, complete every side story, verify delivery replay and rewards, validate saves and handle storage failures, and check equipment, consumables and waypoint elevation. Character tests load the exported citizen rig and verify immutable source geometry, distinct faces, finite shapes, accessory attachment, separate animation skeletons, stable individual poses and optional personal-story branches. Speech tests cover chunked delivery, interruption, replay, late voice discovery, mute/volume persistence, blocked playback and stalled engines.

Earlier browser verification covered the first chapter, driving, save continuation, workshop purchases, fast travel, story choices and journal/map layouts at desktop and phone sizes. Those checks predate the current city layout; current road, building and traversal validation is described in [CITY-RENDERING.md](docs/CITY-RENDERING.md). Mobile verification uses browser emulation, not a physical-device performance certification. Production compilation can use `npm run build -- --configLoader runner` in Windows environments that restrict esbuild’s ancestor-directory access.

The geometry regression suite scans all 900 city blocks with the live story reservations. It checks building and interchange signs against rendered bridge solids, all 63 interactable labels across camera angles, tree crowns against buildings and infrastructure, supported streetlights, and rail clearance at curved road joins. The title layout uses a bounded content area, with two columns on short landscape screens and gameplay readouts hidden until play. With Playwright available, run `node scripts/check_mobile_layout.mjs` against the dev server (`LAYOUT_URL` overrides its default `http://127.0.0.1:5174`; `PLAYWRIGHT_MODULE` can select an existing installation). It checks 38 title/HUD layouts using fallback fonts and saves screenshots in `test-results/mobile-layout/`.

NPC/voice verification inspected all seven cast models and their portraits, opened Mara and Rook conversations, accepted a job, exercised replay/mute/exit, reloaded saved voice preferences, and checked portrait (390 × 844) and landscape (844 × 390) layouts. The production build loaded without console errors and omitted development diagnostics. The test browser initially reported speech playback starting, then its native service returned `synthesis-failed`, including for standalone default-voice utterances outside the game. Error fallback was verified; reliable audible playback and voice quality still require checking on the target device.

The fashion and personal-story update was inspected in an animated cast gallery and the production game. Rook’s nested topic menu and brass-bird reply were checked at desktop and 390 × 844 phone sizes, with no horizontal overflow, quest advancement or console warnings/errors. Browser audio was muted for that separate visual check.
