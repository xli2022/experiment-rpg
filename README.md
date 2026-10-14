# AFTERLIGHT: THE LAST SIGNAL

A cyberpunk open city for desktop and mobile browsers, with plug-in game modes. **Free roam**, the default, is the city with no missions. **The Last Signal** is a playable RPG: investigate a blackout that erased thousands of residents from Afterlight’s civic network, meet the people keeping the city alive, and decide who controls its future. New modes reuse the city, its traffic and the player; see [game modes](docs/MODES.md). Built with Three.js and Vite, with a procedural city, characters using CC0 MakeHuman assets, and downloaded CC0 Quaternius animations retargeted in Blender. There are no proprietary game assets or paid runtime services. See [character sources](assets/characters/SOURCES.md), [animation sources](assets/animations/quaternius/SOURCES.md), and the [story and world guide](docs/STORY.md).

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev -- --port 5173
```

Open **http://localhost:5173**. Choose a mode on the start screen: **Free roam** (preselected the first time) or **The Last Signal**. After that, the mode you last played is preselected. Each card shows its save and offers Continue or New game; **Change mode** in the pause menu returns to the cards.

To play on a phone, connect it to the same Wi-Fi as the computer and open the **Network** URL printed by Vite. The server listens on all interfaces. The computer's firewall must allow the development server on the private network. Landscape is recommended; portrait also works. A public deployment requires serving the `dist` directory over HTTPS.

```sh
npm test          # Campaign, saves, traffic simulation, city and character checks
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

Explore a **5.5 × 5.5 kilometre city across thirteen districts**, from western hills and dense central neighborhoods to Blackwater Bay. The original street connections, district arrangement and coastline fit within one quarter of the former area. Buildings keep their full authored size, 26–49 m across, lined up along each street with narrow side passages, so taller roofs offer downward jumps to nearby lower ones. In the story, start at the Eastpoint hideout and follow the pedestrian ramp south to **Mara on the Upper Market**, four metres above the street. In any mode, step up to a car waiting at a red light and press **E** to drive it.

