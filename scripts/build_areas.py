#!/usr/bin/env python3
"""
Build the listening areas: familiar Bengaluru neighbourhoods, the city split between them,
and the bus stops and metro stations inside each one.

Each area is centred on its metro station, or on the middle of the BMTC bus stops named after
it (near a rough location hint, so a village with the same name far away is ignored). The city
is then divided so every point belongs to its nearest area (a Voronoi diagram), clipped to where
BMTC buses run within 20 km of Majestic.

Usage (needs `pip install shapely`):
    python3 scripts/build_areas.py path/to/bmtc-bus.zip data/metro.json data

bmtc-bus.zip is the BMTC GTFS from https://github.com/reclaimchennai/India_GTFS
(karnataka/bengaluru/bus.zip), built from https://github.com/Vonter/bmtc-gtfs (ODbL).

Writes:
    data/areas.json          the areas, their outlines, ragas and colours
    data/stops/<area>.json   bus stops in each area, for "Route 13 near ..." labels
    data/bmtc-routes.json    BMTC route ids to route numbers, used by the live bus relay
"""

import csv
import io
import json
import math
import os
import re
import statistics
import sys
import zipfile

from shapely.geometry import MultiPoint, Point
from shapely.ops import unary_union, voronoi_diagram

MAJESTIC = (12.9757, 77.5729)
CITY_RADIUS_KM = 20
KX = 111.32 * math.cos(math.radians(MAJESTIC[0]))
KY = 110.57

# Pentatonic Carnatic ragas. The first eight areas are the featured ones on the page.
RAGAS = ['hindolam', 'madhyamavati', 'mohanam', 'shivaranjani', 'hamsadhwani', 'abhogi', 'bhupalam', 'revati',
         'shuddhasaveri', 'shuddhadhanyasi']
COLOURS = ['#c6f432', '#e8368f', '#f5b301', '#3d60b3', '#e0301e', '#1fb36b', '#c9a54c', '#b04aa3']

