# Authored animation provenance

**Quaternius — Universal Animation Library, Standard v3 (free edition)**

- Official pack: https://quaternius.com/packs/universalanimationlibrary.html
- Official download and changelog: https://quaternius.itch.io/universal-animation-library
- Creator: Quaternius. The project page credits animator Gonzalo Furnier.
- License: CC0 1.0 Universal, free for personal and commercial use. The original `License.txt` and `README.txt` are preserved beside this file.
- Retrieved September 26, 2026 via the official free Standard download, without buying the Pro or source-file editions.
- Original ZIP SHA-256: `CC73FC4E495B82958207316596317A3F40B9FA38065BDE1027937452DA537724`.

The retained ZIP is the unmodified download. `UAL1_Standard.glb` contains 43 in-place source clips and the reference mannequin. `UAL1_Standard_RM.glb` contains the root-motion versions. The pack page also advertises larger paid editions; those animations are not bundled here.

## Retargeted clips

| Afterlight | Source clip |
| --- | --- |
| Idle | Idle_Loop |
| Walk | Walk_Loop |
| WalkFormal | Walk_Formal_Loop |
| Jog | Jog_Fwd_Loop |
| Run | Sprint_Loop |
| JumpStart / JumpLoop / JumpLand | Jump_Start / Jump_Loop / Jump_Land |
| ArmedIdle | Pistol_Idle_Loop |
| Aim / AimUp / AimDown | Pistol_Aim_Neutral / Pistol_Aim_Up / Pistol_Aim_Down |
| Reload / Fire | Pistol_Reload / Pistol_Shoot |
| Hit / Driving | Hit_Chest / Driving_Loop |

Hit and Driving are available in the exports for future controller work. The current vehicle view hides the player model. The free pack does not supply directional pistol locomotion; armed movement blends the forward locomotion clips with the pistol upper body.

`scripts/retarget_animations.py` maps the source rig onto the MakeHuman-based Afterlight rig. It calibrates facing, bind pose, and palm orientation, transfers joint rotations and scaled pelvis motion, and bakes self-contained clips into `public/models/vex.glb` and `citizen.glb`. No runtime downloads, account, or animation service is required.

Walk, jog, and sprint playback rates use the distance covered by their corresponding root-motion clips, scaled to the character's height. Both the source data and the packed editable Blender file are included for future animation work.