- **Living streets.** Cars keep their lanes, queue at two-phase traffic lights, give way at quiet junctions, wait for people on crosswalks, and signal and brake visibly. Pedestrians walk the sidewalks, wait for the walk signal, and stop to talk, check a phone, stroll in pairs or jog. Indoors, people sit on sofas and at desks, browse shops, wait for the lift and staff the lobbies. See [traffic](docs/CITY-RENDERING.md#traffic) and [people inside](docs/CITY-RENDERING.md#people-inside).
- **Talk to residents (optional, AI).** Turn on *Talk with residents* in the pause menu, then face any passer-by or person indoors and press E. They answer in a few lines written live by a small open language model running in your browser, with a name, job, mood and worry of their own and the place and hour they are in. Story contacts keep their written dialogue. See [resident conversations](#resident-conversations).
- **Free roam.** No quests, enemies or weapon: explore, climb, glide, drive and enter buildings. Its panel counts the districts visited and buildings entered, and the map shows transit stations. Free roam keeps its own save, separate from the story.

- **Six campaign chapters, two evidence paths, and three playable endings.** Meet eight named contacts, ask about their lives, accept local work, and make the final broadcast.
- **A varied, voiced cast.** Women, men and a nonbinary gardener have individual facial shapes, builds, skin tones, hairstyles, outfits, portraits and personalities. A reusable pool contains twenty-eight visual archetypes: twenty human designs (ten men and ten women), four robots and four aliens. Active counts follow district, quality and available space. Every named contact has personal conversation topics, characteristic job replies and individual reactions to all three endings.
- **Seven side stories and a repeatable delivery contract.** Recover medical supplies, repair irrigation, reunite a family, rebuild radios, reclaim stolen freight, collect memories, and survey the city. Multiple quests can be active together; track one in the journal.
- **Vertical exploration.** Most building walls can be climbed, including rotated facades. Ascend, descend, shimmy, jump away and pull onto clear rooftops. A parachute automatically opens during long falls, slowing your descent while you steer toward a roof or street. Walkable ramps connect the Upper Market, Citadel concourse and Stacks terrace gardens; equipment and taller penthouses add rooftop obstacles.
- **Enterable buildings.** Walk through any street door into a procedurally generated interior: lobbies, shops, open-plan offices, warehouse halls and apartments with living rooms, bedrooms and bathrooms. Wide switchback stairs connect every floor, and towers taller than three storeys add a lift (E to choose a floor). Windows look out on the real city. Any window can be shot, or smashed from inside (E). Jump at a window from inside to vault over the sill and drop out, smashing the glass if it is whole; a broken window into a room can also be climbed in through. Units and rooms have stable IDs, ready for residents and evidence later. See [interiors](docs/CITY-RENDERING.md#interiors).
- **Neighborhood variety.** Each region has a consistent rectangular, circular or hexagonal footprint and its own average building height, from low neighborhoods to skyscraper districts. Afterlight Core mixes all three shapes and the full height range. Stepped towers, balcony blocks, row houses, civic halls and industrial sheds retain varied finishes, mostly-lit or mostly-dark random windows, roof gardens and street-facing tenant signs. See the [district architecture settings](docs/CITY-RENDERING.md#district-architecture).
- **Greener neighborhoods.** Clustered broadleaf trees, slender evergreens, flowering shrubs and grass beds fill suitable open spaces. Residential districts get denser planting, freight districts stay sparser, and roof gardens and public planters have fuller foliage. Roads, entrances and story destinations stay clear.
- **Exploration with rewards.** Discover districts, recover eight written memory fragments, search twelve salvage caches, and clear five drone patrol groups. Cleared patrols stay cleared, including after loading a save.
- **Equipment and supplies.** Buy medkits from Imani, Orrin or Rook. Rook installs three tiers each of weapon damage, armor and sprint upgrades in exchange for credits and salvage. Neighborhood trust earns discounts; the final choice changes patrol behavior or community prices.
- **Nineteen transit stops and two refuges.** Discover a stop on foot, then select it on the map to take the tram. Travel requires leaving your car and escaping combat. Refuges restore health, armor and ammo and set your return point.
- **Automatic browser saves.** Quests, choices, inventory, upgrades, reputation, discoveries, patrol clears and position persist. Health and ammo refill on loading; acquired cars do not persist between sessions. Saves from older city layouts return to the remapped refuge while retaining campaign progress. A blocked or full browser store produces a visible warning. Start over through the pause menu’s explicit new-story confirmation.

| Desktop | Action |
| --- | --- |
| WASD / arrow keys | Move; accelerate, reverse, and steer in a car |
| Mouse | Look while captured; click and drag if pointer capture is unavailable |
| Left mouse | Fire (story); hold for automatic fire |
| Right mouse | Aim; can be held together with left mouse |
| Shift / Alt | Sprint / walk; default movement is a brisk jog |
| Space | Jump; vault out through a window ahead; grab a wall ahead; jump away while climbing; handbrake in a car |
| E | Talk to contacts (and to residents, with resident conversations on), use terminals, collect items, rest, use a lift, enter/exit a nearby car, take a car waiting in traffic, or smash a window in arm's reach from inside; otherwise grab a nearby wall, and let go while climbing. WASD climbs up/down and sideways |
| R | Reload the 24-round magazine; unlimited reserve ammo |
| J | Open/close the field journal (story): quests, inventory, contacts and memories |
| Q | Use a field medkit (story, +60 health) |
| M | Open/close city map |
| Escape | Pause/resume and release the mouse |

Jogging is 5.8 m/s, sprinting starts at 10.8 m/s, deliberate walking is 2.4 m/s, and aiming moves at 2.6 m/s. Acceleration, braking and animation playback follow actual movement. Climbing is 3.4 m/s, or 5.1 m/s with Shift, with no stamina limit; keep moving up to pull onto an unobstructed roof. Rooftop position persists in saves. Loading a save made while hanging on a wall resumes falling.

Your reusable parachute opens automatically after a 12 m drop from the highest point of a fall or jump. It inflates over 0.55 seconds and slows descent to 5 m/s. Short jumps keep their usual arc. Use the normal movement controls to steer; weapons stay stowed while gliding, and landing or grabbing a wall packs the canopy away. No extra button or equipment purchase is needed.

On mobile, move with the left stick and look by dragging the open right side of the screen. The buttons at the bottom right provide fire, reload, jump/brake, and use/climb/exit. Pushing the movement stick fully sprints. Movement, drag-look and the action buttons support simultaneous touches and reset when a menu opens or the app loses focus. USE grabs a reachable wall and becomes LET GO while hanging; the movement stick controls ascent, descent and sideways movement, and the jump button pushes away. The climb panel shows height and progress to the roof. Touch aiming has a small aim assist. Tap the minimap for the map, the notebook icon for the journal, or the medkit count to heal. Dialogue choices and all journal/shop actions support touch.

The top-right full-screen button expands the game and its interface together, requesting hidden browser controls where supported. Browsers that block direct fullscreen show Home Screen instructions instead of a disabled button. On iPhone, use Safari’s Share → Add to Home Screen, keep Open as Web App enabled if offered, and launch Afterlight from its icon. A web app manifest and Apple metadata support launching without browser bars; the operating system may retain its status bar or home indicator. The Home Screen app may use separate save storage from Safari. This does not add offline support.

The city map supports dragging and zooming within the city boundary; Entire city centers the complete map. Mobile layouts account for portrait, landscape and screen safe areas, with the full map fitting within the landscape popup.

Sound effects default to on and begin when you start playing; the speaker button mutes or unmutes them. **Spoken NPC dialogue starts enabled**, for story contacts and for residents you talk to, using the browser’s available English voices with per-character voice selection, pitch and pacing. Conversations have Replay and Voice on/off controls, and the pause menu has the spoken-dialogue settings, with a separate voice volume slider, in every mode. Voice preferences persist independently of your story. Subtitles always remain visible. Selecting another response, leaving a conversation or hiding the page cancels playback. A missing or blocked speech service shows a message and leaves every dialogue choice usable. Device voices and quality vary; this is synthesized speech, not recorded voice acting. The game uses the [Web Speech synthesis API](https://webaudio.github.io/web-speech-api/#tts-section), needs no microphone or API key, and the browser may use local or network speech services.

To borrow a car, walk up to one that is stopped or crawling in traffic and press **E** (or **USE** on touch). In the story you can also hit a moving car three times to stop it. There are no designated parked cars. Pedestrian and traffic targets vary with the district, available street space and graphics quality.

High quality adds neon bloom; Performance mode uses shorter scenery/detail distances, fewer animated actors and rain particles, and a lower resolution cap. Mobile selects Performance mode automatically, and resolution adapts to sustained frame pressure. Scenery loads in nearby and visible cells, with distant instance buffers released as you travel. The map supports drag-to-pan, zoom buttons, and neighborhood/city views. See [city scale, rendering research and measured results](docs/CITY-RENDERING.md).

Health and armor slowly recover out of combat. Defeat returns you to your last refuge without erasing quest progress. Menus and story conversations pause the world; resident conversations keep the city running. Map destination lines indicate a bearing, not an obstacle-avoiding driving route.

### Resident conversations

Background residents, the people on the street and inside buildings, can talk when **Talk with residents (AI)** is turned on in the pause menu. It is off by default. The model is **Qwen3.5 2B** (4-bit, Apache-2.0): about 1.1 GB to download and 2.6 GB of graphics memory. Turning the setting on downloads it once from Hugging Face into the browser's cache. WebLLM loads it onto the graphics card in a worker, so play carries on meanwhile. Previous 0.8B settings now load 2B, and both retired 0.8B builds are deleted from the cache when loading. Every graphics card uses the build that computes in 32-bit floats, since the old 16-bit build produced broken tokens on some devices. The model must pass a short text check before residents can use it. The pause menu shows progress, and a notice says when residents are ready. It needs WebGPU on a hardware graphics card, as in current desktop Chrome or Edge. Elsewhere the setting explains why it is unavailable. Phones and tablets may not have the memory.

Face a passer-by or someone indoors within about 2.5 m and press **E** (**USE** on touch). The prompt names their job. Opening chat waits for you to type and send the first message; residents only reply after you speak. The city keeps moving while you talk. Their name and reply appear in a speech bubble anchored above the character, styled like the rest of the city HUD. A compact input bar contains just the message field (up to 140 characters), **Send**, and **Bye** to finish the conversation. On desktop, click the world to use movement and drag-look while chatting; typing stays in the input. Escape, E outside the input, walking away, or opening a menu also finishes the conversation. The resident pauses to listen, except while finishing a street crossing; the rest of the world continues. Touch movement and look controls remain available. Each resident's name, job, mood, worry and manner are seeded from their own ID, so the same person stays the same person. They know their district, what they are doing (crossing the street, working a shop counter, waiting for the lift), the hour, the rain and the available nearby destinations. Robots and aliens speak as themselves. Replies are trimmed to one to three spoken sentences. An unusable reply, such as one that steps out of character or has broken tokens, and any failure become a short fallback line. A reply that slips into another language is kept. Replies are written on your device; nothing you type leaves the browser. Residents speak their lines aloud with a voice of their own: a preferred device voice, different people starting from different ones, with pitch and pace set by build and age. Robots and aliens speak well above or below the crowd. Voice on/off and volume are in the pause menu; saying something new or leaving stops the speech. Story contacts and quests never use the model, and come first when you press E near them. **Delete the downloaded resident model** in the pause menu turns the setting off and removes the current and retired model downloads.

With **Qwen3.5 2B**, ask a resident to **dance**, **sit down** (or **take a seat**), **get up**, **guide me to a destination**, **go to a destination**, **follow me**, **wait here**, **move aside**, or **go back to your routine**, in your own words. After the request checks described below, the model selects an action with a short schema-constrained JSON decision, separate from the character dialogue; only a complete, valid decision can request a supported action for the person you are talking to. The prompt gives paraphrases and distinguishes commands from negation, quoted commands and questions about an activity; interpretation is probabilistic, so some wording may need rephrasing. Ordinary conversation chooses no action. The game checks the request and supplies the spoken acknowledgement, so an impossible move is not announced as completed. Raw JSON is never displayed or spoken. An accepted request is acknowledged in the speech bubble and queued until the conversation ends. A later accepted request replaces it; ordinary chat leaves it queued. Incomplete, malformed or cancelled output never changes an activity.

**Dance** loops an articulated pose for humans, robots and aliens until another request. **Sit down** folds into a seated pose on clear, level floor space and stays in place; residents already in a chair or on a bench remain seated. **Get up** stands from the floor or leaves a seat and waits. A movement or dance request first gets a seated resident to their feet. **Wait** preserves a seated posture. **Guide me to…** leads along a checked walking route and pauses when you fall behind; **go to…** sends the resident independently and leaves them waiting on arrival. Destinations come from real nearby storefronts and tram stations outdoors, or the current floor’s exit/elevator indoors. Ask about nearby places to learn the available names. Routing is limited to local destinations within 120 m on roughly the same level; these commands do not plan multi-floor elevator or stair journeys. The model selects a known destination ID, never arbitrary coordinates, and unavailable or blocked routes are rejected.

Small request checks run before model classification for explicit removed commands (lie down, wave, cheer, come here and face me) and common requests that omit the destination. These match the whole request, with optional polite wording, so they do not intercept quoted commands or discussion. Removed commands remain conversation; an unspecified destination gets a request for a place name. Neither replaces an already accepted action.

Actions start only after the conversation finishes. The game rechecks the queued request then, so a vanished resident or newly blocked step cannot be acted on using an old decision. Leaving mid-reply cancels that unfinished response; an already accepted request can still start. Followers walk after your footsteps with personal space, through building entrances and up or down stairs. They can take the elevator after you, waiting for room in the car before arriving. They wait if you drive, jump or get too far away, and stop at blocked paths. People at desks, sofas and benches stand up to follow or move aside when there is room to leave their seat. Move aside finds a clear nearby spot and waits there. Returning to routine retraces the resident's route, including stairs, entrances and reverse elevator trips, to their original position and facing before restoring normal walking or indoor activity. Someone who was seated returns to that exact seat and sits down again; if the seat is blocked, they wait for it to clear. Residents keep their identity and starting place when their home floor unloads or they go out of view during the session. Changing mode, a scene cut or reloading resets these interactions; they are not part of the save yet.

## Project layout

Sources are layered, and each layer imports only those before it: `core` → `world` → `traffic` → `engine` → `modes`. `actors` is shared by traffic, the engine and modes. [`tests/module-layers.test.js`](tests/module-layers.test.js) enforces this.

- `src/main.js` — composition root: creates the engine with the registered modes
- `src/core/` — renderer-independent physics, collision geometry, spawn search, spatial grid, mesh helpers and quality budgets
- `src/world/` — the static city behind `createWorld()`:
  - `master-plan.js` / `authored-plan.js` / `neighborhood-plan.js` / `infill-plan.js` — terrain, the road graph, district streets and infill
  - `vertical-city.js` / `world-stream.js` — buildings, decks, collision and streamed instancing
  - `building-*.js` / `district-architecture.js` / `vegetation.js` / `wayfinding.js` — architecture, signs, planting and labels
  - `interior-plan.js` / `interior-physics.js` / `interiors.js` — enterable interiors
  - `view-cutaway.js` — fading whatever stands between the camera and the player
  - `atmosphere.js` — sky, lights, fog and rain
  - `landmarks.js` — the fixed sites every mode can use
- `src/traffic/` — living streets behind `createTraffic()`:
  - `network.js` — road graph, lanes, turn connectors, crosswalks and sidewalks
  - `signals.js` — signal timing and its props
  - `vehicles.js` — car agents and the instanced fleet
  - `pedestrians.js` — walkers and the avatar pool
  - `occupants.js` — people inside buildings, on the interior floors standing near the player
  - `population.js` — district budgets
  - `car-model.js` — the procedural car
- `src/actors/` — NPC rigs, appearance, wardrobe, visitors, grounding and speed-aware animation, shared by traffic, the engine and modes
- `src/engine/` — the runtime every mode shares:
  - `game.js` — loop, mode host and picker flow
  - `player/` — characters, locomotion, jumping, climbing and parachute
  - `camera-rig.js` — the third-person follow camera
  - `hud.js` / `ui.js` / `mode-picker.js` / `map-controls.js` — HUD, map, menus and mode cards
  - `weapon.js` / `effects.js` — the optional weapon, tracers and sparks
  - `residents/` — optional AI conversations with background residents: `persona.js` (who each resident is, the prompt and reply cleanup), `model.js` / `model-worker.js` (the setting and the in-browser model) `conversation.js` (the panel and turn-taking), and `decisions.js` (the bounded JSON action protocol)
  - `voice.js` — spoken dialogue for story contacts and residents, shared through the host
  - `input.js`, `audio.js`, `clock.js`, `shadows.js`, `contact-shadows.js`, `save.js` and `fullscreen.js`
  - `style.css` / `ui.css` / `mobile.css` — styles
- `src/modes/index.js` — the mode registry; see [game modes](docs/MODES.md)
- `src/modes/story/` — The Last Signal:
  - `campaign.js` — quest and economy engine with versioned saves
  - `content.js` — contacts, quests, items and endings on landmark positions
  - `dialogue.js` — conversations, spoken through the engine's `voice.js`
  - `rpg-ui.js` / `hud.js` — journal, shops, map sidebar and story panels
  - `world-life.js` / `drones.js` — contacts in the city, and patrols
- `src/modes/free-roam/` — Free roam, the minimal example mode
- `src/tools/` — the development character studio
- `tests/` — Node test suites, one per area
- `assets/characters/afterlight-characters.blend` — editable character source with packed textures
- `scripts/build_characters.py` — original player/citizen Blender authoring and export pipeline
- `scripts/build_human_bases.py` — distinct female casual/tailored and male utility body/garment meshes, packed textures and retargeted motion
- `scripts/build_visitors.py` / `scripts/visitor_surfaces.py` — author equipment variants, UVs and embedded PBR atlases in Blender, then export and reimport-check native animations
- `tools/characters.html` / `scripts/check_characters.mjs` — development character studio and browser texture/pose audit
- `scripts/retarget_animations.py` — transfers the downloaded animations to the character rig
- `assets/animations/quaternius/` — original animation download, GLBs, and CC0 license
- `public/models/` — self-contained player and crowd GLBs

Vex has anatomical proportions, a textured face, eyes and hair, a utility jacket with folds and normal maps, jeans, gloves, boots, and cybernetic details. The 49-bone rig uses Quaternius Universal Animation Library Standard v3 clips for idle, walking, jogging, sprinting, jump anticipation/flight/landing, pistol stance, recoil, and reloading. Locomotion blends with the upper-body weapon motion; playback follows actual travel speed to reduce foot sliding. The H-9 Ghost machine pistol follows the right hand and fits the downloaded two-handed pistol grip.

Jumping synchronizes takeoff with leg extension and prepares the feet before contact. Outgoing clips hold their sampled pose while fading, and blended boot contact prevents the feet from sinking into the road. Standing landings retain the full recovery; moving characters step back into their gait after impact. Another jump is available after the initial landing recovery.

The human pedestrian pool uses four distinct base meshes: the original male utility jacket, a broad male worker in overalls and a short-sleeve shirt, a female casual shirt-and-jeans model, and a fuller female tailored blouse-and-skirt model. The three additional bases are assembled in Blender from the CC0 body data with three separate authored CC0 garment meshes and fitted footwear; they do not reuse the original jacket mesh. Five resident designs use each base, giving ten men and ten women, with varied faces, builds, hair, timing and two walk styles. Named contacts have seven bespoke combinations of those features. Runtime geometry fitting changes the face, waist, hips, shoulders and garment volume while preserving skin weights. Original hair, beards, glasses, hats and occupational accessories follow the head/chest/hip bones. Cached shapes and merged wardrobe parts limit duplicated work. The player retains the original mesh and receives matching leather, metal and skin surface finishes. Blender is only needed to edit or regenerate the base assets; it is not required to run the game. Run `node scripts/build_npc_shapes.mjs` to regenerate the facial field from bundled source data.

Eight archetypes built from four preserved [Quaternius CC0 robot and alien sources](assets/characters/quaternius/SOURCES.md) join the street crowd: a service robot, utility mech, cargo courier, district sentinel, alien resident, atmospheric traveler, ceremonial envoy and crested navigator. New bone-attached equipment changes their silhouettes; padded UV atlases embed color, normal and roughness/metallic maps in every export. Their native skeletal animations are retained, with separate skeletons and playback phases for every instance. Models are fitted to pedestrian height and facing, and interleaved early in the pool so both quality settings include nonhuman residents. These actors share the existing population and navigation budgets; named story contacts retain their designs. The self-contained GLBs load locally from `public/models/visitors/`; unavailable visitor files fall back to human pedestrians. Run `scripts/build_visitors.py` with Blender 4.5 or newer to rebuild them from the preserved sources (verified with 5.0.1). The build needs NumPy in Blender’s Python environment; it performs no asset downloads. The eight visitor GLBs total approximately 13.2 MB.

New human residents include an airship pilot, market tailor, transit officer, dock loader, night watch, skyline runner, botanical trader and signal technician. Braids, ponytails, high fades and receding hairlines join the existing styles; rounded coat, utility, pilot and vendor pieces have shared color, normal and roughness maps. The original skin and clothing atlases remain, with corrected complexion tinting and filtered fabric detail. Pedestrians blend to idle when stopped, match gait timing to actual travel and turn before walking in the opposite direction. Human and visitor foot contact follows the animated soles. Long airborne player motion continues looping, while takeoff and landing remain one-shot transitions.

To inspect the assets during development, start Vite and open **`/tools/characters.html`**. The character studio offers a direct comparison of the four human bases, every design, all available clips, playback speed, turntable/orbit controls, and neutral or city lighting. It is separate from the production game bundle. With Playwright available, run `node scripts/check_characters.mjs`; `CHARACTERS_URL` changes the dev-server URL, `PLAYWRIGHT_MODULE` selects an existing installation, and `CHROME_PATH` optionally selects a browser executable. It checks decoded textures, UV presence, actual base-model routing, the balanced human roster and finite posed geometry across all 36 designs plus four neutral base previews, then loads the city, and saves screenshots and results under `test-results/characters/`.

The named women wear distinct fitted shirts or tailored blouses and skirts, with individual makeup, jewelry and poses. Rook’s optical implant, arm brace and brass bird and Orrin’s braided beard, long coat and compass connect to new optional stories about their pasts. Their local quests unlock personal follow-ups. The People journal shows the updated portraits, descriptions and biographies.

## Scope and verification

This remains a browser-scale game: open-city exploration, enterable procedural interiors, arcade vehicles, voiced text dialogue, optional AI-written small talk with residents and drone combat. Humans share a common animated rig; robots and aliens use their source rigs. Speech has no lip synchronization or prerecorded performances. There is no multiplayer. Saves are local to this browser and origin, not synchronized across devices. UI fonts use Google Fonts with system fallbacks; game assets load locally. The optional resident model downloads from Hugging Face only when the player turns resident conversations on.

The automated suite covers traversal, city generation, campaign state and characters. Traversal checks include prompt acceleration/braking, rotated wall and roof collision, climbing and mantling at 30/60/120 FPS, blocked ledges, cancelling a mantle without getting stuck, raised-surface landings, jump-off/roof falls, the actual skeletal climbing pose, and rooftop saves. City tests cover connected roads, sloped support, building/road clearance, street-facing geometry, bounded streaming and district populations. Traffic tests build the city's junction network and check:

- signal phases
- a five-minute drive with no collisions or red-light entries
- crosswalk yielding
- pedestrians keeping to sidewalks and walk signals
- headroom: no car or person passing beneath a bridge, ramp or deck too low to clear
- car takeovers

Arrival checks include cars blocking tram and refuge destinations. Input and physics regressions cover popup focus restoration, held menu keys, cancelled touch gestures, vehicle exits at every heading, and cars blocking weapon fire. Campaign tests walk all six combinations of evidence and ending choices, reload between chapters, complete every side story, verify delivery replay and rewards, validate saves and handle storage failures, and check equipment, consumables and waypoint elevation. Character tests load the exported citizen rig and verify immutable source geometry, distinct faces, finite shapes, accessory attachment, separate animation skeletons, stable individual poses and optional personal-story branches. Speech tests cover chunked delivery, interruption, replay, late voice discovery, mute/volume persistence, blocked playback and stalled engines.

Earlier browser verification covered the first chapter, driving, save continuation, workshop purchases, fast travel, story choices and journal/map layouts at desktop and phone sizes. Those checks predate the current city layout; current road, building and traversal validation is described in [CITY-RENDERING.md](docs/CITY-RENDERING.md). Mobile verification uses browser emulation, not a physical-device performance certification. Production compilation can use `npm run build -- --configLoader runner` in Windows environments that restrict esbuild’s ancestor-directory access.

The geometry regression suite scans all 900 city blocks with the live story reservations. It checks building and interchange signs against rendered bridge solids, all 63 interactable labels across camera angles, tree crowns against buildings and infrastructure, supported streetlights, and rail clearance at curved road joins. `tests/world-geometry.test.js` checks every building against every other building, road, deck, pier, embankment and piece of street furniture. It also checks that lamps stay out of buildings and door walkways, that footways stay clear of posts and railings, and that low raised roads stand on embankments. The title layout uses a bounded content area, with two columns on short landscape screens and gameplay readouts hidden until play. With Playwright available, run `node scripts/check_mobile_layout.mjs` against the dev server (`LAYOUT_URL` overrides its default `http://127.0.0.1:5174`; `PLAYWRIGHT_MODULE` can select an existing installation). It renders the real mode cards and each mode's HUD panels, checks 57 title and HUD layouts (19 viewports, each with the title, Story and Free roam) using fallback fonts, and saves screenshots in `test-results/mobile-layout/`.

NPC/voice verification inspected all seven cast models and their portraits, opened Mara and Rook conversations, accepted a job, exercised replay/mute/exit, reloaded saved voice preferences, and checked portrait (390 × 844) and landscape (844 × 390) layouts. The production build loaded without console errors and omitted development diagnostics. The test browser initially reported speech playback starting, then its native service returned `synthesis-failed`, including for standalone default-voice utterances outside the game. Error fallback was verified; reliable audible playback and voice quality still require checking on the target device.

Resident conversations are covered by `tests/residents.test.js` with a stand-in model. The tests cover seeded personas for every crowd and visitor design and for real interior spots, the brief, reply cleanup and who can be talked to. They cover the setting: opting in, migrating old model choices to 2B, browsers without WebGPU, a failed load, the check of a newly loaded model, turning it off mid-download, a lost graphics device and deleting the download. They also cover the conversation flow and residents' seeded voices, including which lines are spoken. Earlier headless Chromium checks, before the compact conversation UI, used a stand-in model and covered:

- the setting's progress and ready notice;
- the Talk prompt in front of a passer-by, in free roam and in the story;
- the panel, the quick lines and typing (E, M and J typed into the field stay text);
- Escape interrupting a reply;
- residents speaking each reply in their own voice, with a recording stand-in for the browser's speech service; Replay, Voice on/off, leaving cancelling speech, and Mara still speaking with her own voice through the shared one;
- Mara's written dialogue taking precedence beside her;
- portrait (390 × 844) and landscape (844 × 390) layouts.

There were no console errors in that conversation check. Its indoor coverage used Node against real interior plans; the later seated-action browser check is described below. WebLLM downloaded and loaded the real model in that browser on a software graphics adapter, but the adapter crashed on the first reply. In headless Chrome on Linux with an RTX 3080 Ti (Vulkan, no shader-f16), the real 32-bit build passed its check and answered 60 lines for four residents in readable English, in about 1–2 s each; an adapter reporting shader-f16 got the same build. Earlier checks of both model sizes passed there; 2B took 22 s with its download and 3–4 s from the cache. Only 2B is now offered. The 16-bit build's broken tokens were reported on Mac or Windows and could not be reproduced on that machine, and the 32-bit build still needs checking there.

Resident actions are covered by `tests/resident-actions.test.js`: following and returning around obstacles, collision and ledge checks, waiting, paused time, holding only the conversational resident, queued action replacement and cancellation, actor identity, population recycling, indoor collision bodies and floor streaming, invalid or cancelled JSON, and inference-option forwarding. Run `node scripts/check_resident_actions.mjs` with Playwright available (`PLAYWRIGHT_MODULE` can point at an existing installation); `CHROME_PATH` selects Chrome and `RESIDENT_URL` selects the dev server. Set `RESIDENT_TOUCH=1` to include active touch controls, `RESIDENT_REAL=1` to use the actual Qwen3.5 2B model, or `RESIDENT_HEADED=1` to open a visible Chrome window. The visible Linux configuration uses OpenGL for WebGL and Vulkan for WebGPU, avoiding the WebGL 2 failure seen with Vulkan-only visible surfaces on NVIDIA. The script keeps its test browser cache under `test-results/resident-actions/`.

`tests/resident-travel.test.js` exercises the production navigation against real building geometry: entrances, two switchback storeys and the complete return walk across building layouts; elevators and blocked arrival spaces; current-floor visibility; an indoor resident following outside and returning to the original upper-floor activity after floors unload; and interrupting a return after taking a lift. The resident's original position, facing and identity are preserved, and the collision body moves vertically with the actor.

The expanded action tests cover dance, sitting down and getting up, preserving posture while waiting, seated floor clearance, local destination routing, independent travel, guide catch-up distance, blocked paths and destination arguments surviving queued conversations. Human and visitor tests check the actual exported rigs for pose restoration, grounding and seated footprint. `node scripts/check_resident_functions.mjs` renders all four human bases and eight visitors; `RESIDENT_REAL=1` also checks 43 command cases with the real Qwen worker (36 model classifications and seven request checks), including sitting paraphrases and rejection of the removed lying-down action. It uses the same Playwright, Chrome and server environment variables as the action script, with results in `test-results/resident-actions/`. A separate desktop/touch UI check verified silent opening, player-first replies and cancellation after close/reopen.

`tests/resident-seats.test.js` covers desk, sofa and bench residents standing up only after an accepted request is committed, following and waiting, returning to their exact seat and original activity, blocked exits and occupied seats, interrupted returns, and a round trip by elevator with the home floor unloaded. Seat transitions restore the original collision shape and blend seated and standing poses; `tests/npc-animation.test.js` checks the animation weights. A live Chrome check with the real character assets and a stand-in decision model also exercised a desk, sofa and bench resident through the conversation form: each stayed seated while follow was queued, stood after Bye, walked toward the player, and returned to the exact seat and original activity after the routine request. Screenshots confirmed the standing and restored seated poses, with no browser console errors.

Before the expanded action set, a Linux check with an RTX 3080 Ti and the Qwen3.5 2B q4f32 build classified all 21 test messages correctly, including paraphrases, negation, ordinary dialogue, quoted commands and unsupported requests. The JSON decisions took 0.81–1.03 seconds each in the isolated intent check. The original four actions were then exercised through the conversation form in the real city: following moved the resident, waiting held their position, moving aside ended in a wait, and returning restored their routine. The live conversation check confirmed advancing world time, movement while chatting, typing without movement, a queued request leaving the current activity unchanged, and the request starting after Bye. A separate touch run exercised all four actions, walk-away and Escape endings, and portrait (390 × 844) and landscape (844 × 390) layouts with unobstructed movement controls and speech. Both runs had no browser console errors. This is a small regression set, not a guarantee of correct interpretation of arbitrary language. Completed decisions are validated before execution; Qwen's empty non-thinking wrapper is removed before JSON parsing.

The fashion and personal-story update was inspected in an animated cast gallery and the production game. Rook’s nested topic menu and brass-bird reply were checked at desktop and 390 × 844 phone sizes, with no horizontal overflow, quest advancement or console warnings/errors. Browser audio was muted for that separate visual check.
