import { STREETS } from './city.js';

const $ = id => document.getElementById(id);
export class HUD {
  constructor(city) {
    this.city = city; this.map = $('minimap').getContext('2d'); this.full = $('full-map').getContext('2d');
    this.nodes = Object.fromEntries(['health-value', 'health-bar', 'armor-value', 'armor-bar', 'ammo', 'credits', 'cred-value', 'level', 'speed', 'speed-bar', 'mission-title', 'mission-description', 'objective-text', 'objective-distance', 'mission-reward', 'weapon-panel', 'driving-panel', 'interaction', 'interact-caption', 'interact-label', 'notification', 'waypoint', 'waypoint-label', 'waypoint-distance', 'reload-hint', 'fps', 'district', 'map-district'].map(id => [id, $(id)]));
    $('ammo-bars').innerHTML = '<i></i>'.repeat(24); this.ammoBars = [...$('ammo-bars').children];
    this.lastAmmo = -1; this.lastDriving = null; this.notificationUntil = 0; this.lastStage = -1;
  }
  notify(text, duration = 4) { this.nodes.notification.textContent = text; this.nodes.notification.classList.remove('hidden'); this.notificationUntil = performance.now() + duration * 1000; }
  update(state, player, driving, nearest, objective, fps) {
    const n = this.nodes;
    n['health-value'].textContent = Math.ceil(state.health); n['health-bar'].style.transform = `scaleX(${state.health / 100})`;
    n['armor-value'].textContent = Math.ceil(state.armor); n['armor-bar'].style.transform = `scaleX(${state.armor / 50})`;
    const ammo = state.reloading > 0 ? '—' : state.ammo;
    if (this.lastAmmo !== ammo) { n.ammo.textContent = ammo; this.ammoBars.forEach((bar, i) => bar.classList.toggle('empty', i >= state.ammo)); this.lastAmmo = ammo; }
    n['reload-hint'].innerHTML = state.reloading > 0 ? 'RELOADING...' : '<kbd>R</kbd> RELOAD';
    n.credits.textContent = state.credits.toLocaleString(); n['cred-value'].textContent = state.cred; n.level.textContent = String(1 + Math.floor(state.cred / 500)).padStart(2, '0');
    n.fps.textContent = Math.round(fps);
    if (this.lastDriving !== !!driving) {
      n['weapon-panel'].classList.toggle('hidden', !!driving); n['driving-panel'].classList.toggle('hidden', !driving);
      document.getElementById('crosshair').style.display = driving ? 'none' : '';
      document.getElementById('touch-fire').style.display = driving ? 'none' : '';
      document.getElementById('touch-reload').style.display = driving ? 'none' : '';
      this.lastDriving = !!driving;
    }
    if (driving) { const speed = Math.round(Math.abs(driving.speed) * 3.6); n.speed.textContent = speed; n['speed-bar'].style.width = `${Math.min(speed / 151 * 100, 100)}%`; }
    const canInteract = !driving && nearest && state.started && !state.paused;
    n.interaction.classList.toggle('hidden', !canInteract);
    if (canInteract) { n['interact-caption'].textContent = 'ARCHER GT / AVAILABLE'; n['interact-label'].textContent = 'Take the wheel'; }
    if (performance.now() > this.notificationUntil) n.notification.classList.add('hidden');
    const distance = Math.round(Math.hypot(player.x - objective.x, player.z - objective.z));
    n['objective-distance'].textContent = state.stage === 3 ? 'DISTRICT OPEN' : `${distance} M AWAY`;
    if (state.stage === 2) n['objective-text'].textContent = `Disable rogue drones (${Math.min(state.kills, 3)}/3)`;
    if (this.lastStage !== state.stage) {
      const titles = ['Own the night', 'A little night drive', 'Clear the air', 'The city is yours'];
      const descriptions = ['Every legend starts at street level.', 'Take the Archer up to the North Exchange.', 'Rogue security has locked down the block.', 'No curfew. No rules. Find your own way.'];
      const objectives = ['Get in the nearby vehicle', 'Reach the North Exchange', `Disable rogue drones (${Math.min(state.kills, 3)}/3)`, 'Explore Vesper City'];
      n['mission-title'].textContent = titles[state.stage]; n['mission-description'].textContent = descriptions[state.stage]; n['objective-text'].textContent = objectives[state.stage];
      n['mission-reward'].textContent = state.stage === 3 ? 'CONTRACT COMPLETE ✓' : '+ 250 STREET CRED';
      this.lastStage = state.stage;
    }
    const district = player.z < -54 ? 'NORTH EXCHANGE' : player.x > 50 ? 'CHROME HEIGHTS' : player.x < -50 ? 'LOWER EAST' : 'NEON QUARTER';
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
    const scale = expanded ? Math.min(w, h) / 316 : 2.38;
    const cx = expanded ? 0 : player.x, cz = expanded ? 0 : player.z;
    const point = (x, z) => [w / 2 + (x - cx) * scale, h / 2 + (z - cz) * scale];
    ctx.fillStyle = '#0a1822'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#92b4b50c'; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = '#314955'; ctx.lineWidth = 16 * scale;
    for (const s of STREETS) {
      const [x, y] = point(s, s);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (const b of this.city.mapInfo) {
      const [x, y] = point(b.x, b.z), rw = b.w * scale, rh = b.d * scale;
      ctx.fillStyle = '#152b37'; ctx.strokeStyle = '#45616a'; ctx.lineWidth = expanded ? 1.4 : 1;
      ctx.fillRect(x - rw / 2, y - rh / 2, rw, rh); ctx.strokeRect(x - rw / 2, y - rh / 2, rw, rh);
    }
    if (!objective.hidden) {
      const [px, py] = point(player.x, player.z), [ox, oy] = point(objective.x, objective.z);
      ctx.strokeStyle = '#d7eb7899'; ctx.lineWidth = expanded ? 2.5 : 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, oy); ctx.lineTo(ox, oy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#e4dd8e'; ctx.save(); ctx.translate(ox, oy); ctx.rotate(Math.PI / 4); ctx.fillRect(-4, -4, 8, 8); ctx.restore();
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
      ctx.font = '600 13px Barlow'; ctx.fillStyle = '#b5cbcc'; ctx.textAlign = 'center';
      [['NORTH EXCHANGE', 0, -149], ['NEON QUARTER', 0, 48], ['CHROME HEIGHTS', 96, 48], ['LOWER EAST', -96, 48]].forEach(([label, x, z]) => ctx.fillText(label, ...point(x, z)));
      ctx.textAlign = 'left'; ctx.font = '11px Barlow'; ctx.fillStyle = '#7a999d'; ctx.fillText('N ↑', 20, 27); ctx.fillText('300 M × 300 M / EXPLORABLE DISTRICT', 20, h - 20);
    }
  }
}
