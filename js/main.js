// main.js - connects the areas, live buses, metro timetable, music and the record, and runs the page.
import { Timetable, serviceMoment, istNow, formatClock, IST_OFFSET_MS } from './timetable.js';
import { Music, RAGAS, STYLES, LINE_VOICES, BUS_VOICES, BUS_DEGREES, ragaScale, tempoForSpeed } from './music.js';
import { Areas, toKm } from './areas.js';
import { BusFeed } from './buses.js';
import { loadBusTimetable, tempoForBusesDue } from './bustimetable.js';
import { Record } from './record.js';

const $ = (id) => document.getElementById(id);
const DEFAULT_AREA = 'jayanagar';
const BOARD_ROWS = 6;
const FRESH_FIX_S = 15 * 60; // a bus counts as "in the area now" if it reported in the last 15 minutes
const REGIONS = ['Central', 'North', 'East', 'South', 'West'];
const STYLE_KEY = 'ooru-raga-style';
const TIME = (sec) => formatClock(sec * 1000 + IST_OFFSET_MS, false);

let tt;
let areas;
let record;
let music;
let feed;
let area = null;
let areaStops = [];
const stopCache = new Map();
const queue = []; // bus pings waiting for their moment
const visuals = []; // notes waiting to light up on the record
const board = [];
let boardDirty = true;
let metroUpTo = null; // IST ms up to which metro arrivals have been handled
let lastUi = 0;
let traffic = { speed: null, samples: 0, buses: 0 };
let busTable = null; // the area's bus timetable, used while live buses are unavailable
let busTableFor = null;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function init() {
  let metroData;
  let areaData;
  try {
    [metroData, areaData] = await Promise.all([getJson('data/metro.json'), getJson('data/areas.json')]);
  } catch (err) {
    console.error(err);
    $('start').hidden = true;
    $('feed-note').textContent = 'The map did not load. If you opened index.html from your computer, run a local web server (see the README).';
    return;
  }
  tt = new Timetable(metroData);
  areas = new Areas(areaData);
  music = new Music(tt.lines);
  record = new Record($('record'), { metro: metroData, areas });
  $('m-areas').textContent = areas.list.length;
  $('picker-count').textContent = areas.list.length;

  buildPicker();
  bindControls();
  setStyle(savedStyle());
  feed = new BusFeed({ onSnapshot, isPlaying: () => music.playing });
  window.addEventListener('hashchange', () => selectArea(location.hash.slice(1)));
  selectArea(location.hash.slice(1) || DEFAULT_AREA);
  feed.start();
  document.fonts?.ready.then(() => {
    record.readColours();
    record.renderStatic();
  });
  setInterval(tick, 100);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ choosing an area

function selectArea(id, { fromUser = false } = {}) {
  const next = areas.byId.get(id) || areas.byId.get(DEFAULT_AREA);
  if (next === area) return;
  area = next;
  if (location.hash.slice(1) !== area.id) history.replaceState(null, '', `#${area.id}`);
  music.setRaga(area.raga);
  record.setSelected(area);
  board.length = 0;
  boardDirty = true;
  visuals.length = 0; // the queue keeps every area's buses, so a new area starts playing straight away
  areaStops = [];
  loadStops(area);
  busTable = null;
  busTableFor = null;
  if (timetableMode()) ensureBusTable();
  updateTraffic();
  renderArea();
  setNowPlaying(`Listening to ${area.name}`, `Raga ${RAGAS[area.raga].name}. Moving buses play veena, waiting buses play flute.`);
  for (const b of document.querySelectorAll('[data-area]')) b.setAttribute('aria-pressed', String(b.dataset.area === area.id));
  if (fromUser && !music.playing) togglePlay();
}

/** Live buses unavailable (feed paused, unreachable or offline): play the timetable instead. */
function timetableMode() {
  return !!feed && feed.state !== 'live' && feed.state !== 'loading';
}

function ensureBusTable() {
  if (!area || busTableFor === area.id) return;
  const id = area.id;
  busTableFor = id;
  busTable = null;
  loadBusTimetable(id)
    .then((t) => {
      if (area && area.id === id) busTable = t;
    })
    .catch(() => {
      if (busTableFor === id) busTableFor = null; // try again on the next tick
    });
}

async function loadStops(a) {
  if (!stopCache.has(a.id)) {
    try {
      const rows = await getJson(`data/stops/${a.id}.json`);
      stopCache.set(a.id, rows.map(([name, kn, lat, lon]) => ({ name, kn, at: toKm(lat, lon) })));
    } catch {
      stopCache.set(a.id, []);
    }
  }
  if (a === area) areaStops = stopCache.get(a.id);
}

function nearestStop(x, y) {
  let best = null;
  let bestD = 0.6; // km
  for (const s of areaStops) {
    const d = Math.hypot(s.at[0] - x, s.at[1] - y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best ? best.name : area.name;
}

function renderArea() {
  const r = RAGAS[area.raga];
  const poster = $('poster');
  poster.style.setProperty('--area', area.colour);
  $('area-index').textContent = `Area ${String(area.index + 1).padStart(2, '0')} / ${areas.list.length}`;
  $('area-raga').textContent = `Raga ${r.name}`;
  $('area-scale').textContent = ragaScale(r);
  $('area-akshara').textContent = area.akshara;
  $('area-name').textContent = area.name;
  $('area-kn').textContent = area.kn;
  $('f-metro').textContent = area.stations.length;
  $('np-area').textContent = area.name;
  $('board-title').textContent = `Just played in ${area.name}`.toUpperCase();
  document.title = `${area.name} · Ooru Raga`;
  updateMediaSession();
}

function buildPicker() {
  const featured = $('featured');
  for (const a of areas.list.filter((x) => x.featured)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card';
    b.dataset.area = a.id;
    b.style.setProperty('--card', a.colour);
    b.innerHTML = '<span class="g" lang="kn"></span><b></b><small></small>';
    b.querySelector('.g').textContent = a.akshara;
    b.querySelector('b').textContent = a.name;
    b.querySelector('small').textContent = RAGAS[a.raga].name;
    featured.append(b);
  }
  const regions = $('regions');
  for (const region of REGIONS) {
    const col = document.createElement('div');
    col.className = 'region';
    const h = document.createElement('h3');
    h.textContent = region;
    const ul = document.createElement('ul');
    for (const a of areas.list.filter((x) => x.region === region).sort((p, q) => p.name.localeCompare(q.name))) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.area = a.id;
      b.innerHTML = '<span class="chip-dot"></span><span class="chip-name"></span><span class="chip-kn" lang="kn"></span>';
      b.style.setProperty('--card', a.colour);
      b.querySelector('.chip-name').textContent = a.name;
      b.querySelector('.chip-kn').textContent = a.kn;
      li.append(b);
      ul.append(li);
    }
    col.append(h, ul);
    regions.append(col);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-area]');
    if (!b) return;
    selectArea(b.dataset.area, { fromUser: true });
    if (b.closest('.picker')) $('record').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function bindControls() {
  $('start').addEventListener('click', togglePlay);
  $('play').addEventListener('click', togglePlay);
  $('prev').addEventListener('click', () => stepArea(-1));
  $('next').addEventListener('click', () => stepArea(1));
  $('share').addEventListener('click', shareArea);
  bindMediaKeys();
  $('volume').addEventListener('input', (e) => music.setVolume(Number(e.target.value) / 100));
  for (const b of document.querySelectorAll('[data-style]')) b.addEventListener('click', () => setStyle(b.dataset.style, true));
  for (const t of document.querySelectorAll('[data-layer]')) {
    t.addEventListener('click', () => {
      const on = t.getAttribute('aria-pressed') !== 'true';
      t.setAttribute('aria-pressed', String(on));
      music.setLayer(t.dataset.layer, on);
    });
  }

  const canvas = $('record');
  const tip = $('tooltip');
  const where = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, r];
  };
  canvas.addEventListener('click', (e) => {
    const [x, y] = where(e);
    const a = record.areaAt(x, y);
    if (a) selectArea(a.id, { fromUser: true });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const [x, y, r] = where(e);
    const a = record.areaAt(x, y);
    canvas.style.cursor = a ? 'pointer' : 'default';
    if (!a) {
      tip.hidden = true;
      return;
    }
    const buses = feed.buses.size ? [...feed.buses.values()].filter((b) => b.area === a.index).length : 0;
    tip.innerHTML = '<b></b><span class="kn" lang="kn"></span><small></small>';
    tip.querySelector('b').textContent = a.name;
    tip.querySelector('.kn').textContent = a.kn;
    tip.querySelector('small').textContent = `Raga ${RAGAS[a.raga].name} · ${buses} buses · ${a.stations.length} metro stops`;
    tip.hidden = false;
    tip.style.left = `${Math.min(x + 16, r.width - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(y + 16, r.height - tip.offsetHeight - 8)}px`;
  });
  canvas.addEventListener('pointerleave', () => (tip.hidden = true));
}

function stepArea(d) {
  selectArea(areas.list[(area.index + d + areas.list.length) % areas.list.length].id, { fromUser: true });
}

/** Share a link straight to this area: the phone's share sheet, or copy the link. */
async function shareArea() {
  const url = `${location.origin}${location.pathname}#${area.id}`;
  const text = `Listen to ${area.name} on Ooru Raga: Bengaluru's buses and metro, played live as Carnatic music.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: `${area.name} · Ooru Raga`, text, url });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // they closed the share sheet
    }
  }
  const label = $('share-label');
  try {
    await navigator.clipboard.writeText(url);
    label.textContent = 'Link copied';
  } catch {
    const field = $('share-link');
    field.value = url;
    field.hidden = false;
    field.select();
    label.textContent = 'Copy this link';
  }
  clearTimeout(shareArea.timer);
  shareArea.timer = setTimeout(() => {
    label.textContent = 'Share';
    $('share-link').hidden = true;
  }, 4000);
}

/** Lock-screen and headphone controls on phones: play, pause, next and previous area. */
function bindMediaKeys() {
  if (!('mediaSession' in navigator)) return;
  const on = (action, fn) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      // this browser doesn't offer that button
    }
  };
  on('play', () => !music.playing && togglePlay());
  on('pause', () => music.playing && togglePlay());
  on('previoustrack', () => stepArea(-1));
  on('nexttrack', () => stepArea(1));
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !area || typeof MediaMetadata === 'undefined') return;
  const side = STYLES[music.style];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: `${area.name} · Raga ${RAGAS[area.raga].name}`,
    artist: 'Ooru Raga',
    album: `${side.side} · ${side.name}`,
    artwork: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
  navigator.mediaSession.playbackState = music.playing ? 'playing' : 'paused';
}

// Side A (Carnatic) or Side B (Carnatic jazz). Remembered in this browser only.
function savedStyle() {
  try {
    return localStorage.getItem(STYLE_KEY) || 'carnatic';
  } catch {
    return 'carnatic';
  }
}

function setStyle(style, fromUser = false) {
  const s = STYLES[style] ? style : 'carnatic';
  music.setStyle(s);
  record.setSide(STYLES[s]);
  document.documentElement.dataset.side = s;
  for (const b of document.querySelectorAll('[data-style]')) b.setAttribute('aria-pressed', String(b.dataset.style === s));
  $('rhythm-sub').textContent = STYLES[s].rhythm;
  $('np-side').textContent = `${STYLES[s].side} · ${STYLES[s].name}`;
  updateMediaSession();
  if (fromUser) {
    try {
      localStorage.setItem(STYLE_KEY, s);
    } catch {
      // private window or blocked storage: the choice just won't be remembered
    }
    if (!music.playing) togglePlay();
  }
}

async function togglePlay() {
  try {
    if (music.playing) music.pause();
    else await music.start();
  } catch (err) {
    console.error(err);
    setNowPlaying('Sound could not start', 'This browser blocked audio. Try tapping play again.');
    return;
  }
  $('start').hidden = true;
  const b = $('play');
  b.setAttribute('aria-pressed', String(music.playing));
  b.setAttribute('aria-label', music.playing ? 'Pause' : 'Play');
  metroUpTo = null;
  if (music.playing) feed.schedule();
  updateMediaSession();
}

// ------------------------------------------------------------ live buses

function onSnapshot({ pings, windowStart, windowEnd }) {
  for (const b of feed.buses.values()) {
    const a = areas.at(b.x, b.y);
    b.area = a ? a.index : -1;
  }
  record.setBuses([...feed.buses.values()]);
  record.setBusesFaded(feed.state !== 'live');
  // Replay the last window's pings over the next poll, in the order they happened.
  const now = performance.now();
  const span = Math.max(1, windowEnd - windowStart);
  const spread = Math.min(feed.interval, span * 1000);
  for (const b of pings) queue.push({ atPerf: now + 400 + ((b.ts - windowStart) / span) * spread, bus: b });
  queue.sort((p, q) => p.atPerf - q.atPerf);
  if (queue.length > 6000) queue.splice(0, queue.length - 6000);
  updateTraffic();
  lastUi = 0;
}

function updateTraffic() {
  if (!feed || !area) return;
  const speeds = [];
  let count = 0;
  for (const b of feed.buses.values()) {
    if (b.area !== area.index || feed.feedTime - b.ts > FRESH_FIX_S) continue;
    count++;
    if (b.speed != null) speeds.push(b.speed);
  }
  speeds.sort((p, q) => p - q);
  traffic = { speed: speeds.length >= 3 ? speeds[speeds.length >> 1] : null, samples: speeds.length, buses: count };
  if (feed.state === 'live') music.setTempo(tempoForSpeed(traffic.speed));
}

function playBus(item) {
  const b = item.bus;
  const [x0, y0, x1, y1] = area.box;
  const north = 1 - (b.y - y0) / (y1 - y0 || 1);
  const degree = Math.max(0, Math.min(BUS_DEGREES - 1, Math.round(north * (BUS_DEGREES - 1))));
  const pan = ((b.x - x0) / (x1 - x0 || 1)) * 1.6 - 0.8;
  const moving = !BusFeed.isStanding(b);
  const note = music.playBus({ moving, degree, eventPerf: item.atPerf, pan });
  const label = note ? note.label : music.busLabel(degree);
  const stop = nearestStop(b.x, b.y);
  const who = b.route ? `Route ${b.route}` : 'A bus';
  visuals.push({
    atPerf: note ? note.atPerf : item.atPerf,
    at: [b.x, b.y],
    colour: moving ? 'var(--ink)' : 'var(--sindoor)',
    label: `${stop} · ${label}`,
    row: { time: TIME(b.ts), who: b.route || 'BUS', where: stop, note: label, kind: moving ? 'bus' : 'stand' },
    title: moving ? `${who} near ${stop}` : `${who} standing near ${stop}`,
    sub: moving
      ? `${BUS_VOICES.moving.instrument} · ${label}${b.speed != null ? ` · ${Math.round(b.speed)} km/h` : ''}`
      : `${BUS_VOICES.standing.instrument} · ${label} · ${b.speed != null && b.speed > 0.5 ? `crawling at ${Math.round(b.speed)} km/h` : 'not moving'}`,
  });
}

/** A bus is due at a stop in the area, by BMTC's timetable (used while live buses are unavailable). */
function busArrival(simMs, i) {
  const stop = busTable.stops[busTable.stop[i]];
  const route = busTable.routes[busTable.route[i]];
  const waiting = busTable.end[i] === 1; // starting or ending its trip here: it waits at the stand
  const [x0, y0, x1, y1] = area.box;
  const [x, y] = stop.at;
  const north = 1 - (y - y0) / (y1 - y0 || 1);
  const degree = Math.max(0, Math.min(BUS_DEGREES - 1, Math.round(north * (BUS_DEGREES - 1))));
  const pan = ((x - x0) / (x1 - x0 || 1)) * 1.6 - 0.8;
  const eventPerf = performance.now() + (simMs - istNow());
  const note = music.playBus({ moving: !waiting, degree, eventPerf, pan });
  const label = note ? note.label : music.busLabel(degree);
  const who = route ? `Route ${route}` : 'A bus';
  const voice = waiting ? BUS_VOICES.standing : BUS_VOICES.moving;
  visuals.push({
    atPerf: note ? note.atPerf : eventPerf,
    at: stop.at,
    colour: waiting ? 'var(--sindoor)' : 'var(--ink)',
    label: `${stop.name} · ${label}`,
    row: { time: formatClock(simMs, false), who: route || 'BUS', where: stop.name, note: label, kind: waiting ? 'stand tt' : 'bus tt' },
    title: waiting ? `${who} waiting at ${stop.name}` : `${who} due at ${stop.name}`,
    sub: `${voice.instrument} · ${label} · from BMTC's timetable`,
  });
}

