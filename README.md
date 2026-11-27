# Metro Raga · ಮೆಟ್ರೋ ರಾಗ

Bengaluru's Namma Metro, played as music. Every time a train reaches a station, that
station plays a note. Each line is its own instrument, and the trains follow the real
published timetable in Bengaluru time, so what you hear is what the metro is doing now.

| Line | Instrument | Home note (Sa) at |
| --- | --- | --- |
| Purple | Veena | Majestic |
| Green | Bansuri flute | Majestic |
| Yellow | Temple bells | RV Road |

A tanpura drone plays underneath, and the two interchange stations (Majestic and
RV Road) add a soft gong.

## How it works

1. **The timetable.** BMRCL publishes timetables for each line. The community project
   [bmrcl-gtfs](https://github.com/Vonter/bmrcl-gtfs) turns them into GTFS, the
   standard timetable format, with every trip of every day.
2. **The trains.** The browser works out where each train should be at the current
   moment in IST and moves it along the real track shape. This follows the timetable,
   not live GPS. BMRCL does not publish live train positions, so the real trains can
   be a couple of minutes off.
3. **The notes.** Each station gets a note from a five-note Carnatic raga. The further
   a station is from Majestic (RV Road on the Yellow Line), the higher its note. A
   train heading out of the city climbs, and a train heading in falls back towards Sa.
   Stations to the west sound in your left ear and stations to the east in your right.

All the sound is synthesised in the browser with the Web Audio API. There are no audio
files.

## Run it on your computer

The site is plain HTML, CSS and JavaScript. There is no build step and nothing to install.
Browsers will not load the timetable file from a page opened by double-clicking, so run a
tiny local web server. Python is already on most Macs and Linux machines:

```bash
cd metro-raga
```

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> and press **Start listening**.

## Put it online for free (GitHub Pages)

1. Push this folder to a GitHub repository.
2. On GitHub, open the repository's **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, choose
   `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/metro-raga/`.

Free GitHub accounts need the repository to be public for Pages.

## Change how it sounds

Everything musical is in [`js/music.js`](js/music.js), near the top:

- `LINE_VOICES` sets which instrument each line plays, how high it sits, and how loud it is.
- `RAGAS` lists the ragas. Add one by giving its swaras and the semitones above Sa.
- `autoRaga()` decides which raga plays at which hour when the picker is on Auto.
- `SA_MIDI` sets the home pitch for everything (50 is D3). `TEMPO` sets the pulse.

The map's colours and fonts are CSS variables at the top of [`style.css`](style.css).

## Update the timetable

When BMRCL changes its timetable or a new line opens, bmrcl-gtfs is usually updated.
To pull the new data in:

1. Download `bmrcl.zip` from <https://github.com/Vonter/bmrcl-gtfs/tree/main/gtfs>.
2. Run the converter, which uses only the Python standard library:

   ```bash
   python3 scripts/build_data.py path/to/bmrcl.zip data/metro.json
   ```

A new line will also need an entry in `ANCHORS` and `LINE_ORDER` in
[`scripts/build_data.py`](scripts/build_data.py), an instrument in `LINE_VOICES`, and a
colour variable (`--line-pink`, for example) in `style.css`.

## Files

```
index.html            the page
style.css             colours, fonts, layout
js/main.js            the clock, controls, and the link between trains and sound
js/timetable.js       where every train is, and when it reaches each station
js/music.js           the instruments, ragas and tanpura
js/map.js             the map, trains and ripples, drawn on a canvas
data/metro.json       the timetable, made small enough for a browser (about 60 KB)
scripts/build_data.py turns the GTFS zip into data/metro.json
```

## Credits and licences

- Code: MIT licence (see [`LICENSE`](LICENSE)).
- Timetable data in `data/metro.json` is derived from
  [bmrcl-gtfs](https://github.com/Vonter/bmrcl-gtfs) by Vonter and is shared under the
  [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  See [`data/LICENSE.md`](data/LICENSE.md).
- bmrcl-gtfs is built from timetables published by
  [BMRCL](https://www.bmrc.co.in/metro-timings/) and track geometry from
  © OpenStreetMap contributors.
- Inspired by [Delhi Metro Jazz](https://www.delhimetrojazz.com/).

This is an unofficial art project. It is not affiliated with BMRCL and is not a journey planner.
