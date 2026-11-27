# Ooru Raga · ಊರು ರಾಗ

Bengaluru, played live. Pick an area of the city (Jayanagar, HSR Layout, Bellandur and 63 more) and
hear its BMTC buses and Namma Metro trains turned into Carnatic music as they move.

- **Buses lead the song.** About 4,000 buses report their GPS position every few minutes. When one in
  your area reports, it plays the veena if it's moving and the bansuri flute if it's standing still.
- **Traffic sets the pulse.** The tempo follows how fast your area's buses are moving, so a jam slows
  the song down. The record has two sides:
  - **Side A, Carnatic:** kanjira and mridangam in Adi tala, with a tanpura drone.
  - **Side B, Carnatic jazz:** a swinging rhythm section. A walking bass and electric-piano chords
    are built only from the raga's notes, with a ride cymbal, and a mridangam phrase every fourth bar.
- **The metro adds colour.** Trains follow the BMRCL timetable. When one reaches a station in your
  area, the Purple Line plays santoor, Green plays jal tarang and Yellow plays temple bells.
- **Every area has a raga**, with a tanpura tuned to match. Links like `/#hsr-layout` open an area
  directly, so people can share their own neighbourhood.

All sound is synthesised in the listener's browser. There are no audio files and no audio server.

## How it's built for lots of listeners

```
 BMTC buses ──> reclaim.city feed (500 KB, every ~15 s)
                        │  fetched at most once every 20 s per Cloudflare server
                        ▼
              /api/buses relay (functions/api/buses.js, on Cloudflare)
                        │  shrunk to ~45 KB, one copy shared by everyone
                        ▼
      every listener's browser: polls every 45 s, draws the record, makes the music
```

- **The website is static files** on Cloudflare Pages: served from Cloudflare's servers worldwide, with
  no limit on visitors or bandwidth on the free plan.
- **The relay protects the bus feed.** However many people are listening, reclaim.city sees about three
  requests a minute from each Cloudflare location. Tested locally: 300 requests, 30 at a time, caused
  one fetch of the bus feed.
- **Nothing breaks if the bus feed stops.** The relay keeps serving the last good copy, the page marks
  it "PAUSED since 17:31", and the metro and tanpura play on. If the relay can't be reached at all, the
  page shows a saved snapshot of buses, clearly labelled "SAMPLE".
- **Listeners use little data:** about 45 KB every 45 seconds while the tab is open or playing, and
  nothing while a silent tab sits in the background.

### Free plan limits, and when to pay $5

Static pages on Cloudflare Pages are unlimited. The relay is a Cloudflare "Function", and the free plan
allows **100,000 relay requests a day**. Each listener makes about 80 an hour, so that's roughly
**1,250 listener-hours a day** (for example, 2,500 people listening for half an hour each).

If a launch goes bigger than that, the site still loads and plays the metro, but buses show as paused
until the next day. To remove that limit, turn on **Workers Paid** in the Cloudflare dashboard
($5 a month, 10 million requests a month included, about 125,000 listener-hours). It also lifts the
per-request processing limit, which the relay comes close to on the free plan.

## Where it's live

**https://soumyachoubey.github.io/ooru-raga/**, on GitHub Pages (free), published from the
`gh-pages` branch. To publish a change, push it to `main` and then to `gh-pages`:

```bash
git push origin main
```

```bash
git push origin main:gh-pages
```

On GitHub Pages there is no relay, so each listener's browser reads the public bus feed from
reclaim.city directly, once a minute. That's fine for a launch of hundreds or a few thousand
listeners at a time. For bigger crowds, also deploy to Cloudflare Pages (below): the relay in
`functions/api/buses.js` turns on automatically there, and the page uses it instead.

## Launch checklist

1. **Code on GitHub.** The repository holds everything Cloudflare needs.
2. **Connect it to Cloudflare Pages** (steps below). You get a free address such as
   `https://ooru-raga.pages.dev`, with no domain needed.
3. **Make link previews work everywhere.** In `index.html`, change `content="og-image.jpg"` on the
   `og:image` line to the full address, for example `https://ooru-raga.pages.dev/og-image.jpg`.
   WhatsApp, Instagram and X need the full address to show the picture.
4. **Turn on visitor counts (optional, free, no cookies).** In Cloudflare, open the Pages project,
   then **Metrics**, and enable **Web Analytics**.
5. **Check it on a phone.** Open the address, press Start listening, try Side B, share an area to
   yourself on WhatsApp and check the preview appears.
6. **For a big launch,** consider Workers Paid ($5 for the month), so live buses don't pause if the
   free daily limit runs out.

People can also add it to their home screen; it has its own icon and opens full screen.

