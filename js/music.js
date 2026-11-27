// music.js - every sound here is synthesised in the browser with the Web Audio API.
// There are no recordings. If you want to change how the metro sounds, start here.

// Five-note Carnatic ragas. Any notes from one of these sound good together,
// which matters because trains arrive whenever the timetable says they do.
// `semis` are semitones above Sa (the home note).
export const RAGAS = {
  mohanam: { name: 'Mohanam', swaras: ['S', 'R2', 'G3', 'P', 'D2'], semis: [0, 2, 4, 7, 9] },
  madhyamavati: { name: 'Madhyamavati', swaras: ['S', 'R2', 'M1', 'P', 'N2'], semis: [0, 2, 5, 7, 10] },
  hamsadhwani: { name: 'Hamsadhwani', swaras: ['S', 'R2', 'G3', 'P', 'N3'], semis: [0, 2, 4, 7, 11] },
  shivaranjani: { name: 'Shivaranjani', swaras: ['S', 'R2', 'G2', 'P', 'D2'], semis: [0, 2, 3, 7, 9] },
  hindolam: { name: 'Hindolam', swaras: ['S', 'G2', 'M1', 'D1', 'N2'], semis: [0, 3, 5, 8, 10] },
};

/** "Auto" picks a raga from the hour on the simulation clock. */
export function autoRaga(hour) {
  if (hour >= 4 && hour < 11) return 'mohanam';
  if (hour >= 11 && hour < 16) return 'madhyamavati';
  if (hour >= 16 && hour < 20) return 'hamsadhwani';
  return 'shivaranjani';
}

// One instrument per line. `octave` is how far above the veena's Sa it sits.
// `maxDegree` is the note the furthest station gets (5 notes per octave).
export const LINE_VOICES = {
  PURPLE: { instrument: 'Veena', kind: 'veena', octave: 0, maxDegree: 12, level: 0.95 },
  GREEN: { instrument: 'Bansuri flute', kind: 'flute', octave: 1, maxDegree: 10, level: 0.55 },
  YELLOW: { instrument: 'Temple bells', kind: 'bells', octave: 2, maxDegree: 7, level: 0.8 },
};

const SA_MIDI = 50; // D3, about 147 Hz. Change this one number to retune everything.
const TEMPO = 80; // notes snap to an eighth-note grid at this tempo
const MAX_NOTES_PER_STEP = 2; // per line, so fast-forward stays musical

const SWARA_NAMES = { S: 'Sa', R: 'Ri', G: 'Ga', M: 'Ma', P: 'Pa', D: 'Dha', N: 'Ni' };
const SUBSCRIPT = { 1: '₁', 2: '₂', 3: '₃' };

export const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

/** "Ga′" = Ga one octave up. */
export function swaraName(raga, degree) {
  const n = raga.swaras.length;
  return SWARA_NAMES[raga.swaras[degree % n][0]] + '′'.repeat(Math.floor(degree / n));
}

/** "S R₂ G₃ P D₂" */
export function ragaScale(raga) {
  return raga.swaras.map((s) => s[0] + (SUBSCRIPT[s[1]] || '')).join(' ');
}

export class Music {
  constructor(lines) {
    this.lines = lines;
    this.ctx = null;
    this.playing = false;
    this.raga = RAGAS.mohanam;
    this.muted = new Set();
    this.droneOn = true;
    this.volume = 0.8;
    this.slots = new Map();
    this.buffers = new Map();
    this.lastGong = -Infinity;
    this.droneStep = 0;
    this.nextDrone = 0;

    // Note for each station: the further from the line's home station, the higher.
    this.degrees = lines.map((L) => {
      const v = LINE_VOICES[L.id];
      const far = Math.max(L.anchor, L.stations.length - 1 - L.anchor);
      return L.stations.map((_, i) => Math.round((Math.abs(i - L.anchor) / far) * v.maxDegree));
    });
  }

