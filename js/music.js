// music.js - every sound here is synthesised in the browser with the Web Audio API.
// There are no recordings. If you want to change how the city sounds, start here.
//
// The ensemble for each area:
//   Buses (live)       moving buses play the veena, buses standing still play the bansuri flute
//   Metro (timetable)  trains at the area's stations: santoor, jal tarang or temple bells by line
//   Rhythm             Side A (Carnatic): kanjira and mridangam in Adi tala
//                      Side B (Carnatic jazz): walking bass, electric piano and ride cymbal, swung
//                      Either way the tempo follows the area's traffic.
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

// The two sides of the record.
export const STYLES = {
  carnatic: { side: 'Side A', name: 'Carnatic', rhythm: 'Kanjira, mridangam' },
  jazz: { side: 'Side B', name: 'Carnatic jazz', rhythm: 'Bass, keys, ride' },
};

// Buses: the most notes, so they get the two leading Carnatic instruments.
export const BUS_VOICES = {
  moving: { instrument: 'Veena', octave: 0 },
  standing: { instrument: 'Bansuri flute', octave: 1 },
};
export const BUS_DEGREES = 10; // bus notes span two octaves, north of the area highest

// Metro: one instrument per line. `maxDegree` is the note the station furthest from Majestic gets.
export const LINE_VOICES = {
  PURPLE: { instrument: 'Santoor', kind: 'santoor', octave: 1, maxDegree: 10, level: 0.85 },
  GREEN: { instrument: 'Jal tarang', kind: 'jaltarang', octave: 1, maxDegree: 10, level: 0.9 },
  YELLOW: { instrument: 'Temple bells', kind: 'bells', octave: 2, maxDegree: 7, level: 0.75 },
};