# name, Kannada, metro station (short name) or None, bus-stop pattern, rough (lat, lon) hint
AREAS = [
    ('Jayanagar', 'ಜಯನಗರ', 'Jayanagar', None, None),
    ('JP Nagar', 'ಜೆ.ಪಿ. ನಗರ', 'Jaya Prakash Nagar', None, None),
    ('HSR Layout', 'ಎಚ್‌ಎಸ್‌ಆರ್ ಲೇಔಟ್', None, r'\bhsr\b', (12.912, 77.640)),
    ('Bellandur', 'ಬೆಳ್ಳಂದೂರು', None, r'\bbellandur', (12.926, 77.676)),
    ('Koramangala', 'ಕೋರಮಂಗಲ', None, r'\bkoramangala', (12.935, 77.624)),
    ('Indiranagar', 'ಇಂದಿರಾನಗರ', 'Indiranagar', None, None),
    ('Malleshwaram', 'ಮಲ್ಲೇಶ್ವರಂ', None, r'\bmalle(sh|s)waram', (13.003, 77.570)),
    ('Whitefield', 'ವೈಟ್‌ಫೀಲ್ಡ್', None, r'white ?f[ie]+ld', (12.970, 77.750)),
    ('Majestic', 'ಮೆಜೆಸ್ಟಿಕ್', 'Majestic', None, None),
    ('Basavanagudi', 'ಬಸವನಗುಡಿ', 'National College', None, None),
    ('BTM Layout', 'ಬಿಟಿಎಂ ಲೇಔಟ್', 'BTM Layout', None, None),
    ('Electronic City', 'ಎಲೆಕ್ಟ್ರಾನಿಕ್ ಸಿಟಿ', 'Electronic City', None, None),
    ('Hebbal', 'ಹೆಬ್ಬಾಳ', None, r'\bhebbala?\b', (13.036, 77.597)),
    ('Yelahanka', 'ಯಲಹಂಕ', None, r'\byelahanka', (13.100, 77.595)),
    ('Marathahalli', 'ಮಾರತ್ತಹಳ್ಳಿ', None, r'\bmarathahalli', (12.956, 77.701)),
    ('Banashankari', 'ಬನಶಂಕರಿ', 'Banashankari', None, None),
    ('Rajajinagar', 'ರಾಜಾಜಿನಗರ', 'Rajajinagar', None, None),
    ('MG Road', 'ಎಂ.ಜಿ. ರಸ್ತೆ', 'MG Road', None, None),
    ('Shivajinagar', 'ಶಿವಾಜಿನಗರ', None, r'\bshivajinagara? bus station', (12.984, 77.603)),
    ('Yeshwanthpur', 'ಯಶವಂತಪುರ', 'Yeshwantpur', None, None),
    ('Peenya', 'ಪೀಣ್ಯ', 'Peenya Industry', None, None),
    ('Vijayanagar', 'ವಿಜಯನಗರ', 'Vijayanagar', None, None),
    ('Kengeri', 'ಕೆಂಗೇರಿ', 'Kengeri', None, None),
    ('RR Nagar', 'ಆರ್.ಆರ್. ನಗರ', 'Rajarajeshwari Nagar', None, None),
    ('Bannerghatta Road', 'ಬನ್ನೇರುಘಟ್ಟ ರಸ್ತೆ', None, r'\barekere\b|\bhulimavu\b', (12.885, 77.600)),
    ('Sarjapur Road', 'ಸರ್ಜಾಪುರ ರಸ್ತೆ', None, r'doddakannelli|carmelaram|kodathi|wipro', (12.910, 77.702)),
    ('KR Puram', 'ಕೆ.ಆರ್. ಪುರಂ', 'Krishnarajapura', None, None),
    ('Hennur', 'ಹೆಣ್ಣೂರು', None, r'\bhennur', (13.035, 77.640)),
    ('Kalyan Nagar', 'ಕಲ್ಯಾಣನಗರ', None, r'\bkalyana ?nagara?\b', (13.022, 77.640)),
    ('RT Nagar', 'ಆರ್.ಟಿ. ನಗರ', None, r'\br ?t nagara?\b', (13.024, 77.594)),
    ('Frazer Town', 'ಫ್ರೇಜರ್ ಟೌನ್', None, r'\bfrazer town', (13.000, 77.613)),
    ('Ulsoor', 'ಹಲಸೂರು', 'Halasuru', None, None),
    ('Domlur', 'ದೊಮ್ಮಲೂರು', None, r'\bdomlur', (12.961, 77.638)),
    ('Banaswadi', 'ಬಾಣಸವಾಡಿ', None, r'\bbanaswadi', (13.012, 77.650)),
    ('Uttarahalli', 'ಉತ್ತರಹಳ್ಳಿ', None, r'\buttarahalli', (12.905, 77.540)),
    ('Nagarabhavi', 'ನಾಗರಭಾವಿ', None, r'\bnagarabhavi', (12.961, 77.513)),
    ('Basaveshwara Nagar', 'ಬಸವೇಶ್ವರನಗರ', None, r'basaveshwara', (12.988, 77.536)),
    ('Jalahalli', 'ಜಾಲಹಳ್ಳಿ', 'Jalahalli', None, None),
    ('Vidyaranyapura', 'ವಿದ್ಯಾರಣ್ಯಪುರ', None, r'\bvidyaranyapura', (13.077, 77.558)),
    ('Thanisandra', 'ಥಣಿಸಂದ್ರ', None, r'\bthanisandra', (13.057, 77.633)),
    ('Varthur', 'ವರ್ತೂರು', None, r'\bvarthur', (12.940, 77.744)),
    ('Hoodi', 'ಹೂಡಿ', 'Hoodi', None, None),
    ('Begur', 'ಬೇಗೂರು', None, r'\bbeguru?\b', (12.876, 77.628)),
    ('Kumaraswamy Layout', 'ಕುಮಾರಸ್ವಾಮಿ ಲೇಔಟ್', None, r'\bkumaraswamy', (12.904, 77.562)),
    ('Chamrajpet', 'ಚಾಮರಾಜಪೇಟೆ', None, r'chamara?ja?pe', (12.957, 77.566)),
    ('Wilson Garden', 'ವಿಲ್ಸನ್ ಗಾರ್ಡನ್', None, r'\bwilson garden', (12.947, 77.596)),
    ('Silk Board', 'ಸಿಲ್ಕ್ ಬೋರ್ಡ್', 'Central Silk Board', None, None),
    ('Sanjaynagar', 'ಸಂಜಯನಗರ', None, r'\bsanjay ?nagara?\b', (13.031, 77.577)),
    ('Kadugodi', 'ಕಾಡುಗೋಡಿ', None, r'\bkadugodi', (12.998, 77.760)),
    ('Bommanahalli', 'ಬೊಮ್ಮನಹಳ್ಳಿ', 'Bommanahalli', None, None),
    ('Sadashivanagar', 'ಸದಾಶಿವನಗರ', None, r'\bsadashivanagar', (13.008, 77.580)),
    ('Brookefield', 'ಬ್ರೂಕ್‌ಫೀಲ್ಡ್', 'Kundalahalli', None, None),
    ('Jakkur', 'ಜಕ್ಕೂರು', None, r'\bjakkuru?\b', (13.073, 77.603)),
    ('Madivala', 'ಮಡಿವಾಳ', None, r'\bmadivala|\bmadiwala', (12.922, 77.618)),
    ('Hosur Road', 'ಹೊಸೂರು ರಸ್ತೆ', 'Hosa Road', None, None),
    ('Nagasandra', 'ನಾಗಸಂದ್ರ', 'Nagasandra', None, None),
    ('Mysore Road', 'ಮೈಸೂರು ರಸ್ತೆ', 'Mysore Road', None, None),
    ('Hebbagodi', 'ಹೆಬ್ಬಗೋಡಿ', 'Hebbagodi', None, None),
    ('Kanakapura Road', 'ಕನಕಪುರ ರಸ್ತೆ', 'Doddakallasandra', None, None),
    ('Madavara', 'ಮಾದಾವರ', 'Madavara', None, None),
    ('Challaghatta', 'ಚಲ್ಲಘಟ್ಟ', 'Challaghatta', None, None),
    ('Kogilu', 'ಕೋಗಿಲು', None, r'\bkogilu', (13.103, 77.610)),
    ('Horamavu', 'ಹೊರಮಾವು', None, r'\bhoramavu', (13.034, 77.656)),
    ('Anjanapura', 'ಅಂಜನಾಪುರ', None, r'\banjanapura', (12.862, 77.563)),
    ('Gottigere', 'ಗೊಟ್ಟಿಗೆರೆ', None, r'\bgottigere', (12.856, 77.589)),
    ('Herohalli', 'ಹೇರೋಹಳ್ಳಿ', None, r'\bherohalli|sunkadakatte', (12.990, 77.498)),
]

