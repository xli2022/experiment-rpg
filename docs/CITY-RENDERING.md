# Afterlight: the vertical city

The playable city occupies a **5,500 × 5,500 metre square (30.25 km²)**. The original Afterlight master road map is compressed to half its width and depth, preserving the connections, bends, intersections, thirteen districts and Blackwater Bay coastline. The western and northern hills and dense central city remain in their original relative positions.

`authored-plan.js` retains the original 11 km plan traced from the supplied roadmap PNG. It generates the complete road graph before `master-plan.js` applies the shared `CITY_SCALE = 0.5` transform from `world-scale.js`. The runtime map, terrain, roads, ramps, public decks and story coordinates therefore share one transform. Terrain relief and infrastructure elevations scale with horizontal distances to preserve ramp grades; building heights, character and vehicle dimensions, movement speeds and interaction distances retain their human scale. All runtime `y` coordinates are absolute; a road's named level describes its height above the terrain, not its world-space height.

## Streets, bridges and public space

Afterlight Ring, Neon Spine, Meridian Expressway, North Freightway and South Bypass form the principal routes. Western traffic joins the Ring at Ridge Junction and shares its west flank through West Spire, following the PNG instead of adding a second parallel main road. North Freightway meets Meridian at Harbor Crossing, and the eastern ends of Neon Spine and South Bypass continue over the bay as bridges. Neighborhood streets use unequal blocks, staggered T-junctions and outward continuations to nearby streets and avenues. Older hillside districts bend with the terrain; corporate and freight districts retain more regular streets and larger blocks. Repeated circular district roads have been removed. Raised interchanges use physical access ramps; surface junctions meet at grade. Approaches join the same sampled positions and heights as the main roads.

An access ramp keeps its street's level until its slab, shoulders included, is clear of that street's lanes and sidewalks. It climbs at an even grade of at least 6% and at most about 10%, then runs level, and reaches the trunk's level before its slab meets the trunk's shoulder. So a ramp meets only its own street and trunk at grade, and anything else it passes over or under keeps 2.5 m of headroom. Eastpoint's ramp rises from the South Link beside Meridian and merges after crossing high above Market Street, leaving the opening junction open to the sky. The Ridge Junction, North Gate, Stacks and Horizon Hub ramps also follow set routes, because the generic route would leave their street at a shallow angle, climb across a nearby junction or cross street, or run beneath the trunk's own deck.

Where a raised road crosses a street within 0.7 m of its level, as the Western Arterial and South Bypass do on their way down to grade, the two form a junction. If the raised road is more than a kerb's height above the street there, it comes down onto the ground through the junction and eases back to its own profile over at least 50 m, never climbing more steeply than 6% or its existing maximum. A crossing that was a bridge and is brought within a junction's reach by this is levelled too. The one remaining step, Neon Spine 0.27 m above Bay Avenue where it starts to climb to its bay bridge, is lower than a kerb.

The main road layers are surface streets, approximately **+6 m** arterials and **+12.5 m** expressways. Ground roads follow both the longitudinal grade and the terrain's crossfall. Road geometry, vehicle height, walking support and ray obstruction use the same sampled surfaces; intersections do not depend on a decorative flat line hovering over an unrelated collision floor. Curved segment joints share a curvature-dependent cap overlap between visible asphalt and physical support, keeping outside lanes supported through tight turns. Road materials remain dark, matte asphalt, distinct from the lighter textured paving beside them.

Citywide infill extends the neighborhood pattern into the remaining sparse land. A sampled distance field selects the largest gaps, then joins existing surface streets at the surrounding district's angle. A second pass splits long blocks with cross streets and staggered T-junctions. Both passes run in authored coordinates before the completed graph is compressed, preserving every existing connection. Water, quay slopes, public decks, Eastpoint's starting area and authored towers remain reserved. Coverage and block-length tests prevent large empty regions or long parallel strips from returning.

Eastpoint introduces the vertical layout immediately: a street-level hideout, an **+4 m Upper Market**, a pedestrian skywalk and bay terrace, and the expressway above them. Both ends of the pedestrian route have walkable access ramps. The Citadel has a **+6 m concourse**, and the Stacks has a raised community terrace. Railings leave openings at adjoining decks and access ramps. Viaduct piers are excluded from lower traffic and pedestrian routes.

