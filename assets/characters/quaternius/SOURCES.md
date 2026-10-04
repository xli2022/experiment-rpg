# Robot and alien character provenance

These original models and their authored skeletal animations are by **Quaternius**. They were retrieved September 28, 2026 from the public Google Drive folders linked by the creator's official pack pages. The downloads require no account or purchase. Source files in this folder are preserved unmodified.

## License evidence

All three official pack pages explicitly identify their models as **CC0 1.0 Universal (Public Domain Dedication)** and permit personal and commercial use:

- [Animated Robot Pack](https://quaternius.com/packs/animatedrobot.html) — one animated robot, released October 2018.
- [Animated Alien Pack](https://quaternius.com/packs/animatedalien.html) — two animated alien models, released April 2019.
- [Animated Mech Pack](https://quaternius.com/packs/animatedmech.html) — four mechanical robots with their own animations, released March 2021. `George.gltf` is from the Flat Colors edition.

The creator's [FAQ](https://quaternius.com/faq.html) also confirms that the models are CC0, can be modified, and do not require attribution. The original license files are retained byte for byte as `License-AnimatedRobot.txt`, `License-AnimatedAlien.txt`, and `License-AnimatedMech.txt`.

License reference: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) and [full legal text](https://creativecommons.org/publicdomain/zero/1.0/legalcode). Credit is retained voluntarily: **Quaternius — https://quaternius.com/**.

## Official source downloads

| Source file | Official pack download folder | Direct file download | Game export |
| --- | --- | --- | --- |
| `Robot.blend` | [Animated Robot](https://drive.google.com/drive/folders/18MU0RtRu9G6SU6uSZ_zMQFmVkRlB4zH5) | [Original Blender file](https://drive.google.com/uc?export=download&id=1gbfdEMvoEQd1CTxFcMVnn4zAtP4cBYd3) | `public/models/visitors/robot-scout.glb` |
| `George.gltf` | [Animated Mech](https://drive.google.com/drive/folders/1sueV_4CGMpZC8y30mWfgKK9UaT3mkHBX) | [Original glTF file](https://drive.google.com/uc?export=download&id=1CEATvzzC1w198kD9DLTamgMD8LsRwV1I) | `public/models/visitors/robot-worker.glb` |
| `Alien.blend` | [Animated Alien](https://drive.google.com/drive/folders/1ADdETHqjSIEUhjKjhLB9hQjeppXEqcvL) | [Original Blender file](https://drive.google.com/uc?export=download&id=1yzD8KGYYSvXI0V43WIH_M2uIcVa_-m8b) | `public/models/visitors/alien-scout.glb` |
| `Alien_Helmet.blend` | [Animated Alien](https://drive.google.com/drive/folders/1ADdETHqjSIEUhjKjhLB9hQjeppXEqcvL) | [Original Blender file](https://drive.google.com/uc?export=download&id=183b0EGwWRjMug6v2pcsnCMhQUA7_oyrX) | `public/models/visitors/alien-resident.glb` |

Original license downloads: [Animated Robot](https://drive.google.com/uc?export=download&id=1Vagl3SNJn-RjpID6GU-O5TzD4qyUYLw1), [Animated Alien](https://drive.google.com/uc?export=download&id=1MhrE5nFKpVAFHMeMXIMZP-ly01CazB-N), [Animated Mech](https://drive.google.com/uc?export=download&id=1za89GDUfFtTyq8f2uL0_U0Nw_anSzGir).

## Source integrity

SHA-256 hashes computed from the retained downloads:

| File | SHA-256 |
| --- | --- |
| `Robot.blend` | `06689F194ABA7AF110B10CB0A3FB8D42BFD70DD6DC6F4BC9A231C51F314A84B0` |
| `George.gltf` | `6D4696D1D79FCCBC7B011023439599CD147EC66BD4A870AEF87497A073807E25` |
| `Alien.blend` | `450667CA606559F091A21B612CEFB2968350FF416B9D663215BE1F31D2A47710` |
| `Alien_Helmet.blend` | `3AE0B5C226DCB34B3CDCCE73FFCE11A41C951BCCBA8F01013FA39E2605F64BA7` |
| `License-AnimatedRobot.txt` | `83D8959F9FC56353ED571FBE2DC52E4BCD64508E2399501CD45AC2CE3DF0BF8C` |
| `License-AnimatedAlien.txt` | `83D8959F9FC56353ED571FBE2DC52E4BCD64508E2399501CD45AC2CE3DF0BF8C` |
| `License-AnimatedMech.txt` | `83D8959F9FC56353ED571FBE2DC52E4BCD64508E2399501CD45AC2CE3DF0BF8C` |

The GLB names are local Afterlight character archetypes. The exported models derive from the sources listed above; the original Quaternius assets retain their authorship and CC0 license.

## Rebuilding the game assets

From the repository root, with Blender 4.5 LTS installed:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe' --background --factory-startup --python scripts/build_visitors.py
npm test
```

The script bakes the original rig constraints, retains native idle and walking animation, consolidates the robot's rigid attachments, converts legacy Blender materials, and exports self-contained GLBs. It compares sampled geometry bounds before and after baking and after reimporting each exported file. No source download is required to rebuild. Per-model JSON records beside the exports include source dimensions, triangle counts, clip durations, pose comparison errors and estimated walking speed.

`src/npc-visitors.js` fits each cloned model to its intended pedestrian height, grounds it, turns the source's +Z facing toward the game's -Z heading, and matches animation playback to movement speed. Source geometry and materials remain shared; skeletons and animation state belong to each pedestrian. The helmet uses alpha blending for browser rendering.

## Afterlight surface and archetype polish

The retained CC0 downloads are still unmodified. `scripts/visitor_surfaces.py` creates original, reproducible surface finishes and equipment in Blender. The exported cast now contains **four robot and four alien archetypes**:

| Archetype | Retained source | Geometry changes |
| --- | --- | --- |
| Service robot (`robot-scout`) | `Robot.blend` | Chest telemetry housing and three status lamps |
| Utility mech (`robot-worker`) | `George.gltf` | Industrial chest electronics, cooling grille and shoulder fasteners |
| Cargo courier (`robot-courier`) | `Robot.blend` | Cargo case, lid and retention rails, long aerial and dispatch telemetry |
| District sentinel (`robot-sentinel`) | `George.gltf` | Heavy shoulder shells, optical visor, identification strips and rear power cells |
| Expedition resident (`alien-scout`) | `Alien.blend` | Wearable chest instrument and beacon |
| Atmospheric traveler (`alien-resident`) | `Alien_Helmet.blend` | Clear atmospheric helmet and chest pressure regulators |
| Ceremonial envoy (`alien-envoy`) | `Alien_Helmet.blend` | Shoulder mantle, clasps, collar rings and ceremonial brooch |
| Crested navigator (`alien-navigator`) | `Alien.blend` | Three cranial fins, survey pack and shoulder locator lights |

Every mesh receives regenerated UV islands with atlas gutters. Each GLB embeds a shared 1024 × 1024 color atlas and 512 × 512 normal and metallic/roughness atlases. Robot paint has a restrained brushed finish and fine panel lines; alien surfaces have subtle pore and pigment variation. Material finishes distinguish metal, painted housings, skin, dark eyes, emissive lamps and transparent helmets. All image content is generated by the script, with no external image download or image licensing dependency. Curved robot surfaces use smooth normals; alien base meshes receive one subdivision before skeletal deformation. Equipment follows native bones and is converted to skin weights during draw-call consolidation.

All eight exports retain native `Idle` and `Walk`, including baked IK. The build samples original, baked, consolidated and reimported geometry to verify deformation, checks root drift, and records texture dimensions, geometry details, counts and calibrated gait speeds in the adjacent JSON files. Runtime idle/walk transitions use the shared `src/npc-animation.js` controller and adjust gait speed to actual pedestrian movement.

The build is verified with Blender 5.0.1 and also targets Blender 4.5 or newer. Blender's Python must include NumPy for its glTF importer/exporter. To rebuild a subset, append `-- robot-courier alien-navigator` after the Python script argument. No new source download is required.
