// map.js - draws the metro on a <canvas>: real track shapes, stations, trains, ripples.
//
// Positions are worked out in kilometres from Majestic, then scaled to fit the
// screen. The faint rings are 5 km apart because distance from Majestic is what
// sets each station's pitch.

const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON_EQ = 111.32;
const RING_KM = [5, 10, 15, 20];
const RIPPLE_SECONDS = 1.9;
const LABEL_SECONDS = 2.6;
const MAX_FLOATING_LABELS = 5;

// Station labels always drawn (short names). Smaller screens get fewer.
const KEY_LABELS = ['Majestic', 'RV Road', 'Whitefield', 'Challaghatta', 'Madavara', 'Silk Institute', 'Bommasandra'];
const MORE_LABELS = ['MG Road', 'Indiranagar', 'Yeshwantpur', 'Electronic City', 'Central Silk Board', 'Krishnarajapura', 'Jayanagar', 'Vijayanagar'];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export class MetroMap {
  constructor(canvas, tt) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tt = tt;
    this.ripples = [];
    this.floating = [];
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const purple = tt.lines[0];
    this.home = tt.stations[purple.stations[purple.anchor]]; // Majestic
    this.lat0 = this.home.lat;
    this.lon0 = this.home.lon;
    this.kmPerDegLon = KM_PER_DEG_LON_EQ * Math.cos((this.lat0 * Math.PI) / 180);

    this.lineKm = tt.lines.map((l) => l.path.map(([lat, lon]) => this.toKm(lat, lon)));
    this.lineCum = tt.lines.map((l) => l.path.map((p) => p[2]));
    this.stationKm = tt.stations.map((s) => this.toKm(s.lat, s.lon));
    const xs = this.lineKm.flat().map((p) => p[0]);
    const ys = this.lineKm.flat().map((p) => p[1]);
    this.bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const span = Math.max(Math.abs(this.bounds.minX), Math.abs(this.bounds.maxX));
    this.pans = this.stationKm.map(([x]) => (x / span) * 0.8); // west on the left, east on the right

    this.readColors();
    this.staticLayer = document.createElement('canvas');
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  readColors() {
    this.colors = {
      lines: this.tt.lines.map((l) => cssVar(`--line-${l.id.toLowerCase()}`) || l.color),
      bg: cssVar('--night'),
      panel: cssVar('--raise'),
      text: cssVar('--text'),
      muted: cssVar('--muted'),
      ring: cssVar('--ring'),
      font: cssVar('--font-body'),
      mono: cssVar('--font-mono'),
    };
    this.glows = this.colors.lines.map((c) => {
      const g = document.createElement('canvas');
      g.width = g.height = 64;
      const x = g.getContext('2d');
      const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, c);
      grad.addColorStop(1, 'transparent');
      x.globalAlpha = 0.55;
      x.fillStyle = grad;
      x.fillRect(0, 0, 64, 64);
      return g;
    });
  }

  toKm(lat, lon) {
    return [(lon - this.lon0) * this.kmPerDegLon, -(lat - this.lat0) * KM_PER_DEG_LAT];
  }

  toPx([x, y]) {
    return [this.ox + x * this.scale, this.oy + y * this.scale];
  }

  panOf(stationIdx) {
    return this.pans[stationIdx];
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    for (const c of [this.canvas, this.staticLayer]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    this.compact = this.w < 560;
    const pad = this.compact ? 34 : 56;
    const b = this.bounds;
    this.scale = Math.min((this.w - 2 * pad) / (b.maxX - b.minX), (this.h - 2 * pad) / (b.maxY - b.minY));
    this.ox = this.w / 2 - ((b.minX + b.maxX) / 2) * this.scale;
    this.oy = this.h / 2 - ((b.minY + b.maxY) / 2) * this.scale;
    this.linePx = this.lineKm.map((pts) => pts.map((p) => this.toPx(p)));
    this.stationPx = this.stationKm.map((p) => this.toPx(p));
    this.renderStatic();
  }

  /** Screen position of a point `d` km along line `li`. */
  pointAt(li, d) {
    const cum = this.lineCum[li];
    const pts = this.linePx[li];
    let lo = 0;
    let hi = cum.length - 1;
    if (d <= cum[0]) return pts[0];
    if (d >= cum[hi]) return pts[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const f = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
  }

  renderStatic() {
    const c = this.staticLayer.getContext('2d');
    const { colors, tt } = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);

    // Distance rings around Majestic.
    const [hx, hy] = this.stationPx[tt.stations.indexOf(this.home)];
    c.strokeStyle = colors.ring;
    c.fillStyle = colors.muted;
    c.lineWidth = 1;
    c.font = `500 10px ${colors.mono}`;
    c.textAlign = 'left';
    c.textBaseline = 'bottom';
    const labelAngle = (-52 * Math.PI) / 180; // north-east of Majestic, where no line runs
    for (const km of RING_KM) {
      const r = km * this.scale;
      c.setLineDash([2, 5]);
      c.beginPath();
      c.arc(hx, hy, r, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      const lx = hx + r * Math.cos(labelAngle) + 4;
      const ly = hy + r * Math.sin(labelAngle) - 2;
      if (ly > 14 && lx < this.w - 40) c.fillText(`${km} km`, lx, ly);
    }

    // Tracks: a wide soft stroke under a thin bright one.
    tt.lines.forEach((l, li) => {
      const pts = this.linePx[li];
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (const [width, alpha] of [
        [9, 0.16],
        [2.4, 0.9],
      ]) {
        c.globalAlpha = alpha;
        c.strokeStyle = colors.lines[li];
        c.lineWidth = width;
        c.beginPath();
        pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.stroke();
      }
    });
    c.globalAlpha = 1;

    // Stations.
    tt.stations.forEach((s, si) => {
      const [x, y] = this.stationPx[si];
      const interchange = s.lines.length > 1;
      c.beginPath();
      c.arc(x, y, interchange ? 5.5 : 3, 0, Math.PI * 2);
      c.fillStyle = colors.bg;
      c.fill();
      c.lineWidth = interchange ? 2 : 1.4;
      c.strokeStyle = interchange ? colors.text : colors.lines[s.lines[0]];
      c.stroke();
    });

    // Fixed labels.
    const wanted = new Set(this.compact ? KEY_LABELS : [...KEY_LABELS, ...MORE_LABELS]);
    c.textBaseline = 'middle';
    tt.stations.forEach((s, si) => {
      if (!wanted.has(s.short)) return;
      const major = s.lines.length > 1;
      c.font = `${major ? 600 : 400} ${major ? 12.5 : 11.5}px ${colors.font}`;
      c.fillStyle = major ? colors.text : colors.muted;
      this.drawLabel(c, si, s.short, major ? 11 : 8);
    });
  }

  /** Places a label beside a station, pushed away from the city centre so lines stay clear. */
  labelSpot(si, gap) {
    const s = this.tt.stations[si];
    const [x, y] = this.stationPx[si];
    const li = s.lines[0];
    const line = this.tt.lines[li];
    const local = line.stations.indexOf(si);
    const d = line.dist[local];
    const a = this.pointAt(li, d - 0.4);
    const b = this.pointAt(li, d + 0.4);
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    let dx;
    let dy;
    if (s.lines.length > 1) {
      [dx, dy] = s.short === 'Majestic' ? [-0.72, -0.7] : [0.9, 0.42];
    } else if (local === 0 || local === line.stations.length - 1) {
      const sign = local === 0 ? -1 : 1; // terminus: continue past the end of the line
      [dx, dy] = [tx * sign, ty * sign];
    } else {
      const [hx, hy] = this.stationPx[this.tt.stations.indexOf(this.home)];
      [dx, dy] = [-ty, tx];
      if (dx * (x - hx) + dy * (y - hy) < 0) [dx, dy] = [-dx, -dy];
    }
    return { x: x + dx * gap, y: y + dy * gap, dx, dy };
  }

  drawLabel(c, si, text, gap, tag = false) {
    const { x, y, dx, dy } = this.labelSpot(si, gap);
    const align = dx > 0.35 ? 'left' : dx < -0.35 ? 'right' : 'center';
    const width = c.measureText(text).width;
    // Keep the whole label on screen: work out its left edge, clamp it, draw left-aligned.
    const left = align === 'left' ? x : align === 'right' ? x - width : x - width / 2;
    const clampedLeft = Math.max(8, Math.min(this.w - width - 8, left));
    c.textAlign = 'left';
    const yy = Math.max(12, Math.min(this.h - 12, Math.abs(dx) <= 0.35 ? y + Math.sign(dy) * 6 : y));
    if (tag) {
      // A solid tag so a note label covers the fixed station name underneath it.
      const fill = c.fillStyle;
      c.fillStyle = this.colors.panel;
      c.beginPath();
      if (c.roundRect) c.roundRect(clampedLeft - 6, yy - 10, width + 12, 20, 5);
      else c.rect(clampedLeft - 6, yy - 10, width + 12, 20);
      c.fill();
      c.fillStyle = fill;
      c.fillText(text, clampedLeft, yy);
      return;
    }
    c.lineWidth = 3.5;
    c.strokeStyle = this.colors.bg;
    c.lineJoin = 'round';
    c.strokeText(text, clampedLeft, yy);
    c.fillText(text, clampedLeft, yy);
  }

  /** A train has just sounded at a station. */
  pulse(stationIdx, line, label, now) {
    this.ripples.push({ si: stationIdx, line, start: now });
    this.floating = this.floating.filter((f) => f.si !== stationIdx);
    this.floating.push({ si: stationIdx, line, text: label, start: now });
    if (this.floating.length > (this.compact ? 3 : MAX_FLOATING_LABELS)) this.floating.shift();
    if (this.ripples.length > 60) this.ripples.shift();
  }

  draw(trains, now, mutedLines) {
    const c = this.ctx;
    if (!this.w) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.staticLayer, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const { colors } = this;

    // Ripples where notes just played.
    this.ripples = this.ripples.filter((r) => (now - r.start) / 1000 < RIPPLE_SECONDS);
    for (const r of this.ripples) {
      const age = (now - r.start) / 1000 / RIPPLE_SECONDS;
      const [x, y] = this.stationPx[r.si];
      const radius = this.reduceMotion ? 7 : 4 + 26 * (1 - (1 - age) ** 3);
      c.globalAlpha = (1 - age) * 0.85;
      c.strokeStyle = colors.lines[r.line];
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(x, y, radius, 0, Math.PI * 2);
      c.stroke();
      if (age < 0.3) {
        c.globalAlpha = (0.3 - age) * 2.6;
        c.fillStyle = colors.lines[r.line];
        c.beginPath();
        c.arc(x, y, 5, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;

    // Trains: a short trail, a glow, and a bright dot.
    for (const t of trains) {
      const dim = mutedLines.has(t.line);
      const [x, y] = this.pointAt(t.line, t.dist);
      if (!this.reduceMotion && Math.abs(t.dist - t.tail) > 0.05) {
        const steps = 6;
        c.strokeStyle = colors.lines[t.line];
        c.lineWidth = 2.6;
        c.lineCap = 'round';
        for (let i = 0; i < steps; i++) {
          const d0 = t.tail + ((t.dist - t.tail) * i) / steps;
          const d1 = t.tail + ((t.dist - t.tail) * (i + 1)) / steps;
          const p0 = this.pointAt(t.line, d0);
          const p1 = this.pointAt(t.line, d1);
          c.globalAlpha = ((i + 1) / steps) * (dim ? 0.15 : 0.45);
          c.beginPath();
          c.moveTo(p0[0], p0[1]);
          c.lineTo(p1[0], p1[1]);
          c.stroke();
        }
      }
      c.globalAlpha = dim ? 0.25 : 1;
      if (!dim) c.drawImage(this.glows[t.line], x - 13, y - 13, 26, 26);
      c.fillStyle = colors.lines[t.line];
      c.beginPath();
      c.arc(x, y, 3.6, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = colors.text;
      c.beginPath();
      c.arc(x, y, 1.3, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // Floating "Indiranagar · Ga′" labels.
    this.floating = this.floating.filter((f) => (now - f.start) / 1000 < LABEL_SECONDS);
    c.textBaseline = 'middle';
    for (const f of this.floating) {
      const age = (now - f.start) / 1000 / LABEL_SECONDS;
      c.globalAlpha = Math.min(1, (1 - age) * 2.2);
      c.font = `600 12px ${colors.font}`;
      c.fillStyle = colors.text;
      const s = this.tt.stations[f.si];
      this.drawLabel(c, f.si, `${s.short} · ${f.text}`, 14, true);
    }
    c.globalAlpha = 1;
  }

  /** Nearest station to a point on the canvas, within a finger's width. */
  stationAt(px, py) {
    let best = -1;
    let bestD = this.compact ? 20 : 14;
    this.stationPx.forEach(([x, y], i) => {
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }
}
