// Original character designs. Appearance and delivery are authored independently
// of names, skin tones and faction allegiance.
export const NPC_PROFILES = {
  mara: { id: 'mara', age: 32, height: 1.72, width: .95, depth: .96, waist: .79, hips: 1.16, jaw: .84, cheeks: 1.05, faceLength: .95, nose: -.003, skin: '#bb8867', hair: '#382536', hairstyle: 'swept', jacket: '#592b3d', trousers: '#191c2b', accent: '#d4b071', iris: '#627d61', outfit: 'radio', glasses: null,
    fashion: { inner: '#161b22', neckline: 1.43, roughness: .38, metalness: .12, boots: true }, makeup: { lips: '#823c49', strength: .66, liner: .58 }, jewelry: 'hoops', stance: { chest: [-.045, .04, -.025], head: [.01, -.055, -.05] },
    description: 'Side-swept plum hair, berry lips and gold hoops; a fitted burgundy leather jacket over a plunging black top, belted trousers and tall boots.' },
  imani: { id: 'imani', age: 48, height: 1.68, width: 1.06, depth: 1.07, waist: .97, hips: 1.2, jaw: .91, cheeks: 1.15, faceLength: .96, nose: .004, skin: '#76503d', hair: '#92978f', hairstyle: 'coils', jacket: '#e1d6bc', trousers: '#294e51', accent: '#d0aa63', iris: '#4a2d23', outfit: 'medic', glasses: 'round',
    fashion: { inner: '#225f60', neckline: 1.48, roughness: .62, metalness: .02 }, makeup: { lips: '#784647', strength: .5, liner: .34 }, jewelry: 'drops', stance: { chest: [-.025, -.025, .02], head: [0, .035, .025] },
    description: 'Sculpted silver coils, bronze makeup and gold drop earrings; a cream blazer cinched over a teal satin camisole.' },
  sable: { id: 'sable', age: 35, height: 1.65, width: .9, depth: .92, waist: .78, hips: 1.13, jaw: .8, cheeks: 1.02, faceLength: .96, nose: .002, skin: '#e2c5a2', hair: '#191d2a', hairstyle: 'bob', jacket: '#302b41', trousers: '#1e2031', accent: '#b99dcf', iris: '#49322c', outfit: 'archivist', glasses: 'square',
    fashion: { inner: '#181c25', neckline: 1.40, roughness: .4, metalness: .07, pinstripe: true, boots: true }, makeup: { lips: '#863c50', strength: .72, liner: .62 }, jewelry: 'pendant', stance: { chest: [-.04, -.05, .015], head: [.015, .045, -.035] },
    description: 'A sharp black bob, wine lipstick and fine silver frames; a close-cut plum evening suit with a deep neckline and an amethyst pendant.' },
  rook: { id: 'rook', age: 43, height: 1.88, width: 1.17, depth: 1.11, waist: 1.02, hips: 1.03, jaw: 1.09, cheeks: 1.04, faceLength: 1.06, nose: -.005, skin: '#8e6148', hair: '#352c25', hairstyle: 'shaved', beard: 'short', jacket: '#9d6535', trousers: '#3c4547', accent: '#e7ab54', iris: '#503a23', outfit: 'mechanic', glasses: null,
    signature: 'mechanist', scar: true, stance: { chest: [-.055, .09, -.025], head: [.025, -.065, .05] },
    description: 'An amber optical implant, an eyebrow scar and an exposed mechanical forearm brace; battered ochre workwear, one armored shoulder and a tiny brass bird.' },
  jun: { id: 'jun', age: 31, height: 1.74, width: .98, depth: 1.02, waist: 1.03, hips: 1.04, jaw: .96, cheeks: 1.09, faceLength: 1.01, nose: .003, skin: '#c4ae86', hair: '#493629', hairstyle: 'beanie', jacket: '#52614a', trousers: '#4c493a', accent: '#94c893', iris: '#5a4930', outfit: 'gardener', description: 'A moss beanie, loose work clothes and a canvas apron full of seed packets.' },
  orrin: { id: 'orrin', age: 58, height: 1.8, width: 1.1, depth: 1.12, waist: 1.1, hips: 1.06, jaw: 1.04, cheeks: .97, faceLength: 1.08, nose: -.008, skin: '#c09b78', hair: '#909b98', hairstyle: 'cap', beard: 'braided', jacket: '#243b4d', trousers: '#303b43', accent: '#b98852', iris: '#6d8790', outfit: 'sailor',
    signature: 'navigator', coatDrop: .15, scar: true, stance: { chest: [-.025, -.06, .03], head: [.015, .06, -.045] },
    description: 'A braided silver beard, a weathered cheek and a brass-ringed ear; a long naval coat, worn epaulettes and a pocket compass on a chain.' },
  cass: { id: 'cass', age: 26, height: 1.61, width: .92, depth: .91, waist: .8, hips: 1.13, jaw: .86, cheeks: 1.07, faceLength: .93, nose: .001, skin: '#bc8b6b', hair: '#347e7f', hairstyle: 'pixie', jacket: '#a44160', trousers: '#252b3e', accent: '#80c8bd', iris: '#5d7275', outfit: 'courier',
    fashion: { inner: '#222a38', neckline: 1.47, crop: 1.185, roughness: .34, metalness: .09, boots: true }, makeup: { lips: '#984653', strength: .62, liner: .65 }, jewelry: 'choker', stance: { chest: [-.04, .055, -.04], head: [0, -.04, .065] },
    description: 'A swept teal pixie cut, smoky eyes and an iridescent choker; a cropped rose moto jacket, bare midriff and fitted high-waisted riding trousers.' },
};

