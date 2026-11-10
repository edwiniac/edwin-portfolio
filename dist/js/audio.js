// ─────────────────────────────────────────────────────────────
// Sound — the whole score is synthesised with the Web Audio API.
// No samples, no files: a drone that changes key with each chapter,
// bells, wind, torch fire, footsteps on stone, and UI ticks.
// ─────────────────────────────────────────────────────────────

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// One harmony per chapter. The walk starts in D minor and only resolves
// to D major in the last room, when the loop closes.
const SCORE = [
  { chord:[38,45,53,64], bells:[62,65,67,69,72,74,77], cutoff:380, drone:0.15, density:0.7 }, // Dm9   — threshold
  { chord:[34,46,53,62], bells:[58,62,65,67,70,74],    cutoff:470, drone:0.15, density:0.9 }, // Bb    — origin
  { chord:[41,48,57,64], bells:[60,64,65,69,72,76],    cutoff:580, drone:0.16, density:1.2 }, // Fmaj7 — works
  { chord:[36,48,55,64], bells:[60,62,64,67,72,74],    cutoff:640, drone:0.16, density:1.1 }, // C     — craft
  { chord:[33,45,52,60], bells:[57,60,64,69,72],       cutoff:300, drone:0.10, density:0.45 },// Am    — belief (quiet)
  { chord:[38,45,54,66], bells:[62,66,69,71,74,78,81], cutoff:820, drone:0.17, density:1.4 }, // D     — the loop closes
];

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = true;
    this.ch = 0;
    this._lvl = 0;
    this._lastTick = 0;
    this._lastType = 0;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx || this.muted) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
  }

  get active() { return !!this.ctx && !this.muted && this.ctx.state === 'running'; }

  // Must be called from a user gesture.
  start() {
    if (this.ctx) { this.setMuted(false); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = this.ctx = new AC();
    const now = ctx.currentTime;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.3;
    this.master.connect(comp).connect(ctx.destination);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this._bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.master.connect(this.analyser);

    // stone-hall reverb from a generated impulse response
    const conv = ctx.createConvolver();
    conv.buffer = this._impulse(3.4);
    const wet = ctx.createGain(); wet.gain.value = 0.85;
    this.send = ctx.createGain();
    this.send.connect(conv).connect(wet).connect(this.master);

    this.noise = this._noiseBuffer(2.5);
    this._buildDrone();
    this._buildAir();
    this._buildFire();
    this._buildShimmer();

    this.muted = false;
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(0.9, now + 2.2);
    this._bellLoop();
    return true;
  }

  setMuted(m) {
    if (!this.ctx) return;
    this.muted = m;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, now, 0.15);
    if (m) setTimeout(() => { if (this.muted) this.ctx.suspend(); }, 700);
    else this.ctx.resume();
  }

  // 0..1 loudness, used to make the world breathe with the music
  level() {
    if (!this.active) { this._lvl *= 0.9; return this._lvl; }
    this.analyser.getByteFrequencyData(this._bins);
    let s = 0;
    for (let i = 1; i < 24; i++) s += this._bins[i];
    const v = s / (23 * 255);
    this._lvl += (v - this._lvl) * 0.15;
    return this._lvl;
  }

  // ── building blocks ─────────────────────────────
  _noiseBuffer(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _impulse(sec) {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
    }
    return b;
  }
  _noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = loop;
    return s;
  }
  _out(node, dry = 1, wet = 0, pan = 0) {
    let n = node;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = pan; n.connect(p); n = p;
    }
    if (dry) { const g = this.ctx.createGain(); g.gain.value = dry; n.connect(g).connect(this.master); }
    if (wet) { const g = this.ctx.createGain(); g.gain.value = wet; n.connect(g).connect(this.send); }
  }

  _buildDrone() {
    const ctx = this.ctx, sc = SCORE[0];
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass'; this.droneFilter.frequency.value = sc.cutoff; this.droneFilter.Q.value = 0.8;
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = sc.drone;
    this.droneFilter.connect(this.droneGain);
    this._out(this.droneGain, 1, 0.5);

    // slow breathing of the filter
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lfoG = ctx.createGain(); lfoG.gain.value = 130;
    lfo.connect(lfoG).connect(this.droneFilter.frequency); lfo.start();

    this.voices = sc.chord.map((m, i) => {
      const g = ctx.createGain(); g.gain.value = [0.5, 0.34, 0.22, 0.12][i];
      const oscs = [-6, 7].map(det => {
        const o = ctx.createOscillator();
        o.type = i < 2 ? 'sawtooth' : 'triangle';
        o.frequency.value = mtof(m); o.detune.value = det + (Math.random() * 4 - 2);
        o.connect(g); o.start();
        return o;
      });
      g.connect(this.droneFilter);
      return oscs;
    });
    // pure sine on the root for body
    this.sub = ctx.createOscillator(); this.sub.type = 'sine'; this.sub.frequency.value = mtof(sc.chord[0]);
    const sg = ctx.createGain(); sg.gain.value = 0.16;
    this.sub.connect(sg).connect(this.master); this.sub.start();
  }

  _buildAir() {
    const ctx = this.ctx;
    const src = this._noiseSrc(true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.022;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045;
    const lg = ctx.createGain(); lg.gain.value = 0.012;
    lfo.connect(lg).connect(g.gain); lfo.start();
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.031;
    const lg2 = ctx.createGain(); lg2.gain.value = 220;
    lfo2.connect(lg2).connect(bp.frequency); lfo2.start();
    src.connect(bp).connect(g);
    this._out(g, 1, 0.3);
    src.start();
  }

  _buildFire() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    // crackle: sparse decaying clicks baked into a loop
    const len = sr * 4, b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    for (let n = 0; n < 70; n++) {
      const at = Math.floor(Math.random() * (len - 600));
      const dur = 40 + Math.floor(Math.random() * 380), amp = 0.25 + Math.random() * 0.75;
      for (let i = 0; i < dur; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.pow(1 - i / dur, 3);
    }
    const crackle = ctx.createBufferSource(); crackle.buffer = b; crackle.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1700;
    const roar = this._noiseSrc(true);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 230;
    const rg = ctx.createGain(); rg.gain.value = 0.5;
    this.fireGain = ctx.createGain(); this.fireGain.gain.value = 0;
    crackle.connect(hp).connect(this.fireGain);
    roar.connect(lp).connect(rg).connect(this.fireGain);
    this._out(this.fireGain, 1, 0.25);
    crackle.start(); roar.start();
  }

  _buildShimmer() {
    const ctx = this.ctx;
    this.shimGain = ctx.createGain(); this.shimGain.gain.value = 0;
    [[587.33, 0.21], [880, 0.33], [1174.66, 0.17]].forEach(([f, rate]) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.5;
      const l = ctx.createOscillator(); l.frequency.value = rate;
      const lg = ctx.createGain(); lg.gain.value = 0.5;
      l.connect(lg).connect(g.gain); l.start();
      o.connect(g).connect(this.shimGain); o.start();
    });
    this._out(this.shimGain, 0.4, 1);
  }

  _bell(freq, when = 0, vel = 0.12, pan = 0) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    [[1, 1], [2.01, 0.28], [3.02, 0.07]].forEach(([mul, amp]) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * mul;
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og).connect(g); o.start(t); o.stop(t + 3.3);
    });
    this._out(g, 0.5, 0.9, pan);
  }

  _bellLoop() {
    const sc = SCORE[this.ch];
    const wait = (1500 + Math.random() * 3200) / sc.density;
    this._bellTimer = setTimeout(() => {
      if (this.active && !document.hidden) {
        const s = SCORE[this.ch];
        const note = s.bells[Math.floor(Math.random() * s.bells.length)];
        this._bell(mtof(note), 0, 0.05 + Math.random() * 0.05, Math.random() * 1.2 - 0.6);
        if (Math.random() < 0.3) this._bell(mtof(s.bells[Math.floor(Math.random() * s.bells.length)] + 12), 0.18, 0.03, Math.random() - 0.5);
      }
      this._bellLoop();
    }, wait);
  }

  // ── story cues ──────────────────────────────────
  setChapter(i) {
    this.ch = Math.max(0, Math.min(SCORE.length - 1, i));
    if (!this.ctx) return;
    const sc = SCORE[this.ch], now = this.ctx.currentTime;
    this.voices.forEach((oscs, v) => oscs.forEach(o => o.frequency.setTargetAtTime(mtof(sc.chord[v]), now, 0.5)));
    this.sub.frequency.setTargetAtTime(mtof(sc.chord[0]), now, 0.5);
    this.droneFilter.frequency.setTargetAtTime(sc.cutoff, now, 0.9);
    this.droneGain.gain.setTargetAtTime(sc.drone, now, 0.9);
  }
  setFire(litCount, dim = 1) {
    if (!this.ctx) return;
    this.fireGain.gain.setTargetAtTime(Math.min(0.11, litCount * 0.022) * dim, this.ctx.currentTime, 0.6);
  }
  setProximity(p) {
    if (!this.ctx) return;
    this.shimGain.gain.setTargetAtTime(p * p * 0.03, this.ctx.currentTime, 0.4);
  }

  whoosh(dur = 1.2, amp = 0.2) {
    if (!this.active) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this._noiseSrc(true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(170, t);
    bp.frequency.exponentialRampToValueAtTime(2100, t + dur * 0.5);
    bp.frequency.exponentialRampToValueAtTime(240, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(g);
    this._out(g, 1, 0.5);
    s.start(t); s.stop(t + dur + 0.05);
  }
  thump(amp = 0.45, f0 = 95) {
    if (!this.active) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g); this._out(g, 1, 0.3);
    o.start(t); o.stop(t + 0.75);
  }
  steps(n, dur) {
    if (!this.active) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.1, gap = Math.max(0.2, (dur - 0.15) / n);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * gap, pan = i % 2 ? 0.22 : -0.22;
      const s = this._noiseSrc();
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300 + Math.random() * 120;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      s.connect(lp).connect(g); this._out(g, 1, 0.7, pan);
      s.start(t, Math.random()); s.stop(t + 0.15);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(88, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.09);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.22, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(og); this._out(og, 1, 0.4, pan);
      o.start(t); o.stop(t + 0.14);
    }
  }
  ignite(pan = 0, delay = 0) {
    if (!this.active) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    s.connect(bp).connect(g); this._out(g, 1, 0.5, pan);
    s.start(t); s.stop(t + 0.8);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(62, t + 0.3);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(og); this._out(og, 1, 0.3, pan);
    o.start(t); o.stop(t + 0.45);
  }
  tick() {
    if (!this.active) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this._lastTick < 0.05) return;
    this._lastTick = t;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(2300, t); o.frequency.exponentialRampToValueAtTime(1700, t + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); this._out(g, 1, 0.3);
    o.start(t); o.stop(t + 0.06);
  }
  blip() {
    if (!this.active) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(940, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); this._out(g, 1, 0.6);
    o.start(t); o.stop(t + 0.18);
  }
  // the narrator's pen
  type() {
    if (!this.active) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this._lastType < 0.045) return;
    this._lastType = t;
    const s = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2800 + Math.random() * 1400; bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    s.connect(bp).connect(g); this._out(g, 1, 0.15);
    s.start(t, Math.random() * 2); s.stop(t + 0.03);
  }
  chime(i) {
    if (!this.active) return;
    const sc = SCORE[Math.max(0, Math.min(SCORE.length - 1, i))];
    [sc.chord[1] + 12, sc.chord[2] + 12, sc.chord[3] + 12].forEach((m, k) =>
      this._bell(mtof(m), k * 0.11, 0.075, (k - 1) * 0.3));
  }

  // composite cues
  open() {
    this.thump(0.6, 80);
    this.whoosh(2.6, 0.16);
    setTimeout(() => this.chime(0), 900);
  }
  travel(i, dist, dur) {
    this.setChapter(i);
    this.whoosh(dur + 0.35, 0.2);
    this.thump(0.3, 70);
    this.steps(Math.min(6, 2 + dist * 2), dur);
  }
}
