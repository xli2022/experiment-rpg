import { clamp } from './physics.js';

export class Input {
  constructor(canvas, callbacks) {
    this.keys = new Set(); this.lookX = 0; this.lookY = 0; this.firing = false; this.aiming = false;
    this.joyX = 0; this.joyY = 0; this.sensitivity = 1; this.dragging = false;
    this.enabled = false; this.canvas = canvas; this.callbacks = callbacks;
    canvas.tabIndex = 0;
    this.touch = matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('touch', this.touch);
    const action = code => {
      if (!this.enabled) return;
      if (code === 'KeyE') callbacks.interact();
      if (code === 'KeyR') callbacks.reload();
      if (code === 'Space') callbacks.jump();
      if (code === 'KeyM') callbacks.map();
      if (code === 'KeyJ') callbacks.journal();
      if (code === 'KeyQ') callbacks.medkit();
      if (code === 'KeyC') callbacks.climb();
    };
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') { e.preventDefault(); if (!e.repeat) callbacks.pause(); return; }
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) return;
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) action(e.code);
      if (this.enabled) this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.clear(); callbacks.blur(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clear(); callbacks.blur(); } });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      if (!this.enabled || e.pointerType === 'touch') return;
      callbacks.audio();
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
      if (!document.pointerLockElement) this.lock();
    });
    // Mouse events fire for every button in a chord; pointerdown only fires for the first.
    // This lets left-click fire while right-click is already held to aim.
    window.addEventListener('mousedown', e => {
      if (!this.enabled || (e.target !== canvas && !this.dragging && document.pointerLockElement !== canvas)) return;
      if (e.button === 0) { this.firing = true; callbacks.fire(); }
      if (e.button === 2) this.aiming = true;
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
      this.dragging = e.buttons !== 0;
    });
    window.addEventListener('pointermove', e => {
      if (!this.enabled || e.pointerType === 'touch') return;
      if (document.pointerLockElement === canvas) { this.lookX += e.movementX; this.lookY += e.movementY; }
      else if (this.dragging) { this.lookX += e.clientX - this.lastX; this.lookY += e.clientY - this.lastY; this.lastX = e.clientX; this.lastY = e.clientY; }
    });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) { this.firing = false; this.aiming = false; } });
    const resets = [];
    // Each control owns exactly one pointer. Releasing a different finger, or a
    // delayed capture event from an old gesture, cannot cancel the current one.
    const control = (id, onDown, onMove = () => {}, onUp = () => {}) => {
      const el = document.getElementById(id); let owner = null;
      const active = value => { el.classList.toggle('active', value); el.dataset.active = String(value); };
      const end = e => {
        if (owner === null || e && e.pointerId !== owner) return;
        const pointerId = owner; owner = null; active(false); onUp();
        if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
      };
      el.addEventListener('pointerdown', e => {
        if (!this.enabled || owner !== null) return;
        e.preventDefault(); e.stopPropagation(); owner = e.pointerId;
        el.setPointerCapture(e.pointerId); active(true); callbacks.audio(); onDown(e);
      });
      el.addEventListener('pointermove', e => { if (this.enabled && e.pointerId === owner) onMove(e); });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(type, end);
      active(false); resets.push(() => end());
    };
    const stick = (id, thumbId, setAxes) => {
      const el = document.getElementById(id), thumb = document.getElementById(thumbId);
      const update = e => {
        const rect = el.getBoundingClientRect(), radius = Math.max(1, Math.min(rect.width, rect.height) * .28);
        let x = e.clientX - rect.left - rect.width / 2, y = e.clientY - rect.top - rect.height / 2;
        const length = Math.hypot(x, y), amount = Math.min(1, length / radius);
        if (length > radius) { x *= radius / length; y *= radius / length; }
        // A radial quiet center avoids drift; smooth remapping retains gentle
        // steering and a full-strength outer edge in every direction.
        const t = Math.max(0, (amount - .12) / .88), strength = t * t * (3 - 2 * t);
        setAxes(length ? x / Math.min(length, radius) * strength : 0, length ? y / Math.min(length, radius) * strength : 0);
        thumb.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      };
      control(id, update, update, () => { setAxes(0, 0); thumb.style.transform = 'translate(-50%,-50%)'; });
    };
    stick('joystick', 'joystick-thumb', (x, y) => { this.joyX = x; this.joyY = -y; });
    let lx = 0, ly = 0;
    control('look-zone', e => { lx = e.clientX; ly = e.clientY; }, e => {
      this.lookX += (e.clientX - lx) * 1.8; this.lookY += (e.clientY - ly) * 1.8; lx = e.clientX; ly = e.clientY;
    });
    control('touch-fire', () => { this.firing = true; callbacks.fire(); }, undefined, () => { this.firing = false; });
    control('touch-interact', () => callbacks.interact());
    control('touch-climb', () => callbacks.climb());
    control('touch-reload', () => callbacks.reload());
    control('touch-jump', () => { this.keys.add('Space'); callbacks.jump(); }, undefined, () => this.keys.delete('Space'));
    this.resetTouch = () => { for (const reset of resets) reset(); };
  }
  lock() {
    if (this.touch || !this.enabled || document.pointerLockElement === this.canvas || !this.canvas.requestPointerLock) return;
    try { const pending = this.canvas.requestPointerLock(); pending?.catch(() => {}); } catch { /* Drag-look remains available when pointer lock is blocked. */ }
  }
  clear() {
    this.keys.clear(); this.firing = this.aiming = this.dragging = false; this.joyX = this.joyY = this.lookX = this.lookY = 0;
    this.resetTouch();
  }
  setEnabled(enabled) {
    this.enabled = enabled; this.clear();
    document.getElementById('touch-controls').classList.toggle('hidden', !enabled || !this.touch);
    if (enabled) { this.canvas.focus({ preventScroll: true }); this.lock(); }
    if (!enabled && document.pointerLockElement) document.exitPointerLock();
  }
  axes() {
    const x = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) + this.joyX;
    const y = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) + this.joyY;
    const length = Math.max(1, Math.hypot(x, y)); return { x: x / length, y: y / length };
  }
  look() {
    const result = { x: clamp(this.lookX, -350, 350) * .0024 * this.sensitivity,
      y: clamp(this.lookY, -350, 350) * .002 * this.sensitivity };
    this.lookX = this.lookY = 0; return result;
  }
}
