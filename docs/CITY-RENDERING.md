# Metropolitan Vesper: scale and rendering

The playable square is **11,000 × 11,000 metres (121 km²)**, roughly 386 times the previous 560 × 560 metre area. San Francisco's 2020 Census land area is 46.91 square miles, approximately 121.5 km²; the playable boundary stays below that cap. This is a fictional city inspired by terraces, parks and mixed urban neighborhoods, rather than a geographic recreation. [US Census QuickFacts](https://www.census.gov/quickfacts/fact/csv/sanfranciscocitycalifornia/LND110220)

The shared building system generates **34,279 buildings** across the original downtown and expanded neighborhoods, plus the authored story landmarks. There are over **54,000 trees**, **11,348 street props** and **1,504 public spaces**: community gardens, basketball courts, produce markets with string lights, fountains and sculpture plazas. Buildings include terraces, apartments, offices, warehouses, factories, civic halls, greenhouses and markets. Roof gardens and equipment give climbing destinations variety. Heights, footprints, orientation, facade colors and district type mixes vary. Downtown now uses the same architecture and instanced materials as the wider city, while keeping its signs, contacts and story locations. Facade UVs scale per instance so windows keep consistent dimensions on tall and short buildings.

Sixteen districts connect through 23 inner routes and 114 regional street centerlines. Curved inner roads follow authored splines; regional roads use one continuous deformation, so intersections and chunk boundaries join. Placement reserves road and interaction clearance. Thirty tram stops and 36 driveable cars support exploration. The map pans, zooms and switches between neighborhood and city views. The existing story remains concentrated in the original districts; scenery buildings have no interiors.

## What the research informed

