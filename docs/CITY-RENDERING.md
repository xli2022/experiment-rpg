# Afterlight: the vertical city

The playable city occupies an **11,000 × 11,000 metre square (121 km²)**. The new layout follows the supplied Afterlight master road map: thirteen districts, a western and northern hillside, a dense central city and Blackwater Bay to the east. The old downtown and its surrounding uniform regional grid are no longer the runtime map.

`master-plan.js` owns the shared coordinates for the map, terrain, roads, ramps and raised pedestrian spaces. Main corridors and district centers are traced from the supplied roadmap PNG, with image coordinates calibrated to its 11 km boundary and converted into metres around the world origin. Their bends, spacing and junction positions follow that reference rather than an evenly spaced replacement grid. All runtime `y` coordinates are absolute; a road's named level describes its height above the terrain, not its world-space height.

## Streets, bridges and public space

Afterlight Ring, Neon Spine, Meridian Expressway, North Freightway and South Bypass form the principal routes. Western traffic joins the Ring at Ridge Junction and shares its west flank through West Spire, following the PNG instead of adding a second parallel main road. North Freightway meets Meridian at Harbor Crossing, and the eastern ends of Neon Spine and South Bypass continue over the bay as bridges. Neighborhood streets use unequal blocks, staggered T-junctions and outward continuations to nearby streets and avenues. Older hillside districts bend with the terrain; corporate and freight districts retain more regular streets and larger blocks. Repeated circular district roads have been removed. Raised interchanges use physical access ramps; surface junctions meet at grade. Approaches join the same sampled positions and heights as the main roads.

The main road layers are surface streets, approximately **+12 m** arterials and **+25 m** expressways. Ground roads follow both the longitudinal grade and the terrain's crossfall. Road geometry, vehicle height, walking support and ray obstruction use the same sampled surfaces; intersections do not depend on a decorative flat line hovering over an unrelated collision floor. Curved segment joints share a curvature-dependent cap overlap between visible asphalt and physical support, keeping outside lanes supported through tight turns. Road materials remain dark, matte asphalt, distinct from the lighter textured paving beside them.

Citywide infill extends the neighborhood pattern into the remaining sparse land. A sampled distance field selects the largest gaps, then joins existing surface streets at the surrounding district's angle. A second pass splits long blocks with cross streets and staggered T-junctions. Main corridors and the original neighborhood streets retain their coordinates. Water, quay slopes, public decks, Eastpoint's starting area and authored towers remain reserved. Coverage and block-length tests prevent large empty regions or long parallel strips from returning.

Eastpoint introduces the vertical layout immediately: a street-level hideout, an **+8 m Upper Market**, a pedestrian skywalk and bay terrace, and the expressway above them. Both ends of the pedestrian route have walkable access ramps. The Citadel has a **+12 m concourse**, and the Stacks has a raised community terrace. Railings leave openings at adjoining decks and access ramps. Viaduct piers are excluded from lower traffic and pedestrian routes.

Authored towers frame Eastpoint within walking distance, with heights from 78 to 156 m. The eight candidate anchors, kiosks, planters and signs preserve their local offsets around the reference-map interchange; footprint clearance can omit an anchor where a traced road needs the space. Their stepped podiums, upper floors and roof terraces have matching physical geometry. Procedural districts add corporate towers, residential slabs with balconies, old terraces, markets, factories and warehouse yards. Their height ranges, density, facade colors and street furniture vary by district. Road clearance and reserved story locations are applied before placing buildings. Scenery buildings have no interiors.

Every building has a tenant sign on its street-facing wall. Shops reuse the original neon brands, while offices, residences, civic buildings, factories and warehouses have appropriate organizations and labels. Generated buildings use their frontage street; landmark towers select the wall facing the nearest surface street. Signs fit below roofs and residential balconies and above doors, shop canopies and loading bays. The 28 designs share one mipmapped 2048 px atlas and one instanced sign draw per populated visual cell, with no extra lights or sign shadow pass. Sign instance UV buffers are released with their chunks; the atlas is shared across the city.

