// -----------------------------------------------------------------------------
// cce66's feedback on his IPX800 V3 (forum t/11448 #14, firmware 3.05.69):
// the real `status.xml` he copied (test/fixtures, nothing personal in it),
// inputs `btn<n>` `dn` = connected (on), `up` = not; the 16 analog inputs; a
// faster pace for the inputs (ms, one request at a time, 1 s at least); the
// device names `IPX800V3-R1`; a range of relays to drive (`R1-R8`); `<day>`
// and `<time0>` (a wrong clock of the box) never read.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INPUTS_POLL_MS, TIMINGS } from '../src/constants.js';
import { isPendingAnswer, parseV3, parseXml, v3Codes } from '../src/ipx/model.js';
import { fakeIpx } from './helpers/fakeIpx.js';
import { CONFIG, F, SECOND, created, setup } from './helpers/app.js';

const CAPTURE = readFileSync(new URL('./fixtures/status-3.05.69.xml', import.meta.url), 'latin1');

/** The capture with the values of a state put in (led, btn, analog, anselect). */
function captureXml(state) {
  let xml = CAPTURE;
  const put = (name, i, value) => {
    if (value === undefined) return;
    xml = xml.replace(
      new RegExp(`<${name}${i}>[^<]*</${name}${i}>`),
      `<${name}${i}>${value}</${name}${i}>`,
    );
  };
  state.led.forEach((v, i) => put('led', i, v));
  state.btn.forEach((v, i) => put('btn', i, v));
  (state.analog16 ?? []).forEach((v, i) => put('analog', i, v));
  (state.anselect16 ?? []).forEach((v, i) => put('anselect', i, v));
  return xml;
}

/** A fake IPX800 V3 answering the capture as `status.xml` only (globalstatus.xml: 404). */
function captured() {
  const world = fakeIpx({ global: false, statusXml: captureXml });
  world.state.analog16 = Array(16).fill(undefined);
  world.state.anselect16 = Array(16).fill(undefined);
  return world;
}

const rounds = (world) => world.requests.filter((r) => /status\.xml/.test(r.path));

test('the capture of 3.05.69: 32 relays at 0, 32 inputs "up" = 0, 16 analog inputs without reading; day and time0 unread', () => {
  const parsed = parseXml(Buffer.from(CAPTURE, 'latin1'));
  assert.ok(parsed.fields, 'a status page of an IPX800 V3');
  assert.equal(isPendingAnswer(parsed.fields), false, 'no dnsstatus: a reading');
  assert.equal(parsed.fields.get('version'), '3.05.69');
  assert.equal(parsed.fields.get('time0'), '87:-109:07', 'there, as sent');
  const all = new Set([...v3Codes(new Set(), new Map())]);
  for (let n = 9; n <= 32; n += 1) all.add(`r${n}`).add(`d${n}`);
  const targets = parseV3(parsed.fields, all);
  for (let n = 1; n <= 32; n += 1) {
    assert.equal(targets.get(`r${n}`).value, 0, `R${n}`);
    assert.equal(targets.get(`d${n}`).value, 0, `D${n}: up = not connected`);
  }
  for (let n = 1; n <= 16; n += 1) {
    const a = targets.get(`a${n}`);
    assert.ok(a, `A${n} is on this IPX800`);
    assert.equal(a.value, undefined, `A${n}: raw 0, nothing wired, never 0`);
    assert.equal(a.sensor, undefined, 'type 0 (raw): not published');
    assert.equal(a.unhandled, false, 'type 0 is the default of an unused input: not named');
  }
  assert.equal(targets.size, 32 + 32 + 16, 'nothing from day, time0, count, tinfo');
  const dn = parseXml(CAPTURE.replace('<btn0>up</btn0>', '<btn0>dn</btn0>'));
  assert.equal(parseV3(dn.fields, ['d1']).get('d1').value, 1, 'dn = connected = 1');
});