- **Genshin Impact:** miHoYo's technical director describes separate mobile and console rendering pipelines, mobile as the primary development platform, and choosing practical techniques around art and runtime cost. Afterlight applies that principle through separate quality budgets and selective animation/detail updates. Its WebGL renderer does not reproduce Genshin's console compute, lighting or shadow systems. [Zhenzhong Yi, published by Unity Japan](https://docswell.com/s/UnityJapan/KWRPQ5-210617-unity-dojo20211mihoyozhenzhongyi)
- **Mobile GPU costs:** remove invisible work, batch compatible geometry, and reduce unnecessary geometry, pixel work and bandwidth. Afterlight uses spatial instancing, opaque tree crowns, shared materials and a small facade texture; distant lamps use emissive geometry rather than thousands of lights. [Arm's mobile rendering guidance](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/console-quality-game-rendering-on-mobile)
- **Open-world residency:** Epic's World Partition loads grid cells around streaming sources instead of keeping an entire level resident. Afterlight implements a smaller procedural equivalent, with a nearby prefetch region and destination warmup for tram travel. [Epic World Partition documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine)
- **Instancing lifecycle:** repeated meshes share geometry/materials, instance bounds are recomputed after transforms, and evicted meshes release instance buffers while shared resources remain reusable. [Three.js InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html)

## Runtime architecture

`world-config.js` defines the boundary and quality-independent scale. `city-plan.js` preserves the authored center and generates its surrounding neighborhoods. `metropolis.js` generates deterministic 192 m regional blocks on demand, retaining at most 160 recently used blueprints. Global road metadata is small and resident; the entire city's buildings are never constructed at startup.

`world-stream.js` manages 96 m visual cells. It generates nearby cells and camera-visible cells, batches geometry by material/shape, and separates building shells from nearby details. Per-frame uploads are limited to two cell layers, with a soft CPU generation budget. A single cell can exceed that budget; generation is synchronous, not a worker pipeline. Detail and distant instance buffers are released with distance/time hysteresis. A 100 m surrounding region is prefetched so turning the camera does not expose an empty immediate neighborhood.

Collision queries use lightweight deterministic metadata independently of visual residency. Axis-aligned boxes serve only as broad-phase candidates; circle and ray tests use actual rotated footprints. Road-placement clearance is separate from physical walls. Buildings no longer reserve invisible collision at their rotated corners, and rooftop equipment/bridges collide only at their actual elevation. Solid props and structural pieces belong to the visible shell layer, so reducing detail never removes an obstacle’s body. Intersections reserve furniture clearance, and the freight office and broadcast tower have curved road bypasses. A visible rail marks the metropolitan boundary.

`architecture.js` and `public-spaces.js` share structural pieces between rendering and collision. Most building walls support climbing, including the original landmarks. Four wall faces, sideways movement, blocked ledges, release/jump-off and a timed mantle lead onto walkable roofs. `climb-animation.js` solves two-bone hand/foot targets on Vex’s existing rig and blends back into normal movement; no new character download is needed. Ground support, jumping, camera rays and saves account for roof elevation. Street-level saves remain compatible. Scenery has no interiors, corner-to-corner climbing transfer or stamina system.

| Budget | High | Performance / mobile default |
| --- | ---: | ---: |
| Shell load distance | 510 m | 340 m |
| Detail load distance | 135 m | 85 m |
| Animated crowd distance | 65 m | 42 m |
| Maximum device pixel ratio | 1.5 | 1 |
| Adaptive resolution floor | 70% | 65% |
| Rain particles | 1,100 | 250 |
| Soft cell generation budget | 2.5 ms/frame | 1.5 ms/frame |
| Bloom render targets | Enabled | Not allocated |

Frustum and distance checks suppress invisible actors; detached offscreen skeletons avoid scene-matrix work. Nearby visible actors update every frame, with more distant visible animations at approximately 10 Hz. The 26-person crowd pool is reused around regional streets. Scenery uses shell/detail levels, not continuous mesh simplification or GPU occlusion queries. Small shared character/car/texture pools remain loaded; this is procedural scenery streaming, not HTTP streaming of individually downloaded buildings.

The resolution governor requires sustained frame pressure before lowering resolution and a longer recovery before increasing it. Hidden pages stop rendering. Cached map backgrounds rebuild only when the view changes sufficiently; overview zoom omits individual buildings and minor roads.

## Measurements and verification

Earlier expansion benchmark (before the traversal/public-space pass): development Chromium, starting position (-2.5, 30), default camera. The new result is the median of five samples, 600 ms apart, after a two-second settling period. The baseline was recorded before expansion using the same full-frame renderer counters. Characters move, so exact submission counts vary with timing. These are draw submissions, **not GPU time or a physical-phone benchmark**.

| Scene | Before calls | After calls | Before triangles | After triangles |
| --- | ---: | ---: | ---: | ---: |
| Desktop 1280 × 800, DPR 1, High | 619 | 517 | 917,114 | 282,062 |
| Phone emulation 390 × 844, DPR capped at 1, Performance | 514 | 228 | 873,400 | 100,122 |

This is about **69% fewer triangles on desktop and 89% fewer in phone emulation**. Both new runs were approximately 60 FPS on the test desktop. The phone run confirmed the coarse-pointer default, disabled canvas MSAA, no bloom targets, touch controls and no horizontal overflow. Its baseline selected Performance on an existing desktop context; the new run reloaded with mobile context settings. Device thermal behavior and GPU bandwidth still need physical iOS/Android testing.

Seven cross-city tram trips kept roughly 46–48 shell cells resident at rest on desktop, reached the 160-blueprint cache cap, and increased eviction counts as expected. Returning to previously visited areas stabilized at 404 uploaded geometries and 192 textures in that run; shared character resources upload as first encountered. A separate drive covered 209 m through regional cells, then exited and walked away. Desktop and portrait/landscape phone layouts, map zoom, transit, and focus restoration after the journal were inspected without console warnings or errors. The final production build also loaded downtown and Cypress Commons without console warnings/errors, with development diagnostics absent.

`npm test` passes 78 tests, including a sweep of all 3,364 candidate regional blocks for road/building separation and world bounds, transit/car clearance, deterministic regeneration, spatial collision equivalence, instance disposal/rebuild, resolution hysteresis, saves, and exits at every car angle. `npm run build -- --configLoader runner` succeeds. Vite retains its existing warning about the Three.js vendor chunk exceeding 500 kB. Development diagnostics (`window.__AFTERLIGHT__.snapshot()`) report renderer submissions, residency, evictions, blueprint counts, animation activity and CPU submission costs; they are excluded from production.


### Traversal and neighborhood pass

Current smoke checks include a 55 m downtown climb, rooftop walking/jumping and save reload, joystick climbing and mantling on an original greenhouse in portrait/landscape phone emulation, automatic focus after the journal, and a 92 m regional drive reaching 42 m/s followed by a clean exit and walk-away. Both curved story-landmark bypass centerlines were checked against live colliders, and all authored interaction destinations retain clearance.

The starting area was sampled again at (-2.5, 30), after a 2.5 s settling period, with five samples 600 ms apart. Median results were 538 calls / 289,820 triangles on desktop (1280 × 800, High), and 231 calls / 103,326 triangles in phone emulation (390 × 844, Performance, DPR capped at 1). Both were approximately 60 FPS on the desktop test host. Residency was 49 and 23 shell cells respectively. CPU update/submission costs remained approximately 0.6 / 2.6 ms; these are CPU timings, not GPU frame times. The final plaza dressing retains the same shared materials and adds only nearby small detail instances. Physical mobile performance has not been measured.

The production build succeeds, retaining only the existing Three.js vendor-size warning. The automated traversal suite checks actual rotated corners, overhead clearance, frame-rate independence, ledge obstruction, all eight structural building families, public-space paths, roof saves and skeletal climbing transitions. Production and development browser smoke checks use isolated save contexts.

### Repository review

Repeated review passes corrected mantle cancellation embedding the player in a facade, negative landing timers on raised surfaces, repeated menu-key toggles, stale touch gestures after menus, lost focus when replacing quest/map lists, inconsistent vehicle cover for weapon rays, and pedestrian facing on curved streets. New regressions cover the traversal, input and cover failures. The final production smoke test used the GitHub Pages `/experiment-rpg/` base path, confirmed local model loading and absent development diagnostics, and exercised mantle cancellation followed by walking away on phone emulation. Journal/map focus and portrait/landscape layouts passed without console warnings or errors. A desktop drive covered 95 m at up to 42 m/s, then exited and walked another 4 m; streaming remained bounded. The npm dependency audit reported no known vulnerabilities, the bundled head-shape generator reproduced its checked-in output exactly, and both Blender Python scripts passed syntax validation.
