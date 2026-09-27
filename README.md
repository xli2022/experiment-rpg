# AFTERLIGHT

A playable, original cyberpunk city prototype for desktop and mobile browsers. Built with Three.js and Vite, with a procedural city, characters using CC0 MakeHuman assets, and downloaded CC0 Quaternius animations retargeted in Blender. There are no proprietary game assets or paid runtime services. See [character sources](assets/characters/SOURCES.md) and [animation sources and licensing](assets/animations/quaternius/SOURCES.md).

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev -- --port 5173
```

Open **http://localhost:5173**. Click **Enter the city**.

To play on a phone, connect it to the same Wi-Fi as the computer and open the **Network** URL printed by Vite. The server listens on all interfaces. The computer's firewall must allow the development server on the private network. Landscape is recommended; portrait also works. A public deployment requires serving the `dist` directory over HTTPS.

```sh
npm test           # Simulation and exported character asset checks
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

Explore a 300 × 300 metre district with 16 city blocks, 64 main buildings, a surrounding skyline, pedestrians, neon shopfronts, rain, and street reflections. Eight Archer GT cars can be driven. Take the nearby car to the North Exchange, exit, and disable three rogue drones to complete the first contract. Continue exploring afterward.

| Desktop | Action |
| --- | --- |
| WASD / arrow keys | Move; accelerate, reverse, and steer in a car |
| Mouse | Look while captured; click and drag if pointer capture is unavailable |
| Left mouse | Fire; hold for automatic fire |
| Right mouse | Aim; can be held together with left mouse |
| Shift | Sprint |
| Space | Jump; handbrake in a car |
| E | Enter the nearest car within 4.5 m; exit when moving slowly |
| R | Reload the 24-round magazine; unlimited reserve ammo |
| M | Open/close city map |
| Escape | Pause/resume and release the mouse |

On mobile, move with the left stick, drag the right side to look, and use the on-screen fire, reload, jump/brake, and E buttons. Pushing the stick fully sprints. Touch aiming has a small aim assist. Tap the minimap to open the city map and the top-right settings icon for pause/options.

Sound starts muted; enable it with the speaker button. High quality adds neon bloom; Performance mode reduces render resolution and rain. Mobile selects Performance mode automatically. Health and armor slowly recover out of combat. Defeat returns you to the starting area, and the pause menu has a manual return option.

## Project layout

- `src/main.js` — simulation, camera, combat, vehicles, and mission flow
- `src/city.js` — procedural city, signs, roads, skyline, weather
- `src/models.js` — procedural cars, drones, and shared mesh helpers
- `src/characters.js` — GLB loading, skeletal animation blending, weapon attachment
- `src/crowd.js` — full skeletal pedestrians with authored walk cycles
- `src/input.js` — keyboard/mouse and multi-touch controls
- `src/jump.js` — shared jump arc and authored-animation timing
- `src/physics.js` — collision, vehicle handling, and ray tests
- `src/ui.js` / `src/style.css` — responsive HUD, minimap, and menus
- `src/audio.js` — locally synthesized weapon, vehicle, and interface audio
- `tests/physics.test.js` — simulation regression tests
- `tests/characters.test.js` — exported skinning, authored motion, loop continuity, and runtime blending checks
- `assets/characters/afterlight-characters.blend` — editable character source with packed textures
- `scripts/build_characters.py` — reproducible Blender authoring and export pipeline
- `scripts/retarget_animations.py` — transfers the downloaded animations to the character rig
- `assets/animations/quaternius/` — original animation download, GLBs, and CC0 license
- `public/models/` — self-contained player and crowd GLBs

Vex has anatomical proportions, a textured face, eyes and hair, a utility jacket with folds and normal maps, jeans, gloves, boots, and cybernetic details. The 49-bone rig uses Quaternius Universal Animation Library Standard v3 clips for idle, walking, jogging, sprinting, jump anticipation/flight/landing, pistol stance, recoil, and reloading. Locomotion blends with the upper-body weapon motion; playback follows actual travel speed to reduce foot sliding. The H-9 Ghost machine pistol follows the right hand and fits the downloaded two-handed pistol grip.

Jumping synchronizes takeoff with leg extension and prepares the feet before contact. Outgoing clips hold their sampled pose while fading, and blended boot contact prevents the feet from sinking into the road. Standing landings retain the full recovery; moving characters step back into their gait after impact. Another jump is available after the initial landing recovery.

The 26 pedestrians use the same detailed geometry and complete skeletal walk animations, with varied proportions, colors, timing, and two walk styles. Their faces and clothing silhouette currently share the same base model. Mesh reduction and the old eight-pose crowd animation have been removed in favor of animation quality. Blender is only needed to edit or regenerate the assets; it is not required to run the game.

## Scope and verification

This is the first playable city slice, with arcade vehicle physics and drone combat. It does not yet include building interiors, dialogue trees, inventory, a full RPG campaign, multiplayer, or saved progress. Reloading the page starts a new session. UI fonts use Google Fonts with local system fallbacks; game assets require no external downloads once the application has loaded.

Verified in Chromium with a full desktop mission playthrough, simultaneous aim/fire, reloads, vehicle entry/exit, braking, jumping, map toggling, audio controls, quality switching, and pause. Touch movement, aiming, shooting, reloading, vehicle entry, driving, braking, and exit were checked with real browser touch events; layouts were inspected at 844 × 390 and 390 × 844. Mobile checks are browser emulation, not physical-device performance certification. The production build also passed a separate browser smoke check without runtime errors or development diagnostics. Eight automated simulation tests cover wall tunnelling, sliding, boundaries, blocked exits, forward/reverse/braking, bullet occlusion, and angle wrapping.

Seven additional automated character tests verify embedded textures, skin weights, all 16 exported animation clips, changing joint tracks, seamless locomotion loops, normalized upper/lower body layers, outgoing jump poses, and jump timing at 30/60/120 fps (15 automated tests total). The authored animation update was checked in desktop Chromium and touch emulation for movement, jumps, firing, and reloads; desktop vehicle entry, driving, braking, and exit also passed. The full animation source download is retained locally, so asset rebuilding does not depend on an external animation service.