// ------------------------------------------------------------ metro

function metroArrival(simMs, trip, stopIdx) {
  const p = trip.p;
  const local = p.stops[stopIdx];
  const si = tt.lines[p.line].stations[local];
  if (!area.stationSet.has(si)) return;
  const station = tt.stations[si];
  const at = toKm(station.lat, station.lon);
  const [x0, , x1] = area.box;
  const eventPerf = performance.now() + (simMs - istNow());
  const note = music.playStation({
    line: p.line,
    local,
    eventPerf,
    pan: ((at[0] - x0) / (x1 - x0 || 1)) * 1.6 - 0.8,
    interchange: station.lines.length > 1,
  });
  const label = note ? note.label : music.labelFor(p.line, local);
  const line = tt.lines[p.line];
  visuals.push({
    atPerf: note ? note.atPerf : eventPerf,
    at,
    colour: `var(--line-${line.id.toLowerCase()})`,
    label: `${station.short} metro · ${label}`,
    row: { time: formatClock(simMs, false), who: line.id, where: `${station.short} metro`, note: label, kind: line.id.toLowerCase() },
    title: `${line.name} train at ${station.short}`,
    sub: `${LINE_VOICES[line.id].instrument} · ${label} · to ${tt.stations[p.towards].short}`,
  });
}

