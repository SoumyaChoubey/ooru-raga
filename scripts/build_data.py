#!/usr/bin/env python3
"""
Turn the Namma Metro GTFS timetable into one small JSON file the website can load.

GTFS is the standard format transit agencies use to publish timetables. It is a
zip of CSV files (stops.txt, trips.txt, stop_times.txt, ...). That is far too
big to send to a browser (stop_times.txt alone is 5 MB), so this script keeps
only what the music needs:

  * stations   - name (English + Kannada) and position
  * lines      - the track drawn on the map, and each station's distance along it
  * patterns   - a list of stops plus how many seconds after departure the train
                 reaches each one (the timetable only has 19 distinct patterns)
  * services   - every trip of the day as (pattern, start time)
  * calendar   - which service runs on which date (weekday, Monday, Sunday, holiday)

Usage:
    python3 scripts/build_data.py path/to/bmrcl.zip data/metro.json

Get bmrcl.zip from https://github.com/Vonter/bmrcl-gtfs (gtfs/bmrcl.zip).
Only the Python standard library is used, so there is nothing to install.
"""

import csv
import io
import json
import math
import sys
import zipfile
from collections import defaultdict

# Each line's "home" station. Notes get higher the further a train is from here,
# so trains heading into the city sing downward towards Sa.
ANCHORS = {"PURPLE": "KGWA", "GREEN": "KGWA", "YELLOW": "RVR"}  # Majestic, RV Road
LINE_ORDER = ["PURPLE", "GREEN", "YELLOW"]

# Short labels for the map. Anything not listed keeps its full name, or the part
# after the last comma ("Nadaprabhu Kempegowda Station, Majestic" -> "Majestic").
SHORT_NAMES = {
    "Krantivira Sangolli Rayanna Railway Station": "KSR Railway Station",
    "Infosys Foundation Konappana Agrahara": "Konappana Agrahara",
    "Delta Electronics Bommasandra": "Bommasandra",
    "Pantharapalya - Nayandahalli": "Nayandahalli",
    "Rashtreeya Vidyalaya Road": "RV Road",
    "Whitefield (Kadugodi)": "Whitefield",
    "Mahatma Gandhi Road": "MG Road",
    "Krishna Rajendra Market": "KR Market",
    "Swami Vivekananda Road": "SV Road",
    "Biocon Hebbagodi": "Hebbagodi",
    "Mantri Square Sampige Road": "Sampige Road",
}


def read_csv(z, name):
    with z.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def seconds(hms):
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


def haversine_km(a, b):
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def to_xy(p, lat0):
    """Rough metres east/north, good enough over a city."""
    return (p[1] * 111320 * math.cos(math.radians(lat0)), p[0] * 110540)


def simplify(points, tolerance_m, lat0):
    """Ramer-Douglas-Peucker: drop track points that don't change the drawn shape."""
    xy = [to_xy(p, lat0) for p in points]

    def dist_to_segment(p, a, b):
        ax, ay = a
        bx, by = b
        px, py = p
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return math.hypot(px - ax, py - ay)
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0, None
        for k in range(i + 1, j):
            d = dist_to_segment(xy[k], xy[i], xy[j])
            if d > best:
                best, idx = d, k
        if idx is not None and best > tolerance_m:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(points, keep) if k]


def project_onto_path(point, path, cum, lat0):
    """Distance (km) along the path of the path point closest to `point`."""
    px, py = to_xy(point, lat0)
    best = (float("inf"), 0.0)
    for i in range(len(path) - 1):
        ax, ay = to_xy(path[i], lat0)
        bx, by = to_xy(path[i + 1], lat0)
        dx, dy = bx - ax, by - ay
        seg = dx * dx + dy * dy
        t = 0 if seg == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / seg))
        d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if d < best[0]:
            best = (d, cum[i] + t * (cum[i + 1] - cum[i]))
    return best[1]


def short_name(name):
    if name in SHORT_NAMES:
        return SHORT_NAMES[name]
    if ", " in name:
        return name.rsplit(", ", 1)[1]
    return name