## Put it online (Cloudflare Pages, free)

You need a free GitHub account with this project pushed to it, and a free Cloudflare account.

1. Go to <https://dash.cloudflare.com>, sign up or log in.
2. In the sidebar choose **Workers & Pages**, then **Create**. Pick **Pages**, then the option to
   connect or import a Git repository. (Cloudflare renames these buttons now and then.)
3. Choose your GitHub account and this repository, then continue to the setup page.
4. Leave **Framework preset** as *None*, leave **Build command** empty, and set
   **Build output directory** to `/`. Choose **Save and Deploy**.
5. After about a minute you get an address like `https://ooru-raga.pages.dev`. Open it and press
   **Start listening**. The sticker on the record should say **LIVE** (or **PAUSED** if the bus feed
   itself is down at that moment).

Every time you push a change to GitHub, Cloudflare redeploys automatically. You can add your own
domain later under the project's **Custom domains** tab.

GitHub Pages also works for the page itself, but it can't run the relay, so buses will show the saved
sample instead of live positions.

## Run it on your computer

To see everything including live buses, use Cloudflare's own tool (needs [Node.js](https://nodejs.org)):

```bash
npx wrangler pages dev .
```

Then open <http://localhost:8788>. For the page alone, with sample buses, any static server works:

```bash
python3 -m http.server 8000
```

## Change how it sounds

- [`js/music.js`](js/music.js): the instruments, the ragas (`RAGAS`), what buses play (`BUS_VOICES`),
  which metro line plays what (`LINE_VOICES`), the jazz comping patterns (`COMPING`) and swing amount
  (`SWING`), how traffic sets the tempo (`tempoForSpeed`), and the home pitch (`SA_MIDI`).
- [`scripts/build_areas.py`](scripts/build_areas.py): the list of areas, their Kannada names, and
  which raga each area gets. Rebuild with the command in the next section.
- [`style.css`](style.css): the colours and fonts, as variables at the top.

## Update the data

```bash
# Metro timetable, from https://github.com/Vonter/bmrcl-gtfs (gtfs/bmrcl.zip)
python3 scripts/build_data.py path/to/bmrcl.zip data/metro.json

# Areas, bus stops and route numbers (needs: pip install shapely), from
# https://github.com/reclaimchennai/India_GTFS (karnataka/bengaluru/bus.zip)
python3 scripts/build_areas.py path/to/bus.zip data/metro.json data

# A fresh saved snapshot of buses for the "SAMPLE" fallback
node scripts/make_sample.mjs
```

## Files

```
index.html               the page
og-image.jpg, icons/     the picture shown when the link is shared, and home-screen icons
manifest.webmanifest     lets people add the site to their phone's home screen
style.css                colours, fonts and layout
_headers, wrangler.toml  Cloudflare Pages settings (caching, and where the site lives)
functions/api/buses.js   the live bus relay that runs on Cloudflare
lib/bus-feed.js          reads the bus feed and shrinks it (used by the relay and the sample script)
js/main.js               connects everything: areas, buses, metro, music, the page
js/buses.js              fetches live buses and turns new GPS reports into notes
js/timetable.js          where every metro train is, and when it reaches each station
js/areas.js              the listening areas and which one a point falls in
js/music.js              every instrument, synthesised in the browser
js/record.js             draws the city as a record, with buses, trains and the tonearm
data/                    metro timetable, areas, bus stops per area, route numbers, sample buses
fonts/                   self-hosted fonts and their licences
scripts/                 rebuild the data
```

## Credits and licences

- Code: MIT licence (see [`LICENSE`](LICENSE)).
- Live bus positions: BMTC, republished by [reclaim.city](https://maps.reclaim.city/bmtc/).
- Bus routes and stops: [bmtc-gtfs](https://github.com/Vonter/bmtc-gtfs) by Vonter, via
  [reclaimchennai/India_GTFS](https://github.com/reclaimchennai/India_GTFS), ODbL 1.0.
- Metro timetable: [bmrcl-gtfs](https://github.com/Vonter/bmrcl-gtfs) by Vonter, ODbL 1.0, from
  [BMRCL's published timetables](https://www.bmrc.co.in/metro-timings/) and © OpenStreetMap
  contributors. Everything in `data/` derived from these is shared under the same ODbL terms (see
  [`data/LICENSE.md`](data/LICENSE.md)).
- Fonts: Anton, Oswald, Doto, Anek Kannada, IBM Plex Sans and DM Serif Display, all under the SIL Open
  Font License (licences in [`fonts/`](fonts)).
- Inspired by [Delhi Metro Jazz](https://www.delhimetrojazz.com/).

An unofficial art project. Not affiliated with BMTC or BMRCL, and not a journey planner.
