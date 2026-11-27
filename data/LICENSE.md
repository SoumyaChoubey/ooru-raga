# Data licence

`metro.json` is a derived database made from
[bmrcl-gtfs](https://github.com/Vonter/bmrcl-gtfs) by Vonter with
[`scripts/build_data.py`](../scripts/build_data.py).

It is made available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Any rights in individual contents of the database are licensed under the
[Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/).

Sources:

- Timetables published by Bengaluru Metro Rail Corporation Limited (BMRCL):
  <https://www.bmrc.co.in/metro-timings/>
- Station positions and track shapes: © OpenStreetMap contributors,
  <https://www.openstreetmap.org/copyright>

The timetable gives times only at each line's end stations. bmrcl-gtfs estimates the
times at stations in between from distance, dwell time and average speed, so they can be
a couple of minutes off from what happens on the platform.