const SA_MIDI = 50; // D3, about 147 Hz. Change this one number to retune everything.
// A twentieth of a second of silence. Looping it in an <audio> element tells iPhones this page is
// playing music, so sound still comes out when the ring/silent switch is on silent.
const SILENT_WAV = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
const MAX_NOTES_PER_STEP = 2; // per voice, so busy areas stay musical
const ADI_TALA_ACCENTS = [1, 0, 0, 0, 0.7, 0, 0.7, 0]; // 4 + 2 + 2 beats
const SWING = 0.17; // jazz: off-beat eighths land at two thirds of the beat
const COMPING = [
  // [beat, length in beats] for the electric piano, one pattern per bar
  [[0, 1], [1 + 2 / 3, 0.9]],
  [[2 / 3, 0.5], [2 + 2 / 3, 1]],
  [[0, 3.2]],
  [[1, 0.6], [3, 0.6]],
  [[0, 0.7], [2 + 2 / 3, 0.5], [3 + 2 / 3, 0.3]],
];

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
    this.style = 'carnatic';
    this.layers = { buses: true, metro: true, rhythm: true, drone: true };
    this.volume = 0.8;
    this.tempo = 76;
    this.slots = new Map();
    this.buffers = new Map();
    this.lastGong = -Infinity;
    this.droneStep = 0;
    this.nextDrone = 0;
    this.nextBeat = 0;
    this.beat = 0;
    this.walk = 0; // walking bass position (raga degree)

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

  setStyle(style) {
    this.style = STYLES[style] ? style : 'carnatic';
    this.#levels();
  }

  setVolume(v) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(this.playing ? v : 0, this.ctx.currentTime, 0.05);
  }

  setLayer(name, on) {
    this.layers[name] = on;
    this.#levels();
  }

  #levels() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const jazz = this.style === 'jazz';
    const set = (g, v) => g.gain.setTargetAtTime(v, t, 0.25);
    set(this.busGain, this.layers.buses ? 1 : 0);
    set(this.metroGain, this.layers.metro ? 1 : 0);
    set(this.rhythmGain, this.layers.rhythm ? 1 : 0);
    set(this.droneGain, this.layers.drone ? (jazz ? 0.07 : 0.2) : 0);
  }

  async start() {
    if (!this.ctx) this.#build();
    clearTimeout(this.suspendTimer);
    this.#keepAwake(true);
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
    this.#keepAwake(false);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    this.suspendTimer = setTimeout(() => this.ctx.suspend(), 450);
  }

  /** Plays (or stops) the silent loop and asks for media playback, so phones treat this as music. */
  #keepAwake(on) {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // older browsers: nothing to do
    }
    if (!this.silentLoop) {
      this.silentLoop = new Audio(SILENT_WAV);
      this.silentLoop.loop = true;
      this.silentLoop.setAttribute('playsinline', '');
    }
    if (on) this.silentLoop.play().catch(() => {});
    else this.silentLoop.pause();
  }

  /** Finds a free eighth-note slot on the pulse at or after `eventPerf`. Returns its audio time. */
  #slot(voiceKey, degree, eventPerf) {
    const now = this.ctx.currentTime;
    const t = now + Math.max(0, (eventPerf - performance.now()) / 1000) + 0.04;
    const step = 60 / this.tempo / 2; // eighth notes on the pulse
    const swing = this.style === 'jazz' ? SWING * 2 * step : 0;
    const origin = this.beatAnchor || 0;
    let slot = Math.ceil((t - origin) / step);
    for (let tries = 0; tries < 3; tries++, slot++) {
      const at = origin + slot * step + (Math.abs(slot) % 2 ? swing : 0);
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
    const voice = LINE_VOICES[this.lines[line].id];
    const freq = this.#freq(voice.octave, degree);
    const vel = 0.72 + Math.random() * 0.28;
    const out = this.#panner(pan, this.lineGains[line]);
    if (voice.kind === 'santoor') this.#santoor(when, freq, vel, out);
    else if (voice.kind === 'jaltarang') this.#jaltarang(when, freq, vel, out);
    else this.#bells(when, freq, vel, out);
    if (interchange && when - this.lastGong > 6) {
      this.lastGong = when;
      this.#gong(when, pan);
    }
    return this.#result(when, swaraName(this.raga, degree));
  }

  /** A live bus reported its position in the area. Moving: veena. Standing still: flute. */
  playBus({ moving, degree, eventPerf, pan }) {
    if (!this.playing || !this.layers.buses) return null;
    const voice = moving ? BUS_VOICES.moving : BUS_VOICES.standing;
    const when = this.#slot(moving ? 'veena' : 'flute', degree, eventPerf);
    if (when === null) return null;
    const freq = this.#freq(voice.octave, degree);
    // Gamaka: sometimes slide up into the note from the one below, as Carnatic players do.
    const below = degree > 0 && Math.random() < 0.35 ? this.#freq(voice.octave, degree - 1) / freq : 0;
    const vel = 0.72 + Math.random() * 0.28;
    const out = this.#panner(pan, this.busGain);
    if (moving) this.#veena(when, freq, vel, out, below);
    else this.#flute(when, freq, vel * 0.72, out, below);
    return this.#result(when, swaraName(this.raga, degree));
  }

  /** Keeps the tanpura and the rhythm going. Call a few times a second. */
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
      const beatLen = 60 / this.tempo;
      if (this.style === 'jazz') this.#jazzBeat(this.nextBeat, beatLen);
      else this.#carnaticBeat(this.nextBeat);
      this.beatAnchor = this.nextBeat; // notes snap to this beat's grid
      this.beat++;
      this.nextBeat += beatLen;
    }
  }

  #carnaticBeat(t) {
    const pos = this.beat % 8;
    const accent = ADI_TALA_ACCENTS[pos];
    this.#kanjira(t, accent ? 0.5 + 0.5 * accent : 0.32, accent === 1);
    if (pos === 0) this.#mridangam(t, 0.85, this.rhythmGain, 1); // sama, the start of the cycle
    if (pos === 4) this.#mridangam(t, 0.5, this.rhythmGain, 1.5);
  }

  #jazzBeat(t, beatLen) {
    const pos = this.beat % 4;
    const bar = Math.floor(this.beat / 4);
    // Ride: every beat, plus the swung "and" of 2 and 4. Hi-hat closes on 2 and 4.
    this.#ride(t, pos === 0 ? 0.9 : 0.7);
    if (pos === 1 || pos === 3) {
      this.#ride(t + beatLen * (0.5 + SWING), 0.45);
      this.#hat(t);
    }
    // Two chords built from the raga's own notes, two bars each.
    const root = Math.floor(bar / 2) % 2 ? 3 : 0;
    const nextRoot = Math.floor((bar + 1) / 2) % 2 ? 3 : 0;
    // Walking bass: the chord's root on the downbeat, steps through the raga, leads into the next.
    if (pos === 0) this.walk = root;
    else if (pos === 3) this.walk = nextRoot + (Math.random() < 0.5 ? 1 : -1);
    else this.walk += [-1, 1, 1, 2][Math.floor(Math.random() * 4)];
    this.walk = Math.max(-2, Math.min(7, this.walk));
    this.#bass(t, this.#freq(-1, this.walk), beatLen * 0.92);
    if (pos === 0) {
      const pattern = COMPING[Math.floor(Math.random() * COMPING.length)];
      const chord = [0, 2, 4, 6].map((d) => this.#freq(0, root + d));
      for (const [at, len] of pattern) this.#keys(t + at * beatLen, chord, len * beatLen);
    }
    // Every fourth bar ends with a mridangam phrase, ta-ka-di-mi.
    if (bar % 4 === 3 && pos === 3) {
      [1, 1.3, 1.15, 0.9].forEach((p, i) => this.#mridangam(t + (i * beatLen) / 4, 0.55 + (i === 0) * 0.2, this.rhythmGain, p));
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
    this.metroGain.connect(this.bus);
    this.lineGains = this.lines.map((L) => {
      const g = ctx.createGain();
      g.gain.value = LINE_VOICES[L.id].level;
      g.connect(this.metroGain);
      return g;
    });
    this.busGain = ctx.createGain();
    this.busGain.connect(this.bus);
    this.rhythmGain = ctx.createGain();
    this.rhythmGain.connect(this.bus);

    this.droneGain = ctx.createGain();
    this.droneGain.connect(this.master);
    const droneSend = ctx.createGain();
    droneSend.gain.value = 0.35;
    this.droneGain.connect(droneSend).connect(this.reverb);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    this.#levels();
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
    const oct = Math.floor(degree / n);
    const semi = oct * 12 + this.raga.semis[((degree % n) + n) % n];
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

  #noiseBurst(t, dur, filterType, freq, q, level, out) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(out);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur + 0.02);
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
    g.gain.setValueAtTime(0.46 * vel, t);
    g.gain.setTargetAtTime(0, t + dur - 0.5, 0.15);
    src.connect(body).connect(tone).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur);
  }

  #flute(t, freq, vel, out, below) {
    const ctx = this.ctx;
    const dur = 1.6;
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
    env.gain.linearRampToValueAtTime(0.36 * vel, t + 0.07);
    env.gain.linearRampToValueAtTime(0.26 * vel, t + 0.45);
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

  /** Hammered strings: a bright, quick pluck struck twice, like a santoor player's mallets. */
  #santoor(t, freq, vel, out) {
    const ctx = this.ctx;
    const dur = 1.8;
    const { buffer, rate } = this.#pluck(freq, dur, 0.9965, 0.88);
    [
      [0, 0.62],
      [0.075, 0.26],
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

  /** Jal tarang: porcelain bowls of water struck with sticks. A pure tone that wobbles as it rings. */
  #jaltarang(t, freq, vel, out) {
    const ctx = this.ctx;
    const dur = 1.6;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq * 1.012, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 6.5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(freq * 0.004, t + 0.4);
    wobble.connect(depth).connect(o.frequency);
    const partial = ctx.createOscillator();
    partial.frequency.value = freq * 2.76;
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.06 * vel, t);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.3 * vel, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env).connect(out);
    partial.connect(pg).connect(out);
    for (const n of [o, wobble, partial]) {
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

  /** Mridangam stroke: the bass head's thud with its pitch dropping. `pitch` varies the stroke. */
  #mridangam(t, vel, out, pitch = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(165 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(78 * pitch, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.75);
    this.#noiseBurst(t, 0.05, 'bandpass', 1100 * pitch, 1.4, 0.2 * vel, out);
  }

  /** Kanjira tap: a jingle of filtered noise over a small frame drum. */
  #kanjira(t, vel, accent) {
    const ctx = this.ctx;
    this.#noiseBurst(t, accent ? 0.16 : 0.07, 'bandpass', accent ? 5200 : 6400, 2.5, 0.24 * vel, this.rhythmGain);
    const d = ctx.createOscillator();
    d.frequency.setValueAtTime(accent ? 420 : 520, t);
    d.frequency.exponentialRampToValueAtTime(accent ? 300 : 400, t + 0.08);
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0.3 * vel, t);
    dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    d.connect(dg).connect(this.rhythmGain);
    d.start(t);
    d.stop(t + 0.14);
  }

  /** Ride cymbal: several square waves at clashing pitches, filtered high, ringing on. */
  #ride(t, vel) {
    const ctx = this.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 8800;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012 * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    hp.connect(bp).connect(g).connect(this.rhythmGain);
    for (const f of [263, 400, 421, 474, 587, 845]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * 2.2;
      o.connect(hp);
      o.start(t);
      o.stop(t + 0.92);
    }
    this.#noiseBurst(t, 0.03, 'highpass', 9000, 0.7, 0.025 * vel, this.rhythmGain);
  }

  /** Hi-hat closed with the foot: a short "chick". */
  #hat(t) {
    this.#noiseBurst(t, 0.05, 'highpass', 7500, 0.8, 0.05, this.rhythmGain);
  }

  /** Upright bass: a round, low pluck. */
  #bass(t, freq, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const sub = ctx.createOscillator();
    sub.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(320, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.075, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.034, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp);
    sub.connect(lp);
    lp.connect(g).connect(this.rhythmGain);
    for (const n of [o, sub]) {
      n.start(t);
      n.stop(t + dur + 0.02);
    }
  }

  /** Electric piano chord: each note a soft FM "tine" with a bell-like attack. */
  #keys(t, freqs, dur) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.045;
    out.connect(this.rhythmGain);
    for (const f of freqs) {
      const c = ctx.createOscillator();
      c.frequency.value = f;
      const m = ctx.createOscillator();
      m.frequency.value = f;
      const idx = ctx.createGain();
      idx.gain.setValueAtTime(f * 1.6, t);
      idx.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.3);
      m.connect(idx).connect(c.frequency);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.6, t + 0.006);
      env.gain.exponentialRampToValueAtTime(0.25, t + 0.4);
      env.gain.setValueAtTime(0.25, t + Math.max(0.41, dur));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
      c.connect(env).connect(out);
      for (const n of [c, m]) {
        n.start(t);
        n.stop(t + dur + 0.4);
      }
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
