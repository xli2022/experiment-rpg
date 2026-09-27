import { STREETS } from './city.js';
import { WORLD_OBJECTS, DISTRICTS, districtAt } from './content.js';
import { MAP_SPAN, COLORS, SYMBOLS } from './world.js';

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
    n.credits.textContent = data.credits.toLocaleString(); n['cred-value'].textContent = data.xp; n.level.textContent = String(1 + Math.floor(data.xp / 500)).padStart(2, '0');
    n.fps.textContent = Math.round(fps);
    if (this.lastDriving !== !!driving) {
      n['weapon-panel'].classList.toggle('hidden', !!driving); n['driving-panel'].classList.toggle('hidden', !driving);
      document.getElementById('crosshair').style.display = driving ? 'none' : '';
      document.getElementById('touch-fire').style.display = driving ? 'none' : '';
      document.getElementById('touch-reload').style.display = driving ? 'none' : '';
      this.lastDriving = !!driving;
    }
    if (driving) { const speed = Math.round(Math.abs(driving.speed) * 3.6); n.speed.textContent = speed; n['speed-bar'].style.width = `${Math.min(speed / 151 * 100, 100)}%`; }
    const canInteract = !driving && (nearby || nearest) && state.started && !state.paused;
    n.interaction.classList.toggle('hidden', !canInteract);
    if (canInteract) {
      n['interact-caption'].textContent = nearby ? nearby.name.toUpperCase() : 'ARCHER GT / AVAILABLE';
      n['interact-label'].textContent = nearby ? ({ contact: 'Talk', cache: 'Search supplies', memory: 'Recover memory', terminal: 'Access terminal', transit: 'Open transit map', rest: 'Rest & recover', board: 'Browse local jobs' }[nearby.type]) : 'Take the wheel';
    }
    if (performance.now() > this.notificationUntil) n.notification.classList.add('hidden');
    const distance = Math.round(Math.hypot(player.x - objective.x, player.z - objective.z));
    n['objective-distance'].textContent = objective.hidden ? 'CITY OPEN' : `${distance} M AWAY`;
    n['mission-title'].textContent = objective.pinned ? objective.label : objective.quest?.title ?? 'The city is yours';
    n['mission-description'].textContent = objective.pinned ? 'A place worth finding. Your stories are waiting in the journal.' : objective.quest?.description ?? 'There are still voices to hear and streets to explore.';
    n['objective-text'].textContent = objective.text;
    n['mission-reward'].textContent = objective.quest ? `+ ${objective.quest.reward} CREDITS` : 'J / FIELD JOURNAL';
    const district = districtAt(player.x, player.z).name.toUpperCase();
    n.district.textContent = district; n['map-district'].textContent = district;
  }
  waypoint(camera, objective, player, vector, active) {
    const el = this.nodes.waypoint;
    if (!active || objective.hidden) { el.classList.add('hidden'); return; }
    vector.set(objective.x, objective.y ?? 3.5, objective.z).project(camera);
    if (vector.z > 1 || vector.z < -1 || Math.abs(vector.x) > .88 || Math.abs(vector.y) > .83 || Math.hypot(player.x - objective.x, player.z - objective.z) < 4) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden'); el.style.left = `${(vector.x * .5 + .5) * innerWidth}px`; el.style.top = `${(-vector.y * .5 + .5) * innerHeight}px`; el.style.transform = 'translate(-50%,-100%)';
    this.nodes['waypoint-label'].textContent = objective.label; this.nodes['waypoint-distance'].textContent = `${Math.round(Math.hypot(player.x - objective.x, player.z - objective.z))} M`;
  }
  drawMap(player, yaw, drones, objective, expanded = false) {
    const ctx = expanded ? this.full : this.map, w = ctx.canvas.width, h = ctx.canvas.height;
    const scale = expanded ? Math.min(w, h) / MAP_SPAN : 2.1;
    const cx = expanded ? 0 : player.x, cz = expanded ? 0 : player.z;
    const point = (x, z) => [w / 2 + (x - cx) * scale, h / 2 + (z - cz) * scale];
    ctx.fillStyle = '#0a1822'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#92b4b50c'; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = '#314955'; ctx.lineWidth = 16 * scale;
    for (const s of [...STREETS, -192, 192]) {
      const extent = [-192, 0, 192].includes(s) ? 275 : 145;
      ctx.beginPath(); ctx.moveTo(...point(s, -extent)); ctx.lineTo(...point(s, extent)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...point(-extent, s)); ctx.lineTo(...point(extent, s)); ctx.stroke();
    }
    for (const b of this.city.mapInfo) {
      const [x, y] = point(b.x, b.z), rw = b.w * scale, rh = b.d * scale;
      ctx.fillStyle = '#152b37'; ctx.strokeStyle = '#45616a'; ctx.lineWidth = expanded ? 1.4 : 1;
      ctx.fillRect(x - rw / 2, y - rh / 2, rw, rh); ctx.strokeRect(x - rw / 2, y - rh / 2, rw, rh);
    }
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
      const [x, y] = point(car.x, car.z); ctx.fillStyle = '#80ded7'; ctx.save(); ctx.translate(x, y); ctx.rotate(-car.yaw); ctx.fillRect(-2.7, -4.5, 5.4, 9); ctx.restore();
    }
    for (const drone of drones) {
      if (drone.dead) continue;
      const [x, y] = point(drone.root.position.x, drone.root.position.z); ctx.fillStyle = '#ff647e'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    const [px, py] = point(player.x, player.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(-yaw); ctx.fillStyle = '#dcff8720'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, expanded ? 32 : 48, -Math.PI * .7, -Math.PI * .3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#dfff85'; ctx.strokeStyle = '#263d2b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3); ctx.lineTo(-6.5, 7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    if (expanded) {
      ctx.font = '600 10px Barlow, Arial'; ctx.fillStyle = '#b5cbcc'; ctx.textAlign = 'center';
      DISTRICTS.forEach(d => { ctx.fillStyle = this.campaign.data.discovered.includes(d.id) ? '#bed5cc' : '#6f8a95'; ctx.fillText(d.name.toUpperCase(), ...point(d.x, d.z + (d.id === 'ridge' ? -65 : 40))); });
      ctx.textAlign = 'left'; ctx.font = '10px Barlow, Arial'; ctx.fillStyle = '#7a999d'; ctx.fillText('N ↑', 20, 27); ctx.fillText('560 M × 560 M / 8 CONNECTED DISTRICTS', 20, h - 20);
    }
  }
}
