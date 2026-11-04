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
 *     "workers": [
 *       { "id": "am1", "name": "Alex", "shift": "AM", "extra": true },
 *       ...
 *     ],
 *     "shifts": {
 *       "AM":  { "workers": 4, "extras": [true, false, false, false] },
 *       "PM":  { "workers": 3, "extras": [] },
 *       "NOC": { "workers": 2, "extras": [] }
 *     }
 *   }
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
export const WORKER_GROUPS = ['AM', 'PM', 'NOC', 'On Call'];
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

/**
 * Same rule as nextFlags in index.html: after a finalize, workers above the
 * fewest patients are flagged; once all are flagged a new round starts,
 * keeping only those who got a second extra in this finalize.
 */
export function nextFlags(flags, counts) {
  const n = counts.length;
  let f = Array.from({ length: n }, (_, i) => !!(flags && flags[i]));
  if (f.every(Boolean)) f = f.map(() => false);
  const min = Math.min(...counts);
  const got = counts.map((c) => c > min);
  const after = f.map((x, i) => x || got[i]);
  if (n && after.every(Boolean)) return f.map((x, i) => x && got[i]);
  return after;
}

/**
 * Updates per-worker `extra` status across the facility worker pool after a finalize.
 * Workers can fill in from any shift and retain or lose their `extra` status.
 */
export function nextWorkerExtras(workers, shift, assignedIds, counts) {
  if (!Array.isArray(workers) || !workers.length) return [];
  const out = workers.map((w) => ({ id: String(w.id), name: String(w.name), shift: w.shift, extra: !!w.extra }));
  const byId = new Map(out.map((w) => [w.id, w]));
  const ids = Array.isArray(assignedIds) ? assignedIds.slice(0, counts.length) : [];
  const active = ids.map((id) => byId.get(id)).filter(Boolean);
  if (active.length && active.every((w) => w.extra)) {
    active.forEach((w) => { w.extra = false; });
  }
  const hadBefore = new Set(out.filter((w) => w.extra).map((w) => w.id));
  const min = Math.min(...counts);
  const gotSecond = new Set();
  counts.forEach((c, i) => {
    if (c > min) {
      const w = byId.get(ids[i]);
      if (w) {
        if (hadBefore.has(w.id)) gotSecond.add(w.id);
        w.extra = true;
      }
    }
  });
  const shiftPool = out.filter((w) => w.shift === shift);
  if (shiftPool.length && shiftPool.every((w) => w.extra)) {
    shiftPool.forEach((w) => { w.extra = gotSecond.has(w.id); });
  }
  if (active.length && active.every((w) => w.extra)) {
    active.forEach((w) => { w.extra = gotSecond.has(w.id); });
  }
  return out;
}

const clampWorkers = (n) => Math.max(1, Math.min(MAX_WORKERS, Math.floor(Number(n)) || 1));

function cleanWorkers(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const w of list.slice(0, 300)) {
    if (!w || typeof w !== 'object') continue;
    const id = String(w.id || '').trim().slice(0, 40);
    const name = String(w.name || '').trim().slice(0, 40);
    const shift = WORKER_GROUPS.includes(w.shift) ? w.shift : 'AM';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, shift, extra: !!w.extra });
  }
  return out;
}

/** Keep only the fields we store, filling in shift defaults for older saves. */
export function cleanState(s) {
  const shifts = {};
  for (const name of SHIFTS) {
    const sh = (s.shifts && s.shifts[name]) || {};
    shifts[name] = {
      workers: clampWorkers(sh.workers ?? 4),
      extras: Array.isArray(sh.extras) ? sh.extras.slice(0, MAX_WORKERS).map(Boolean) : [],
    };
  }
  return {
    version: Number.isInteger(s.version) ? s.version : 0,
    updatedAt: s.updatedAt || null,
    rooms: s.rooms.map((r) => ({ room: r.room, beds: r.beds.map((b) => ({ label: b.label, occupied: b.occupied })) })),
    workers: cleanWorkers(s.workers),
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
 *   { op: "finalize", shift: "AM", counts: [13, 13, 12], workerIds: ["am1", ...] }
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
        s.shifts[o.shift].extras = nextFlags(s.shifts[o.shift].extras, o.counts);
        if (s.workers.length && Array.isArray(o.workerIds)) {
          s.workers = nextWorkerExtras(s.workers, o.shift, o.workerIds, o.counts);
        }
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
        // First save ever: start from the layout and workers the page sent.
        let current = await env.BEDS.get(KEY, 'json');
        if (!current) {
          if (!body.seed) return json({ error: 'nothing saved yet and no starting layout sent' }, 409);
          current = cleanState(validateState(body.seed));
        } else if (body.seed && Array.isArray(body.seed.workers) && body.seed.workers.length) {
          const savedExtra = new Map((current.workers || []).map((w) => [w.id, !!w.extra]));
          current.workers = cleanWorkers(body.seed.workers).map((w) => ({
            ...w,
            extra: savedExtra.has(w.id) ? savedExtra.get(w.id) : !!w.extra,
          }));
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
