import { footprintVertices } from './building-footprints.js';
import { WORLD_OBJECTS, DISTRICTS, districtAt } from './content.js';
import { COLORS, SYMBOLS } from './world.js';
import { formatCurrency } from './currency.js';
import { coastX } from './master-plan.js';
import { WORLD_LIMIT } from './world-config.js';
import { CITY_SCALE } from './world-scale.js';
import { constrainMapView, MAP_WORLD_SPAN } from './map-viewport.js';
import { roomAt } from './interior-plan.js';

const $ = id => document.getElementById(id);
export class HUD {
  constructor(city, campaign) {
    this.city = city; this.campaign = campaign; this.map = $('minimap').getContext('2d'); this.full = $('full-map').getContext('2d');
    this.nodes = Object.fromEntries(['health-value', 'health-bar', 'armor-value', 'armor-bar', 'ammo', 'credits', 'cred-value', 'level', 'speed', 'speed-bar', 'mission-title', 'mission-description', 'objective-text', 'objective-distance', 'mission-reward', 'weapon-panel', 'driving-panel', 'interaction', 'interact-caption', 'interact-label', 'notification', 'waypoint', 'waypoint-label', 'waypoint-distance', 'reload-hint', 'fps', 'district', 'map-district'].map(id => [id, $(id)]));
    $('ammo-bars').innerHTML = '<i></i>'.repeat(24); this.ammoBars = [...$('ammo-bars').children];
    this.lastAmmo = -1; this.lastDriving = null; this.notificationUntil = 0; this.lastStage = -1;
  }
  notify(text, duration = 4) { this.nodes.notification.textContent = text; this.nodes.notification.classList.remove('hidden'); this.notificationUntil = performance.now() + duration * 1000; }
  update(state, player, driving, nearest, objective, fps, nearby) {
    const n = this.nodes, data = this.campaign.data;
    n['health-value'].textContent = Math.ceil(state.health); n['health-bar'].style.transform = `scaleX(${state.health / 100})`;
    n['armor-value'].textContent = Math.ceil(state.armor); n['armor-bar'].style.transform = `scaleX(${state.armor / this.campaign.maxArmor})`;
    $('armor-max').textContent = `/ ${this.campaign.maxArmor}`;
    $('medkit-count').textContent = data.medkits; $('salvage-count').textContent = `${data.salvage} COMPONENTS`;
    const ammo = state.reloading > 0 ? '—' : state.ammo;
    if (this.lastAmmo !== ammo) { n.ammo.textContent = ammo; this.ammoBars.forEach((bar, i) => bar.classList.toggle('empty', i >= state.ammo)); this.lastAmmo = ammo; }
    n['reload-hint'].innerHTML = state.reloading > 0 ? 'RELOADING...' : '<kbd>R</kbd> RELOAD';
    n.credits.textContent = data.credits.toLocaleString('en-US'); n['cred-value'].textContent = data.xp; n.level.textContent = String(1 + Math.floor(data.xp / 500)).padStart(2, '0');
    n.fps.textContent = Math.round(fps);
    const climbing = !!player.climb, gliding = !!player.parachute;
    if (this.lastDriving !== !!driving || this.lastClimbing !== climbing || this.lastGliding !== gliding) {
      n['weapon-panel'].classList.toggle('hidden', !!driving || climbing || gliding); n['driving-panel'].classList.toggle('hidden', !driving);
      for (const id of ['crosshair', 'touch-fire', 'touch-reload']) $(id).style.display = driving || climbing || gliding ? 'none' : '';
      $('touch-interact').style.display = climbing || gliding ? 'none' : '';
      const jump = $('touch-jump'), interact = $('touch-interact');
      jump.querySelector('span').textContent = driving ? 'BRAKE' : 'JUMP';
      jump.setAttribute('aria-label', driving ? 'Handbrake' : 'Jump');
      interact.querySelector('span').textContent = driving ? 'EXIT' : 'USE';
      interact.setAttribute('aria-label', driving ? 'Exit vehicle' : 'Talk, use, or enter vehicle');
      $('joystick').querySelector('.joystick-label').textContent = driving ? 'DRIVE' : climbing ? 'CLIMB' : gliding ? 'GLIDE' : 'MOVE';
      this.lastDriving = !!driving; this.lastClimbing = climbing; this.lastGliding = gliding;
    }
    const face = player.climb ?? player.climbCandidate, touch = document.body.classList.contains('touch');
    const showClimb = !!face && !driving && state.started && !state.paused;
    const showGlide = gliding && !driving && state.started && !state.paused;
    $('climb-panel').classList.toggle('hidden', !showClimb && !showGlide); $('climb-panel').classList.toggle('near-wall', !climbing && !gliding);
    $('touch-climb').classList.toggle('hidden', !showClimb); $('touch-climb').textContent = climbing ? 'LET GO' : 'CLIMB';
    if (showGlide) {
      $('climb-title').textContent = player.parachute.openness < 1 ? 'PARACHUTE OPENING' : 'PARACHUTE';
      $('climb-height').textContent = `${Math.max(0, Math.round(player.y - player.groundY))} M`;
      $('climb-progress').style.width = `${Math.round(player.parachute.openness * 100)}%`;
      $('climb-controls').textContent = touch ? 'Stick to steer · Height to landing\nPacks away on landing' : 'WASD to steer · Height to landing\nPacks away on landing';
    } else if (showClimb) {
      $('climb-title').textContent = !climbing ? 'WALL WITHIN REACH' : face.mode === 'mantle' ? 'PULLING UP' : face.blocked ? 'MOVE ALONG THE WALL' : 'CLIMBING';
      $('climb-height').textContent = `${Math.round(climbing ? player.y : face.roofY)} M`;
      $('climb-progress').style.width = `${Math.min(100, Math.max(0, (player.y - face.baseY) / Math.max(1, face.roofY - face.baseY) * 100))}%`;
      $('climb-controls').textContent = touch ? climbing ? 'Stick: climb & move sideways. ↑ jump off. LET GO to drop.' : 'Tap CLIMB to grab this wall.' : climbing ? 'W/S up & down · A/D sideways\nShift climb faster · Space jump off · C release' : 'C to climb · Space to grab a wall ahead';
    }
    if (driving) { const speed = Math.round(Math.abs(driving.speed) * 3.6); n.speed.textContent = speed; n['speed-bar'].style.width = `${Math.min(speed / 151 * 100, 100)}%`; }
    const canInteract = !driving && !climbing && !gliding && (nearby || nearest) && state.started && !state.paused;
    n.interaction.classList.toggle('hidden', !canInteract);
    if (canInteract) {
      n['interact-caption'].textContent = nearby ? nearby.name.toUpperCase() : 'ARCHER GT / AVAILABLE';
      n['interact-label'].textContent = nearby ? ({ contact: 'Talk', cache: 'Search supplies', memory: 'Recover memory', terminal: 'Access terminal', transit: 'Open transit map', rest: 'Rest & recover', board: 'Browse local jobs', lift: 'Choose a floor' }[nearby.type]) : 'Take the wheel';
    }
    if (performance.now() > this.notificationUntil) n.notification.classList.add('hidden');
    const distance = Math.round(Math.hypot(player.x - objective.x, player.z - objective.z));
    const rise = Math.round((objective.y ?? player.y) - player.y);
    n['objective-distance'].textContent = objective.hidden ? 'CITY OPEN' : `${distance} M AWAY${Math.abs(rise) > 3 ? ` / ${rise > 0 ? '↑' : '↓'} ${Math.abs(rise)} M` : ''}`;
    n['mission-title'].textContent = objective.pinned ? objective.label : objective.quest?.title ?? 'The city is yours';
    n['mission-description'].textContent = objective.pinned ? 'A place worth finding. Your stories are waiting in the journal.' : objective.quest?.description ?? 'There are still voices to hear and streets to explore.';
    n['objective-text'].textContent = objective.text;
    n['mission-reward'].textContent = objective.quest ? `+${formatCurrency(objective.quest.reward)}` : 'J / FIELD JOURNAL';
    const district = districtAt(player.x, player.z).name.toUpperCase();
    n.district.textContent = player.interior?.inside ? interiorLabel(player.interior) : district; n['map-district'].textContent = district;
  }
  waypoint(camera, objective, player, vector, active) {
    const el = this.nodes.waypoint;
    if (!active || objective.hidden) { el.classList.add('hidden'); return; }
    vector.set(objective.x, (objective.y ?? 0) + 3.5, objective.z).project(camera);
    if (vector.z > 1 || vector.z < -1 || Math.abs(vector.x) > .88 || Math.abs(vector.y) > .83 || Math.hypot(player.x - objective.x, player.z - objective.z) < 4) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden'); el.style.left = `${(vector.x * .5 + .5) * innerWidth}px`; el.style.top = `${(-vector.y * .5 + .5) * innerHeight}px`; el.style.transform = 'translate(-50%,-100%)';
    const rise = Math.round((objective.y ?? player.y) - player.y);
    this.nodes['waypoint-label'].textContent = objective.label; this.nodes['waypoint-distance'].textContent = `${Math.round(Math.hypot(player.x - objective.x, player.z - objective.z))} M${Math.abs(rise) > 3 ? ` / ${rise > 0 ? '↑' : '↓'} ${Math.abs(rise)} M` : ''}`;
  }
  drawMap(player, yaw, drones, objective, expanded = false) {
    const ctx = expanded ? this.full : this.map, w = ctx.canvas.width, h = ctx.canvas.height;
    const view = this.city.mapView;
    if (expanded) constrainMapView(view, ctx.canvas);
    const scale = expanded ? Math.min(w, h) / view.span : 2.1;
    const cx = expanded ? view.x : player.x, cz = expanded ? view.z : player.z;
    const point = (x, z) => [w / 2 + (x - cx) * scale, h / 2 + (z - cz) * scale];
    this.drawBaseMap(ctx, w, h, cx, cz, scale, expanded);
    if (!objective.hidden) {
      const [px, py] = point(player.x, player.z); let [ox, oy] = point(objective.x, objective.z);
      if (!expanded) { const ratio = Math.min(1, (w / 2 - 14) / Math.max(1, Math.abs(ox - w / 2)), (h / 2 - 14) / Math.max(1, Math.abs(oy - h / 2))); ox = w / 2 + (ox - w / 2) * ratio; oy = h / 2 + (oy - h / 2) * ratio; }
      ctx.strokeStyle = '#d7eb7899'; ctx.lineWidth = expanded ? 1.5 : 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ox, oy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#e4dd8e'; ctx.save(); ctx.translate(ox, oy); ctx.rotate(Math.PI / 4); ctx.fillRect(-4, -4, 8, 8); ctx.restore();
    }
    for (const place of WORLD_OBJECTS) {
      if (this.campaign.data.collected.includes(place.id)) continue;
      if (['cache', 'memory'].includes(place.type) && Math.hypot(player.x - place.x, player.z - place.z) > 38 && place.id !== objective.id) continue;
      if (place.type === 'terminal' && place.id !== objective.id) continue;
      const [x, y] = point(place.x, place.z);
      ctx.fillStyle = COLORS[place.type];
      if (expanded) {
        ctx.fillStyle = '#0a1822'; ctx.fillRect(x - 7, y - 7, 14, 14);
        ctx.font = '600 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = COLORS[place.type];
        ctx.globalAlpha = place.type === 'transit' && !this.campaign.data.transit.includes(place.id) ? .5 : 1;
        ctx.fillText(SYMBOLS[place.type], x, y); ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      } else { ctx.beginPath(); ctx.arc(x, y, place.type === 'contact' ? 4.5 : 3, 0, Math.PI * 2); ctx.fill(); }
    }
    for (const car of this.city.cars) {
      if (expanded && scale < .12 && Math.hypot(player.x - car.x, player.z - car.z) > 300) continue;
      const [x, y] = point(car.x, car.z); ctx.fillStyle = '#80ded7'; ctx.save(); ctx.translate(x, y); ctx.rotate(-car.yaw); ctx.fillRect(-2.7, -4.5, 5.4, 9); ctx.restore();
    }
    for (const drone of drones) {
      if (drone.dead) continue;
      if (expanded && scale < .12 && Math.hypot(player.x - drone.root.position.x, player.z - drone.root.position.z) > 300) continue;
      const [x, y] = point(drone.root.position.x, drone.root.position.z); ctx.fillStyle = '#ff647e'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    const [px, py] = point(player.x, player.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(-yaw); ctx.fillStyle = '#dcff8720'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, expanded ? 32 : 48, -Math.PI * .7, -Math.PI * .3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#dfff85'; ctx.strokeStyle = '#263d2b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3); ctx.lineTo(-6.5, 7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    if (expanded) {
      ctx.font = '600 10px Barlow, Arial'; ctx.fillStyle = '#b5cbcc'; ctx.textAlign = 'center';
      DISTRICTS.forEach(d => { ctx.fillStyle = this.campaign.data.discovered.includes(d.id) ? '#bed5cc' : '#6f8a95'; ctx.fillText(d.name.toUpperCase(), ...point(d.x, d.z + 40)); });
      ctx.textAlign = 'left'; ctx.font = '10px Barlow, Arial'; ctx.fillStyle = '#7a999d'; ctx.fillText('N ↑', 20, 27); ctx.fillText(`${view.span >= MAP_WORLD_SPAN ? `${MAP_WORLD_SPAN / 1000} KM × ${MAP_WORLD_SPAN / 1000} KM` : `${Math.round(view.span)} M VIEW`} / ${DISTRICTS.length} DISTRICTS`, 20, h - 20);
    }
  }
  drawBaseMap(ctx, w, h, cx, cz, scale, expanded) {
    this.mapCaches ??= [];
    const x = Math.round(cx / 48) * 48, z = Math.round(cz / 48) * 48;
    const key = `${x},${z},${scale},${w},${h}`, slot = expanded ? 1 : 0;
    let cache = this.mapCaches[slot];
    if (!cache || cache.key !== key) {
      const canvas = cache?.canvas ?? document.createElement('canvas'); canvas.width = w + 256; canvas.height = h + 256;
      const c = canvas.getContext('2d'), point = (px, pz) => [canvas.width / 2 + (px - x) * scale, canvas.height / 2 + (pz - z) * scale];
      const rx = canvas.width / 2 / scale, rz = canvas.height / 2 / scale;
      c.fillStyle = '#0a1822'; c.fillRect(0, 0, canvas.width, canvas.height);
      c.save(); c.beginPath(); c.rect(...point(-WORLD_LIMIT, -WORLD_LIMIT), MAP_WORLD_SPAN * scale, MAP_WORLD_SPAN * scale); c.clip();
      c.fillStyle = '#092a3c'; c.beginPath();
      const coastExtent = WORLD_LIMIT + 500 * CITY_SCALE;
      c.moveTo(...point(coastExtent, -coastExtent));
      for (let shore = -coastExtent; shore <= coastExtent; shore += 120 * CITY_SCALE) c.lineTo(...point(coastX(shore), shore));
      c.lineTo(...point(coastExtent, coastExtent)); c.closePath(); c.fill();
      const segments = this.city.roadIndex.query(x - rx, z - rz, x + rx, z + rz);
      for (const layer of ['local', 'secondary', 'primary', 'expressway', 'ramp', 'pedestrian']) {
        const minimumWidth = { expressway: 2, primary: 1.7, secondary: .85, local: .35 }[layer] ?? .65;
        c.strokeStyle = { local: '#344e59', secondary: '#6b9bc0', primary: '#b375a4', expressway: '#f18c65', ramp: '#e6ad79', pedestrian: '#7ad8c5' }[layer];
        const widths = new Map();
        for (const s of segments) {
          const roadClass = s.road?.class ?? s.class;
          const kind = s.kind === 'pedestrian' || roadClass === 'pedestrian' ? 'pedestrian' : roadClass === 'ramp' ? 'ramp' : roadClass === 'expressway' ? 'expressway' : roadClass === 'primary' ? 'primary' : roadClass === 'secondary' ? 'secondary' : 'local';
          if (kind !== layer || scale < .12 && kind === 'pedestrian') continue;
          const width = Math.max(minimumWidth, s.width * scale);
          if (!widths.has(width)) widths.set(width, []);
          widths.get(width).push(s);
        }
        for (const [width, group] of widths) {
          c.beginPath(); c.lineWidth = width;
          for (const s of group) { c.moveTo(...point(s.a.x, s.a.z)); c.lineTo(...point(s.b.x, s.b.z)); }
          c.stroke();
        }
      }
      if (scale >= .12) for (const s of this.city.masterPlan.supports) {
        c.strokeStyle = '#7ad8c5'; c.fillStyle = '#457c7699';
        if (s.a) { c.lineWidth = Math.max(1, s.width * scale); c.beginPath(); c.moveTo(...point(s.a.x, s.a.z)); c.lineTo(...point(s.b.x, s.b.z)); c.stroke(); }
        else { const [px, pz] = point(s.minX, s.minZ); c.fillRect(px, pz, s.width * scale, s.depth * scale); }
      }
      if (expanded && scale < .16) {
        c.textAlign = 'center'; c.font = 'bold 10px Arial';
        for (const interchange of this.city.masterPlan.interchanges) {
          const [px, pz] = point(interchange.x, interchange.z);
          c.fillStyle = '#091820'; c.strokeStyle = '#eeccb0'; c.lineWidth = 1.3; c.beginPath(); c.arc(px, pz, 8, 0, Math.PI * 2); c.fill(); c.stroke();
          c.fillStyle = '#f5ead7'; c.fillText(interchange.number, px, pz + 3.5);
        }
        c.textAlign = 'left';
      }
      if (rx < 1500 && rz < 1500) {
        const blocks = this.city.metropolis.area(x - rx, z - rz, x + rx, z + rz);
        for (const f of [...(this.city.plan.features ?? []), ...blocks.flatMap(b => b.features ?? [])]) {
          const [px, py] = point(f.x, f.z);
          c.fillStyle = f.type === 'garden' ? '#376455' : f.type === 'court' ? '#38626b' : '#685d50';
          const width = (f.w ?? 40) * scale, depth = (f.d ?? 40) * scale;
          if (f.shape === 'circle') { c.beginPath(); c.ellipse(px, py, width / 2, depth / 2, 0, 0, Math.PI * 2); c.fill(); }
          else c.fillRect(px - width / 2, py - depth / 2, width, depth);
        }
        const buildings = this.city.mapInfo.concat(blocks.flatMap(b => b.buildings));
        c.fillStyle = '#1f3944'; c.strokeStyle = '#3e5861'; c.lineWidth = .7;
        for (const b of buildings) {
          if (Math.abs(b.x - x) > rx + 40 || Math.abs(b.z - z) > rz + 40) continue;
          const [px, py] = point(b.x, b.z); c.save(); c.translate(px, py); c.rotate(-(b.yaw ?? 0));
          c.beginPath();
          footprintVertices(b.footprint, b.w * scale, b.d * scale).forEach((v, i) => i ? c.lineTo(v.x, v.z) : c.moveTo(v.x, v.z));
          c.closePath(); c.fill(); if (scale > .5) c.stroke(); c.restore();
        }
      }
      c.restore();
      cache = { key, canvas, x, z }; this.mapCaches[slot] = cache;
    }
    ctx.drawImage(cache.canvas, -128 + (cache.x - cx) * scale, -128 + (cache.z - cz) * scale);
  }
}

// "Building · floor · unit or room", e.g. NORTHLIGHT HOMES · FLOOR 12 · 12B.
export function interiorLabel({ plan, level, local }) {
  const room = roomAt(plan, level, local.x, local.z);
  const where = room?.unit ? room.unit.slice(plan.id.length + 1) : room ? room.kind.toUpperCase() : null;
  return [(plan.name ?? plan.type).toUpperCase(), `FLOOR ${level + 1}`, where].filter(Boolean).join(' · ');
}