// Shape blends are individual art direction, independent of voice selection.
for (const [id, faceShape, shoulders, chest] of [
  ['mara', 1, .9, .032], ['imani', .9, .96, .038], ['sable', 1, .88, .029],
  ['rook', 0, 1.08, .01], ['jun', .48, .97, .008], ['orrin', .08, 1.02, .004], ['cass', .94, .89, .027],
]) Object.assign(NPC_PROFILES[id], { faceShape, shoulders, chest });

// Reusable crowd archetypes retain the same full animated rig, with distinct
// silhouettes and faces rather than a random tint on a single identical person.
export const CROWD_PROFILES = [
  ...Object.values(NPC_PROFILES).map((p, i) => ({ ...p, id: `resident-${i}`, outfit: ['casual', 'scarf', 'casual', 'vest', 'casual', 'scarf', 'courier'][i], glasses: i === 2 ? 'square' : null, jacket: ['#667685', '#786449', '#577a75', '#746384', '#9a6b53', '#40576c', '#818658'][i] })),
  { ...NPC_PROFILES.imani, id: 'resident-7', height: 1.81, width: 1.04, hair: '#292323', skin: '#604434', jacket: '#b29069', hairstyle: 'coils', outfit: 'casual', glasses: null },
  { ...NPC_PROFILES.sable, id: 'resident-8', height: 1.76, width: 1.01, skin: '#b88a61', hair: '#a17a45', jacket: '#476571', hairstyle: 'bun', outfit: 'scarf', glasses: null },
  { ...NPC_PROFILES.rook, id: 'resident-9', height: 1.73, width: 1.1, skin: '#d2b8a3', hair: '#756b65', jacket: '#8b5853', hairstyle: 'cap', outfit: 'vest', glasses: null },
  { ...NPC_PROFILES.cass, id: 'resident-10', height: 1.79, width: .91, skin: '#856047', hair: '#ddd0be', jacket: '#637587', hairstyle: 'undercut', outfit: 'casual' },
  { ...NPC_PROFILES.jun, id: 'resident-11', height: 1.63, width: 1.15, skin: '#d7b18d', hair: '#414143', jacket: '#82729a', hairstyle: 'bob', outfit: 'casual', glasses: 'round' },
];

// Hero props belong to their owners; passers-by retain simpler streetwear.
for (const profile of CROWD_PROFILES) { profile.signature = null; profile.stance = null; profile.jewelry = null; profile.coatDrop = 0; }

// Pitch/rate characterize delivery. Preferred names select a fitting device
// voice when one exists; voice inventory is never inferred from appearance.
export const VOICE_PROFILES = {
  mara: { pitch: 1.02, rate: .99, voiceSlot: 0, preferred: ['Zira', 'Samantha', 'Aria', 'Jenny', 'Female'], label: 'Warm / direct' },
  imani: { pitch: .9, rate: .9, voiceSlot: 1, preferred: ['Hazel', 'Serena', 'Sonia', 'Zira', 'Female'], label: 'Calm / measured' },
  sable: { pitch: 1.08, rate: 1.03, voiceSlot: 2, preferred: ['Susan', 'Victoria', 'Libby', 'Samantha', 'Female'], label: 'Precise / restrained' },
  rook: { pitch: .78, rate: .94, voiceSlot: 0, preferred: ['David', 'Daniel', 'Guy', 'Male'], label: 'Low / unhurried' },
  jun: { pitch: 1, rate: .96, voiceSlot: 3, preferred: ['Mark', 'Alex', 'Ryan', 'Karen'], label: 'Gentle / conversational' },
  orrin: { pitch: .7, rate: .86, voiceSlot: 1, preferred: ['George', 'Daniel', 'David', 'Male'], label: 'Weathered / deliberate' },
  cass: { pitch: 1.19, rate: 1.11, voiceSlot: 4, preferred: ['Zira', 'Samantha', 'Jenny', 'Female'], label: 'Bright / quick' },
  echo: { pitch: .66, rate: .83, voiceSlot: 2, preferred: ['Mark', 'David', 'Alex', 'Male'], label: 'Synthetic / deliberate' },
};
