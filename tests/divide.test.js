const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The app is a single index.html; pull the splitting logic out of its <script id="divide-logic"> block.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = html.match(/<script id="divide-logic">([\s\S]*?)<\/script>/)[1];
const sandbox = { self: {} };
vm.runInNewContext(code, sandbox);
// Round-trip through JSON so arrays from the sandbox compare equal to local ones.
const wrap = (fn) => (...args) => JSON.parse(JSON.stringify(fn(...args)));
const { evenSizes, divideBeds, parseBedList } = Object.fromEntries(
  Object.entries(sandbox.self.Divider).map(([k, fn]) => [k, wrap(fn)]));

const beds = (spec) => spec.split('').map((c, i) => ({ id: String(i + 1), occupied: c === 'x' }));

test('evenSizes spreads remainder to the first groups', () => {
  assert.deepStrictEqual(evenSizes(10, 3), [4, 3, 3]);
  assert.deepStrictEqual(evenSizes(2, 4), [1, 1, 0, 0]);
  assert.deepStrictEqual(evenSizes(9, 3), [3, 3, 3]);
});

test('occupied beds split evenly and contiguously', () => {
  const r = divideBeds(beds('xxxxxxxxxx'), 3);
  assert.deepStrictEqual(r.groups.map((g) => g.occupied), [
    ['1', '2', '3', '4'], ['5', '6', '7'], ['8', '9', '10'],
  ]);
});

test('empty beds attach to the group whose span they sit in', () => {
  // beds: 1x 2. 3x 4x 5. 6x  -> 4 occupied, 2 staff
  const r = divideBeds(beds('x.xx.x'), 2);
  assert.deepStrictEqual(r.groups[0], { occupied: ['1', '3'], empty: ['2'] });
  assert.deepStrictEqual(r.groups[1], { occupied: ['4', '6'], empty: ['5'] });
});

test('leading empty beds go to the first group', () => {
  const r = divideBeds(beds('..xx'), 2);
  assert.deepStrictEqual(r.groups[0], { occupied: ['3'], empty: ['1', '2'] });
  assert.deepStrictEqual(r.groups[1], { occupied: ['4'], empty: [] });
});

