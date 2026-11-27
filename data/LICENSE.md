# Data licence

The files in this folder are derived databases, shared under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Any rights in individual contents are licensed under the
[Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/).

| File | Made from | With |
| --- | --- | --- |
| `metro.json` | [bmrcl-gtfs](https://github.com/Vonter/bmrcl-gtfs) by Vonter (ODbL), from BMRCL's published timetables and © OpenStreetMap contributors | `scripts/build_data.py` |
| `areas.json`, `stops/*.json`, `bmtc-routes.json` | [bmtc-gtfs](https://github.com/Vonter/bmtc-gtfs) by Vonter (ODbL), as republished in [reclaimchennai/India_GTFS](https://github.com/reclaimchennai/India_GTFS) | `scripts/build_areas.py` |
| `sample-buses.json` | One snapshot of live BMTC bus positions from [reclaim.city](https://maps.reclaim.city/bmtc/) | `scripts/make_sample.mjs` |

Area outlines are drawn by this project: each point in the city belongs to the nearest familiar
neighbourhood, so they are approximate and are not official ward or corporation boundaries.

The metro timetable gives times only at each line's end stations. bmrcl-gtfs estimates the times at
stations in between, so they can be a couple of minutes off from what happens on the platform.