// ------------------------------------------------------------ the clock

// Ten times a second: hand arrivals to the music a moment ahead, so timing stays tight
// even when the tab is in the background.
function tick() {
  if (!area) return;
  const ahead = music.playing ? (document.hidden ? 1700 : 300) : 0;
  const horizon = istNow() + ahead;
  if (metroUpTo === null || horizon <= metroUpTo || horizon - metroUpTo > 10 * 60 * 1000) {
    metroUpTo = horizon;
  } else {
    const from = serviceMoment(metroUpTo);
    const to = serviceMoment(horizon);
    if (from.dateKey === to.dateKey) {
      tt.day(to).eachEvent(from.secs, to.secs, (t, trip, i) => metroArrival(to.dayStartMs + t * 1000, trip, i));
      if (timetableMode() && busTable) busTable.eachArrival(to.weekday, from.secs, to.secs, (i, t) => busArrival(to.dayStartMs + t * 1000, i));
    }
    metroUpTo = horizon;
  }
  if (timetableMode()) ensureBusTable();
  const until = performance.now() + ahead;
  while (queue.length && queue[0].atPerf <= until) {
    const item = queue.shift();
    if (item.bus.area === area.index) playBus(item);
  }
  music.tick();
}

function frame() {
  const now = performance.now();
  const ist = istNow();
  const m = serviceMoment(ist);
  const trains = tt.day(m).trainsAt(m.secs);

  for (let i = 0; i < visuals.length; ) {
    const v = visuals[i];
    if (v.atPerf > now) {
      i++;
      continue;
    }
    visuals.splice(i, 1);
    if (now - v.atPerf > 2500) continue; // skip a backlog from a hidden tab
    record.pulse(v.at, resolveColour(v.colour), v.label, now);
    board.unshift(v.row);
    if (board.length > BOARD_ROWS) board.pop();
    boardDirty = true;
    setNowPlaying(v.title, v.sub);
  }

  record.draw(trains, now);
  if (now - lastUi > 250) {
    lastUi = now;
    updateUi(ist, trains, now);
  }
  requestAnimationFrame(frame);
}

