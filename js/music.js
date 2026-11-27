// music.js - every sound here is synthesised in the browser with the Web Audio API.
// There are no recordings. If you want to change how the city sounds, start here.
//
// The ensemble for each area:
//   Buses (live)       moving buses play the santoor, buses standing still play the mridangam
//   Metro (timetable)  trains reaching the area's stations play veena, flute or bells by line
//   Pulse              a soft kanjira keeping Adi tala; its tempo follows the area's traffic
//   Tanpura            the drone underneath, tuned to the area's raga

// Five-note Carnatic ragas: any notes from one of these sound good together, which matters
// because buses and trains arrive whenever they like. `semis` are semitones above Sa.
export const RAGAS = {
  mohanam: { name: 'Mohanam', swaras: ['S', 'R2', 'G3', 'P', 'D2'], semis: [0, 2, 4, 7, 9] },
  madhyamavati: { name: 'Madhyamavati', swaras: ['S', 'R2', 'M1', 'P', 'N2'], semis: [0, 2, 5, 7, 10] },
  hamsadhwani: { name: 'Hamsadhwani', swaras: ['S', 'R2', 'G3', 'P', 'N3'], semis: [0, 2, 4, 7, 11] },
  shivaranjani: { name: 'Shivaranjani', swaras: ['S', 'R2', 'G2', 'P', 'D2'], semis: [0, 2, 3, 7, 9] },
  hindolam: { name: 'Hindolam', swaras: ['S', 'G2', 'M1', 'D1', 'N2'], semis: [0, 3, 5, 8, 10] },
  abhogi: { name: 'Abhogi', swaras: ['S', 'R2', 'G2', 'M1', 'D2'], semis: [0, 2, 3, 5, 9] },
  bhupalam: { name: 'Bhupalam', swaras: ['S', 'R1', 'G2', 'P', 'D1'], semis: [0, 1, 3, 7, 8] },
  revati: { name: 'Revati', swaras: ['S', 'R1', 'M1', 'P', 'N2'], semis: [0, 1, 5, 7, 10] },
  shuddhasaveri: { name: 'Shuddha Saveri', swaras: ['S', 'R2', 'M1', 'P', 'D2'], semis: [0, 2, 5, 7, 9] },
  shuddhadhanyasi: { name: 'Shuddha Dhanyasi', swaras: ['S', 'G2', 'M1', 'P', 'N2'], semis: [0, 3, 5, 7, 10] },
};

// One instrument per metro line. `octave` is how far above Sa it sits.
// `maxDegree` is the note the station furthest from Majestic gets (5 notes per octave).
export const LINE_VOICES = {
  PURPLE: { instrument: 'Veena', kind: 'veena', octave: 0, maxDegree: 12, level: 0.95 },
  GREEN: { instrument: 'Bansuri flute', kind: 'flute', octave: 1, maxDegree: 10, level: 0.55 },
  YELLOW: { instrument: 'Temple bells', kind: 'bells', octave: 2, maxDegree: 7, level: 0.8 },
};

export const BUS_DEGREES = 10; // bus notes span two octaves, north of the area highest
const SA_MIDI = 50; // D3, about 147 Hz. Change this one number to retune everything.
const MAX_NOTES_PER_STEP = 2; // per voice, so busy areas stay musical
const ADI_TALA_ACCENTS = [1, 0, 0, 0, 0.7, 0, 0.7, 0]; // 4 + 2 + 2 beats

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

/** Pulse tempo from the median bus speed in an area: a crawl is slow, an open road is quick. */
export function tempoForSpeed(kmh) {
  if (kmh == null) return 76;
  return Math.round(Math.max(54, Math.min(120, 54 + kmh * 2.2)));
}

export class Music {
  constructor(lines) {
    this.lines = lines;
    this.ctx = null;
    this.playing = false;
    this.raga = RAGAS.mohanam;
    this.layers = { buses: true, metro: true, tanpura: true };
    this.volume = 0.8;
    this.tempo = 76;
    this.slots = new Map();
    this.buffers = new Map();
    this.lastGong = -Infinity;
    this.droneStep = 0;
    this.nextDrone = 0;
    this.nextBeat = 0;
    this.beat = 0;

    // Note for each metro station: the further from the line's home station, the higher.
    this.degrees = lines.map((L) => {
      const v = LINE_VOICES[L.id];
      const far = Math.max(L.anchor, L.stations.length - 1 - L.anchor);
      return L.stations.map((_, i) => Math.round((Math.abs(i - L.anchor) / far) * v.maxDegree));
    });
  }

