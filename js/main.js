// main.js - connects the clock, the timetable, the music and the map, and runs the controls.
import { Timetable, serviceMoment, istNow, formatClock, formatServiceSecs } from './timetable.js';
import { Music, RAGAS, LINE_VOICES, autoRaga, ragaScale } from './music.js';
import { MetroMap } from './map.js';

const $ = (id) => document.getElementById(id);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LOG_LENGTH = 6;
const MORNING_RUSH_SECS = 8.75 * 3600;

// ------------------------------------------------------------ the simulation clock
// Normally this is just Bengaluru time. "Jump to" and the speed buttons move it.
const clock = { anchorPerf: performance.now(), anchorSim: istNow(), speed: 1 };
const simAt = (perf) => clock.anchorSim + (perf - clock.anchorPerf) * clock.speed;
const perfAt = (sim) => clock.anchorPerf + (sim - clock.anchorSim) / clock.speed;
const isLive = () => clock.speed === 1 && Math.abs(simAt(performance.now()) - istNow()) < 5000;

let tt;
let map;
let music;
let ragaChoice = 'auto';
let scheduledUpTo = null; // simulation time up to which arrivals have been handed to the music
let lastUi = 0;
let logDirty = true;
const pending = []; // arrivals waiting for their moment to light up on the map
const log = [];
const lastStation = [];

function setClock({ sim, speed } = {}) {
  const now = performance.now();
  const current = simAt(now);
  clock.anchorPerf = now;
  clock.anchorSim = sim ?? current;
  clock.speed = speed ?? clock.speed;
  scheduledUpTo = null;
  pending.length = 0;
  if (sim !== undefined) {
    // A jump: notes from the old time would be confusing in the list.
    log.length = 0;
    lastStation.length = 0;
    logDirty = true;
  }
  updateSpeedButtons();
  lastUi = 0;
}

