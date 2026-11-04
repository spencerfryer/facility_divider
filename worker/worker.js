/**
 * Bed Divider shared-state Worker (Cloudflare Workers + KV).
 *
 * Stores one JSON document under the KV key "state":
 *   {
 *     "version": 12,                       // bumps on every save
 *     "updatedAt": "2026-11-04T03:55:00Z",
 *     "rooms": [
 *       { "room": "1", "beds": [ { "label": "A", "occupied": true },
 *                                { "label": "B", "occupied": false } ] },
 *       ...
 *     ],
 *     "shifts": {
 *       "AM":  { "workers": 4, "history": [
 *                  { "at": "2026-11-04T07:05:00Z", "counts": [13, 13, 12], "ranges": ["1A – 9A", ...] } ] },
 *       "PM":  { "workers": 3, "history": [] },
 *       "NOC": { "workers": 2, "history": [] }
 *     }
 *   }
 * So it holds the rooms, how many beds each room has, whether each bed is
 * occupied, and for each shift the number of workers plus the last
 * HISTORY_LENGTH finalized assignments (newest first).
 *
 * Routes:
 *   GET  /state   anyone: returns the saved state (404 if nothing saved yet)
 *   POST /auth    checks the passcode (204 if right, 401 if wrong)
 *   POST /ops     passcode required: applies a list of changes, returns the new state
 *
 * Bindings (set in the Cloudflare dashboard):
 *   BEDS      KV namespace
 *   PASSCODE  secret: the code staff type to make changes
 */

export const MAX_BEDS = 3;
export const SHIFTS = ['AM', 'PM', 'NOC'];
export const HISTORY_LENGTH = 7;
const MAX_WORKERS = 50;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const KEY = 'state';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Passcode',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}

/** Throws an Error with a readable message if `s` isn't a valid state. */
export function validateState(s) {
  if (!s || !Array.isArray(s.rooms)) throw new Error('state needs a "rooms" list');
  if (s.rooms.length < 1 || s.rooms.length > 500) throw new Error('between 1 and 500 rooms allowed');
  const names = new Set();
  for (const r of s.rooms) {
    if (!r || typeof r.room !== 'string' || !r.room.trim() || r.room.length > 20) throw new Error('each room needs a short "room" name');
    if (names.has(r.room)) throw new Error(`room ${r.room} is listed twice`);
    names.add(r.room);
    if (!Array.isArray(r.beds) || r.beds.length < 1 || r.beds.length > MAX_BEDS) throw new Error(`room ${r.room} must have 1 to ${MAX_BEDS} beds`);
    const labels = new Set();
    for (const b of r.beds) {
      if (!b || typeof b.label !== 'string' || !b.label || b.label.length > 10) throw new Error(`room ${r.room} has a bed without a label`);
      if (labels.has(b.label)) throw new Error(`room ${r.room} has two beds labelled ${b.label}`);
      labels.add(b.label);
      if (typeof b.occupied !== 'boolean') throw new Error(`bed ${r.room}${b.label} needs occupied true or false`);
    }
  }
  return s;
}

const clampWorkers = (n) => Math.max(1, Math.min(MAX_WORKERS, Math.floor(Number(n)) || 1));

/** Keep only the fields we store, filling in shift defaults for older saves. */
export function cleanState(s) {
  const shifts = {};
  for (const name of SHIFTS) {
    const sh = (s.shifts && s.shifts[name]) || {};
    shifts[name] = {
      workers: clampWorkers(sh.workers ?? 4),
      history: Array.isArray(sh.history) ? sh.history.slice(0, HISTORY_LENGTH).map((h) => ({
        at: String(h.at || ''),
        counts: Array.isArray(h.counts) ? h.counts.map((c) => Math.max(0, Math.floor(Number(c)) || 0)) : [],
        ranges: Array.isArray(h.ranges) ? h.ranges.map((r) => String(r).slice(0, 40)) : [],
      })) : [],
    };
  }
  return {
    version: Number.isInteger(s.version) ? s.version : 0,
    updatedAt: s.updatedAt || null,
    rooms: s.rooms.map((r) => ({ room: r.room, beds: r.beds.map((b) => ({ label: b.label, occupied: b.occupied })) })),
    shifts,
  };
}

