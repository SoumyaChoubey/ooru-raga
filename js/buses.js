// buses.js - live BMTC bus positions.
//
// Where the site runs on Cloudflare, it asks our relay (/api/buses) every 45 seconds: one shared,
// shrunk copy of the feed for everyone. Where there is no relay (GitHub Pages), it reads the
// public feed from reclaim.city directly, once a minute. Buses whose GPS reported a new position
// since the last snapshot become "pings", which main.js turns into notes, spread out over the
// next poll in the order they happened. So you hear the city a minute or two behind real time,
// like a radio broadcast delay.
//
// If neither can be reached (a preview, or offline), it shows a saved snapshot and says so.
import { ORIGIN, FEED_URL, decodeVehiclePositions, compactFeed } from '../lib/bus-feed.js';
import { toKm } from './areas.js';

export const POLL_MS = 45_000; // buses report every 30 s to 3 min, so 45 s feels live and stretches the free plan
const DIRECT_POLL_MS = 60_000; // gentler when every browser reads the public feed itself
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
    this.source = 'relay'; // relay | direct
    this.routeNames = null;
  }

  /** How long between polls right now. */
  get interval() {
    return this.source === 'direct' ? DIRECT_POLL_MS : POLL_MS;
  }

  start() {
    this.poll();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && performance.now() > this.nextPollAt - this.interval + 5000) this.poll();
    });
  }

  schedule() {
    clearTimeout(this.timer);
    const hidden = document.hidden;
    if (hidden && !this.isPlaying()) {
      this.nextPollAt = Infinity; // nobody is looking or listening: wait for the tab to come back
      return;
    }
    const wait = hidden ? HIDDEN_POLL_MS : this.interval;
    this.nextPollAt = performance.now() + wait;
    this.timer = setTimeout(() => this.poll(), wait);
  }

  async fetchRelay() {
    const res = await fetch('api/buses', { cache: 'no-store' });
    const type = res.headers.get('content-type') || '';
    if (res.status === 404 || !type.includes('json')) {
      const err = new Error('no relay on this host');
      err.missing = true;
      throw err;
    }
    if (!res.ok) throw new Error(`relay answered ${res.status}`);
    const data = await res.json();
    if (!data.v) throw new Error('relay sent no buses');
    return data;
  }

  async fetchDirect() {
    if (!this.routeNames) this.routeNames = await (await fetch('data/bmtc-routes.json')).json();
    const res = await fetch(FEED_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`bus feed answered ${res.status}`);
    const feed = decodeVehiclePositions(new Uint8Array(await res.arrayBuffer()));
    if (!feed.vehicles.length) throw new Error('bus feed was empty');
    return compactFeed(feed, this.routeNames, Math.floor(Date.now() / 1000));
  }

  async poll() {
    clearTimeout(this.timer);
    let data = null;
    if (this.source === 'relay') {
      try {
        data = await this.fetchRelay();
      } catch (err) {
        if (err.missing) this.source = 'direct'; // no relay here (GitHub Pages): read the feed itself
      }
    }
    if (!data && this.source === 'direct') {
      try {
        data = await this.fetchDirect();
      } catch {
        // the feed can't be reached from here: fall through to paused or sample
      }
    }
    if (data) {
      this.ingest(data, false);
    } else {
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