// ------------------------------------------------------------ start-up
async function init() {
  let data;
  try {
    const res = await fetch('data/metro.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    showLoadError();
    console.error(err);
    return;
  }
  tt = new Timetable(data);
  music = new Music(tt.lines);
  map = new MetroMap($('map'), tt);

  buildLineButtons();
  buildRagaSelect();
  buildOrchestraTable();
  describeData();
  bindControls();
  document.fonts?.ready.then(() => {
    map.readColors();
    map.renderStatic();
  });

  setInterval(tick, 100);
  requestAnimationFrame(frame);
}

function showLoadError() {
  $('start-overlay').hidden = true;
  const box = document.createElement('div');
  box.className = 'load-error';
  box.innerHTML =
    '<p>The timetable did not load.</p><p>If you opened index.html straight from your computer, start a local web server instead (see the README).</p>';
  document.querySelector('.stage').append(box);
  $('status').textContent = 'Timetable not loaded';
}

const lineColorVar = (li) => `var(--line-${tt.lines[li].id.toLowerCase()})`;
const stationName = (si) => tt.stations[si].short;

function buildLineButtons() {
  const wrap = $('lines');
  tt.lines.forEach((line, li) => {
    const voice = LINE_VOICES[line.id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'line-btn';
    b.style.setProperty('--c', lineColorVar(li));
    b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<span class="swatch"></span>
      <span class="name"></span>
      <span class="meta"><b id="last-${li}">Waiting</b><span id="count-${li}">0 trains</span></span>`;
    b.querySelector('.name').append(line.name, Object.assign(document.createElement('span'), { className: 'inst', textContent: voice.instrument }));
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      music.setLineMuted(li, !on);
    });
    wrap.append(b);
  });
}

function buildRagaSelect() {
  const sel = $('raga');
  sel.append(new Option('Auto · changes with the time of day', 'auto'));
  for (const [key, r] of Object.entries(RAGAS)) sel.append(new Option(`${r.name} · ${ragaScale(r)}`, key));
  sel.value = ragaChoice;
}

function buildOrchestraTable() {
  const body = $('orchestra-rows');
  tt.lines.forEach((line, li) => {
    const tr = document.createElement('tr');
    const cells = [line.name, LINE_VOICES[line.id].instrument, stationName(line.stations[line.anchor]), String(line.stations.length)];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      if (i === 0) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.setProperty('--c', lineColorVar(li));
        td.append(dot);
      }
      td.append(text);
      tr.append(td);
    });
    body.append(tr);
  });
}

function describeData() {
  const fmt = (k) => `${Number(k.slice(6))} ${MONTHS[Number(k.slice(4, 6)) - 1]} ${k.slice(0, 4)}`;
  const { meta } = tt;
  $('data-version').textContent = `This copy of the timetable is valid from ${fmt(meta.validFrom)} to ${fmt(meta.validTo)} and covers the ${tt.lines
    .map((l) => l.name.replace(' Line', ''))
    .join(', ')
    .replace(/, ([^,]*)$/, ' and $1')} lines (${tt.stations.length} stations).`;
}

function bindControls() {
  $('start').addEventListener('click', togglePlay);
  $('play').addEventListener('click', togglePlay);

  $('speed').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-speed]');
    if (b) setClock({ speed: Number(b.dataset.speed) });
  });

  $('jump').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-time]');
    if (!b) return;
    if (b.dataset.time === 'now') return setClock({ sim: istNow(), speed: 1 });
    const [h, m] = b.dataset.time.split(':').map(Number);
    const today = serviceMoment(simAt(performance.now()));
    setClock({ sim: today.dayStartMs + (h * 3600 + m * 60) * 1000 });
  });

  $('resting-jump').addEventListener('click', () => {
    const m = serviceMoment(simAt(performance.now()));
    const day = tt.day(m);
    const nextDay = day.firstStart !== null && m.secs < day.firstStart ? 0 : 1;
    setClock({ sim: m.dayStartMs + nextDay * 86400000 + MORNING_RUSH_SECS * 1000 });
  });

  $('raga').addEventListener('change', (e) => {
    ragaChoice = e.target.value;
    applyRaga();
    lastUi = 0;
  });
  $('volume').addEventListener('input', (e) => music.setVolume(Number(e.target.value) / 100));
  $('drone').addEventListener('change', (e) => music.setDrone(e.target.checked));

  const canvas = $('map');
  let hideTimer;
  canvas.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && showTip(e));
  canvas.addEventListener('pointerleave', () => ($('tooltip').hidden = true));
  canvas.addEventListener('pointerdown', (e) => {
    showTip(e);
    clearTimeout(hideTimer);
    if (e.pointerType !== 'mouse') hideTimer = setTimeout(() => ($('tooltip').hidden = true), 3500);
  });
}

async function togglePlay() {
  try {
    if (music.playing) music.pause();
    else await music.start();
  } catch (err) {
    console.error(err);
    $('status').textContent = 'This browser could not start audio';
    return;
  }
  $('start-overlay').hidden = true;
  const b = $('play');
  b.setAttribute('aria-pressed', String(music.playing));
  b.setAttribute('aria-label', music.playing ? 'Pause' : 'Play');
  scheduledUpTo = null;
  lastUi = 0;
}

function updateSpeedButtons() {
  for (const b of $('speed').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === clock.speed));
}

function applyRaga() {
  const hour = new Date(simAt(performance.now())).getUTCHours();
  music.setRaga(ragaChoice === 'auto' ? autoRaga(hour) : ragaChoice);
}

// ------------------------------------------------------------ arrivals -> notes
// Runs ten times a second (it keeps going in a background tab, unlike drawing).
// While sound is on it looks a little ahead so notes can be scheduled precisely.
function tick() {
  const now = performance.now();
  const ahead = music.playing ? (document.hidden ? 1700 : 300) : 0;
  const horizon = simAt(now + ahead);
  if (scheduledUpTo === null || horizon <= scheduledUpTo || horizon - scheduledUpTo > 10 * 60 * 1000) {
    scheduledUpTo = horizon;
    return;
  }
  applyRaga();
  const from = serviceMoment(scheduledUpTo);
  const to = serviceMoment(horizon);
  scheduledUpTo = horizon;
  if (from.dateKey === to.dateKey) {
    tt.day(to).eachEvent(from.secs, to.secs, (t, trip, stopIdx) => arrival(to.dayStartMs + t * 1000, trip, stopIdx));
  }
  music.tick();
}

function arrival(simMs, trip, stopIdx) {
  const p = trip.p;
  const local = p.stops[stopIdx];
  const si = tt.lines[p.line].stations[local];
  const eventPerf = perfAt(simMs);
  const note = music.playStation({
    line: p.line,
    local,
    eventPerf,
    pan: map.panOf(si),
    interchange: tt.stations[si].lines.length > 1,
  });
  pending.push({
    atPerf: note ? note.atPerf : eventPerf,
    simMs,
    line: p.line,
    si,
    towards: p.towards,
    label: note ? note.label : music.labelFor(p.line, local),
  });
}

function fire(ev, now) {
  map.pulse(ev.si, ev.line, ev.label, now);
  lastStation[ev.line] = ev;
  log.unshift(ev);
  if (log.length > LOG_LENGTH) log.pop();
  logDirty = true;
}

// ------------------------------------------------------------ drawing
function frame() {
  const now = performance.now();
  const sim = simAt(now);
  const m = serviceMoment(sim);
  const day = tt.day(m);
  const trains = day.trainsAt(m.secs);

  for (let i = 0; i < pending.length; ) {
    const ev = pending[i];
    if (ev.atPerf <= now) {
      pending.splice(i, 1);
      if (now - ev.atPerf < 2500) fire(ev, now); // skip a backlog from a hidden tab
    } else i++;
  }

  map.draw(trains, now, music.muted);
  if (now - lastUi > 250) {
    lastUi = now;
    updateUi(sim, m, day, trains);
  }
  requestAnimationFrame(frame);
}

function updateUi(sim, m, day, trains) {
  const d = new Date(sim);
  $('clock').textContent = formatClock(sim);
  $('clock').dateTime = d.toISOString().slice(0, 19).replace('T', ' ');
  $('clock-day').textContent = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · IST`;

  const live = isLive();
  const pill = $('mode-pill');
  pill.dataset.mode = live ? 'live' : 'travel';
  $('mode-text').textContent = live ? 'Live' : clock.speed > 1 ? `${clock.speed}× speed` : 'Time travel';

  const counts = tt.lines.map(() => 0);
  for (const t of trains) counts[t.line]++;
  counts.forEach((n, li) => {
    $(`count-${li}`).textContent = `${n} train${n === 1 ? '' : 's'}`;
    const last = lastStation[li];
    $(`last-${li}`).textContent = last ? `${stationName(last.si)} · ${last.label}` : 'Waiting';
  });

  const n = trains.length;
  $('status').textContent = n ? `${n} trains running${music.playing ? '' : ' · sound off'}` : 'No trains running';
  $('raga-now').textContent = `Raga ${music.raga.name} · ${ragaScale(music.raga)}${ragaChoice === 'auto' ? ' · auto' : ''}`;

  const resting = $('resting');
  resting.hidden = n > 0;
  if (!n) {
    const before = day.firstStart !== null && m.secs < day.firstStart;
    $('resting-text').textContent = before
      ? `First trains on this timetable leave at ${formatServiceSecs(day.firstStart)}. The tanpura keeps playing until then.`
      : 'The last trains of the day have finished. Service starts again in the morning.';
  }

  if (logDirty) renderLog();
}

function renderLog() {
  logDirty = false;
  const ol = $('log');
  if (!log.length) {
    ol.innerHTML = '<li class="empty">Notes appear here as trains reach stations.</li>';
    return;
  }
  ol.replaceChildren(
    ...log.map((ev) => {
      const li = document.createElement('li');
      const time = document.createElement('time');
      time.textContent = formatClock(ev.simMs, false);
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.setProperty('--c', lineColorVar(ev.line));
      const where = document.createElement('span');
      where.className = 'where';
      const to = document.createElement('small');
      to.textContent = ev.si === ev.towards ? ' · end of the line' : ` to ${stationName(ev.towards)}`;
      where.append(stationName(ev.si), to);
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.textContent = ev.label;
      li.append(time, dot, where, sw);
      return li;
    }),
  );
}

function showTip(e) {
  const tip = $('tooltip');
  const r = $('map').getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const si = map.stationAt(x, y);
  if (si < 0) {
    tip.hidden = true;
    return;
  }
  const s = tt.stations[si];
  const title = document.createElement('strong');
  title.textContent = s.name;
  const kn = document.createElement('span');
  kn.className = 'kn';
  kn.lang = 'kn';
  kn.textContent = s.kn;
  const rows = s.lines.map((li) => {
    const row = document.createElement('div');
    row.className = 'tip-row';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${lineColorVar(li)}`;
    const note = document.createElement('b');
    note.textContent = music.labelFor(li, tt.lines[li].stations.indexOf(si));
    row.append(dot, `${LINE_VOICES[tt.lines[li].id].instrument}`, note);
    return row;
  });
  tip.replaceChildren(title, kn, ...rows);
  tip.hidden = false;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  tip.style.left = `${Math.min(Math.max(8, x + 14), r.width - w - 8)}px`;
  tip.style.top = `${y + 14 + h > r.height - 8 ? y - h - 12 : y + 14}px`;
}

init();