  labelFor(line, local) {
    return swaraName(this.raga, this.degrees[line][local]);
  }

  busLabel(degree) {
    return swaraName(this.raga, degree);
  }

  setRaga(key) {
    this.raga = RAGAS[key] || RAGAS.mohanam;
  }

  setTempo(bpm) {
    this.tempo = bpm;
  }

  setVolume(v) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(this.playing ? v : 0, this.ctx.currentTime, 0.05);
  }

  setLayer(name, on) {
    this.layers[name] = on;
    if (!this.ctx) return;
    const g = { buses: this.busGain, metro: this.metroGain, tanpura: this.droneGain }[name];
    const level = { buses: 1, metro: 1, tanpura: 0.2 }[name];
    g.gain.setTargetAtTime(on ? level : 0, this.ctx.currentTime, 0.2);
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
    this.nextBeat = Math.max(this.nextBeat, now + 0.3);
    this.beatAnchor = this.nextBeat;
  }

  pause() {
    if (!this.ctx) return;
    this.playing = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    this.suspendTimer = setTimeout(() => this.ctx.suspend(), 450);
  }

  /** Finds a free eighth-note slot on the pulse at or after `eventPerf`. Returns its audio time. */
  #slot(voiceKey, degree, eventPerf) {
    const now = this.ctx.currentTime;
    const t = now + Math.max(0, (eventPerf - performance.now()) / 1000) + 0.04;
    const step = 60 / this.tempo / 2; // eighth notes on the pulse
    const origin = this.beatAnchor || 0;
    let slot = Math.ceil((t - origin) / step);
    for (let tries = 0; tries < 3; tries++, slot++) {
      const at = origin + slot * step;
      const key = `${voiceKey}:${Math.round(at * 100)}`;
      const used = this.slots.get(key) || [];
      if (used.length >= MAX_NOTES_PER_STEP || used.includes(degree)) continue;
      used.push(degree);
      this.slots.set(key, used);
      if (this.slots.size > 400) this.slots.clear();
      return at + (Math.random() - 0.5) * 0.012;
    }
    return null;
  }

  #result(when, label) {
    return { atPerf: performance.now() + (when - this.ctx.currentTime) * 1000, label };
  }

  /** A metro train reached a station in the area. */
  playStation({ line, local, eventPerf, pan, interchange }) {
    if (!this.playing || !this.layers.metro) return null;
    const degree = this.degrees[line][local];
    const when = this.#slot(`m${line}`, degree, eventPerf);
    if (when === null) return null;
    const freq = this.#freq(LINE_VOICES[this.lines[line].id].octave, degree);
    const below = degree > 0 && Math.random() < 0.35 ? this.#freq(LINE_VOICES[this.lines[line].id].octave, degree - 1) / freq : 0;
    const vel = 0.72 + Math.random() * 0.28;
    const out = this.#panner(pan, this.lineGains[line]);
    const kind = LINE_VOICES[this.lines[line].id].kind;
    if (kind === 'veena') this.#veena(when, freq, vel, out, below);
    else if (kind === 'flute') this.#flute(when, freq, vel, out, below);
    else this.#bells(when, freq, vel, out);
    if (interchange && when - this.lastGong > 6) {
      this.lastGong = when;
      this.#gong(when, pan);
    }
    return this.#result(when, swaraName(this.raga, degree));
  }

  /** A live bus reported its position in the area. Moving: santoor note. Standing: mridangam. */
  playBus({ moving, degree, eventPerf, pan }) {
    if (!this.playing || !this.layers.buses) return null;
    const when = this.#slot(moving ? 'santoor' : 'mridangam', moving ? degree : 0, eventPerf);
    if (when === null) return null;
    const vel = 0.7 + Math.random() * 0.3;
    if (moving) {
      this.#santoor(when, this.#freq(1, degree), vel, this.#panner(pan, this.busGain));
      return this.#result(when, swaraName(this.raga, degree));
    }
    this.#mridangam(when, vel, this.#panner(pan, this.busGain));
    return this.#result(when, 'Tham');
  }

  /** Keeps the tanpura and the pulse going. Call a few times a second. */
  tick() {
    if (!this.playing || !this.ctx) return;
    const now = this.ctx.currentTime;
    const horizon = now + 1.8; // looks ahead so a busy or background tab never leaves a gap
    if (this.nextDrone < now) this.nextDrone = now + 0.05;
    const tuning = this.#tanpuraTuning();
    while (this.nextDrone < horizon) {
      const i = this.droneStep % 4;
      this.#tanpura(this.nextDrone, midiHz(tuning[i]), [-0.35, 0.15, 0.25, -0.1][i]);
      this.droneStep++;
      this.nextDrone += 1.1 + Math.random() * 0.05 + (i === 3 ? 0.7 : 0);
    }
    if (this.nextBeat < now) this.nextBeat = now + 0.05;
    while (this.nextBeat < horizon) {
      const accent = ADI_TALA_ACCENTS[this.beat % 8];
      this.#kanjira(this.nextBeat, accent ? 0.5 + 0.5 * accent : 0.32, accent === 1);
      this.beatAnchor = this.nextBeat; // notes snap to this beat's grid
      this.beat++;
      this.nextBeat += 60 / this.tempo;
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

    this.metroGain = ctx.createGain();
    this.metroGain.gain.value = this.layers.metro ? 1 : 0;
    this.metroGain.connect(this.bus);
    this.lineGains = this.lines.map((L) => {
      const g = ctx.createGain();
      g.gain.value = LINE_VOICES[L.id].level;
      g.connect(this.metroGain);
      return g;
    });

    this.busGain = ctx.createGain();
    this.busGain.gain.value = this.layers.buses ? 1 : 0;
    this.busGain.connect(this.bus);

    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0.55;
    this.pulseGain.connect(this.busGain);

    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = this.layers.tanpura ? 0.2 : 0;
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
        const k = 0.6 - 0.5 * x; // the tail darkens as it fades, like a stone hall
        lp += k * (Math.random() * 2 - 1 - lp);
        d[i] = lp * (1 - x) ** 2.4;
      }
    }
    return buf;
  }

  #freq(octave, degree) {
    const n = this.raga.semis.length;
    const semi = Math.floor(degree / n) * 12 + this.raga.semis[degree % n];
    return midiHz(SA_MIDI + 12 * octave + semi);
  }

  #tanpuraTuning() {
    // Pa, Sa, Sa, low Sa. Ragas without Pa tune the first string to Ma instead.
    const first = this.raga.semis.includes(7) ? SA_MIDI - 5 : SA_MIDI - 7;
    return [first, SA_MIDI, SA_MIDI, SA_MIDI - 12];
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
      // gamaka: slide up into the note from the one below
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

  /** Hammered strings: a bright, quick pluck struck twice, like a santoor player's mallets. */
  #santoor(t, freq, vel, out) {
    const ctx = this.ctx;
    const dur = 1.8;
    const { buffer, rate } = this.#pluck(freq, dur, 0.9965, 0.88);
    [
      [0, 0.3],
      [0.075, 0.13],
    ].forEach(([offset, level]) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level * vel, t + offset);
      g.gain.setTargetAtTime(0, t + dur - 0.5, 0.12);
      src.connect(hp).connect(g).connect(out);
      src.start(t + offset);
      src.stop(t + offset + dur);
    });
  }

  /** Mridangam "tham": the big bass head, a thud whose pitch drops as it rings. */
  #mridangam(t, vel, out) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(78, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.62 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    const skin = ctx.createBufferSource();
    skin.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 1.4;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.22 * vel, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(out);
    skin.connect(bp).connect(sg).connect(out);
    o.start(t);
    o.stop(t + 0.8);
    skin.start(t, Math.random() * 0.5);
    skin.stop(t + 0.06);
  }

  /** Kanjira tap for the pulse: a jingle of filtered noise over a small drum. */
  #kanjira(t, vel, accent) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = accent ? 5200 : 6400;
    hp.Q.value = 2.5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + (accent ? 0.16 : 0.07));
    const d = ctx.createOscillator();
    d.frequency.setValueAtTime(accent ? 420 : 520, t);
    d.frequency.exponentialRampToValueAtTime(accent ? 300 : 400, t + 0.08);
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0.2 * vel, t);
    dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(hp).connect(ng).connect(this.pulseGain);
    d.connect(dg).connect(this.pulseGain);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.2);
    d.start(t);
    d.stop(t + 0.14);
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
    const out = this.#panner((pan || 0) * 0.5, this.metroGain);
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