test('every bed is assigned exactly once', () => {
  const b = beds('x..xxx.x.xx...xxxx.x');
  for (let n = 1; n <= 8; n++) {
    const r = divideBeds(b, n);
    const all = r.groups.flatMap((g) => [...g.occupied, ...g.empty]).sort((a, c) => a - c);
    assert.deepStrictEqual(all, b.map((x) => x.id));
    const sizes = r.groups.map((g) => g.occupied.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
  }
});

test('no occupied beds spreads empty beds evenly', () => {
  const r = divideBeds(beds('.....'), 2);
  assert.deepStrictEqual(r.groups.map((g) => g.empty), [['1', '2', '3'], ['4', '5']]);
});

test('zero staff assigns nothing', () => {
  const r = divideBeds(beds('x.x'), 0);
  assert.strictEqual(r.groups.length, 0);
});

test('parseBedList handles ranges, prefixes, and lists', () => {
  assert.deepStrictEqual(parseBedList('1-3'), ['1', '2', '3']);
  assert.deepStrictEqual(parseBedList('A1-A3, B1'), ['A1', 'A2', 'A3', 'B1']);
  assert.deepStrictEqual(parseBedList('101A\n101B\n102'), ['101A', '101B', '102']);
  assert.deepStrictEqual(parseBedList('01-03'), ['01', '02', '03']);
  assert.deepStrictEqual(parseBedList('1-2, 2, 3'), ['1', '2', '3']);
});

test('a room can be split: one worker ends on 29B, the next starts on 29C', () => {
  const b = [
    { id: '28A', occupied: true }, { id: '28B', occupied: true },
    { id: '29A', occupied: true }, { id: '29B', occupied: true }, { id: '29C', occupied: true },
    { id: '30A', occupied: false }, { id: '30B', occupied: true }, { id: '31A', occupied: true },
  ];
  const r = divideBeds(b, 2);
  assert.deepStrictEqual(r.groups.map((g) => g.occupied), [['28A', '28B', '29A', '29B'], ['29C', '30B', '31A']]);
  assert.deepStrictEqual(r.groups[1].empty, ['30A']);
});

const { parseLayout } = Object.fromEntries(
  Object.entries(sandbox.self.Divider).map(([k, fn]) => [k, wrap(fn)]));

test('parseLayout reads bed counts and custom labels', () => {
  assert.deepStrictEqual(parseLayout({ rooms: [{ room: 1, beds: 2 }, { room: '2', beds: 3 }, { room: '3', beds: ['A', 'W'] }] }), [
    { name: '1', beds: ['A', 'B'] }, { name: '2', beds: ['A', 'B', 'C'] }, { name: '3', beds: ['A', 'W'] },
  ]);
});

test('parseLayout gives plain-English errors', () => {
  assert.throws(() => parseLayout({}), /"rooms" list/);
  assert.throws(() => parseLayout({ rooms: [{ room: '1', beds: 2 }, { room: '1', beds: 2 }] }), /listed twice/);
  assert.throws(() => parseLayout({ rooms: [{ room: '1', beds: 'two' }] }), /should be a number/);
  assert.throws(() => parseLayout({ rooms: [{ beds: 2 }] }), /no "room" name/);
});

test('rooms.json is valid: 37 rooms, no room 13', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rooms.json'), 'utf8'));
  const rooms = parseLayout(data);
  assert.strictEqual(rooms.length, 37);
  assert.ok(!rooms.some((r) => r.name === '13'));
});

const { pickExtras, nextFlags, parseWorkers, workerRatio, nextWorkerExtras } = Object.fromEntries(
  Object.entries(sandbox.self.Divider).map(([k, fn]) => [k, wrap(fn)]));

test('workers.json is valid and parses into alphabetized AM, PM, NOC, On Call workers with unique ids', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workers.json'), 'utf8'));
  const pool = parseWorkers(data);
  assert.ok(Array.isArray(pool) && pool.length >= 4);
  for (const shift of ['AM', 'PM', 'NOC', 'On Call']) {
    const group = pool.filter((w) => w.shift === shift);
    assert.ok(group.length >= 1);
    assert.ok(group.every((w) => typeof w.id === 'string' && w.id && typeof w.name === 'string' && w.name && w.shiftsWorked === 0 && w.extraCount === 0));
    const names = group.map((w) => w.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepStrictEqual(names, sorted);
  }
});

test('nextWorkerExtras increments shiftsWorked for everyone and extraCount for extra patients', () => {
  let pool = [
    { id: 'am1', name: 'Alex', shift: 'AM', shiftsWorked: 0, extraCount: 0 },
    { id: 'am2', name: 'Bri', shift: 'AM', shiftsWorked: 0, extraCount: 0 },
    { id: 'am3', name: 'Casey', shift: 'AM', shiftsWorked: 0, extraCount: 0 },
    { id: 'pm1', name: 'Jordan', shift: 'PM', shiftsWorked: 0, extraCount: 0 },
  ];

  // Day 1 (AM): am1, am2, pm1 work; pm1 gets extra (3, 3, 4) -> am3 untouched
  pool = nextWorkerExtras(pool, 'AM', ['am1', 'am2', 'pm1'], [3, 3, 4]);
  assert.deepStrictEqual(pool.map((w) => [w.id, w.shiftsWorked, w.extraCount]), [
    ['am1', 1, 0],
    ['am2', 1, 0],
    ['am3', 0, 0],
    ['pm1', 1, 1],
  ]);

  // Day 2 (AM): am1, am2, am3 work; even split (4, 4, 4) -> shiftsWorked increments, no extraCount increments
  pool = nextWorkerExtras(pool, 'AM', ['am1', 'am2', 'am3'], [4, 4, 4]);
  assert.deepStrictEqual(pool.map((w) => [w.id, w.shiftsWorked, w.extraCount]), [
    ['am1', 2, 0],
    ['am2', 2, 0],
    ['am3', 1, 0],
    ['pm1', 1, 1],
  ]);
});

