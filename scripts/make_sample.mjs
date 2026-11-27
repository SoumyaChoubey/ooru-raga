// Saves a snapshot of the live bus feed as data/sample-buses.json.
// The site falls back to it, clearly labelled with its time, when the live relay can't be reached
// (for example on GitHub Pages, which can't run the relay).
//
// Usage:  node scripts/make_sample.mjs                 (downloads the feed now)
//         node scripts/make_sample.mjs saved-feed.pb   (uses a saved copy)
import { readFile, writeFile } from 'node:fs/promises';
import { FEED_URL, decodeVehiclePositions, compactFeed } from '../lib/bus-feed.js';

const routes = JSON.parse(await readFile(new URL('../data/bmtc-routes.json', import.meta.url), 'utf8'));
const bytes = process.argv[2]
  ? new Uint8Array(await readFile(process.argv[2]))
  : new Uint8Array(await (await fetch(FEED_URL)).arrayBuffer());

const t0 = performance.now();
const feed = decodeVehiclePositions(bytes);
const compact = compactFeed(feed, routes, Math.floor(Date.now() / 1000));
const ms = (performance.now() - t0).toFixed(1);
compact.sample = true;
await writeFile(new URL('../data/sample-buses.json', import.meta.url), JSON.stringify(compact));
const when = new Date((feed.feedTime + 19800) * 1000).toISOString().replace('T', ' ').slice(0, 16);
console.log(`${feed.vehicles.length} vehicles decoded, ${compact.id.length} kept, ${compact.routes.length} routes, feed time ${when} IST, ${ms} ms`);
