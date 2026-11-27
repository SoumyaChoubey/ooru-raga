// GET /api/buses - the live BMTC bus relay (a Cloudflare Pages Function).
//
// Why it exists: thousands of listeners must not each download the 500 KB feed from
// reclaim.city. This fetches it at most once every 20 seconds per Cloudflare server, shrinks it
// to about 45 KB, and hands the same copy to everyone. More listeners do not mean more load
// on the bus feed.
//
// If the feed is down, it keeps serving the last good copy, marked with how old it is.
// BUS_FEED_URL (optional environment variable) points it at another copy of the feed, for testing.
import { FEED_URL, decodeVehiclePositions, compactFeed } from '../../lib/bus-feed.js';
import ROUTES from '../../data/bmtc-routes.json';

const REFRESH_MS = 20_000; // fetch upstream at most this often
const CACHE_KEY = 'https://ooru-raga.internal/api/buses/v2';

let memo = null; // { body, at } kept in this server's memory between requests
let inflight = null; // one upstream fetch at a time, shared by everyone waiting

async function refresh(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'ooru-raga-relay (+https://github.com/)' },
    cf: { cacheTtl: 10, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Bus feed answered ${res.status}`);
  const feed = decodeVehiclePositions(new Uint8Array(await res.arrayBuffer()));
  if (!feed.vehicles.length) throw new Error('Bus feed was empty');
  const body = JSON.stringify(compactFeed(feed, ROUTES, Math.floor(Date.now() / 1000)));
  memo = { body, at: Date.now() };
  return memo;
}

function reply(entry, source) {
  return new Response(entry.body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=15',
      'x-relay-source': source,
      'x-relay-age': String(Math.round((Date.now() - entry.at) / 1000)),
    },
  });
}

export async function onRequestGet({ env, waitUntil }) {
  if (memo && Date.now() - memo.at < REFRESH_MS) return reply(memo, 'memory');

  // Other copies of this function in the same data centre may have fetched it recently.
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(CACHE_KEY).catch(() => null);
    const at = Number(hit?.headers.get('x-fetched-at'));
    if (hit && Date.now() - at < REFRESH_MS) {
      memo = { body: await hit.text(), at };
      return reply(memo, 'cache');
    }
  }

  try {
    inflight ??= refresh(env.BUS_FEED_URL || FEED_URL).finally(() => (inflight = null));
    const fresh = await inflight;
    if (cache) {
      const stored = new Response(fresh.body, {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', 'x-fetched-at': String(fresh.at) },
      });
      waitUntil(cache.put(CACHE_KEY, stored).catch(() => {}));
    }
    return reply(fresh, 'upstream');
  } catch (err) {
    if (memo) return reply(memo, 'stale');
    return new Response(JSON.stringify({ error: 'The live bus feed could not be reached.', detail: String(err.message || err) }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}