test('the capture on the app: status.xml read, the names IPX800V3-R1 / -D1 / -A16, inputs published, dn then up', async () => {
  const world = captured();
  world.state.anselect16[15] = '2';
  world.state.analog16[15] = '222';
  const devices = [created('input', 'd1'), created('analog', 'a16', { sensor: 'temperature' })];
  const { app, gladys, start, wait } = await setup({ world, devices });
  await start();
  await app.flush();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(rounds(world).at(-1).path, '/status.xml');
  const names = new Map(gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]));
  assert.equal(names.get('ext:ipx:relay:r1'), 'IPX800V3-R1');
  assert.equal(names.get('ext:ipx:relay:r8'), 'IPX800V3-R8');
  assert.equal(names.get('ext:ipx:input:d8'), 'IPX800V3-D8');
  assert.equal(names.get('ext:ipx:analog:a16'), 'IPX800V3-A16', 'analog16: a TC4012 there');
  assert.ok(!names.has('ext:ipx:analog:a1'), 'a raw input (type 0): no device');
  assert.equal(gladys.fake.lastState(F('input', 'd1', 'state')), 0);
  assert.equal(gladys.fake.lastState(F('analog', 'a16', 'temperature')), 21.7);
  world.state.btn[0] = 'dn';
  await wait(10 * SECOND);
  await app.flush();
  assert.equal(gladys.fake.lastState(F('input', 'd1', 'state')), 1, 'connected');
  world.state.btn[0] = 'up';
  await wait(10 * SECOND);
  await app.flush();
  assert.equal(gladys.fake.lastState(F('input', 'd1', 'state')), 0, 'disconnected');
  app.stop();
});

test('a created device keeps its name; the IPX800 n >= 2 gets its number in the name', async () => {
  const device = { ...created('input', 'd1'), name: 'Porte garage' };
  const { app, gladys, start } = await setup({ devices: [device] });
  await start();
  const names = new Map(gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]));
  assert.equal(names.get('ext:ipx:input:d1'), 'Porte garage');
  assert.equal(names.get('ext:ipx:input:d2'), 'IPX800V3-D2');
  app.stop();
});

test('inputs_poll_ms: one round a second, never sooner, one request at a time; back to the interval when emptied', async () => {
  const world = captured();
  const config = { ...CONFIG, inputs_poll_ms: 1000 };
  const { app, gladys, start, wait } = await setup({ world, config });
  await start();
  const first = rounds(world).length;
  await wait(10 * SECOND);
  const reads = rounds(world).slice(first - 1);
  assert.ok(reads.length >= 10 && reads.length <= 11, `${reads.length} rounds in 10 s`);
  const gaps = reads.slice(1).map((r, i) => r.at - reads[i].at);
  assert.ok(
    gaps.every((g) => g >= INPUTS_POLL_MS.min - 1),
    `never sooner than 1 s: ${gaps.join(', ')}`,
  );
  assert.equal(world.peak, 1, 'one request to the IPX at a time');
  // A slow IPX (1.5 s an answer): the rounds wait for it, never two at once.
  world.latency = 1500;
  await wait(10 * SECOND);
  assert.equal(world.peak, 1);
  world.latency = 20;
  await gladys.fake.configUpdated({ ...CONFIG, inputs_poll_ms: '' });
  await wait(2 * SECOND);
  const settled = rounds(world).length;
  await wait(9 * SECOND);
  assert.ok(rounds(world).length - settled <= 1, 'back to one round per 10 s');
  app.stop();
});

test('inputs_poll_ms below 1000 ms is read as 1000 ms; above the poll interval, the interval wins', async () => {
  const fast = await setup({ world: captured(), config: { ...CONFIG, inputs_poll_ms: 50 } });
  await fast.start();
  const before = rounds(fast.world).length;
  await fast.wait(5 * SECOND);
  const n = rounds(fast.world).length - before;
  assert.ok(n >= 4 && n <= 6, `${n} rounds in 5 s at 50 ms asked`);
  fast.app.stop();
  const slow = await setup({
    world: captured(),
    config: { ...CONFIG, poll_interval: 5, inputs_poll_ms: 60_000 },
  });
  await slow.start();
  const at = rounds(slow.world).length;
  await slow.wait(20 * SECOND);
  assert.equal(rounds(slow.world).length - at, 4, 'every 5 s (the poll interval)');
  slow.app.stop();
});

