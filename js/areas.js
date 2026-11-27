// areas.js - the listening areas (Jayanagar, HSR Layout, ...) and which one a point falls in.
//
// Everything on the record is measured in kilometres from Majestic: x to the east, y to the south.

export const MAJESTIC = { lat: 12.9757, lon: 77.5729 };
const KX = 111.32 * Math.cos((MAJESTIC.lat * Math.PI) / 180);
const KY = 110.57;

/** [km east, km south] of Majestic. */
export const toKm = (lat, lon) => [(lon - MAJESTIC.lon) * KX, (MAJESTIC.lat - lat) * KY];

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class Areas {
  constructor(data) {
    this.city = data.city.map(([lat, lon]) => toKm(lat, lon));
    this.list = data.areas.map((a, index) => {
      const poly = a.outline.map(([lat, lon]) => toKm(lat, lon));
      const xs = poly.map((p) => p[0]);
      const ys = poly.map((p) => p[1]);
      return {
        ...a,
        index,
        poly,
        centre: toKm(a.lat, a.lon),
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        stationSet: new Set(a.stations),
      };
    });
    this.byId = new Map(this.list.map((a) => [a.id, a]));
  }

  /** The area containing a point (km from Majestic), or null outside the city. */
  at(x, y) {
    for (const a of this.list) {
      const [x0, y0, x1, y1] = a.box;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (pointInPolygon(x, y, a.poly)) return a;
    }
    return null;
  }
}
