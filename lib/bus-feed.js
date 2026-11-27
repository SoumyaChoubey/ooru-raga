// bus-feed.js - reads the live BMTC bus feed and shrinks it for browsers.
//
// The feed is GTFS-Realtime "vehicle positions" (a protocol buffer, about 500 KB) published
// for Bengaluru by reclaim.city. Browsers only need where each bus is, which way it faces,
// when it last reported and its route number, so `compactFeed` keeps just that, in columns
// of small whole numbers that compress well (about 45 KB with brotli).
//
// Used by the relay (functions/api/buses.js) and by scripts/make_sample.mjs.

export const FEED_URL = 'https://maps.reclaim.city/bengaluru/rt/vehicle_positions.pb';

// Positions are sent as whole numbers of 1/10,000 degree (about 11 m) from this corner.
export const ORIGIN = { lat: 12.5, lon: 77.2, scale: 1e4 };
const MAJESTIC = { lat: 12.9757, lon: 77.5729 };
const MAX_KM_FROM_MAJESTIC = 32;

class Reader {
  constructor(bytes) {
    this.buf = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }
  varint() {
    let x = 0;
    let scale = 1;
    let b;
    do {
      b = this.buf[this.pos++];
      x += (b & 0x7f) * scale;
      scale *= 128;
    } while (b & 0x80);
    return x;
  }
  end() {
    const len = this.varint();
    return this.pos + len;
  }
  hash(end) {
    // FNV-1a over the bytes, cut to 24 bits: a small, stable number to follow a bus between updates
    let h = 0x811c9dc5;
    for (let i = this.pos; i < end; i++) h = Math.imul(h ^ this.buf[i], 0x01000193);
    this.pos = end;
    return (h >>> 0) & 0xffffff;
  }
  ascii(end) {
    let s = '';
    for (let i = this.pos; i < end; i++) s += String.fromCharCode(this.buf[i]);
    this.pos = end;
    return s;
  }
  float() {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  skip(wireType) {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.pos += 8;
    else if (wireType === 2) this.pos = this.end();
    else if (wireType === 5) this.pos += 4;
    else throw new Error(`Unsupported wire type ${wireType}`);
  }
}

function readMessage(r, end, onField) {
  while (r.pos < end) {
    const tag = r.varint();
    if (!onField(tag >>> 3, tag & 7)) r.skip(tag & 7);
  }
  r.pos = end;
}

/** Decodes a GTFS-Realtime FeedMessage of vehicle positions. */
export function decodeVehiclePositions(bytes) {
  const r = new Reader(bytes);
  let feedTime = 0;
  const vehicles = [];
  readMessage(r, bytes.length, (field, wt) => {
    if (field === 1 && wt === 2) {
      // FeedHeader: timestamp is field 3
      readMessage(r, r.end(), (f, w) => (f === 3 && w === 0 ? ((feedTime = r.varint()), true) : false));
      return true;
    }
    if (field === 2 && wt === 2) {
      const v = { id: 0, lat: NaN, lon: NaN, bearing: 0, speed: -1, ts: 0, route: '' };
      readMessage(r, r.end(), (f, w) => {
        if (f === 1 && w === 2) return ((v.id = r.hash(r.end())), true); // FeedEntity.id
        if (f !== 4 || w !== 2) return false; // FeedEntity.vehicle
        readMessage(r, r.end(), (vf, vw) => {
          if (vf === 1 && vw === 2) {
            // TripDescriptor: route_id is field 5
            readMessage(r, r.end(), (tf, tw) => (tf === 5 && tw === 2 ? ((v.route = r.ascii(r.end())), true) : false));
            return true;
          }
          if (vf === 2 && vw === 2) {
            // Position: latitude 1, longitude 2, bearing 3, speed 5 (all float)
            readMessage(r, r.end(), (pf, pw) => {
              if (pw !== 5) return false;
              const value = r.float();
              if (pf === 1) v.lat = value;
              else if (pf === 2) v.lon = value;
              else if (pf === 3) v.bearing = value;
              else if (pf === 5) v.speed = value;
              return true;
            });
            return true;
          }
          if (vf === 5 && vw === 0) return ((v.ts = r.varint()), true);
          return false;
        });
        return true;
      });
      if (Number.isFinite(v.lat) && Number.isFinite(v.lon)) vehicles.push(v);
      return true;
    }
    return false;
  });
  return { feedTime, vehicles };
}

/**
 * Column-shaped summary for browsers. `routeNames` maps BMTC route ids to route numbers.
 * Buses are sorted south to north and `dlat` holds the difference from the previous bus,
 * which compresses far better. Bearings are in steps of 5 degrees.
 */
export function compactFeed({ feedTime, vehicles }, routeNames, fetchedAtSec) {
  const out = { v: 2, network: 'bengaluru', feedTime, fetchedAt: fetchedAtSec, routes: [], id: [], dlat: [], lon: [], brg5: [], age: [], route: [] };
  const routeIndex = new Map();
  const kx = 111.32 * Math.cos((MAJESTIC.lat * Math.PI) / 180);
  const sorted = vehicles.slice().sort((a, b) => a.lat - b.lat);
  let prevLat = 0;
  for (const v of sorted) {
    const dx = (v.lon - MAJESTIC.lon) * kx;
    const dy = (v.lat - MAJESTIC.lat) * 110.57;
    if (dx * dx + dy * dy > MAX_KM_FROM_MAJESTIC ** 2) continue;
    const name = routeNames[v.route.replace(/^BMTC:/, '')] || '';
    let r = -1;
    if (name) {
      if (!routeIndex.has(name)) {
        routeIndex.set(name, out.routes.length);
        out.routes.push(name);
      }
      r = routeIndex.get(name);
    }
    const lat = Math.round((v.lat - ORIGIN.lat) * ORIGIN.scale);
    out.id.push(v.id);
    out.dlat.push(lat - prevLat);
    prevLat = lat;
    out.lon.push(Math.round((v.lon - ORIGIN.lon) * ORIGIN.scale));
    out.brg5.push(Math.round(v.bearing / 5) % 72);
    out.age.push(Math.max(0, feedTime - (v.ts || feedTime)));
    out.route.push(r);
  }
  return out;
}