def main(zip_path, out_path):
    z = zipfile.ZipFile(zip_path)
    stops = {r["stop_id"]: r for r in read_csv(z, "stops.txt")}
    routes = {r["route_id"]: r for r in read_csv(z, "routes.txt")}
    trips = {r["trip_id"]: r for r in read_csv(z, "trips.txt")}
    feed_info = read_csv(z, "feed_info.txt")[0]

    kannada = {}
    for r in read_csv(z, "translations.txt"):
        if r["table_name"] == "stops" and r["field_name"] == "stop_name" and r["language"] == "kn":
            kannada[r["record_id"]] = r["translation"]

    shapes = defaultdict(list)
    for r in read_csv(z, "shapes.txt"):
        shapes[r["shape_id"]].append(
            (int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"]))
        )
    for k in shapes:
        shapes[k] = [(lat, lon) for _, lat, lon in sorted(shapes[k])]

    def station_of(stop_id):
        s = stops[stop_id]
        return s["parent_station"] or stop_id

    # Group stop_times by trip.
    by_trip = defaultdict(list)
    for r in read_csv(z, "stop_times.txt"):
        by_trip[r["trip_id"]].append(r)

    # Collapse trips into patterns: same line, direction, stops and relative timings.
    pattern_index = {}
    patterns = []
    service_trips = defaultdict(list)
    for trip_id, rows in by_trip.items():
        rows.sort(key=lambda r: int(r["stop_sequence"]))
        trip = trips[trip_id]
        start = seconds(rows[0]["departure_time"])
        key = (
            trip["route_id"],
            int(trip["direction_id"]),
            tuple(station_of(r["stop_id"]) for r in rows),
            tuple(seconds(r["arrival_time"]) - start for r in rows),
            tuple(seconds(r["departure_time"]) - start for r in rows),
        )
        if key not in pattern_index:
            pattern_index[key] = len(patterns)
            patterns.append({"key": key, "shape": trip["shape_id"]})
        service_trips[trip["service_id"]].append((start, pattern_index[key]))

    # Station list and one drawn track per line, taken from the longest pattern.
    station_ids = []
    station_pos = {}

    def station_index(sid):
        if sid not in station_pos:
            station_pos[sid] = len(station_ids)
            station_ids.append(sid)
        return station_pos[sid]

    lines = []
    line_local = {}  # route_id -> {station_id: index within the line}
    for route_id in LINE_ORDER:
        mine = [p for p in patterns if p["key"][0] == route_id]
        longest = max(mine, key=lambda p: (len(p["key"][2]), -p["key"][1]))
        order = list(longest["key"][2])
        raw_path = shapes[longest["shape"]]
        lat0 = sum(p[0] for p in raw_path) / len(raw_path)
        path = simplify(raw_path, 4.0, lat0)
        cum = [0.0]
        for a, b in zip(path, path[1:]):
            cum.append(cum[-1] + haversine_km(a, b))
        dists = [project_onto_path((float(stops[s]["stop_lat"]), float(stops[s]["stop_lon"])), path, cum, lat0) for s in order]
        if dists[0] > dists[-1]:  # make distance grow along the station order
            path.reverse()
            total = cum[-1]
            cum = [round(total - d, 4) for d in reversed(cum)]
            dists = [total - d for d in dists]
        line_local[route_id] = {s: i for i, s in enumerate(order)}
        r = routes[route_id]
        lines.append(
            {
                "id": route_id,
                "name": f"{r['route_short_name']} Line",
                "color": "#" + r["route_color"],
                "stations": [station_index(s) for s in order],
                "dist": [round(d, 4) for d in dists],
                "anchor": order.index(ANCHORS[route_id]),
                "path": [[round(lat, 5), round(lon, 5), round(d, 4)] for (lat, lon), d in zip(path, cum)],
            }
        )

    stations = []
    for sid in station_ids:
        s = stops[sid]
        stations.append(
            {
                "id": sid,
                "name": s["stop_name"],
                "short": short_name(s["stop_name"]),
                "kn": kannada.get(sid, ""),
                "lat": round(float(s["stop_lat"]), 5),
                "lon": round(float(s["stop_lon"]), 5),
                "lines": [i for i, l in enumerate(lines) if station_pos[sid] in l["stations"]],
            }
        )

    out_patterns = []
    for p in patterns:
        route_id, direction, stop_seq, arr, dep = p["key"]
        local = line_local[route_id]
        out_patterns.append(
            {
                "line": LINE_ORDER.index(route_id),
                "dir": direction,
                "stops": [local[s] for s in stop_seq],
                "arr": list(arr),
                "dep": list(dep),
            }
        )

    services = {}
    for service_id, items in service_trips.items():
        items.sort()
        flat = []
        for start, pat in items:
            flat += [pat, start]
        services[service_id] = flat

    calendar = []
    for r in read_csv(z, "calendar.txt"):
        days = [int(r[d]) for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")]
        calendar.append({"service": r["service_id"], "days": days, "start": r["start_date"], "end": r["end_date"]})
    exceptions = [[r["date"], r["service_id"], int(r["exception_type"])] for r in read_csv(z, "calendar_dates.txt")]

    data = {
        "meta": {
            "feedVersion": feed_info.get("feed_version", ""),
            "validFrom": feed_info.get("feed_start_date", ""),
            "validTo": feed_info.get("feed_end_date", ""),
            "timezone": "Asia/Kolkata",
            "source": "https://github.com/Vonter/bmrcl-gtfs",
            "license": "ODbL-1.0",
        },
        "stations": stations,
        "lines": lines,
        "patterns": out_patterns,
        "services": services,
        "calendar": calendar,
        "exceptions": exceptions,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    total_trips = sum(len(v) // 2 for v in services.values())
    print(f"{len(stations)} stations, {len(lines)} lines, {len(out_patterns)} patterns, {total_trips} trips -> {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
