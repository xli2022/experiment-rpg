import { clamp } from './physics.js';

export class Input {
  constructor(canvas, callbacks) {
    this.keys = new Set(); this.lookX = 0; this.lookY = 0; this.firing = false; this.aiming = false;
    this.joyX = 0; this.joyY = 0; this.sensitivity = 1; this.dragging = false;
    this.enabled = false; this.canvas = canvas; this.callbacks = callbacks;
    this.touch = matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('touch', this.touch);
    const action = code => {
      if (code === 'Escape') { callbacks.pause(); return; }
      if (!this.enabled) return;
      if (code === 'KeyE') callbacks.interact();
      if (code === 'KeyR') callbacks.reload();
      if (code === 'Space') callbacks.jump();
      if (code === 'KeyM') callbacks.map();
      if (code === 'KeyJ') callbacks.journal();
      if (code === 'KeyQ') callbacks.medkit();
    };
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') { e.preventDefault(); callbacks.pause(); return; }
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
    const stick = document.getElementById('joystick'), thumb = document.getElementById('joystick-thumb');
    let stickId = null;
    const updateStick = e => {
      const rect = stick.getBoundingClientRect(), radius = rect.width * .36;
      let x = e.clientX - rect.left - rect.width / 2, y = e.clientY - rect.top - rect.height / 2;
      const length = Math.hypot(x, y); if (length > radius) { x *= radius / length; y *= radius / length; }
      this.joyX = x / radius; this.joyY = -y / radius; thumb.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    };
    stick.addEventListener('pointerdown', e => { if (!this.enabled) return; e.preventDefault(); stickId = e.pointerId; stick.setPointerCapture(e.pointerId); updateStick(e); callbacks.audio(); });
    stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) updateStick(e); });
    const endStick = () => { stickId = null; this.joyX = this.joyY = 0; thumb.style.transform = 'translate(-50%,-50%)'; };
    stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick); stick.addEventListener('lostpointercapture', endStick);
    const look = document.getElementById('look-zone'); let lookId = null, lx = 0, ly = 0;
    look.addEventListener('pointerdown', e => { if (!this.enabled) return; lookId = e.pointerId; lx = e.clientX; ly = e.clientY; look.setPointerCapture(e.pointerId); });
    look.addEventListener('pointermove', e => { if (e.pointerId !== lookId) return; this.lookX += (e.clientX - lx) * 1.8; this.lookY += (e.clientY - ly) * 1.8; lx = e.clientX; ly = e.clientY; });
    const endLook = () => { lookId = null; }; look.addEventListener('pointerup', endLook); look.addEventListener('pointercancel', endLook); look.addEventListener('lostpointercapture', endLook);
    function button(id, onDown, onUp = () => {}) {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); onDown(); });
      el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp); el.addEventListener('lostpointercapture', onUp);
    }
    button('touch-fire', () => { if (this.enabled) { this.firing = true; callbacks.audio(); callbacks.fire(); } }, () => { this.firing = false; });
    button('touch-interact', () => { if (this.enabled) callbacks.interact(); });
    button('touch-reload', () => { if (this.enabled) callbacks.reload(); });
    button('touch-jump', () => { if (this.enabled) { this.keys.add('Space'); callbacks.jump(); } }, () => this.keys.delete('Space'));
  }
  lock() {
    if (this.touch || !this.enabled || !this.canvas.requestPointerLock) return;
    try { const pending = this.canvas.requestPointerLock(); pending?.catch(() => {}); } catch { /* Drag-look remains available when pointer lock is blocked. */ }
  }
  clear() {
    this.keys.clear(); this.firing = this.aiming = this.dragging = false; this.joyX = this.joyY = this.lookX = this.lookY = 0;
    document.getElementById('joystick-thumb').style.transform = 'translate(-50%,-50%)';
  }
  setEnabled(enabled) {
    this.enabled = enabled; this.clear();
    document.getElementById('touch-controls').classList.toggle('hidden', !enabled || !this.touch);
    if (!enabled && document.pointerLockElement) document.exitPointerLock();
  }
  axes() {
    const x = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) + this.joyX;
    const y = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) + this.joyY;
    const length = Math.max(1, Math.hypot(x, y)); return { x: x / length, y: y / length };
  }
  look() {
    const result = { x: clamp(this.lookX, -350, 350) * .0024 * this.sensitivity, y: clamp(this.lookY, -350, 350) * .002 * this.sensitivity };
    this.lookX = this.lookY = 0; return result;
  }
}