Continuous amber glow strips are omitted from building trim and kiosks because they read as stray yellow lines. Structural bands, windows and the remaining district lighting stay in place.

Factories and warehouses use a shared industrial wall texture with panel seams, clerestory glazing and louvres on all four sides. Its eight-by-six-metre repeat follows each instance's dimensions and rotation. The textured body stays in the shell layer, so rear/side detail and distant facades do not depend on close-up loading doors or ribs. One 256 × 128 atlas, mipmaps, capped anisotropy and a rough material keep this within one additional material batch per affected cell without extra window geometry.

The underground metro shown in the planning reference remains **abstracted through discoverable stations and fast travel**. This implementation does not claim a continuous explorable underground rail network. The playable vertical spaces are the surface city, road viaducts, access ramps, public decks and climbable buildings.

## Streaming and rendering

`vertical-city.js` generates deterministic 192 m building blueprints on demand. Lots follow actual ground-level road frontages, with varied widths, setbacks, rear yards and street-facing entrances. Building meshes, foundations and collision boxes share the same rotation. A neighboring-lot check prevents overlapping buildings across streaming boundaries without depending on generation order. Buildings are no longer scattered on an independent world grid. The generator retains at most 160 recently used blocks. Global road and support metadata stay resident, while the whole city's building meshes are never constructed at startup. The same blueprints supply rendering and collision queries, so invisible chunks do not remove physical walls or supports.

`world-stream.js` manages 96 m visual cells. Compatible geometry is instanced by material and shape, with main silhouettes separated from nearby facade detail. Instance transforms support yaw, pitch and roll, allowing roads to follow both ramps and crossfall. Bounds include these tilts. A 100 m surrounding region is prefetched; distance and time hysteresis release detail and distant buffers. At most two cell layers are built per ordinary frame under a soft CPU budget. Generation remains synchronous, so one cell can exceed the soft budget.

Terrain is one resident heightfield with **64 m triangles**, sampled identically by physics. Its 61,952 triangles cover the boundary and an outer margin. There are no overlapping streamed ground tiles or alternate colored floors that replace each other while driving. Textured paving uses a deterministic 128 px diffuse map, mipmaps and anisotropy capped at 4. World-space coordinates keep its eight-metre repeat stable across the city. Pedestrian decks and ramps reuse that texture on their existing slabs with a muted grey tint, adding one material batch per affected cell without another floor mesh or texture allocation. Roads use a separate, fully rough material. Blackwater Bay is a separate water surface visible where the terrain falls below its level.

One directional light casts filtered shadows in a player-centered, texel-snapped area. The map refreshes at most 20 Hz on High or 10 Hz on Low, including while cells stream in, and is reused when paused. Nearby offscreen shells remain available to the shadow pass; flat ground/paint and small facade details do not cast. Trees, buildings and substantial stationary props cast shadows. Cars, characters and drones receive city shadows but never enter the throttled shadow map, which would leave their silhouettes behind between refreshes. Point lights never allocate shadow cubemaps.

`contact-shadows.js` draws soft contact shadows beneath parked/driven cars, traffic, the player, pedestrians and story contacts in one instanced draw. A shared 32 px alpha texture and at most 128 quads keep the cost fixed. Current actor positions, headings and visibility update every rendered frame with no interpolation or shadow-map refresh delay. The player's contact fades when jumping, stays on its support surface and hides while climbing or driving. Flying drones have no ground contact shadow.

Traffic uses a bounded fleet on sampled road lanes, including elevated roads. Vehicles, pedestrians and contacts receive actual surface heights. Street-level and upper-level actors are kept separate by vertical collision and interaction checks. Every traffic car can be stopped with three weapon hits, then entered and driven. The third hit replaces its fleet instance with a matching independent car at the same position, height and orientation; NPC route movement ends immediately. There are no designated parked starter cars. Stopped cars block other traffic and retain normal collision, driving, exit and contact-shadow behavior. Nearby acquired cars reserve slots in the local vehicle budget, preventing repeated takeovers from continually adding replacement traffic. New stories clear them; distant abandoned cars beyond the visible range are retired when more than eight are retained.

