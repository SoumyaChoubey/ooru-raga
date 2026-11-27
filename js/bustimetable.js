// bustimetable.js - the bus timetable backup.
//
// When the live GPS feed is down, buses in your area play from BMTC's published timetable
// instead: every scheduled stop of every bus route in the area (thinned in the busiest minutes).
// Built by scripts/build_bus_timetable.py from BMTC's GTFS (bmtc-gtfs by Vonter, ODbL).
import { toKm } from './areas.js';

const cache = new Map();

/** Loads one area's bus timetable (about 50-90 KB), once. */
export function loadBusTimetable(areaId) {
  if (!cache.has(areaId)) {
    cache.set(
      areaId,
      fetch(`data/bus-timetable/${areaId}.json`)
        .then((res) => {
          if (!res.ok) throw new Error(`timetable ${res.status}`);
          return res.json();
        })
        .then((raw) => new BusTimetable(raw))
        .catch((err) => {
          cache.delete(areaId); // try again later
          throw err;
        }),
    );
  }
  return cache.get(areaId);
}

/** Pulse tempo from how many buses are due in the area this hour: busier is quicker. */
export function tempoForBusesDue(perHour) {
  if (!perHour) return 64;
  return Math.round(Math.max(56, Math.min(108, 56 + 10 * Math.log2(Math.max(1, perHour) / 200))));
}

export class BusTimetable {
  constructor(raw) {
    this.stops = raw.stops.map(([name, lat, lon]) => ({ name, at: toKm(lat, lon) }));
    this.routes = raw.routes;
    this.perHour = raw.perHour;
    const n = raw.t.length;
    this.times = new Float64Array(n);
    let t = 0;
    for (let i = 0; i < n; i++) {
      t += raw.t[i];
      this.times[i] = t;
    }
    this.stop = Uint16Array.from(raw.s);
    this.route = Uint16Array.from(raw.r);
    this.end = Uint8Array.from(raw.e);
    this.days = Uint8Array.from(raw.d);
  }

  /** Calls fn(index, seconds) for each arrival with t0 < seconds <= t1 on a day (0 = Monday). */
  eachArrival(weekday, t0, t1, fn) {
    const bit = 1 << weekday;
    const times = this.times;
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t0) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < times.length && times[i] <= t1; i++) if (this.days[i] & bit) fn(i, times[i]);
  }

  /** Buses due in the area on a day (0 = Monday) in the hour containing `secs` (true count, before thinning). */
  dueThisHour(weekday, secs) {
    const hours = this.perHour[weekday] || [];
    return hours[Math.max(0, Math.min(hours.length - 1, Math.floor(secs / 3600)))] || 0;
  }
}