const colourCache = new Map();
function resolveColour(c) {
  if (!c.startsWith('var(')) return c;
  if (!colourCache.has(c)) colourCache.set(c, getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim());
  return colourCache.get(c);
}

function dayOf(sec) {
  const d = new Date(sec * 1000 + IST_OFFSET_MS);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function setNowPlaying(title, sub) {
  $('np-title').textContent = title;
  $('np-sub').textContent = sub;
}

function updateUi(ist, trains, now) {
  $('clock').textContent = formatClock(ist);
  $('m-trains').textContent = trains.length;
  $('m-buses').textContent = feed.buses.size ? feed.buses.size.toLocaleString('en-IN') : '–';

  const state = feed.state;
  const tableOn = timetableMode() && !!busTable;
  const since = feed.feedTime ? TIME(feed.feedTime) : '';
  const sinceText = feed.feedTime ? `${since} IST${dayOf(feed.feedTime) !== dayOf(ist / 1000 - IST_OFFSET_MS / 1000) ? ` on ${dayOf(feed.feedTime)}` : ''}` : '';
  const [main, sub, note] = tableOn
    ? state === 'paused'
      ? ['TIMETABLE', 'Live paused', `Buses are playing from BMTC's timetable. Live positions paused at ${since} IST.`]
      : ['TIMETABLE', 'Live unreachable', "Live buses can't be reached here, so buses play from BMTC's timetable."]
    : {
        loading: ['…', 'Buses', 'Finding live buses…'],
        live: ['LIVE', 'BMTC GPS', 'Live bus positions, a minute or two behind'],
        paused: ['PAUSED', `since ${since}`, `The live bus feed has paused since ${since} IST.`],
        sample: ['SAMPLE', since, `Live buses aren't reachable here, so these are buses from ${since} IST on ${dayOf(feed.feedTime)}.`],
        error: ['OFFLINE', 'Metro only', 'Bus positions could not be loaded. The metro plays on.'],
      }[state];
  $('sticker').dataset.state = tableOn ? 'timetable' : state;
  $('sticker-main').textContent = main;
  $('sticker-sub').textContent = sub;
  $('feed-note').textContent = note;
  $('legend-bus').textContent = state === 'live' ? 'Bus, live GPS' : 'Bus, last live position';
  record.setBusesFaded(state !== 'live');

  // The notice under the masthead says plainly why buses aren't live, and when it last checked.
  const notice = $('bus-notice');
  notice.hidden = state === 'live' || state === 'loading';
  if (!notice.hidden) {
    const checked = feed.checkedAt ? formatClock(feed.checkedAt + IST_OFFSET_MS) : '';
    if (state === 'paused') {
      const ago = Math.max(0, Date.now() / 1000 - feed.feedTime);
      const agoText = ago >= 3600 ? `${Math.floor(ago / 3600)} h ${Math.floor((ago % 3600) / 60)} min` : `${Math.max(1, Math.floor(ago / 60))} min`;
      $('bus-notice-title').textContent = 'Live buses are taking a break';
      $('bus-notice-text').textContent = `BMTC's live bus feed, which reaches us through reclaim.city, hasn't sent new positions since ${sinceText}. Until it's back, buses in every area play from BMTC's published timetable, so the music keeps going. The metro always follows its timetable. This page checks again every minute and switches back to live buses by itself.`;
      $('bus-notice-meta').textContent = `Last live update ${sinceText}, ${agoText} ago${checked ? ` · Last checked ${checked} IST` : ''}`;
    } else {
      $('bus-notice-title').textContent = "Live buses can't be reached from here";
      $('bus-notice-text').textContent = "This copy of the page can't reach BMTC's live bus feed, so buses in every area play from BMTC's published timetable. The metro always follows its timetable.";
      $('bus-notice-meta').textContent = checked ? `Last checked ${checked} IST` : '';
    }
  }

  const m = serviceMoment(ist);
  if (tableOn) {
    const due = busTable.dueThisHour(m.weekday, m.secs);
    music.setTempo(tempoForBusesDue(due));
    $('f-buses-label').textContent = 'Due / 10 min';
    $('f-buses').textContent = Math.round(due / 6);
  } else {
    $('f-buses-label').textContent = 'Buses now';
    $('f-buses').textContent = feed.buses.size ? traffic.buses : '–';
  }
  $('f-traffic').textContent = state === 'live' && traffic.speed != null ? `${Math.round(traffic.speed)}` : '–';
  $('f-pulse').textContent = music.tempo;

  if (state === 'live' && Number.isFinite(feed.nextPollAt)) {
    const left = Math.max(0, feed.nextPollAt - now);
    $('np-progress').style.width = `${Math.min(100, (1 - left / feed.interval) * 100)}%`;
    $('np-left').textContent = formatClock(feed.feedTime * 1000 + IST_OFFSET_MS);
    $('np-right').textContent = `next in ${Math.ceil(left / 1000)} s`;
  } else {
    $('np-progress').style.width = '100%';
    $('np-left').textContent = since || '--:--';
    $('np-right').textContent = tableOn ? 'timetable' : state === 'loading' ? 'loading' : state;
  }

  if (boardDirty) renderBoard();
}

function renderBoard() {
  boardDirty = false;
  const ol = $('board-rows');
  if (!board.length) {
    ol.innerHTML = '<li class="empty">Waiting for the next bus or train…</li>';
    return;
  }
  ol.replaceChildren(
    ...board.map((r) => {
      const li = document.createElement('li');
      li.className = r.kind;
      for (const [cls, text] of [['t', r.time], ['w', r.who], ['p', r.where.toUpperCase()], ['n', r.note]]) {
        const s = document.createElement('span');
        s.className = cls;
        s.textContent = text;
        li.append(s);
      }
      return li;
    }),
  );
}

init();