`population.js` gives busy commercial districts more pedestrians, residential streets lighter traffic, and industrial areas fewer walkers. Targets are 12–24 pedestrians and 6–10 traffic cars on High, or 8–16 pedestrians and 4–6 cars on Low, reduced further when actual sidewalks or lanes cannot fit them. The skeletal pool stays capped at 26. Crowd slots favor the player's floor and maintain spacing across adjacent paths; later placements are limited to two per 350 ms. Traffic distributes cars across available streets according to lane capacity. Connected road ends use continuous turns that follow supported surfaces at the same height; crossing reservations prevent opposing approaches from deadlocking. The junction cache is capped at 128 cells. Visible actors finish moving out of view before a lower population target retires them, avoiding sudden disappearance.

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
| Directional shadow map | 2048 px, 144 m span | 1024 px, 96 m span |
| Maximum shadow refresh rate | 20 Hz | 10 Hz |
| Nearby NPC traffic target | 6–10 cars | 4–6 cars |
| Nearby pedestrian target | 12–24 | 8–16 |
| Blueprint cache | 160 blocks | 160 blocks |

Frustum and distance checks suppress invisible actors, and offscreen skeletons detach from the scene. Nearby visible actors animate every frame, while distant visible animations update less often. The resolution governor requires sustained frame pressure before lowering resolution and a longer recovery before increasing it. Hidden pages stop rendering. Cached map backgrounds rebuild only when needed; overview zoom draws local streets faintly and omits individual buildings. District labels remain, without circular area overlays that imply artificial neighborhood boundaries.

## Traversal, quests and saves

Solid walls, piers, railings and furniture use height-aware collision. Sloped road and ramp slabs are support surfaces: they provide walking/vehicle height and ray cover without becoming invisible vertical barriers. The player can walk under a bridge, climb above it, or drive onto it through its ramp. Rooftop equipment and stepped terraces collide at their real elevations. Climbing, jumping, the following camera, car exits and contact shadows use these support heights.

Story contacts, terminals, caches, rest points and station destinations were moved to the new city. Early objectives introduce the Upper Market and skybridge; later objectives take the player to the Citadel, Stacks, Void Port, Foundry and North Ridge. Quest and object IDs remain stable, preserving chapter completion, inventory, dialogue choices and rewards.

Saves carry **`worldRevision: 5`**. Coordinates from earlier city layouts are not reused after street and building changes: an older save resumes at its remapped rest location while retaining campaign progress. Current-world saves keep their location and elevation when it is still a valid destination. Startup, refuge returns and tram arrivals use collision-checked positions that include parked cars, leave room to walk, and search nearby on the same floor when occupied. Patrol and district-survey waypoints use the actual terrain or deck elevation.

## Verification

The automated suites cover deterministic district generation, bounded blueprint residency, road and building separation, connected approaches, ramp grades and lane clearance, actual terrain triangle heights, sloped support/ray behavior, banked road rendering and streamed instance transforms. They also retain checks for contact-shadow timing and budgets, district population/spacing, traffic behavior and three-hit vehicle takeovers, climbing, car exits, save migration and campaign consistency. Sign coverage, street-facing visibility, atlas reuse and buffer release are checked for all seven building types, along with first-load visibility of distant tower tops.

The renderer audit checks all 63 remapped world objects with surrounding arrival positions against the generated solid geometry. The road audit samples both road edges and ramp routes against terrain and collision metadata. Current city changes should be checked with `npm test` and `npm run build -- --configLoader runner`, followed by desktop and mobile browser traversal. Development-only `window.__AFTERLIGHT__.snapshot()` reports renderer submissions, streaming residency, blueprint counts, actor activity and CPU update/submission costs. These counters and desktop browser frame rates are not physical-phone GPU measurements.

Historical measurements from the retired flat map are not performance claims for this city. The production build retains the existing warning about the Three.js vendor chunk exceeding 500 kB.