# Kannada vowel signs, virama and other marks that belong to the letter before them.
KN_MARKS = set(range(0x0C81, 0x0C84)) | set(range(0x0CBC, 0x0CBD + 1)) | set(range(0x0CBE, 0x0CD7)) | {0x200C, 0x200D}


def km(lat, lon):
    return ((lon - MAJESTIC[1]) * KX, (MAJESTIC[0] - lat) * KY)


def latlon(x, y):
    return (round(MAJESTIC[0] - y / KY, 5), round(MAJESTIC[1] + x / KX, 5))


def first_akshara(text):
    """The first written syllable, e.g. ಜಯನಗರ -> ಜ, ಕೋರಮಂಗಲ -> ಕೋ, ಸ್ಟೇ -> ಸ್ಟೇ."""
    out = text[0]
    i = 1
    while i < len(text) and (ord(text[i]) in KN_MARKS):
        out += text[i]
        if text[i] == '್' and i + 1 < len(text):  # virama joins the next consonant
            out += text[i + 1]
            i += 1
        i += 1
    return out


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def region(x, y):
    d = math.hypot(x, y)
    if d < 4.5:
        return 'Central'
    angle = (math.degrees(math.atan2(x, -y)) + 360) % 360  # 0 = north, clockwise
    return ['North', 'East', 'South', 'West'][int(((angle + 45) % 360) // 90)]


def main(bus_zip, metro_path, out_dir):
    z = zipfile.ZipFile(bus_zip)
    read = lambda name: list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig')))
    stops = read('stops.txt')
    kn = {r['record_id']: r['translation'] for r in read('translations.txt')
          if r['table_name'] == 'stops' and r['language'] == 'kn'}
    routes = {r['route_id']: r['route_short_name'] for r in read('routes.txt')}
    metro = json.load(open(metro_path, encoding='utf-8'))
    station_by_name = {s['short']: i for i, s in enumerate(metro['stations'])}

    areas = []
    for name, kname, station, pattern, hint in AREAS:
        if station:
            s = metro['stations'][station_by_name[station]]
            lat, lon, source = s['lat'], s['lon'], f'{station} metro station'
        else:
            rx = re.compile(pattern, re.I)
            hits = [(float(s['stop_lat']), float(s['stop_lon'])) for s in stops if rx.search(s['stop_name'])]
            near = [h for h in hits if math.dist(km(*h), km(*hint)) < 2.5]
            if near:
                lat = statistics.median(h[0] for h in near)
                lon = statistics.median(h[1] for h in near)
                source = f'{len(near)} bus stops'
            else:
                lat, lon = hint
                source = 'location hint'
        areas.append({'name': name, 'kn': kname, 'lat': lat, 'lon': lon, 'source': source})

    # The city: everywhere within 700 m of a BMTC stop, within the radius.
    pts = [km(float(s['stop_lat']), float(s['stop_lon'])) for s in stops]
    pts = [p for p in pts if math.hypot(*p) < CITY_RADIUS_KM]
    city = unary_union([Point(p).buffer(0.7, 6) for p in pts]).buffer(0.6).buffer(-0.6)
    if city.geom_type == 'MultiPolygon':
        city = max(city.geoms, key=lambda g: g.area)
    city = city.simplify(0.12)

    centres = [km(a['lat'], a['lon']) for a in areas]
    cells = voronoi_diagram(MultiPoint(centres), envelope=city.envelope.buffer(5))
    os.makedirs(os.path.join(out_dir, 'stops'), exist_ok=True)
    station_pts = [(i, Point(km(s['lat'], s['lon']))) for i, s in enumerate(metro['stations'])]
    stop_pts = [(s, Point(km(float(s['stop_lat']), float(s['stop_lon'])))) for s in stops]

    out = []
    for i, (a, c) in enumerate(zip(areas, centres)):
        cell = next(g for g in cells.geoms if g.contains(Point(c)))
        zone = cell.intersection(city)
        if zone.geom_type != 'Polygon':
            zone = max(zone.geoms, key=lambda g: g.area)
        zone = zone.simplify(0.04)
        area_id = slug(a['name'])
        in_stops = [s for s, p in stop_pts if zone.contains(p)]
        json.dump(
            [[s['stop_name'], kn.get(s['stop_id'], ''), round(float(s['stop_lat']), 5), round(float(s['stop_lon']), 5)] for s in in_stops],
            open(os.path.join(out_dir, 'stops', f'{area_id}.json'), 'w', encoding='utf-8'),
            ensure_ascii=False, separators=(',', ':'),
        )
        out.append({
            'id': area_id,
            'name': a['name'],
            'kn': a['kn'],
            'akshara': first_akshara(a['kn']),
            'raga': RAGAS[i % len(RAGAS)] if i >= 8 else RAGAS[i],
            'colour': COLOURS[i % len(COLOURS)],
            'featured': i < 8,
            'region': region(*c),
            'lat': round(a['lat'], 5),
            'lon': round(a['lon'], 5),
            'source': a['source'],
            'areaKm2': round(zone.area, 1),
            'stops': len(in_stops),
            'stations': [j for j, p in station_pts if zone.contains(p)],
            'outline': [list(latlon(x, y)) for x, y in zone.exterior.coords],
        })

    data = {
        'about': 'Listening areas for Ooru Raga. Bus stops: BMTC GTFS by Vonter (ODbL), via reclaim.city.',
        'city': [list(latlon(x, y)) for x, y in city.exterior.coords],
        'areas': out,
    }
    json.dump(data, open(os.path.join(out_dir, 'areas.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    json.dump({k.split(':', 1)[1]: v for k, v in routes.items() if k.startswith('BMTC:')},
              open(os.path.join(out_dir, 'bmtc-routes.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    for a in sorted(out, key=lambda a: -a['areaKm2']):
        print(f"{a['name']:20s} {a['region']:7s} {a['areaKm2']:6.1f} km2  stops {a['stops']:4d}  metro {len(a['stations'])}  ({a['source']})")
    print(f'{len(out)} areas, city {round(city.area)} km2')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
