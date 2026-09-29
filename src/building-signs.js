import * as THREE from 'three';
import { drawSign } from './city.js';
import { terrainHeight } from './master-plan.js';
import { footprintFrontage } from './building-footprints.js';

// Reuse the original city's sign language, with tenants appropriate to each
// building use. These 28 designs share one atlas throughout the entire city.
export const BUILDING_SIGN_CATALOG = Object.fromEntries(Object.entries({
  office: [
    ['SYNAPSE', 'NEURAL SYSTEMS / CORPORATE OFFICES', '#5ff4df'],
    ['NOVA', 'DATA EXCHANGE / NETWORK SERVICES', '#bd9fff'],
    ['NEURO', 'COGNITIVE RESEARCH / DEVELOPMENT', '#fc779f'],
    ['VOLT', 'CITY GRID / OPERATIONS', '#dcf994'],
  ],
  apartment: [
    ['AURORA', 'RESIDENCES / LOBBY ENTRANCE', '#8edacb'],
    ['ORBIT', 'APARTMENTS / RESIDENT ACCESS', '#aebcf0'],
    ['NIGHTFALL', 'CITY LIVING / RESIDENCES', '#cfabe5'],
    ['VESPER', 'RESIDENTIAL TOWER / RECEPTION', '#99d4dd'],
  ],
  terrace: [
    ['HEMLOCK', 'ROW HOUSES / RESIDENT ACCESS', '#b9d6a0'],
    ['SOUTHGATE', 'HOMES / PRIVATE ENTRANCE', '#d4c49c'],
    ['SUNSET COURT', 'RESIDENCES / COURTYARD', '#e3ad96'],
    ['LANE 09', 'STUDIOS / RESIDENT ENTRANCE', '#a5c8ca'],
  ],
  market: [
    ['KŌJI', 'RAMEN BAR / OPEN ALL NIGHT', '#ffab65'],
    ['AFTER HOURS', 'LATE BAR / NO SLEEP. NO LIMITS.', '#fa58ab'],
    ['DEEP BLUE', 'RECORDS / UNDERGROUND SOUND', '#60b3ff'],
    ['HALO', 'AUGMENTATION CLINIC / WALK IN', '#7dccfa'],
  ],
  civic: [
    ['CIVIC LINK', 'PUBLIC SERVICES / INFORMATION', '#98d9dd'],
    ['PULSE', 'COMMUNITY HEALTH CENTRE', '#aadfbf'],
    ['COMMONS', 'PUBLIC LIBRARY / CITY ARCHIVE', '#c5d6a1'],
    ['CITY WORKS', 'MUNICIPAL SERVICES / RECEPTION', '#b8cddd'],
  ],
  warehouse: [
    ['BLACKWATER', 'FREIGHT HANDLING / LOADING BAYS', '#e4b475'],
    ['SILVER DELTA', 'CARGO STORAGE / DISTRIBUTION', '#b8c9c9'],
    ['LONG HAUL', 'WAREHOUSING / DISPATCH', '#d3bf8a'],
    ['PORTLINE', 'LOGISTICS DEPOT / RECEIVING', '#95c9c1'],
  ],
  factory: [
    ['FOUNDRY', 'ALLOY PROCESSING / PLANT ACCESS', '#d4a17c'],
    ['VOLT POWER', 'POWER SYSTEMS / MANUFACTURING', '#c0cd91'],
    ['SYNTH / FAB', 'PRECISION ASSEMBLY / WORKS', '#9dc7d0'],
    ['IRONWORKS', 'INDUSTRIAL FABRICATION / GOODS IN', '#cea18e'],
  ],
}).map(([type, entries], typeIndex) => [type, entries.map(([title, subtitle, color], index) => ({ type, title, subtitle, color, tile: typeIndex * 4 + index }))]));

const hash = value => { let n = 2166136261; for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };
const ATLAS_SIZE = 2048, TILE_WIDTH = 512, TILE_HEIGHT = 256, INSET_X = 8, INSET_Y = 35;
const IMAGE_WIDTH = 496, IMAGE_HEIGHT = 186;

