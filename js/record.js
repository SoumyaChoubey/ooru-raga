// record.js - draws the city as a vinyl record: the sun behind it, the areas, live buses,
// metro lines and trains, ripples where notes play, and the tonearm resting on your area.
//
// Positions are kilometres from Majestic (the spindle), scaled to fit the screen.
import { toKm } from './areas.js';

const CITY_RADIUS_KM = 21.5;
const RIPPLE_S = 1.8;
const LABEL_S = 2.8;
const TINTS = ['--gulal', '--haldi', '--neeli-2', '--sindoor', '--tota', '--zari'];
const RIM_TEXT = ' NAMMA OORU  •  {areas} AREAS  •  BMTC LIVE  •  3 METRO LINES  •  {side}  •  33⅓ RPM  •  ಊರು ರಾಗ  •';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class Record {
  constructor(canvas, { metro, areas }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.metro = metro;
    this.areas = areas;
    this.selected = null;
    this.side = { side: 'Side A', name: 'Carnatic' };
    this.buses = [];
    this.ripples = [];
    this.labels = [];
    this.arm = null; // current tonearm angle and length, eased towards the target
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.lineKm = metro.lines.map((l) => l.path.map(([lat, lon]) => toKm(lat, lon)));
    this.lineCum = metro.lines.map((l) => l.path.map((p) => p[2]));
    this.stationKm = metro.stations.map((s) => toKm(s.lat, s.lon));
    this.staticLayer = document.createElement('canvas');
    this.busLayer = document.createElement('canvas');
    this.readColours();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  readColours() {
    this.c = {
      ink: css('--ink'),
      record: css('--record'),
      cream: css('--cream'),
      haldi: css('--haldi'),
      gulal: css('--gulal'),
      tota: css('--tota'),
      sindoor: css('--sindoor'),
      lines: this.metro.lines.map((l) => css(`--line-${l.id.toLowerCase()}`) || l.color),
      tints: TINTS.map(css),
    };
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    for (const c of [this.canvas, this.staticLayer, this.busLayer]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    this.compact = this.w < 600;
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    this.R = Math.min(this.w, this.h) * (this.compact ? 0.44 : 0.43);
    this.k = this.R / CITY_RADIUS_KM;
    this.linePx = this.lineKm.map((pts) => pts.map((p) => this.px(p)));
    this.arm = null;
    this.renderStatic();
    this.renderBuses();
  }

  px([x, y]) {
    return [this.cx + x * this.k, this.cy + y * this.k];
  }

  km(px, py) {
    return [(px - this.cx) / this.k, (py - this.cy) / this.k];
  }

  /** Screen position of a point `d` km along metro line `li`. */
  pointAt(li, d) {
    const cum = this.lineCum[li];
    const pts = this.linePx[li];
    if (d <= cum[0]) return pts[0];
    if (d >= cum[cum.length - 1]) return pts[pts.length - 1];
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const f = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
  }

  setSelected(area) {
    this.selected = area;
    this.renderStatic();
    this.renderBuses();
  }

  /** Side A (Carnatic) or Side B (Carnatic jazz): changes the rim text and the colour of the sun. */
  setSide(side) {
    this.side = side;
    this.renderStatic();
  }

  setBuses(buses) {
    this.buses = buses;
    this.renderBuses();
  }

  areaAt(px, py) {
    const [x, y] = this.km(px, py);
    if (Math.hypot(px - this.cx, py - this.cy) > this.R) return null;
    return this.areas.at(x, y);
  }

  #path(c, pts) {
    c.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = this.px(p);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.closePath();
  }

  renderStatic() {
    if (!this.w) return;
    const c = this.staticLayer.getContext('2d');
    const { cx, cy, R } = this;
    const col = this.c;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);

    // The sun behind the record.
    c.beginPath();
    const spikes = 40;
    for (let i = 0; i <= spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const r = R * (i % 2 ? 1.055 : 1.12);
      c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    c.fillStyle = this.side.side === 'Side B' ? col.gulal : col.haldi;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = col.ink;
    c.stroke();

    // The record, its grooves and a sheen of light.
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fillStyle = col.record;
    c.fill();
    c.stroke();
    c.save();
    c.beginPath();
    c.arc(cx, cy, R - 2, 0, Math.PI * 2);
    c.clip();
    for (let r = 8; r < R; r += 3) {
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.strokeStyle = r % 9 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)';
      c.lineWidth = 1;
      c.stroke();
    }
    if (c.createConicGradient) {
      const sheen = c.createConicGradient(-0.6, cx, cy);
      [[0, 0], [0.08, 0.1], [0.16, 0], [0.5, 0], [0.58, 0.08], [0.66, 0], [1, 0]].forEach(([at, a]) => sheen.addColorStop(at, `rgba(255,255,255,${a})`));
      c.fillStyle = sheen;
      c.fillRect(0, 0, this.w, this.h);
    }

    // Areas: a faint tint each, and the chosen one in parrot green.
    for (const a of this.areas.list) {
      const on = a === this.selected;
      this.#path(c, a.poly);
      c.globalAlpha = on ? 1 : 0.1;
      c.fillStyle = on ? col.tota : col.tints[a.index % col.tints.length];
      c.fill();
      c.globalAlpha = 1;
      c.lineWidth = on ? 2.5 : 0.8;
      c.strokeStyle = on ? col.ink : 'rgba(251,243,226,0.22)';
      c.stroke();
    }
    this.#path(c, this.areas.city);
    c.lineWidth = 1.2;
    c.strokeStyle = 'rgba(251,243,226,0.4)';
    c.setLineDash([3, 3]);
    c.stroke();
    c.setLineDash([]);

    // Metro lines and stations.
    this.metro.lines.forEach((l, li) => {
      c.beginPath();
      this.linePx[li].forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.lineWidth = 6;
      c.strokeStyle = col.record;
      c.stroke();
      c.lineWidth = 3;
      c.strokeStyle = col.lines[li];
      c.stroke();
    });
    this.metro.stations.forEach((s, si) => {
      const [x, y] = this.px(this.stationKm[si]);
      const big = s.lines.length > 1;
      c.beginPath();
      c.arc(x, y, big ? 4 : 2.2, 0, Math.PI * 2);
      c.fillStyle = col.cream;
      c.fill();
      if (big) {
        c.lineWidth = 1.5;
        c.strokeStyle = col.record;
        c.stroke();
      }
    });

    // Area names (a few on phones).
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `500 ${this.compact ? 9 : 11}px Oswald, "Arial Narrow", sans-serif`;
    for (const a of this.areas.list) {
      if (a === this.selected) continue;
      if (this.compact ? a.areaKm2 < 45 : !a.featured && a.areaKm2 < 40) continue; // featured areas and the big outer ones
      const [x, y] = this.px(a.centre);
      const t = a.name.toUpperCase();
      c.lineWidth = 3;
      c.strokeStyle = col.record;
      c.strokeText(t, x, y - 9);
      c.fillStyle = 'rgba(251,243,226,0.85)';
      c.fillText(t, x, y - 9);
    }
    c.restore();

    // Text running round the rim.
    c.save();
    c.translate(cx, cy);
    c.font = `600 ${this.compact ? 9 : 12}px Doto, ui-monospace, monospace`;
    c.fillStyle = 'rgba(251,243,226,0.55)';
    c.textAlign = 'center';
    let ang = -Math.PI * 0.86;
    const rr = R - (this.compact ? 10 : 14);
    for (const ch of RIM_TEXT.replace('{areas}', this.areas.list.length).replace('{side}', `${this.side.side} · ${this.side.name}`.toUpperCase())) {
      const w = c.measureText(ch).width;
      ang += w / 2 / rr;
      c.save();
      c.rotate(ang);
      c.translate(0, -rr);
      c.fillText(ch, 0, 0);
      c.restore();
      ang += w / 2 / rr + 0.004;
    }
    c.restore();

    // The spindle, at Majestic.
    c.beginPath();
    c.arc(cx, cy, 9, 0, Math.PI * 2);
    c.fillStyle = col.sindoor;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = col.record;
    c.stroke();
    c.beginPath();
    c.arc(cx, cy, 3, 0, Math.PI * 2);
    c.fillStyle = '#d8d2c6';
    c.fill();

    // A tag naming the chosen area.
    if (this.selected) {
      const [ax, ay] = this.px(this.selected.centre);
      c.font = `800 ${this.compact ? 14 : 19}px "Anek Kannada", sans-serif`;
      const tag = `${this.selected.kn}  ${this.selected.name.toUpperCase()}`;
      const tw = c.measureText(tag).width + 20;
      const left = ax > cx ? ax + 26 : ax - tw - 26;
      const tx = Math.max(8, Math.min(this.w - tw - 8, left));
      const ty = Math.max(20, Math.min(this.h - 20, ay + 30));
      c.fillStyle = col.tota;
      c.fillRect(tx, ty - 15, tw, 30);
      c.lineWidth = 2;
      c.strokeStyle = col.ink;
      c.strokeRect(tx, ty - 15, tw, 30);
      c.beginPath();
      c.moveTo(ax > cx ? tx : tx + tw, ty);
      c.lineTo(ax, ay + 4);
      c.stroke();
      c.fillStyle = col.ink;
      c.textAlign = 'left';
      c.fillText(tag, tx + 10, ty + 2);
    }
  }

  renderBuses() {
    if (!this.w) return;
    const c = this.busLayer.getContext('2d');
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.save();
    c.beginPath();
    c.arc(this.cx, this.cy, this.R - 2, 0, Math.PI * 2);
    c.clip();
    const sel = this.selected ? this.selected.index : -1;
    c.fillStyle = 'rgba(245,179,1,0.62)';
    for (const b of this.buses) {
      if (b.area === sel) continue;
      const [x, y] = this.px([b.x, b.y]);
      c.fillRect(x - 1.1, y - 1.1, 2.2, 2.2);
    }
    c.fillStyle = this.c.ink;
    for (const b of this.buses) {
      if (b.area !== sel) continue;
      const [x, y] = this.px([b.x, b.y]);
      c.beginPath();
      c.arc(x, y, 2.3, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  /** A note just played at a point (km). */
  pulse(at, colour, text, now) {
    this.ripples.push({ at, colour, start: now });
    if (this.ripples.length > 40) this.ripples.shift();
    if (text) {
      this.labels.push({ at, text, start: now });
      if (this.labels.length > (this.compact ? 2 : 4)) this.labels.shift();
    }
  }

  draw(trains, now) {
    if (!this.w) return;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.staticLayer, 0, 0);
    c.drawImage(this.busLayer, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const col = this.c;

    // Trains.
    for (const t of trains) {
      const [x, y] = this.pointAt(t.line, t.dist);
      c.beginPath();
      c.arc(x, y, 4.2, 0, Math.PI * 2);
      c.fillStyle = col.lines[t.line];
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = col.record;
      c.stroke();
      c.beginPath();
      c.arc(x, y, 1.4, 0, Math.PI * 2);
      c.fillStyle = col.cream;
      c.fill();
    }

    // Ripples where notes play.
    this.ripples = this.ripples.filter((r) => (now - r.start) / 1000 < RIPPLE_S);
    for (const r of this.ripples) {
      const age = (now - r.start) / 1000 / RIPPLE_S;
      const [x, y] = this.px(r.at);
      c.globalAlpha = (1 - age) * 0.9;
      c.strokeStyle = r.colour;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, this.reduceMotion ? 8 : 4 + 24 * (1 - (1 - age) ** 3), 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;

    // Little tags saying what just played.
    this.labels = this.labels.filter((l) => (now - l.start) / 1000 < LABEL_S);
    c.font = `600 ${this.compact ? 10.5 : 12}px "IBM Plex Sans", system-ui, sans-serif`;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    const placed = [];
    for (const l of this.labels) {
      const age = (now - l.start) / 1000 / LABEL_S;
      const [x, y] = this.px(l.at);
      const w = c.measureText(l.text).width + 12;
      const tx = Math.max(6, Math.min(this.w - w - 6, x + 10));
      let ty = Math.max(14, Math.min(this.h - 14, y - 14));
      // Step down past any label already showing, so busy areas don't pile text up.
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find((p) => tx < p.x + p.w && tx + w > p.x && Math.abs(ty - p.y) < 22);
        if (!hit) break;
        ty = hit.y + 23;
      }
      ty = Math.min(this.h - 14, ty);
      placed.push({ x: tx, y: ty, w });
      c.globalAlpha = Math.min(1, (1 - age) * 2.5);
      c.fillStyle = col.cream;
      c.fillRect(tx, ty - 10, w, 20);
      c.lineWidth = 1.5;
      c.strokeStyle = col.ink;
      c.strokeRect(tx, ty - 10, w, 20);
      c.fillStyle = col.ink;
      c.fillText(l.text, tx + 6, ty + 1);
    }
    c.globalAlpha = 1;

    this.#drawArm();
  }

  #drawArm() {
    const { cx, cy, R } = this;
    const px0 = cx + R * 0.98;
    const py0 = cy - R * 0.98;
    const target = this.selected ? this.px(this.selected.centre) : [cx + R * 0.8, cy - R * 0.3];
    const ta = Math.atan2(target[1] - py0, target[0] - px0);
    const tl = Math.hypot(target[0] - px0, target[1] - py0);
    if (!this.arm || this.reduceMotion) this.arm = { a: ta, l: tl };
    this.arm.a += (ta - this.arm.a) * 0.12;
    this.arm.l += (tl - this.arm.l) * 0.12;
    const c = this.ctx;
    const metal = (x0, y0, x1, y1) => {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, '#f4f1ea');
      g.addColorStop(0.5, '#9d978c');
      g.addColorStop(1, '#e9e5dc');
      return g;
    };
    const base = this.compact ? 18 : 28;
    c.lineWidth = 2;
    c.strokeStyle = this.c.ink;
    c.beginPath();
    c.arc(px0, py0, base, 0, Math.PI * 2);
    c.fillStyle = metal(px0 - base, py0 - base, px0 + base, py0 + base);
    c.fill();
    c.stroke();
    c.save();
    c.translate(px0, py0);
    c.rotate(this.arm.a);
    c.lineWidth = 1.5;
    c.fillStyle = metal(0, -6, 0, 6);
    c.fillRect(-44, -5, 38, 10);
    c.strokeRect(-44, -5, 38, 10);
    c.beginPath();
    c.rect(0, -3.5, this.arm.l - 34, 7);
    c.fillStyle = metal(0, -4, 0, 4);
    c.fill();
    c.stroke();
    c.translate(this.arm.l - 28, 0);
    c.rotate(0.35);
    c.fillStyle = this.c.ink;
    c.fillRect(-12, -10, 34, 20);
    c.fillStyle = this.c.sindoor;
    c.fillRect(-6, -5, 9, 10);
    c.restore();
    c.beginPath();
    c.arc(px0, py0, 6, 0, Math.PI * 2);
    c.fillStyle = this.c.ink;
    c.fill();
  }
}
