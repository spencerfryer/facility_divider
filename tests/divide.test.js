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

const { divideRooms } = Object.fromEntries(
  Object.entries(sandbox.self.Divider).map(([k, fn]) => [k, wrap(fn)]));

// spec like "xx|x.|..|xxx" -> rooms 1..n with beds A,B,C
const rooms = (spec) => spec.split('|').map((r, i) => ({
  name: String(i + 1),
  beds: r.split('').map((c, j) => ({ id: `${i + 1}${'ABC'[j]}`, occupied: c === 'x' })),
}));

test('rooms are never split between staff', () => {
  const rs = rooms('xxx|xx|xxx|x.|xx.|xxx|..|x.x');
  for (let k = 1; k <= 6; k++) {
    const r = divideRooms(rs, k);
    const seen = r.groups.flatMap((g) => g.rooms);
    assert.deepStrictEqual(seen, rs.map((x) => x.name), `k=${k}`);
    r.groups.forEach((g) => {
      const ids = [...g.occupied, ...g.empty];
      g.rooms.forEach((name) => rs.find((x) => x.name === name).beds.forEach((b) => assert.ok(ids.includes(b.id))));
    });
  }
});

test('room split is as even as possible', () => {
  // loads 2,2,2,2,2,2 into 3 -> 4,4,4
  const r = divideRooms(rooms('xx|xx|xx|xx|xx|xx'), 3);
  assert.deepStrictEqual(r.groups.map((g) => g.occupied.length), [4, 4, 4]);
  // loads 3,3,2,2 into 2: best contiguous split is [3,3] [2,2] = 6/4
  const r2 = divideRooms(rooms('xxx|xxx|xx|xx'), 2);
  assert.deepStrictEqual(r2.groups.map((g) => g.occupied.length), [6, 4]);
});

test('empty rooms between blocks go to the earlier person', () => {
  const r = divideRooms(rooms('xx|..|xx'), 2);
  assert.deepStrictEqual(r.groups.map((g) => g.rooms), [['1', '2'], ['3']]);
});

test('no patients spreads rooms evenly', () => {
  const r = divideRooms(rooms('..|..|..|..|..'), 2);
  assert.deepStrictEqual(r.groups.map((g) => g.rooms), [['1', '2', '3'], ['4', '5']]);
});

test('38 rooms with 5 staff stays fast and balanced', () => {
  const spec = Array.from({ length: 38 }, (_, i) => (i % 3 === 0 ? 'xxx' : i % 5 === 0 ? 'x.' : 'xx')).join('|');
  const t = Date.now();
  const r = divideRooms(rooms(spec), 5);
  assert.ok(Date.now() - t < 500);
  const loads = r.groups.map((g) => g.occupied.length);
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 3, String(loads));
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
