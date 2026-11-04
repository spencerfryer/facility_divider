import test from 'node:test';
import assert from 'node:assert';
import worker, { applyOps, validateState, MAX_BEDS } from '../worker/worker.js';

const seed = () => ({ rooms: [
  { room: '1', beds: [{ label: 'A', occupied: true }, { label: 'B', occupied: true }] },
  { room: '2', beds: [{ label: 'A', occupied: true }, { label: 'B', occupied: true }, { label: 'C', occupied: false }] },
] });

function fakeEnv() {
  const store = new Map();
  return {
    PASSCODE: 'secret-code',
    BEDS: {
      async get(k, type) { const v = store.get(k); return v == null ? null : (type === 'json' ? JSON.parse(v) : v); },
      async put(k, v) { store.set(k, v); },
    },
  };
}
const call = (env, method, path, { body, code } = {}) => worker.fetch(new Request('https://w.example' + path, {
  method, body: body && JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Passcode': code } : {}) },
}), env);

test('applyOps toggles, adds and removes beds', () => {
  let s = applyOps(seed(), [{ op: 'setOccupied', room: '1', bed: 'B', occupied: false }, { op: 'addBed', room: '1' }]);
  assert.deepStrictEqual(s.rooms[0].beds, [{ label: 'A', occupied: true }, { label: 'B', occupied: false }, { label: 'C', occupied: true }]);
  s = applyOps(s, [{ op: 'removeBed', room: '2' }]);
  assert.strictEqual(s.rooms[1].beds.length, 2);
  s = applyOps(s, [{ op: 'setAll', occupied: true }]);
  assert.ok(s.rooms.every((r) => r.beds.every((b) => b.occupied)));
});

test(`rooms are limited to 1..${MAX_BEDS} beds`, () => {
  assert.throws(() => applyOps(seed(), [{ op: 'addBed', room: '2' }]), /already has 3 beds/);
  assert.throws(() => applyOps(seed(), [{ op: 'removeBed', room: '1' }, { op: 'removeBed', room: '1' }]), /at least one bed/);
  assert.throws(() => validateState({ rooms: [{ room: '1', beds: [] }] }), /1 to 3 beds/);
});

test('GET /state is empty until the first save', async () => {
  const env = fakeEnv();
  assert.strictEqual((await call(env, 'GET', '/state')).status, 404);
});

test('saving needs the passcode', async () => {
  const env = fakeEnv();
  assert.strictEqual((await call(env, 'POST', '/auth', { code: 'nope' })).status, 401);
  assert.strictEqual((await call(env, 'POST', '/auth', { code: 'secret-code' })).status, 204);
  const res = await call(env, 'POST', '/ops', { code: 'wrong', body: { seed: seed(), ops: [] } });
  assert.strictEqual(res.status, 401);
});

test('first save seeds from the page, later saves build on the stored state', async () => {
  const env = fakeEnv();
  let res = await call(env, 'POST', '/ops', { code: 'secret-code', body: { seed: seed(), ops: [{ op: 'addBed', room: '1' }] } });
  assert.strictEqual(res.status, 200);
  let s = await res.json();
  assert.strictEqual(s.version, 1);
  assert.strictEqual(s.rooms[0].beds.length, 3);
  // A different seed is ignored once something is saved.
  res = await call(env, 'POST', '/ops', { code: 'secret-code', body: { seed: { rooms: [{ room: 'X', beds: [{ label: 'A', occupied: true }] }] }, ops: [{ op: 'setOccupied', room: '2', bed: 'A', occupied: false }] } });
  s = await res.json();
  assert.strictEqual(s.version, 2);
  assert.strictEqual(s.rooms.length, 2);
  assert.strictEqual(s.rooms[1].beds[0].occupied, false);
  const got = await (await call(env, 'GET', '/state')).json();
  assert.deepStrictEqual(got, s);
});

test('bad changes are rejected without saving', async () => {
  const env = fakeEnv();
  await call(env, 'POST', '/ops', { code: 'secret-code', body: { seed: seed(), ops: [] } });
  const res = await call(env, 'POST', '/ops', { code: 'secret-code', body: { ops: [{ op: 'addBed', room: '99' }] } });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /no room 99/);
  assert.strictEqual((await (await call(env, 'GET', '/state')).json()).version, 1);
});

test('worker counts are saved per shift', () => {
  let s = applyOps(seed(), [{ op: 'setWorkers', shift: 'PM', workers: 3 }, { op: 'setWorkers', shift: 'NOC', workers: 99 }]);
  assert.strictEqual(s.shifts.AM.workers, 4);
  assert.strictEqual(s.shifts.PM.workers, 3);
  assert.strictEqual(s.shifts.NOC.workers, 50);
  assert.throws(() => applyOps(s, [{ op: 'setWorkers', shift: 'LATE', workers: 2 }]), /no shift LATE/);
});

test('finalize validates patient counts and does not store history', () => {
  const s = applyOps(seed(), [{ op: 'finalize', shift: 'AM', counts: [4, 3] }]);
  assert.strictEqual(s.shifts.AM.history, undefined);
  assert.throws(() => applyOps(s, [{ op: 'finalize', shift: 'AM', counts: [] }]), /patient counts/);
  assert.throws(() => applyOps(s, [{ op: 'finalize', shift: 'AM', counts: [1.5] }]), /patient counts/);
});

test('older saves without shifts still load', () => {
  const s = applyOps({ version: 3, rooms: seed().rooms }, []);
  assert.deepStrictEqual(Object.keys(s.shifts), ['AM', 'PM', 'NOC']);
  assert.strictEqual(s.version, 3);
});

test('finalize flags who got an extra patient, per shift', () => {
  let s = applyOps(seed(), [{ op: 'finalize', shift: 'AM', counts: [4, 3, 3] }]);
  assert.deepStrictEqual(s.shifts.AM.extras, [true, false, false]);
  assert.deepStrictEqual(s.shifts.PM.extras, []);
  s = applyOps(s, [{ op: 'finalize', shift: 'AM', counts: [3, 4, 4] }]);
  assert.deepStrictEqual(s.shifts.AM.extras, [false, false, false]); // everyone had one: new round
});

test('finalize updates per-worker extra flags in KV across shifts', () => {
  const initial = {
    ...seed(),
    workers: [
      { id: 'am1', name: 'Alex', shift: 'AM', extra: false },
      { id: 'am2', name: 'Bri', shift: 'AM', extra: false },
      { id: 'pm1', name: 'Jordan', shift: 'PM', extra: false },
    ],
  };
  const s = applyOps(initial, [
    { op: 'finalize', shift: 'AM', counts: [4, 3, 3], workerIds: ['pm1', 'am1', 'am2'] },
  ]);
  assert.deepStrictEqual(s.workers.map((w) => ({ id: w.id, extra: w.extra })), [
    { id: 'am1', extra: false },
    { id: 'am2', extra: false },
    { id: 'pm1', extra: true },
  ]);
});