Authored towers frame Eastpoint within walking distance, following the footprint and height bounds of their region. The eight candidate anchors, kiosks, planters and signs use compressed local offsets around the reference-map interchange; footprint clearance can omit an anchor where a traced road needs the space. Their stepped podiums, upper floors and roof terraces have matching physical geometry. Procedural districts add corporate towers, residential slabs with balconies, old terraces, markets, factories and warehouse yards. Footprints, lot spacing and setbacks use the compact layout, while regional height profiles give each skyline a distinct scale. Closer neighboring roofs support sprint jumps from taller buildings to lower buildings; routes need not work in both directions. Road clearance and reserved story locations are applied before placing buildings. Every building's base volume can be entered; see [interiors](#interiors).

`building-design.js` supplies four architectural variants for each of the seven uses. Offices combine setbacks, split towers and offset upper floors; residences use paired wings, balcony slabs and garden terraces. Row houses have separate stepped parapets, civic buildings have piers and raised halls, markets have striped awnings and clerestories, and industrial sheds have different roof monitors and chimney arrangements. Paint, accents and handedness are selected independently from each building's stable ID, then the paint is blended with its district palette. The same solid volumes supply visible walls, roof slabs, equipment, climbing targets and landing support. Each recipe fits its reserved lot.

`building-materials.js` replaces the repeated window grid with six finishes: curtain wall, limestone, brick, ribbon windows, metal grid and stucco. They share one 1024 × 1024 diffuse atlas, one matching window-light atlas and one instanced facade draw per footprint per cell. Each building's stable ID selects a mostly lit or mostly dark profile, shared by all its wings and setbacks. A separate seed, the section position, wall face and unwrapped floor/column select each window's state, with about 6% random exceptions. Both window color and emission use that decision; the texture banks contain no baked lighting pattern. The pattern remains fixed across frames and streaming reloads. Metre-based UVs, wrapped gutters and derivatives taken before UV wrapping retain window scale and filtering. Instance UV and seed buffers are released with unloaded cells. Main silhouettes and facade finishes remain visible in both graphics modes; small rails and awnings follow the existing detail distance.

Every building has a tenant sign on its street-facing wall. Shops reuse the original neon brands, while offices, residences, civic buildings, factories and warehouses have appropriate organizations and labels. Generated buildings use their frontage street; landmark towers select the wall facing the nearest surface street. Signs fit below roofs and residential balconies and above doors, shop canopies and loading bays. The 28 designs share one mipmapped 2048 px atlas and one instanced sign draw per populated visual cell, with no extra lights or sign shadow pass. Sign instance UV buffers are released with their chunks; the atlas is shared across the city.

Continuous amber glow strips are omitted from building trim and kiosks because they read as stray yellow lines. Structural bands, windows and the remaining district lighting stay in place.

Factories and warehouses use a shared industrial wall texture with panel seams, clerestory glazing and louvres around the full perimeter. Its eight-by-six-metre repeat follows each instance's dimensions and rotation. The textured body stays in the shell layer, so rear/side detail and distant facades do not depend on close-up loading doors or ribs. One 256 × 128 atlas, mipmaps, capped anisotropy and a rough material keep this within one shared material batch per footprint without extra window geometry.

The underground metro shown in the planning reference remains **abstracted through discoverable stations and fast travel**. This implementation does not claim a continuous explorable underground rail network. The playable vertical spaces are the surface city, road viaducts, access ramps, public decks and climbable buildings.

## Streaming and rendering

`vertical-city.js` generates deterministic 192 m building blueprints on demand. Lots follow actual ground-level road frontages, with varied widths, setbacks, rear yards and street-facing entrances. Building meshes, foundations and collision boxes share the same rotation. A neighboring-lot check prevents overlapping buildings across streaming boundaries without depending on generation order. Buildings are no longer scattered on an independent world grid. The generator retains at most 160 recently used blocks. Global road and support metadata stay resident, while the whole city's building meshes are never constructed at startup. The same blueprints supply rendering and collision queries, so invisible chunks do not remove physical walls or supports.

`world-stream.js` manages 96 m visual cells. Compatible geometry is instanced by material and shape, with main silhouettes separated from nearby facade detail. Instance transforms support yaw, pitch and roll, allowing roads to follow both ramps and crossfall. Bounds include these tilts. A 100 m surrounding region is prefetched; distance and time hysteresis release detail and distant buffers. At most two cell layers are built per ordinary frame under a soft CPU budget. Generation remains synchronous, so one cell can exceed the soft budget.

