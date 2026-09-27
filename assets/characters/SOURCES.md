# Character asset provenance

The Vex and citizen models combine MakeHuman Community's CC0 system assets and Quaternius's CC0 animations with original Afterlight rigging, boots, gloves, cybernetic equipment, weapon, retargeting, and export work. No Cyberpunk 2077 models or textures are included. Animation provenance and the unmodified source license are documented in [the animation source folder](../animations/quaternius/SOURCES.md).

## Licenses

The MakeHuman project's [asset license statement](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md#c-the-license-for-the-bundled-assets) releases its bundled graphical assets under CC0 1.0 Universal. The [official system asset catalog](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) explicitly lists `male_casualsuit05`, `short04`, and `young_lightskinned_male` as CC0. A copy of the CC0 terms is in `source/LICENSE.ASSETS.md`.

The original 1.2 download mirror files retain older AGPL notices in their headers. They are preserved verbatim for provenance; the current project license and official system asset catalog above document the subsequent CC0 release of these bundled assets. MakeHuman application code is separately AGPL; no application source code is incorporated into this game or the authoring script.

## Original data

Retrieved September 26, 2026 from the MakeHuman Community repository and its system asset mirror:

| Local source | Upstream |
| --- | --- |
| `base.obj` | [Base mesh](https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/3dobjs/base.obj) |
| `male.target` | [Young male shape](https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/targets/macrodetails/universal-male-young-averagemuscle-averageweight.target) |
| `male-face.target` | [Face shape](https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/targets/macrodetails/caucasian-male-young.target) |
| `default.mhskel`, `default_weights.mhw` | [Skeleton and skin weight data](https://github.com/makehumancommunity/makehuman/tree/master/makehuman/data/rigs) |
| `skin.png` | [Young male skin texture](https://download.tuxfamily.org/makehuman/assets/1.2/base/skins/textures/young_lightskinned_male_diffuse.png) |
| `male_casualsuit05.*`, diffuse and normal maps | [Utility jacket, shirt, jeans and fitting data](https://download.tuxfamily.org/makehuman/assets/1.2/base/clothes/male_casualsuit05/) |
| `short04.*`, diffuse/alpha map | [Slicked-back hair and fitting data](https://download.tuxfamily.org/makehuman/assets/1.2/base/hair/short04/) |

Credit: MakeHuman Team / MakeHuman Community system asset contributors. Original file notices identify Data Collection AB, Joel Palmius, and Jonas Hauquier.

## Afterlight authoring

`scripts/build_characters.py` fits the garments and hair to the shaped body, transfers and reduces skin influences to four per vertex, builds a 49-bone skeleton, and adds original equipment. `scripts/retarget_animations.py` calibrates the rig and transfers 16 authored clips from Quaternius Universal Animation Library Standard v3, including finger motion and pelvis movement. It preserves the character's bone lengths, corrects boot penetration, and bakes the motion at 30 fps. The game blends these clips with its own controller; it does not generate the walk cycles procedurally.

Both exported models retain the complete 25,802-triangle geometry and skeletal animations. Runtime pedestrians share base materials but have individual rigs, walk phases, and tints. The old reduced crowd mesh and eight gait morph targets are no longer used.

`afterlight-characters.blend` is the editable source with packed textures and animation actions. `textures/` contains derived 1024 px images. `public/models/*.glb` embed their textures and need no runtime asset service or Blender installation. The body shape is shared by the current crowd, with height, width, clothing tint, and skin tone variations; unique faces and additional body types are future art work.

To rebuild from the bundled source data with Blender 4.5 LTS:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe' --background --factory-startup --python scripts\build_characters.py
npm test
```

The script also renders front/back studio images in `test-results/` for inspection. Select a rig action in Blender's Action Editor to inspect each animation.
