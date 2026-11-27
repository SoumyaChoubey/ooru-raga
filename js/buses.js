// buses.js - live BMTC bus positions, fetched from our relay (/api/buses).
//
// Every 30 seconds it asks the relay for the latest snapshot. Buses whose GPS reported a new
// position since the last snapshot become "pings", which main.js turns into notes, spread out
// over the next 30 seconds in the order they happened. So you hear the city about a minute
// behind real time, like a radio broadcast delay.
//
// If the relay can't be reached at all (GitHub Pages, a preview, or running from a plain file
// server), it shows a saved snapshot instead and says so.
import { ORIGIN } from '../lib/bus-feed.js';
import { toKm } from './areas.js';

export const POLL_MS = 45_000; // buses report every 30 s to 3 min, so 45 s feels live and stretches the free plan
const HIDDEN_POLL_MS = 60_000;
const STALE_AFTER_S = 600; // the feed counts as paused if its newest position is this old
const STANDING_KMH = 6;

export class BusFeed {
  constructor({ onSnapshot, isPlaying }) {
    this.onSnapshot = onSnapshot;
    this.isPlaying = isPlaying;
    this.buses = new Map();
    this.state = 'loading'; // loading | live | paused | sample | error
    this.feedTime = 0;
    this.fetchedAt = 0;
    this.nextPollAt = 0;
    this.timer = null;
  }

  start() {
    this.poll();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && performance.now() > this.nextPollAt - POLL_MS + 5000) this.poll();
    });
  }

  schedule() {
    clearTimeout(this.timer);
    const hidden = document.hidden;
    if (hidden && !this.isPlaying()) {
      this.nextPollAt = Infinity; // nobody is looking or listening: wait for the tab to come back
      return;
    }
    const wait = hidden ? HIDDEN_POLL_MS : POLL_MS;
    this.nextPollAt = performance.now() + wait;
    this.timer = setTimeout(() => this.poll(), wait);
  }

  async poll() {
    clearTimeout(this.timer);
    try {
      const res = await fetch('api/buses', { cache: 'no-store' });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.includes('json')) throw new Error(`relay answered ${res.status}`);
      const data = await res.json();
      if (!data.v) throw new Error('relay sent no buses');
      this.ingest(data, false);
    } catch (err) {
      if (!this.feedTime || this.state === 'sample') {
        await this.loadSample();
      } else {
        this.state = 'paused'; // keep the last positions, stop pretending they are live
        this.onSnapshot({ pings: [], windowStart: this.feedTime, windowEnd: this.feedTime });
      }
    }
    this.schedule();
  }

  async loadSample() {
    if (this.state === 'sample') return;
    try {
      const data = await (await fetch('data/sample-buses.json')).json();
      this.ingest(data, true);
    } catch {
      this.state = 'error';
      this.onSnapshot({ pings: [], windowStart: 0, windowEnd: 0 });
    }
  }

  ingest(d, sample) {
    if (this.state === 'sample' && !sample) this.buses = new Map(); // live data arrived: forget the saved snapshot
    const prevFeedTime = sample || this.state === 'sample' ? 0 : this.feedTime;
    const windowStart = prevFeedTime || d.feedTime - 60;
    const next = new Map();
    const pings = [];
    let lat = 0;
    for (let i = 0; i < d.id.length; i++) {
      lat += d.dlat[i];
      const la = ORIGIN.lat + lat / ORIGIN.scale;
      const lo = ORIGIN.lon + d.lon[i] / ORIGIN.scale;
      const [x, y] = toKm(la, lo);
      const ts = d.feedTime - d.age[i];
      const prev = this.buses.get(d.id[i]);
      let speed = prev ? prev.speed : null;
      if (prev && ts - prev.ts >= 5) {
        const km = Math.hypot(x - prev.x, y - prev.y);
        speed = Math.min(90, km / ((ts - prev.ts) / 3600));
      }
      const bus = { id: d.id[i], x, y, brg: d.brg5[i] * 5, ts, route: d.route[i] >= 0 ? d.routes[d.route[i]] : '', speed, area: -1 };
      next.set(bus.id, bus);
      if (!sample && ts > windowStart && (!prev || ts > prev.ts)) pings.push(bus);
    }
    this.buses = next;
    this.feedTime = d.feedTime;
    this.fetchedAt = d.fetchedAt;
    const behind = Math.max(d.fetchedAt - d.feedTime, Date.now() / 1000 - d.fetchedAt);
    this.state = sample ? 'sample' : behind > STALE_AFTER_S ? 'paused' : 'live';
    this.onSnapshot({ pings: this.state === 'live' ? pings : [], windowStart, windowEnd: d.feedTime });
  }

  /** Standing still (or crawling) buses play the drum; moving or unknown ones play a note. */
  static isStanding(bus) {
    return bus.speed != null && bus.speed < STANDING_KMH;
  }
}
