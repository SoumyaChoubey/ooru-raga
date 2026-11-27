#!/usr/bin/env python3
"""
Build the bus timetable backup: for each listening area, every scheduled BMTC bus arrival at a
stop inside it, so the music can follow BMTC's timetable whenever the live GPS feed is down.

Usage (needs `pip install shapely`):
    python3 scripts/build_bus_timetable.py path/to/bus.zip data/areas.json data/bus-timetable

bus.zip is the BMTC GTFS from https://github.com/reclaimchennai/India_GTFS
(karnataka/bengaluru/bus.zip), built from https://github.com/Vonter/bmtc-gtfs (ODbL).

Each output file (one per area) holds:
    stops   [name, lat, lon] for stops in the area that buses call at
    routes  route numbers
    t       arrival times in seconds after midnight, as differences from the previous one
            (times after midnight run past 86400, like GTFS)
    s, r    stop and route for each arrival (indexes into the lists above)
    e       1 if the bus starts or ends its trip at that stop (it waits there: the flute plays)
    d       days it runs, as a 7-bit number: Monday = 1, Tuesday = 2 ... Sunday = 64 (127 = daily)
Busy areas are thinned to at most MAX_PER_MINUTE arrivals in any minute, evenly, so the music
stays playable; `perHour[day][hour]` keeps the true number of buses due on each weekday (0 =
Monday) and hour, for the pulse.
"""

import csv
import io
import json
import math
import os
import sys
import zipfile
from collections import defaultdict

from shapely.geometry import Point, Polygon
from shapely.prepared import prep

MAJESTIC = (12.9757, 77.5729)
KX = 111.32 * math.cos(math.radians(MAJESTIC[0]))
KY = 110.57
MAX_PER_MINUTE = 24
DAY_KEYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')


def km(lat, lon):
    return ((lon - MAJESTIC[1]) * KX, (MAJESTIC[0] - lat) * KY)


def seconds(hms):
    h, m, s = (int(x) for x in hms.split(':'))
    return h * 3600 + m * 60 + s


def main(bus_zip, areas_path, out_dir):
    z = zipfile.ZipFile(bus_zip)
    read = lambda name: csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig'))
    areas = json.load(open(areas_path, encoding='utf-8'))['areas']
    shapes = [prep(Polygon([km(lat, lon) for lat, lon in a['outline']])) for a in areas]
    boxes = [Polygon([km(lat, lon) for lat, lon in a['outline']]).bounds for a in areas]

    # Which area each stop is in.
    stop_area = {}
    stop_info = {}
    for s in read('stops.txt'):
        lat, lon = float(s['stop_lat']), float(s['stop_lon'])
        x, y = km(lat, lon)
        for i, (shape, (x0, y0, x1, y1)) in enumerate(zip(shapes, boxes)):
            if x0 <= x <= x1 and y0 <= y <= y1 and shape.contains(Point(x, y)):
                stop_area[s['stop_id']] = i
                stop_info[s['stop_id']] = (s['stop_name'], round(lat, 5), round(lon, 5))
                break

    # Days each service runs (bit 0 = Monday).
    service_days = {}
    for c in read('calendar.txt'):
        service_days[c['service_id']] = sum(1 << i for i, d in enumerate(DAY_KEYS) if c[d] == '1')
    routes = {r['route_id']: r['route_short_name'] for r in read('routes.txt')}
    trips = {t['trip_id']: (routes.get(t['route_id'], ''), service_days.get(t['service_id'], 127)) for t in read('trips.txt')}

    arrivals = defaultdict(list)  # area -> [(secs, stop_id, route, end, days)]

    def flush(trip_id, rows):
        if not rows or trip_id not in trips:
            return
        route, days = trips[trip_id]
        if not days:
            return
        rows.sort(key=lambda r: r[0])
        last = len(rows) - 1
        for i, (_, stop_id, t) in enumerate(rows):
            a = stop_area.get(stop_id)
            if a is not None:
                arrivals[a].append((t, stop_id, route, 1 if i in (0, last) else 0, days))

    current, rows = None, []
    for r in read('stop_times.txt'):
        if r['trip_id'] != current:
            flush(current, rows)
            current, rows = r['trip_id'], []
        rows.append((int(r['stop_sequence']), r['stop_id'], seconds(r['arrival_time'])))
    flush(current, rows)

    os.makedirs(out_dir, exist_ok=True)
    total_kept = 0
    for i, a in enumerate(areas):
        items = sorted(arrivals.get(i, []))
        per_hour = [[0] * 27 for _ in range(7)]
        for t, _, _, _, days in items:
            for day in range(7):
                if days & (1 << day):
                    per_hour[day][min(26, t // 3600)] += 1
        # Thin busy minutes evenly so no minute has more than MAX_PER_MINUTE arrivals.
        by_minute = defaultdict(list)
        for it in items:
            by_minute[it[0] // 60].append(it)
        kept = []
        for minute in sorted(by_minute):
            group = by_minute[minute]
            if len(group) > MAX_PER_MINUTE:
                step = len(group) / MAX_PER_MINUTE
                group = [group[int(k * step)] for k in range(MAX_PER_MINUTE)]
            kept.extend(group)
        stop_index, route_index = {}, {}
        out = {'v': 1, 'area': a['id'], 'stops': [], 'routes': [], 't': [], 's': [], 'r': [], 'e': [], 'd': [], 'perHour': per_hour}
        prev = 0
        for t, stop_id, route, end, days in kept:
            if stop_id not in stop_index:
                stop_index[stop_id] = len(out['stops'])
                out['stops'].append(list(stop_info[stop_id]))
            if route not in route_index:
                route_index[route] = len(out['routes'])
                out['routes'].append(route)
            out['t'].append(t - prev)
            prev = t
            out['s'].append(stop_index[stop_id])
            out['r'].append(route_index[route])
            out['e'].append(end)
            out['d'].append(days)
        with open(os.path.join(out_dir, f"{a['id']}.json"), 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        total_kept += len(kept)
        peak = max(max(h) for h in per_hour)
        print(f"{a['name']:20s} arrivals/day {len(items):6d}  kept {len(kept):6d}  busiest hour {peak:5d}  stops {len(out['stops']):4d}  routes {len(out['routes']):4d}")
    print(f'{total_kept} arrivals kept across {len(areas)} areas')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