  labelFor(line, local) {
    return swaraName(this.raga, this.degrees[line][local]);
  }

  setRaga(key) {
    this.raga = RAGAS[key] || RAGAS.mohanam;
  }

  setVolume(v) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(this.playing ? v : 0, this.ctx.currentTime, 0.05);
  }

  setLineMuted(line, muted) {
    if (muted) this.muted.add(line);
    else this.muted.delete(line);
  }

  setDrone(on) {
    this.droneOn = on;
    if (this.ctx) this.droneGain.gain.setTargetAtTime(on ? 0.2 : 0, this.ctx.currentTime, 0.3);
  }

  async start() {
    if (!this.ctx) this.#build();
    clearTimeout(this.suspendTimer);
    await this.ctx.resume();
    this.playing = true;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.volume, now, 0.15);
    this.nextDrone = Math.max(this.nextDrone, now + 0.15);
  }

  pause() {
    if (!this.ctx) return;
    this.playing = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    this.suspendTimer = setTimeout(() => this.ctx.suspend(), 450);
  }

  /**
   * A train reached a station. Plays its note on the next free beat and returns
   * when it will sound (in performance.now() ms) and its swara, or null if skipped.
   */
  playStation({ line, local, eventPerf, pan, interchange }) {
    if (!this.playing || this.muted.has(line)) return null;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const t = now + Math.max(0, (eventPerf - performance.now()) / 1000) + 0.04;
    const step = 60 / TEMPO / 2;
    const degree = this.degrees[line][local];
    let slot = Math.ceil(t / step);
    for (let tries = 0; tries < 3; tries++, slot++) {
      const key = `${line}:${slot}`;
      const used = this.slots.get(key) || [];
      if (used.length >= MAX_NOTES_PER_STEP || used.includes(degree)) continue;
      used.push(degree);
      this.slots.set(key, used);
      const when = slot * step + (Math.random() - 0.5) * 0.012; // a touch of human timing
      this.#voice(line, degree, when, pan);
      if (interchange && when - this.lastGong > 6) {
        this.lastGong = when;
        this.#gong(when, pan);
      }
      if (this.slots.size > 300) this.#pruneSlots(Math.floor(now / step) - 4);
      return { atPerf: performance.now() + (when - now) * 1000, label: swaraName(this.raga, degree) };
    }
    return null;
  }

  /** Keeps the tanpura going. Call a few times a second. */
  tick() {
    if (!this.playing || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.nextDrone < now) this.nextDrone = now + 0.05;
    const tuning = this.#tanpuraTuning();
    while (this.nextDrone < now + 1.8) {
      const i = this.droneStep % 4;
      this.#tanpura(this.nextDrone, midiHz(tuning[i]), [-0.35, 0.15, 0.25, -0.1][i]);
      this.droneStep++;
      this.nextDrone += 1.1 + Math.random() * 0.05 + (i === 3 ? 0.7 : 0);
    }
  }

  // ---------------------------------------------------------------- set-up

  #build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    this.ctx = ctx;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 10;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.35;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(limiter);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.#impulse(3.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    this.bus = ctx.createGain();
    this.bus.gain.value = 1.25;
    this.bus.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    this.bus.connect(send).connect(this.reverb);

    this.lineGains = this.lines.map((L) => {
      const g = ctx.createGain();
      g.gain.value = LINE_VOICES[L.id].level;
      g.connect(this.bus);
      return g;
    });

    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = this.droneOn ? 0.2 : 0;
    this.droneGain.connect(this.master);
    const droneSend = ctx.createGain();
    droneSend.gain.value = 0.35;
    this.droneGain.connect(droneSend).connect(this.reverb);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
  }

  #impulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len;
        const k = 0.6 - 0.5 * x; // the tail gets darker as it fades, like a stone hall
        lp += k * (Math.random() * 2 - 1 - lp);
        d[i] = lp * (1 - x) ** 2.4;
      }
    }
    return buf;
  }

  #pruneSlots(before) {
    for (const key of this.slots.keys()) if (Number(key.split(':')[1]) < before) this.slots.delete(key);
  }

  #freq(line, degree) {
    const v = LINE_VOICES[this.lines[line].id];
    const n = this.raga.semis.length;
    const semi = Math.floor(degree / n) * 12 + this.raga.semis[degree % n];
    return midiHz(SA_MIDI + 12 * v.octave + semi);
  }

  #tanpuraTuning() {
    // Pa, Sa, Sa, low Sa. Ragas without Pa tune the first string to Ma instead.
    const first = this.raga.semis.includes(7) ? SA_MIDI - 5 : SA_MIDI - 7;
    return [first, SA_MIDI, SA_MIDI, SA_MIDI - 12];
  }

  #voice(line, degree, when, pan) {
    const freq = this.#freq(line, degree);
    // Gamaka: sometimes slide up into the note from the one below, as Carnatic players do.
    const below = degree > 0 && Math.random() < 0.35 ? this.#freq(line, degree - 1) / freq : 0;
    const vel = 0.72 + Math.random() * 0.28;
    const out = this.#panner(pan, this.lineGains[line]);
    const kind = LINE_VOICES[this.lines[line].id].kind;
    if (kind === 'veena') this.#veena(when, freq, vel, out, below);
    else if (kind === 'flute') this.#flute(when, freq, vel, out, below);
    else this.#bells(when, freq, vel, out);
  }

  #panner(pan, dest) {
    if (!this.ctx.createStereoPanner) return dest;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan || 0));
    p.connect(dest);
    return p;
  }

  // ---------------------------------------------------------------- instruments

  /** Karplus-Strong plucked string: a burst of noise circulating in a short, decaying loop. */
  #pluck(freq, seconds, damping, brightness) {
    const key = `${Math.round(freq * 100)}:${seconds}:${damping}:${brightness}`;
    if (this.buffers.has(key)) return this.buffers.get(key);
    const sr = this.ctx.sampleRate;
    const period = Math.max(2, Math.round(sr / freq - 0.5));
    const ring = new Float32Array(period);
    let lp = 0;
    let mean = 0;
    for (let i = 0; i < period; i++) {
      lp += brightness * (Math.random() * 2 - 1 - lp);
      ring[i] = lp;
      mean += lp / period;
    }
    for (let i = 0; i < period; i++) ring[i] -= mean;
    const len = Math.floor(sr * seconds);
    const buffer = this.ctx.createBuffer(1, len, sr);
    const out = buffer.getChannelData(0);
    let idx = 0;
    let peak = 1e-6;
    for (let i = 0; i < len; i++) {
      const next = idx + 1 === period ? 0 : idx + 1;
      const a = ring[idx];
      out[i] = a;
      if (Math.abs(a) > peak) peak = Math.abs(a);
      ring[idx] = damping * 0.5 * (a + ring[next]);
      idx = next;
    }
    for (let i = 0; i < len; i++) out[i] /= peak;
    // The averaging filter tunes the loop slightly flat; playbackRate corrects it.
    const entry = { buffer, rate: freq / (sr / (period + 0.5)) };
    this.buffers.set(key, entry);
    return entry;
  }

  #veena(t, freq, vel, out, below) {
    const ctx = this.ctx;
    const dur = 3.2;
    const { buffer, rate } = this.#pluck(freq, dur, 0.9986, 0.62);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (below) {
      src.playbackRate.setValueAtTime(rate * below, t);
      src.playbackRate.linearRampToValueAtTime(rate, t + 0.14);
    } else {
      src.playbackRate.value = rate;
    }
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 850;
    body.Q.value = 0.9;
    body.gain.value = 5;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.42 * vel, t);
    g.gain.setTargetAtTime(0, t + dur - 0.5, 0.15);
    src.connect(body).connect(tone).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur);
  }

  #flute(t, freq, vel, out, below) {
    const ctx = this.ctx;
    const dur = 1.5;
    const tone = ctx.createOscillator();
    tone.type = 'sine';
    const air = ctx.createOscillator();
    air.type = 'triangle';
    for (const o of [tone, air]) {
      if (below) {
        o.frequency.setValueAtTime(freq * below, t);
        o.frequency.exponentialRampToValueAtTime(freq, t + 0.1);
      } else {
        o.frequency.setValueAtTime(freq, t);
      }
    }
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibDepth = ctx.createGain();
    vibDepth.gain.setValueAtTime(0, t);
    vibDepth.gain.linearRampToValueAtTime(freq * 0.007, t + 0.55);
    vib.connect(vibDepth);
    vibDepth.connect(tone.frequency);
    vibDepth.connect(air.frequency);

    const airLevel = ctx.createGain();
    airLevel.gain.value = 0.22;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.34 * vel, t + 0.07);
    env.gain.linearRampToValueAtTime(0.24 * vel, t + 0.45);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    // Breath: filtered noise that fades after the attack.
    const breath = ctx.createBufferSource();
    breath.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(9000, freq * 2.2);
    bp.Q.value = 1.1;
    const breathEnv = ctx.createGain();
    breathEnv.gain.setValueAtTime(0, t);
    breathEnv.gain.linearRampToValueAtTime(0.16 * vel, t + 0.03);
    breathEnv.gain.exponentialRampToValueAtTime(0.012, t + 0.35);
    breathEnv.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    tone.connect(env);
    air.connect(airLevel).connect(env);
    breath.connect(bp).connect(breathEnv).connect(lp);
    env.connect(lp).connect(out);

    for (const n of [tone, air, vib, breath]) {
      n.start(t);
      n.stop(t + dur + 0.05);
    }
  }

  /** FM bell: a sine wave whose pitch is wobbled by another, faster sine. */
  #bells(t, freq, vel, out) {
    const ctx = this.ctx;
    const dur = 3;
    const carrier = ctx.createOscillator();
    carrier.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 3.5;
    const index = ctx.createGain();
    index.gain.setValueAtTime(freq * 2.4, t);
    index.gain.exponentialRampToValueAtTime(freq * 0.04, t + 1.4);
    mod.connect(index).connect(carrier.frequency);
    const shimmer = ctx.createOscillator();
    shimmer.frequency.value = freq * 2.01;
    const shimmerEnv = ctx.createGain();
    shimmerEnv.gain.setValueAtTime(0.09 * vel, t);
    shimmerEnv.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.26 * vel, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    carrier.connect(env).connect(out);
    shimmer.connect(shimmerEnv).connect(out);
    for (const n of [carrier, mod, shimmer]) {
      n.start(t);
      n.stop(t + dur + 0.05);
    }
  }

  /** Soft low gong for interchange stations (Majestic, RV Road). */
  #gong(t, pan) {
    const ctx = this.ctx;
    const base = midiHz(SA_MIDI - 12);
    const out = this.#panner(pan * 0.5, this.bus);
    [
      [1, 0.5, 5],
      [2, 0.25, 3.4],
      [2.76, 0.16, 2.4],
      [4.07, 0.08, 1.4],
    ].forEach(([ratio, level, decay]) => {
      const o = ctx.createOscillator();
      o.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level * 0.32, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + decay + 0.05);
    });
  }

  #tanpura(t, freq, pan) {
    const ctx = this.ctx;
    const dur = 5;
    const { buffer, rate } = this.#pluck(freq, dur, 0.9995, 0.3);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.setTargetAtTime(0, t + dur - 0.8, 0.25);
    src.connect(lp).connect(g).connect(this.#panner(pan, this.droneGain));
    src.start(t);
    src.stop(t + dur);
  }
}