test('fast rounds spare /data: nothing new, no write a second; a restart still waits the interval', async () => {
  const world = captured();
  const config = { ...CONFIG, inputs_poll_ms: 1000 };
  const { app, start, wait, store, clock } = await setup({ world, config });
  await start();
  const saves = store.saves;
  await wait(20 * SECOND);
  const written = store.saves - saves;
  assert.ok(written <= 20 / (TIMINGS.attemptSaveEvery / SECOND) + 1, `${written} saves in 20 s`);
  assert.ok(rounds(world).length >= 20);
  // Stopped right after a round whose attempt was not written (the last one went 1-4 s before).
  const count = rounds(world).length;
  for (let i = 0; i < 50 && rounds(world).length === count; i += 1) await wait(50);
  assert.ok(rounds(world).length > count, 'a round came');
  const last = rounds(world).at(-1).at;
  app.stop();
  const again = await setup({ store, clock, world: captured(), config });
  await again.start();
  await again.wait(TIMINGS.attemptSaveEvery + 2 * SECOND);
  const next = rounds(again.world)[0];
  assert.ok(next, 'and reads again');
  assert.ok(
    next.at - last >= INPUTS_POLL_MS.min,
    `a restart never reads sooner than the interval after the last read (${next.at - last} ms)`,
  );
  again.app.stop();
});

test('inputs_poll_ms typed while slow rounds wait: the faster pace at once, not after the old interval', async () => {
  const world = captured();
  const { app, gladys, start, wait } = await setup({
    world,
    config: { ...CONFIG, poll_interval: 60 },
  });
  await start();
  const before = rounds(world).length;
  await wait(2 * SECOND);
  await gladys.fake.configUpdated({ ...CONFIG, poll_interval: 60, inputs_poll_ms: 1000 });
  await wait(3 * SECOND);
  assert.ok(rounds(world).length - before >= 2, 'read within a second or so, not in a minute');
  app.stop();
});

test('fast rounds: a guard still goes to /data at once (a state that changed is written)', async () => {
  const devices = [created('relay', 'r1', { relayKind: 'switch' })];
  const world = captured();
  world.state.led[0] = 1;
  const config = { ...CONFIG, relays: 'R1', inputs_poll_ms: 1000 };
  const { app, gladys, start, wait, store, act } = await setup({ world, config, devices });
  await start();
  await wait(3 * SECOND);
  world.ignoreWrites = true;
  await act(gladys.fake.setValue(devices[0], devices[0].features[0], 0));
  await wait(500);
  assert.equal(store.data.guards.length, 1, 'the switch-off not applied is kept in /data');
  assert.equal(store.data.guards[0].code, 'r1');
  app.stop();
});

test('relays R1-R8 (a range): R8 driven, R9 still read only; switching R8 off goes, as any listed relay', async () => {
  const devices = [
    created('relay', 'r8', { relayKind: 'switch' }),
    created('relay', 'r9', { relayKind: 'switch' }),
  ];
  const world = captured();
  const config = { ...CONFIG, relays: 'R1-R8' };
  const { app, gladys, start, act } = await setup({ world, config, devices });
  await start();
  const on = await act(gladys.fake.setValue(devices[0], devices[0].features[0], 1));
  assert.equal(on.success, true, on.error);
  assert.equal(world.state.led[7], 1);
  const off = await act(gladys.fake.setValue(devices[0], devices[0].features[0], 0));
  assert.equal(off.success, true, off.error);
  assert.equal(world.state.led[7], 0);
  const r9 = await act(gladys.fake.setValue(devices[1], devices[1].features[0], 1));
  assert.equal(r9.success, false, 'R9 is not in R1-R8');
  assert.deepEqual(
    world.writes().map((r) => r.path),
    ['/preset.htm?set8=1', '/preset.htm?set8=0'],
  );
  const r1 = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:ipx:relay:r1');
  assert.deepEqual(
    r1.features.map((f) => f.external_id),
    [F('relay', 'r1', 'switch')],
  );
  app.stop();
});

test('fast rounds: what a round changes still goes to /data at once (the owner of a fresh install)', async () => {
  const config = { ...CONFIG, inputs_poll_ms: 1000 };
  const { app, start, store } = await setup({ world: captured(), config, fresh: true });
  await start();
  assert.ok(store.data?.owner?.id, 'the IPX800 read is the owner, on /data after the first round');
  app.stop();
});

test('fast rounds: a save still in flight is never taken for the state on /data', async () => {
  const config = { ...CONFIG, inputs_poll_ms: 1000 };
  const { app, start } = await setup({ world: captured(), config });
  await start();
  app.syncMemory();
  app.savedJson = JSON.stringify(app.memory);
  app.saving = { at: app.monotonic(), promise: new Promise(() => {}) };
  const asked = app.saveIfChanged();
  assert.equal(app.saveAgain, true, 'the state of now written after the save in flight');
  app.saving = undefined;
  app.stop();
  await Promise.race([asked, new Promise((resolve) => setImmediate(resolve))]);
});
