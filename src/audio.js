// All sounds are synthesized locally. No audio downloads, permissions or autoplay.
export class GameAudio {
  constructor() { this.context = null; this.enabled = false; }
  init() {
    if (!this.enabled) return;
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain(); this.master.gain.value = .23; this.master.connect(this.context.destination);
      this.engine = this.context.createOscillator(); this.engine.type = 'sawtooth'; this.engine.frequency.value = 44;
      this.engineFilter = this.context.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 170;
      this.engineGain = this.context.createGain(); this.engineGain.gain.value = 0;
      this.engine.connect(this.engineFilter); this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.master); this.engine.start();
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
      const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * .07;
      const noise = this.context.createBufferSource(); noise.buffer = buffer; noise.loop = true;
      const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 550;
      noise.connect(filter); filter.connect(this.master); noise.start();
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }
  toggle() {
    this.enabled = !this.enabled; this.init();
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? .23 : 0, this.context.currentTime, .1);
    return this.enabled;
  }
  tone(frequency, duration, type = 'sine', gain = .3, end = frequency) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime, osc = this.context.createOscillator(), vol = this.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, now); osc.frequency.exponentialRampToValueAtTime(Math.max(10, end), now + duration);
    vol.gain.setValueAtTime(gain, now); vol.gain.exponentialRampToValueAtTime(.001, now + duration);
    osc.connect(vol); vol.connect(this.master); osc.start(); osc.stop(now + duration);
  }
  shot() { this.tone(140, .11, 'sawtooth', .65, 32); this.tone(2500, .035, 'square', .12, 150); }
  hit() { this.tone(760, .08, 'sine', .18, 420); }
  reload() { this.tone(450, .12, 'triangle', .2, 180); }
  reward() { this.tone(520, .15, 'sine', .3, 900); setTimeout(() => this.tone(1050, .3, 'sine', .25, 1300), 100); }
  explosion() { this.tone(90, .65, 'sawtooth', .7, 15); }
  update(speed, active) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.engine.frequency.setTargetAtTime(38 + Math.abs(speed) * 3, now, .1);
    this.engineGain.gain.setTargetAtTime(active && this.enabled ? .14 + Math.abs(speed) * .007 : 0, now, .12);
  }
}