/**
 * Apply changes to a state and return the new state. Ops:
 *   { op: "setOccupied", room: "12", bed: "A", occupied: false }
 *   { op: "addBed", room: "12" }       adds the next letter, up to MAX_BEDS; new bed starts occupied
 *   { op: "removeBed", room: "12" }    removes the room's last bed, keeps at least one
 *   { op: "setAll", occupied: true }   marks every bed occupied (or empty)
 *   { op: "setWorkers", shift: "AM", workers: 4 }
 *   { op: "finalize", shift: "AM", counts: [13, 13, 12], ranges: ["1A – 9A", ...] }
 *        records the patients per worker; keeps the newest HISTORY_LENGTH
 */
export function applyOps(state, ops) {
  if (!Array.isArray(ops) || ops.length > 200) throw new Error('"ops" must be a list of up to 200 changes');
  const s = cleanState(state);
  const findRoom = (name) => {
    const r = s.rooms.find((x) => x.room === String(name));
    if (!r) throw new Error(`no room ${name}`);
    return r;
  };
  for (const o of ops) {
    switch (o && o.op) {
      case 'setOccupied': {
        const b = findRoom(o.room).beds.find((x) => x.label === o.bed);
        if (!b) throw new Error(`no bed ${o.room}${o.bed}`);
        b.occupied = !!o.occupied;
        break;
      }
      case 'addBed': {
        const r = findRoom(o.room);
        if (r.beds.length >= MAX_BEDS) throw new Error(`room ${r.room} already has ${MAX_BEDS} beds`);
        const used = new Set(r.beds.map((b) => b.label));
        const label = [...LETTERS].find((l) => !used.has(l));
        r.beds.push({ label, occupied: true });
        break;
      }
      case 'removeBed': {
        const r = findRoom(o.room);
        if (r.beds.length <= 1) throw new Error(`room ${r.room} needs at least one bed`);
        r.beds.pop();
        break;
      }
      case 'setAll':
        s.rooms.forEach((r) => r.beds.forEach((b) => { b.occupied = !!o.occupied; }));
        break;
      case 'setWorkers': {
        if (!SHIFTS.includes(o.shift)) throw new Error(`no shift ${o.shift}`);
        s.shifts[o.shift].workers = clampWorkers(o.workers);
        break;
      }
      case 'finalize': {
        if (!SHIFTS.includes(o.shift)) throw new Error(`no shift ${o.shift}`);
        if (!Array.isArray(o.counts) || o.counts.length < 1 || o.counts.length > MAX_WORKERS
            || !o.counts.every((c) => Number.isInteger(c) && c >= 0 && c <= 10000)) {
          throw new Error('finalize needs a list of patient counts');
        }
        const ranges = Array.isArray(o.ranges) ? o.ranges.slice(0, o.counts.length).map((r) => String(r).slice(0, 40)) : [];
        const h = s.shifts[o.shift].history;
        h.unshift({ at: new Date().toISOString(), counts: o.counts, ranges });
        h.length = Math.min(h.length, HISTORY_LENGTH);
        break;
      }
      default:
        throw new Error(`unknown change "${o && o.op}"`);
    }
  }
  return s;
}

/** Constant-time string comparison so the passcode can't be guessed by timing. */
function sameCode(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/state' && request.method === 'GET') {
      const saved = await env.BEDS.get(KEY, 'json');
      return saved ? json(saved) : json({ error: 'nothing saved yet' }, 404);
    }

    const authorised = env.PASSCODE && sameCode(request.headers.get('X-Passcode'), env.PASSCODE);

    if (url.pathname === '/auth' && request.method === 'POST') {
      return authorised ? new Response(null, { status: 204, headers: CORS }) : json({ error: 'wrong passcode' }, 401);
    }

    if (url.pathname === '/ops' && request.method === 'POST') {
      if (!authorised) return json({ error: 'wrong passcode' }, 401);
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'body must be JSON' }, 400); }
      try {
        // First save ever: start from the layout the page sent (from rooms.json).
        let current = await env.BEDS.get(KEY, 'json');
        if (!current) {
          if (!body.seed) return json({ error: 'nothing saved yet and no starting layout sent' }, 409);
          current = cleanState(validateState(body.seed));
        }
        const next = validateState(applyOps(current, body.ops));
        next.version = (current.version || 0) + 1;
        next.updatedAt = new Date().toISOString();
        await env.BEDS.put(KEY, JSON.stringify(next));
        return json(next);
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }

    return json({ error: 'not found' }, 404);
  },
};