Terrain is one resident heightfield with **32 m triangles**, sampled identically by physics. The triangles cover the boundary and an outer margin. There are no overlapping streamed ground tiles or alternate colored floors that replace each other while driving. Textured paving uses a deterministic 128 px diffuse map, mipmaps and anisotropy capped at 4. World-space coordinates keep its eight-metre repeat stable across the city. Pedestrian decks and ramps reuse that texture on their existing slabs with a muted grey tint, adding one material batch per affected cell without another floor mesh or texture allocation. Roads use a separate, fully rough material. Blackwater Bay is a separate water surface visible where the terrain falls below its level.

One directional light casts filtered shadows in a player-centered, texel-snapped area. The map refreshes at most 20 Hz on High or 10 Hz on Low, including while cells stream in, and is reused when paused. Nearby offscreen shells remain available to the shadow pass; flat ground/paint and small facade details do not cast. Trees, buildings and substantial stationary props cast shadows. Cars, characters and drones receive city shadows but never enter the throttled shadow map, which would leave their silhouettes behind between refreshes. Point lights never allocate shadow cubemaps.

`contact-shadows.js` draws soft contact shadows beneath acquired and driven cars, traffic, the player, pedestrians and story contacts in one instanced draw. A shared 32 px alpha texture and at most 128 quads keep the cost fixed. Current actor positions, headings and visibility update every rendered frame with no interpolation or shadow-map refresh delay. The player's contact fades when jumping, stays on its support surface and hides while climbing or driving. Flying drones have no ground contact shadow.