export function signUV(tile) {
  const x = tile % 4 * TILE_WIDTH + INSET_X, y = Math.floor(tile / 4) * TILE_HEIGHT + INSET_Y;
  // Half-texel inset and generous dark gutters keep neighboring designs out
  // of the sign's filtered edges, including mipmapped distant views.
  return [(x + .5) / ATLAS_SIZE, 1 - (y + IMAGE_HEIGHT - .5) / ATLAS_SIZE, (IMAGE_WIDTH - 1) / ATLAS_SIZE, (IMAGE_HEIGHT - 1) / ATLAS_SIZE];
}

function streetFor(p, plan) {
  if (p.street) return p.street;
  // Authored landmark towers have no generated frontage. Find their nearest
  // surface street, not the expressway that may pass over their roof/entrance.
  let nearest = null, best = Infinity;
  for (const radius of [128, 384, 768]) {
    for (const s of plan.roadIndex.query(p.x - radius, p.z - radius, p.x + radius, p.z + radius)) {
      const road = s.road;
      if (road.class === 'expressway' || road.kind === 'ramp') continue;
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, length2 = dx * dx + dz * dz;
      if (length2 < .001) continue;
      const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.z - s.a.z) * dz) / length2));
      const x = s.a.x + t * dx, z = s.a.z + t * dz, y = s.a.y + t * (s.b.y - s.a.y);
      if (Math.abs(y - terrainHeight(x, z)) > 1.1) continue;
      const distance = Math.hypot(p.x - x, p.z - z);
      if (distance < best) { best = distance; nearest = { x, y, z, roadId: road.id, width: road.width }; }
    }
    if (nearest) break;
  }
  return nearest;
}

export function buildingSign(p, plan) {
  const choices = BUILDING_SIGN_CATALOG[p.type];
  if (!choices) throw new Error(`No building signs for ${p.type}`);
  const design = choices[hash(p.id) % choices.length], street = streetFor(p, plan);
  if (!street) throw new Error(`No street frontage for ${p.id}`);
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = street.x - p.x, dz = street.z - p.z;
  const localX = dx * c - dz * s, localZ = dx * s + dz * c;
  const face = footprintFrontage(p, { x: localX, z: localZ });
  const normal = { x: face.nx, z: face.nz }, faceWidth = face.width;
  const residential = p.type === 'apartment' || p.type === 'terrace';
  const loading = ['warehouse', 'factory', 'market'].includes(p.type);
  const bottom = loading ? 5.3 : 4.3;
  const h = Math.min(residential ? 2.25 : 3.5, p.h - bottom - .55, faceWidth * .72 * 3 / 8), w = h * 8 / 3;
  // Above shop canopies/loading doors and below the first residential balcony.
  // A shallow physical backboard separates the plane from facade ribs/windows.
  const lx = face.x + normal.x * .38, lz = face.z + normal.z * .38;
  return { ...design, street, x: p.x + lx * c + lz * s, y: p.y + bottom + h / 2, z: p.z - lx * s + lz * c,
    yaw: p.yaw + Math.atan2(normal.x, normal.z), w, h, uv: signUV(design.tile) };
}

export function createBuildingSignMaterial() {
  let atlas;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = ATLAS_SIZE;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#09131c'; ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    for (const design of Object.values(BUILDING_SIGN_CATALOG).flat()) {
      ctx.save(); ctx.translate(design.tile % 4 * TILE_WIDTH + INSET_X, Math.floor(design.tile / 4) * TILE_HEIGHT + INSET_Y);
      ctx.scale(IMAGE_WIDTH / 1024, IMAGE_HEIGHT / 384);
      drawSign(ctx, design.title, design.subtitle, design.color); ctx.restore();
    }
    atlas = new THREE.CanvasTexture(canvas);
  } else {
    // Headless geometry tests retain the same UV/material path without a DOM.
    atlas = new THREE.DataTexture(new Uint8Array([9, 19, 28, 255]), 1, 1); atlas.needsUpdate = true;
  }
  atlas.name = 'building-sign-atlas'; atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter; atlas.generateMipmaps = true; atlas.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false }); material.name = 'building-signs';
  material.onBeforeCompile = shader => {
    shader.vertexShader = `attribute vec4 instanceUvRect;\n${shader.vertexShader}`.replace('#include <uv_vertex>', `#include <uv_vertex>\n vMapUv = instanceUvRect.xy + vMapUv * instanceUvRect.zw;`);
  };
  material.customProgramCacheKey = () => 'building-sign-atlas-v1';
  return material;
}