test('evenSizes uses worker extraCount/shiftsWorked ratio so lowest ratio gets next extras', () => {
  const pool = [
    { id: 'a', shiftsWorked: 4, extraCount: 2 }, // 50%
    { id: 'b', shiftsWorked: 5, extraCount: 1 }, // 20%
    { id: 'c', shiftsWorked: 4, extraCount: 0 }, // 0%
    { id: 'd', shiftsWorked: 4, extraCount: 1 }, // 25%
  ];
  const ratios = pool.map(workerRatio);
  assert.deepStrictEqual(evenSizes(13, 4, ratios), [3, 3, 4, 3]);
  assert.deepStrictEqual(evenSizes(14, 4, ratios), [3, 4, 4, 3]);

  // Unworked PRN fill-in (0/0 = 0%) vs seasoned staff with 25% gets 1 extra, then jumps to 100%
  let sim = [
    { id: 'ft1', name: 'A', shift: 'AM', shiftsWorked: 4, extraCount: 1 },
    { id: 'ft2', name: 'B', shift: 'AM', shiftsWorked: 4, extraCount: 1 },
    { id: 'prn', name: 'C', shift: 'On Call', shiftsWorked: 0, extraCount: 0 },
  ];
  const d1 = evenSizes(10, 3, sim.map(workerRatio));
  assert.deepStrictEqual(d1, [3, 3, 4]);
  sim = nextWorkerExtras(sim, 'AM', sim.map((w) => w.id), d1);
  // Next day prn has 1/1 = 100%, ft1 & ft2 have 1/5 = 20%, so ft1 gets it next
  const d2 = evenSizes(10, 3, sim.map(workerRatio));
  assert.deepStrictEqual(d2, [4, 3, 3]);
});

test('extras skip workers who already had one this round', () => {
  assert.deepStrictEqual(evenSizes(10, 3, [true, false, false]), [3, 4, 3]);
  assert.deepStrictEqual(evenSizes(11, 3, [true, false, false]), [3, 4, 4]);
  // More extras than unflagged workers: the rest go to flagged workers in order.
  assert.deepStrictEqual(evenSizes(11, 3, [true, true, false]), [4, 3, 4]);
  // Everyone flagged counts as a fresh round.
  assert.deepStrictEqual(evenSizes(10, 3, [true, true, true]), [4, 3, 3]);
  // Flags for a different worker count are cut or padded.
  assert.deepStrictEqual(pickExtras(1, 4, [true, true]), [false, false, true, false]);
});

test('extra patients rotate through every worker over several finalizes', () => {
  let flags = [];
  const got = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const sizes = evenSizes(13, 4, flags);          // one extra each time
    sizes.forEach((s, w) => { if (s === 4) got[w]++; });
    flags = nextFlags(flags, sizes);
  }
  assert.deepStrictEqual(got, [1, 1, 1, 1]);
});

test('nextFlags flags workers above the minimum and resets a full round', () => {
  assert.deepStrictEqual(nextFlags([], [4, 3, 3]), [true, false, false]);
  assert.deepStrictEqual(nextFlags([true, false, false], [3, 4, 4]), [false, false, false]);
  // The overflow extra (worker 1 had one already) carries into the next round.
  assert.deepStrictEqual(nextFlags([true, true, false], [4, 3, 4]), [true, false, false]);
  // Even split: nothing changes.
  assert.deepStrictEqual(nextFlags([true, false], [3, 3]), [true, false]);
});