`population.js` gives busy commercial districts more pedestrians, residential streets lighter traffic, and industrial areas fewer walkers. Targets are 12–24 pedestrians and 6–10 traffic cars on High, or 8–16 pedestrians and 4–6 cars on Low, reduced further when nearby sidewalks cannot fit them. The rest of the street life is described under [traffic](#traffic).

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

## Vegetation

`vegetation.js` adds deterministic planting pockets on a jittered 28 m lattice, with denser greenery in residential districts and sparser planting around freight yards. The current reserved-world layout has about 21,000 trees, including 15,000 new trees alongside the existing 5,800 rear-yard trees, plus 26,000 shrubs. Broadleaf trees have overlapping canopies; cypresses have slender evergreen silhouettes. Size, color, pocket arrangement, flowering shrubs and grass-bed proportions vary without changing after a streaming reload.

Pockets occupy unused space outside candidate building lots, roads, pedestrian structures and story interaction/arrival clearances. The whole canopy envelope is checked against actual road slabs, decks, piers and furniture before planting. Global pocket coordinates determine ownership; neighboring chunks and cache eviction do not add duplicates. Trunks have appropriately sized solid colliders. Soft undergrowth and thin grass beds do not create movement barriers. Larger tree silhouettes and shrubs stay visible in both graphics modes, while flowers and small grass tufts use the near-detail layer.

Grass beds reuse the existing grass texture, following the local terrain slope. They are omitted where a single plane cannot sit closely on the underlying terrain triangles, avoiding floating patches at slope changes. Their actual footprint is also drawn on the map. Roof planters receive fitted foliage, and public planters retain greenery even when near detail unloads.

All tree and shrub parts reuse existing instanced city geometry and materials; the grass beds share one material batch per affected cell. No plant allocates a unique texture, material or independent scene mesh. The vegetation audit checks actual crown/cone triangle geometry across the city, terrain contact for grass beds, story and road clearances, rendering dimensions, trunk collision, and stable regeneration after eviction.

## District architecture

`district-architecture.js` defines each district's footprint, average body height and hard height range in metres. Heights normally follow a triangular distribution centered on the average. Afterlight Core samples its entire range uniformly and chooses its footprint independently, so every shape appears at low, medium and skyscraper heights. Building uses adapt to the sampled height rather than overriding the district average. Roof fixtures sit above the body height; the districts without skyscrapers stay below the game's 100 m threshold even with those fixtures.

| Region | Footprint | Average height | Height range |
| --- | --- | ---: | ---: |
| Afterlight Core | All three | 114 m | 8–220 m |
| Citadel | Hexagonal | 140 m | 80–200 m |
| East Reach | Circular | 88 m | 24–152 m |
| Void Port | Rectangular | 18 m | 10–26 m |
| The Stacks | Circular | 102 m | 48–156 m |
| North Ridge | Rectangular | 30 m | 14–46 m |
| Ember Heights | Hexagonal | 26 m | 12–40 m |
| West End | Rectangular | 44 m | 18–70 m |
| Shadowmarket | Hexagonal | 19 m | 8–30 m |
| The Cut | Rectangular | 14 m | 8–20 m |
| Southward | Circular | 32 m | 14–50 m |
| Foundry | Rectangular | 28 m | 14–42 m |
| Silver Delta | Circular | 20 m | 12–28 m |

Region membership is resolved at each building's center, including boundary lots and the authored Eastpoint landmarks. Shape and height are stable across streaming order and reloads. Circular and hexagonal lots reserve depth for a full frontage diameter, preserving close neighboring roofs. Matching foundations, concentric setbacks, roof slabs, balconies, entrances and signs carry the footprint through the whole building. The map draws the same perimeter.

`building-footprints.js` supplies the shared outline: a regular hexagon or a smoothly shaded 32-sided circle. `building-geometry.js` gives curved walls continuous circumference UVs and hexagonal walls separate face UVs, measured in physical metres. Both keep the shared facade atlas and seeded random window lighting. The stream batches by material and footprint, at most three facade draws per shell cell; no building allocates its own material or texture.

Polygon collision uses the rendered wall planes rather than the enclosing rectangle. Walking, vehicles, camera/projectile rays and roof support leave the unused corners open. Climbing follows the actual faces and allows sideways movement around circular and hexagonal perimeters. Tests compare physics with independent mesh raycasts, check whole-map regional averages and boundaries, and exercise climbing and roof landings on both shapes.

## Interiors

`interior-plan.js` derives each building's interior from its blueprint, with no Three.js dependency. Volume 0, the full-footprint base tier, becomes the cavity. Floors start 0.12 m above the plinth and repeat every 3.6 m, the same storey height as the facade window grid; the top floor takes the remainder. Warehouses and factories are single open halls with an enclosed office. Other buildings get a switchback stair core, plus a lift above three storeys:

- **Pinwheel** layouts put the core in the middle, with a ring landing and four convex wings.
- **Side-core** layouts place it against the back wall when the footprint is under about 15 m across.
- **Single** layouts are one-storey rooms without a core.

Every wing shares a full side with the landing, so each unit opens straight onto it. Units divide into living rooms, bedrooms and bathrooms. Office floors stay open-plan apart from a meeting room. Ground floors become lobbies or shops wherever a street door opens. Street doors come from `buildingEntrances()`, which matches the glazed and roll-up entrances drawn on the facade. Rooms and units have stable IDs such as `<building>/12B:kitchen`, for attaching residents and evidence later. Plans are cached, average under 1 ms each, and are identical across streaming and reloads.

`interior-physics.js` keeps the city's exterior collision unchanged. When the player is inside a building's outline, or within 0.75 m of it, the engine switches to that building's interior context:

- Movement, support, the camera, shots and drone line of sight swap the solid base collider for hull walls. Their outer faces lie exactly on the same perimeter, so the swap matters only at door gaps.
- Floor slabs are convex polygons, never overhanging the outline. Stair flights are support ramps, 1.8 m rise over 3.6 m run, separated by a solid divider. Partitions, rails and furniture are ordinary solids. Windows are glazed and solid until they break (see [broken windows](#broken-windows)).
- Entrance steps outside each door are permanent support pieces. Pedestrians and traffic keep using the exterior colliders.

Indoors the player jogs rather than sprints, and the camera moves closer. The camera stays third person everywhere: where a wall or a tight room leaves too little room behind the player, it swings up over their head, as far as the ceiling allows, rather than closing in. Climbing still uses the exterior walls whenever the player stands outside the outline. Rain is hidden while the camera is inside. The lift's floor picker keeps the player's position in the shared shaft and checks that the arrival point is clear. Saves made indoors are validated against the interior and resume in place.

`interiors.js` builds merged geometry for each floor in building-local space:

- **Lighting:** it is baked into vertex colors on unlit materials, so no scene lights are added and city shaders never recompile. Some units are dark, reflecting the building's lit or dark facade.
- **Doors:** doors open as the player approaches. Room and lift doors fold into one side of their frame, and paired street doors part to both sides, so an open door never reaches past its doorway, for example over the stair beside a lift. Interior doorways are 1.1 m wide, so the player passes through at an angle in any building rotation.
- **What is shown:** inside, the current floor ±1. Outside on foot, the lobby of any building whose door is within 25 m; nothing new is built while driving. At most one floor is built per frame, and unused floors are released after 1.5 s.
- **Shell cut-outs:** the facade, industrial, stone and glass materials share a small clip uniform set. Up to four street doorways are cut out of the shell once their lobby exists. For the occupied building, its cavity discards exterior trim such as balcony rings that would otherwise cross the rooms.

### Broken windows

Windows are the panes the facade atlas paints: one per 2.7 m bay and 3.6 m storey, at a position that depends on the facade style. `facade-windows.js` holds that pane table, and the atlas is drawn from it. Each facade volume's walls count their bays from the corner where their texture starts. A box face runs from its second corner back to its first, a prism face from first to second, and a circle continues round its whole perimeter. Rooms open exactly these panes on the base volume, so a window seen from the street is the window in the room. A pane split by a partition opens on both sides of it. Industrial sheds keep their clerestory band and don't break.

Any facade pane breaks when shot, or with **E** (USE on touch) within arm's reach. Cladding and frames don't break. A broken pane:

- shows from outside as a dark opening ringed with jagged glass, drawn in one instanced pass for panes within 260 m
- loses its glass in the room, leaving shards round the frame
- on the base volume, which holds the rooms, opens through the interior hull, so the player can climb in or out; the parachute opens for long falls. Upper tiers have no rooms behind them

Breaking a window shatters glass outward from the side it was hit from. The session remembers up to 600 broken panes, after which the oldest are glazed again. A building's floors and hull colliders rebuild when one of its panes breaks.

## Traffic

`src/traffic/` turns the road plan into living streets. It depends only on the world's plan and collision, so any mode gets the same traffic.

### Road network

`network.js` builds the network once from the master plan, in about 200 ms. The current city has 1,602 nodes:

- 1,451 junctions, 698 of them signalized
- 111 bends where one street continues into another
- 40 dead ends, 12 of them where a street is closed beneath a low slab (see headroom below)

Junctions are at-grade crossings within 0.7 m of height, and road ends that meet another road. A bridge over a street is not a junction. Every approach measures how far along it the kerbs clear the other streets. Its crosswalk and stop line sit beyond that point; stop lines move back a little more on streets under 9 m wide, so turning cars clear the waiting queue. When a bend lies just before a junction and leaves a lane too short to hold a car, cars wait for the junction before the bend. In 50 places two junctions are too close for a car to wait between them; cars cross each such pair as one (see [close junctions](#vehicles)).

- **Lanes.** Traffic drives on the right, with one lane each way. Roads at least 19 m wide would get two; in the current city the widest road is 16 m, so every road has one. Lanes are offset from a smoothed centreline and follow the road's actual height and crossfall.
- **Turns.** A turn runs straight into the junction, follows a circular arc round the corner where the two lanes' lines meet, and runs straight out. It uses the widest arc whose path stays on the asphalt. On curving roads it uses the approaches' straight axes instead, or as a last resort a path through the junction's centre. Nearly straight connections are gentle curves. Every lane stays on its road, and no turn cuts more than half a metre past a kerb. On two-lane roads, right turns use the kerb lane and left turns the inner one.
- **Dead ends.** Cars U-turn at dead ends. They never enter a dead-end stub shorter than 14 m, which is too short to turn round in.
- **Lazy geometry.** Lanes and connectors are built the first time traffic reaches them, so only nearby streets ever pay for their geometry.
- **Sidewalks.** Both sides of street-level roads get a sidewalk 2 m beyond the kerb, joined at corners and across kerb-to-kerb crosswalks. Blocks too short to hold a sidewalk between their junctions' crosswalks have none, so 85 of the 4,772 at-grade approaches have no pedestrian crossing. Dead ends loop round the road's end. The Upper Market, Citadel concourse and Stacks terrace have their own deck loops, linked to the street by their access ramps.
- **Headroom.** A street passes beneath a slab only with 2.5 m between its surface, sidewalks included, and the slab's rendered underside: room for the tallest car and the tallest visitor. Where a slab sits lower than that, but more than a kerb's height above the street, traffic would pass through it. In the current city this happens in six places, where the Ring and South Bypass come down towards grade over a side street. The street is closed from 5 m short of the slab on one side to 5 m past it on the other. Its lanes, crosswalks and sidewalks end in dead ends there, and cars and people turn back. Roads that meet at a junction share its surface, so they never close each other.

### Signals

`network.js` signalizes junctions with four or more at-grade approaches, and those where a secondary or primary road meets; `signals.js` times them. Quieter T-junctions of local streets are give-way junctions; the through road has priority.

- **Phases.** Each road direction gets its own phase. A road's two approaches always share one, and roads meeting in a straight line join it, so streets that cross never share a green. Most junctions run two phases and a few three-road junctions run three. Green lasts 14–22 s, longer for wider roads, followed by 3 s of amber and 1.5 s all-red. Each junction's offset comes from a hash of its ID, so the city's lights are not synchronized.
- **Pure function of the clock.** No per-frame work is needed for distant junctions.
- **Walk signal.** People may start across a street while its own traffic is held and another phase has green. The lamp shows a flashing hand for the last 6 seconds.
- **Rendering.** Six instanced meshes draw everything for junctions within 170 m: poles, mast arms, three-lamp heads, pedestrian lamps, zebra stripes and stop lines. They are rebuilt after every 40 m the player moves.

### Vehicles

`vehicles.js` drives each car with the Intelligent Driver Model: 1.6 m/s² acceleration, 2.5 m/s² comfortable braking, a 2.5 m standstill gap and a 1.4 s headway.

- **Following.** Anything on the planned path ahead counts as a leader: other traffic, the player's car, acquired cars, people and the player on foot. Curves and slower pieces ahead cap the speed for 2.6 m/s² of lateral acceleration, so cars brake before corners.
- **Junction permission.** A car holds its stop line until it may enter:
  - the light allows it; amber means stop unless stopping would need more than 3.2 m/s²
  - no conflicting car is inside the junction (two movements conflict if car-sized boxes swept along both paths would touch)
  - it has given way where required: left turns to oncoming traffic, and give-way approaches to the through road (they slow to look)
  - the exit has room
- **Commitment.** Once stopping would need a firm brake, the car commits and reserves its path through the junction until its tail is a metre past the turn. Lights one short block ahead are anticipated.
- **Close junctions.** Junctions with no room to wait between them are entered together, on the first one's light and only when every turn through them is free. The car reserves them all, so cross traffic at the next one waits for it to clear, as for any car finishing a turn. Their lights are timed separately and need never be green together.
- **Crosswalks.** While anyone is on, or stepping onto, a crosswalk the car's turn crosses, the car waits behind its stop line rather than stopping across the near crosswalk. It never moves with someone against its body or front bumper. It doesn't wait for people waiting at the kerb, or walking up to it while held back for traffic, who in turn never step out through a car standing on the crossing.
- **Routes.** At each junction cars choose straight, right or left, weighted 6 : 2.5 : 1.5.
- **Appearance.** Three body proportions and ten paints. Front wheels steer, the body pitches under braking and acceleration and rolls in turns, and brake lights and blinking indicators are separate instanced quads. The fleet is at most 16 cars in one instanced draw per car part.
- **Spawning.** Cars spawn out of view, never at a stop line, at a speed they can stop from, and leave once out of view beyond the traffic radius. A scene cut repopulates at once.

### Pedestrians

`pedestrians.js` animates the 28-avatar pool: twenty people and eight robots and aliens.

- **Routes.** Walkers follow the sidewalk graph and only turn back at a dead end. They steer toward a point 1.6 m ahead, turning at no more than 2.6 rad/s.
- **Passing.** Each walker keeps to their own side; they pass slower people and step aside for oncoming ones. Buildings, trees and props are avoided through clear lateral positions sampled every 0.75 m along each sidewalk. Walkers keep to a position that stays clear from a metre behind to three metres ahead, and a stretch nobody can pass is left out. When two people are in each other's way, for example one stepping onto a crosswalk as another steps off it, the one with the lower ID goes first. Walkers wait behind a queue heading the same way. After 1.5 s they squeeze past anyone else standing in the path, such as someone at the kerb for another crossing, a chatting group or the player.
- **Crossing.** Walkers wait at the kerb for the walk signal, or for a gap at give-way crossings. They never step out in front of a car already at the crossing, nor through one standing on it. They cross a little faster and finish the crossing before turning onto the next path.
- **Everyday behaviour.** Some pause to look around or check a phone, and some stand chatting in groups of two or three, with procedural head, chest and arm gestures over their idle. Pairs walk side by side, in single file over kerbs, and a few jog using the Jog clip. Robots and aliens walk at the pace their gait was authored for.
- **Placement.** Feet stay on the ground at all times. A 6 m visibility hysteresis prevents popping at the edge of the actor range. After the first fill, new people arrive two at a time, every 0.35 s, out of view.

### Takeovers

Press **E** beside a traffic car moving slower than 2.5 m/s, for example one waiting at a red light, to take it over. In armed modes, three hits also stop a car.

The car becomes a full model with the same paint, proportions and pose, and joins `traffic.owned`. Acquired cars count toward the local traffic budget. Changing mode removes them, and when more than eight are kept, distant ones out of range are retired.

## Modules and APIs

Sources are layered: `core` ← `world` ← `traffic` ← `engine` ← `modes`. `actors` (character rigs) is shared by traffic, the engine and modes, and `tools` is unrestricted. [`tests/module-layers.test.js`](../tests/module-layers.test.js) enforces the direction. The world never imports traffic, the engine or a mode.

```js
import { createWorld } from './src/world/index.js';
const world = createWorld({ scene, renderer, quality: 'high' });   // landmarks default to AFTERLIGHT_LANDMARKS
world.update({ camera, focus: player, interior, now, dt });       // streaming, weather, interiors
```

`createWorld` returns:

- `masterPlan` (roads, road index, supports, terrain and surface heights)
- `districts`, `districtAt(x, z)` and `isWater(x, z)`
- `spatial`, `spatialFor(interiorContext)`, `interiorContextAt(x, y, z)` and `buildingsNear(x, z, r)`
- `landmarks`, `landmark(id)` and `spawn`
- `mapView`, `atmosphere`, `interiors` and `stream`
- `setQuality(level, { far })`, `snapshot()` and `dispose()`

Landmarks are fixed, reserved sites such as stations, decks and caches. They keep the city identical in every mode; a mode attaches its own meaning to their IDs.

```js
import { createTraffic } from './src/traffic/index.js';
const traffic = createTraffic({ scene, world, assets });           // assets: { citizen, visitors, humanBases }
traffic.update(dt, { player, vehicle: drivenCar, camera, range: 65 });
```

`createTraffic` returns:

- `cars` and `owned`
- `pedestrians` (`people`, `walkers`, `snapshot()`)
- `network` and `signals.state(node, approach)`
- `hijackable(point)`, `takeOver(car)` and `hit(car)`
- `colliders(x, z, r)`
- `setQuality(level)`, `reset()`, `snapshot()` and `dispose()`

`buildNetwork(plan)`, `signalState(node, approach, time)` and the Intelligent Driver Model helpers are exported for tools and tests. Game modes and their host API are described in [MODES.md](MODES.md).

## Traversal, quests and saves

Solid walls, piers, railings and furniture use height-aware collision. Sloped road and ramp slabs are support surfaces: they provide walking/vehicle height and ray cover without becoming invisible vertical barriers. The player can walk under a bridge, climb above it, or drive onto it through its ramp. Rooftop equipment and stepped terraces collide at their real elevations. Climbing, jumping, the following camera, car exits and contact shadows use these support heights.

Long falls automatically deploy a reusable parachute after a 12 m descent from the airborne peak. `jump.js` preserves the short-jump arc and integrates deployment within the physics step, easing down to a 5 m/s descent over 0.55 seconds. Normal movement steers the player; solid walls and the landing surface still use existing collision. A procedural canopy, suspension lines and a hanging pose accompany a wider follow camera and a height readout. Landing, climbing and relocation clear the canopy; pause and menus preserve it. No fall damage is introduced.

Story contacts, terminals, caches, rest points and station destinations were moved to the new city. Early objectives introduce the Upper Market and skybridge; later objectives take the player to the Citadel, Stacks, Void Port, Foundry and North Ridge. Quest and object IDs remain stable, preserving chapter completion, inventory, dialogue choices and rewards.

Saves carry **`worldRevision: 6`**. Coordinates from earlier city layouts, including the 11 km city, are not reused after compaction: an older save resumes at its remapped rest location while retaining campaign progress. Current-world saves keep their location and elevation when it is still a valid destination. Startup, refuge returns and tram arrivals use collision-checked positions that include acquired cars, leave room to walk, and search nearby on the same floor when occupied. Patrol and district-survey waypoints use the actual terrain or deck elevation.

## Verification

Compaction retains all 661 roads and 22,988 segments; the regression suite compares their complete intersection graph with the authored layout. District-center samples retain median nearest roof gaps below 12 m with the varied building footprints. Every district supplies a verified jump to a nearest lower roof at 30, 60 and 120 FPS using normal sprint, collision, support and jump code. These tests include rotated roofs, rooftop equipment and braking after landing, without requiring the return jump to be possible.

The automated suites cover deterministic district generation, bounded blueprint residency, road and building separation, connected approaches, ramp grades and lane clearance, ramps meeting other roads only at their own junctions and otherwise keeping headroom, actual terrain triangle heights, sloped support/ray behavior, banked road rendering and streamed instance transforms. They also retain checks for contact-shadow timing and budgets, district population and spacing, climbing, car exits, save migration and campaign consistency.

Traffic tests build the real network and a small test grid. They check:

- connectors joining the right lanes, every lane keeping a way out, lanes and turns staying on the asphalt, and signal phases never giving conflicting greens
- crosswalks on every approach of a test grid's junctions, and one connected sidewalk network
- a five-minute drive through two districts with no collisions, no red-light entries, no car touching a walker and acceleration within the model's limits; cars stop behind the line, turn both ways and show brake lights while slowing
- turning cars waiting for people on a crosswalk, give-way junctions clearing without deadlock, close junctions crossed as one without collisions (including signalized pairs that are never green together), bridges ignoring people below, and cars stopping for the player and the player's car
- streets closed short of a slab too low to pass under, no lane, turn or walkway in the city passing beneath a slab with less than 2.5 m of headroom, and no junction joining roads more than a kerb's height apart
- pedestrians keeping budgets and spacing, staying off the carriageway except on crosswalks, starting across only on the walk signal, turning back only at dead ends and showing every everyday behaviour
- walkers keeping clear of props, getting past the player, and getting past each other at corners and kerbs
- the three-hit takeover, E takeovers and graphics quality caps

Headless three-minute runs around all thirteen districts and fifteen sampled junctions found no collisions between cars and nobody stuck. The longest waits, about 40 s, were at red lights on three-phase junctions and behind the stationary test player. No walker stood in another's way for longer than a don't-walk phase. A five-minute run with about 24 walkers had no frame where a car touched one. Excluding avatar animation, the whole traffic update takes about 0.1 ms per frame, or 0.17 ms at the 95th percentile. Sign coverage, street-facing visibility, atlas reuse and buffer release are checked for all seven building types, along with first-load visibility of distant tower tops.

The building-variety checks cover distinct silhouettes and independent finishes, supported roof equipment, rotated roof raycasts versus collision, all six facade tiles, selective window emission, shared material batches and UV-buffer regeneration after eviction. District previews were inspected at Eastpoint, Ember Heights, Foundry, Citadel and Shadowmarket. The live game was checked in High and Performance modes without console or shader errors. These browser checks do not establish physical-device frame rates.

With Vite running and Playwright available, `node scripts/check_building_windows.mjs` checks the actual WebGL output for all six facades and all three footprints. It measures dominant light levels, rejects repeating floor/column patterns at 4–32-window intervals, checks separate seeds/faces/sections, and verifies identical windows after chunk eviction. Circular and hexagonal tests locate real pane interiors with mesh raycasts before sampling their pixels. `LAYOUT_URL`, `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` can select the server and local browser installation; results are saved in `test-results/building-windows/`.

Interior suites generate plans for buildings across every district. They check:
- convex zones that tile each floor inside the walls
- reachability of every room from a street door or stair landing
- stairs and lifts where required, and doors matching the drawn entrances
- unique unit IDs, floors above the terrain, and furniture clear of doorways

Physics tests check:
- that the hull matches the shell for collision and rays outside door gaps
- a walk from the street up one storey at 20, 30, 60 and 120 FPS with no falls or wall overlaps
- rays from inside, indoor save validation, and entrance step heights

The renderer audit checks all 63 remapped world objects with surrounding arrival positions against the generated solid geometry. The road audit samples both road edges and ramp routes against terrain and collision metadata. Current city changes should be checked with `npm test` and `npm run build -- --configLoader runner`, followed by desktop and mobile browser traversal. Development-only `window.__AFTERLIGHT__.snapshot()` reports renderer submissions, streaming residency, blueprint counts, actor activity and CPU update/submission costs. These counters and desktop browser frame rates are not physical-phone GPU measurements.

Historical measurements from the retired flat map are not performance claims for this city. The production build retains the existing warning about the Three.js vendor chunk exceeding 500 kB.
