// timetable.js - works out where every train is, and when it reaches each station.
//
// All times are Bengaluru time (IST, UTC+5:30). We keep "IST wall-clock
// milliseconds": Date.now() shifted by 5h30m, read with getUTC* methods so the
// visitor's own time zone never matters.

export const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const DAY_MS = 86400 * 1000;
const SERVICE_DAY_STARTS_AT = 3 * 3600; // trains running just after midnight belong to the day before
const TAIL_SECONDS = 50; // how far back the little trail behind each train reaches

export const istNow = () => Date.now() + IST_OFFSET_MS;
const pad = (n) => String(n).padStart(2, '0');

/** Which timetable day an IST moment belongs to, and how many seconds into it we are. */
export function serviceMoment(istMs) {
  const d = new Date(istMs);
  let dayStartMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (istMs - dayStartMs < SERVICE_DAY_STARTS_AT * 1000) dayStartMs -= DAY_MS;
  const day = new Date(dayStartMs);
  return {
    dateKey: `${day.getUTCFullYear()}${pad(day.getUTCMonth() + 1)}${pad(day.getUTCDate())}`,
    weekday: (day.getUTCDay() + 6) % 7, // 0 = Monday, like GTFS
    dayStartMs,
    secs: (istMs - dayStartMs) / 1000,
  };
}

export function formatClock(istMs, withSeconds = true) {
  const d = new Date(istMs);
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return withSeconds ? `${hm}:${pad(d.getUTCSeconds())}` : hm;
}

export function formatServiceSecs(secs) {
  const s = Math.round(secs) % 86400;
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`;
}

export class Timetable {
  constructor(data) {
    this.meta = data.meta;
    this.stations = data.stations;
    this.lines = data.lines;
    this.patterns = data.patterns;
    this.services = data.services;
    this.calendar = data.calendar;
    this.exceptions = data.exceptions;
    this.dayCache = new Map();

    for (const p of this.patterns) {
      const line = this.lines[p.line];
      p.duration = p.arr[p.arr.length - 1];
      p.towards = line.stations[p.stops[p.stops.length - 1]]; // station index of the last stop
    }
  }

  /** Service ids (weekday, monday, sunday, holiday) running on a date. */
  servicesOn(dateKey, weekday) {
    const inRange = (c) => dateKey >= c.start && dateKey <= c.end;
    // If the feed has expired, keep using its weekly pattern rather than going silent.
    const feedCoversDate = this.calendar.some(inRange);
    const running = new Set();
    for (const c of this.calendar) {
      if (c.days[weekday] && (!feedCoversDate || inRange(c))) running.add(c.service);
    }
    for (const [date, service, type] of this.exceptions) {
      if (date !== dateKey) continue;
      if (type === 1) running.add(service);
      if (type === 2) running.delete(service);
    }
    return [...running].sort();
  }

  /** Everything needed to play one timetable day. Built once per day and cached. */
  day(moment) {
    const services = this.servicesOn(moment.dateKey, moment.weekday);
    const key = services.join('+');
    if (!this.dayCache.has(key)) this.dayCache.set(key, new ServiceDay(this, services));
    return this.dayCache.get(key);
  }

  /** Distance (km along the line) of a train `rel` seconds after its trip started. */
  distanceAt(p, rel) {
    const { arr, dep, stops } = p;
    const dist = this.lines[p.line].dist;
    let i = 0;
    while (i < arr.length - 1 && arr[i + 1] <= rel) i++;
    if (i === arr.length - 1 || rel <= dep[i]) return dist[stops[i]]; // standing at a platform
    const f = (rel - dep[i]) / (arr[i + 1] - dep[i]);
    const eased = f * f * (3 - 2 * f); // speed up out of a station, slow down into the next
    return dist[stops[i]] + (dist[stops[i + 1]] - dist[stops[i]]) * eased;
  }
}

class ServiceDay {
  constructor(tt, services) {
    this.tt = tt;
    this.services = services;
    const trips = [];
    for (const s of services) {
      const flat = tt.services[s] || [];
      for (let i = 0; i < flat.length; i += 2) trips.push({ p: tt.patterns[flat[i]], start: flat[i + 1] });
    }
    trips.sort((a, b) => a.start - b.start);
    this.trips = trips;
    this.firstStart = trips.length ? trips[0].start : null;
    this.lastEnd = trips.reduce((m, t) => Math.max(m, t.start + t.p.duration), 0);

    // One event per station a train passes: departure from its first stop, arrival everywhere else.
    const events = [];
    trips.forEach((trip, k) => {
      const { p, start } = trip;
      for (let i = 0; i < p.stops.length; i++) events.push([start + (i === 0 ? p.dep[0] : p.arr[i]), k, i]);
    });
    events.sort((a, b) => a[0] - b[0]);
    this.evTime = Float64Array.from(events, (e) => e[0]);
    this.evTrip = Int32Array.from(events, (e) => e[1]);
    this.evStop = Uint8Array.from(events, (e) => e[2]);
  }

  /** Calls fn(time, trip, stopIndex) for each station event with t0 < time <= t1. */
  eachEvent(t0, t1, fn) {
    const times = this.evTime;
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t0) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < times.length && times[i] <= t1; i++) fn(times[i], this.trips[this.evTrip[i]], this.evStop[i]);
  }

  /** Trains on the track at `secs` into the day. */
  trainsAt(secs) {
    const out = [];
    for (const trip of this.trips) {
      if (trip.start > secs) break;
      const rel = secs - trip.start;
      if (rel > trip.p.duration) continue;
      out.push({
        line: trip.p.line,
        dist: this.tt.distanceAt(trip.p, rel),
        tail: this.tt.distanceAt(trip.p, Math.max(0, rel - TAIL_SECONDS)),
        towards: trip.p.towards,
      });
    }
    return out;
  }
}
