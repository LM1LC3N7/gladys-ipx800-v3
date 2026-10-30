// -----------------------------------------------------------------------------
// End to end: the app against the SDK's fake Gladys, a fake IPX800 V3 and a
// virtual clock whose reads always move.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMINGS } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { PASSWORD, USER, fakeIpx } from './helpers/fakeIpx.js';
import { ADDRESS, CONFIG, F, PROTECTED, SECOND, created, settle, setup } from './helpers/app.js';

const rounds = (world) => world.requests.filter((r) => /status\.xml/.test(r.path));
const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const led = (world, n) => world.state.led[n - 1];

const withRelays = (relays = 'R1, R2:light, R3, R4, R5', over = {}) => ({
  ...CONFIG,
  relays,
  ...over,
});

// --- Reads ----------------------------------------------------------------------

test('start: one globalstatus.xml at once, the targets discovered, connected; nothing secret in /data', async () => {
  const world = fakeIpx({ user: USER, password: PASSWORD });
  const { app, gladys, start, store } = await setup({
    world,
    config: { ...PROTECTED, extensions: 'R9-R16, D9-D10' },
  });
  await start();
  assert.equal(rounds(world).length, 1);
  assert.equal(world.requests[0].path, '/globalstatus.xml');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys), /IPX800 V3: 16 relay\(s\), 10 input\(s\), 2 analog sensor\(s\)/);
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(ids.includes('ext:ipx:relay:r16'));
  assert.ok(ids.includes('ext:ipx:input:d10'));
  assert.ok(ids.includes('ext:ipx:analog:a1') && ids.includes('ext:ipx:analog:a2'));
  assert.ok(!ids.includes('ext:ipx:analog:a3'), 'an analog input of type 0: no device');
  assert.ok(!ids.includes('ext:ipx:relay:r17'));
  const relay = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:ipx:relay:r1');
  assert.equal(relay.features.length, 1);
  assert.equal(relay.features[0].external_id, F('relay', 'r1', 'readonly'));
  assert.equal(relay.features[0].read_only, true, 'a relay not declared is read only');
  const json = JSON.stringify(store.data);
  assert.doesNotMatch(json, new RegExp(PASSWORD));
  assert.doesNotMatch(json, /admin/);
  assert.doesNotMatch(json, /192\.168/);
  assert.equal(gladys.fake.states.length, 0, 'no state before a device is created');
  app.stop();
});

test('values published: relays, inputs (dn = on), analog temperature and humidity', async () => {
  const devices = [
    created('relay', 'r1'),
    created('input', 'd2'),
    created('analog', 'a1', { sensor: 'temperature' }),
    created('analog', 'a2', { sensor: 'humidity' }),
  ];
  const world = fakeIpx();
  world.state.led[0] = 1;
  world.state.btn[1] = 'dn';
  const { app, gladys, start } = await setup({ world, devices });
  await start();
  await app.flush();
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'readonly')), 1);
  assert.equal(gladys.fake.lastState(F('input', 'd2', 'state')), 1);
  assert.equal(gladys.fake.lastState(F('analog', 'a1', 'temperature')), 21.7);
  assert.equal(gladys.fake.lastState(F('analog', 'a2', 'humidity')), 53.8);
  app.stop();
});

test('globalstatus.xml missing: status.xml read, and the rounds stay on it', async () => {
  const world = fakeIpx({ global: false });
  const { app, gladys, start, wait } = await setup({ world });
  await start();
  await wait(10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(
    world.requests.map((r) => r.path),
    ['/globalstatus.xml', '/status.xml', '/status.xml'],
  );
  app.stop();
});

test('pace: never two rounds within the interval, whatever asks; restart keeps the pace', async () => {
  const { app, gladys, start, wait, world, store, clock } = await setup();
  await start();
  assert.equal(rounds(world).length, 1);
  await gladys.fake.scanRequest();
  await gladys.fake.configUpdated({ ...CONFIG, language: 'en' });
  await app.testConnection();
  await app.connected(CONFIG);
  await wait(5 * SECOND);
  assert.equal(rounds(world).length, 1, 'nothing before the interval');
  await wait(5 * SECOND);
  assert.equal(rounds(world).length, 2);
  await wait(60 * SECOND);
  assert.equal(rounds(world).length, 8);
  app.stop();
  const again = await setup({ store, clock });
  await again.start();
  assert.equal(rounds(again.world).length, 0, 'read less than an interval ago');
  await again.wait(10 * SECOND);
  assert.equal(rounds(again.world).length, 1);
  again.app.stop();
});

test('a text, a missing element or an unhandled sensor is never published as 0', async () => {
  const devices = [
    created('analog', 'a1', { sensor: 'temperature' }),
    created('analog', 'a2', { sensor: 'humidity' }),
    created('input', 'd1'),
    created('relay', 'r1'),
  ];
  const world = fakeIpx();
  world.state.analog[0] = 'n/a';
  world.state.anselect[1] = '3';
  world.state.btn[0] = '';
  world.state.led[0] = 'on';
  const { app, gladys, start } = await setup({ world, devices });
  await start();
  await app.flush();
  const ids = gladys.fake.states.map((s) => s.device_feature_external_id);
  assert.ok(!ids.includes(F('analog', 'a1', 'temperature')));
  assert.ok(!ids.includes(F('analog', 'a2', 'humidity')), 'a type changed to light: not humidity');
  assert.ok(!ids.includes(F('input', 'd1', 'state')));
  assert.ok(!ids.includes(F('relay', 'r1', 'readonly')));
  assert.match(message(gladys), /sensor type not handled yet.*A2/);
  app.stop();
});

test('not an IPX800 V3 (404 on both pages, or another answer): a failure that says so, nothing published', async () => {
  const world = fakeIpx();
  world.queue.push({ status: 404, body: 'Not found' }, { status: 404, body: 'Not found' });
  const { app, gladys, start, wait } = await setup({ world });
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys), /is it an IPX800 V3/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  world.queue.push({ status: 200, body: '{"product":"IPX800_V4","status":"Success"}' });
  await wait(10 * SECOND);
  assert.match(message(gladys), /not an IPX800 V3 answer/);
  app.stop();
});

test('a failed round pauses (kept in /data); refused credentials stop the reads until they change', async () => {
  const world = fakeIpx();
  const { app, gladys, start, wait, store } = await setup({ world });
  world.queue.push(new Error('boom'));
  world.queue.push({ status: 503, body: '' });
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  await wait(10 * SECOND);
  assert.match(message(gladys), /asks to wait/);
  assert.equal(store.data.pause.code, 'busy');
  const before = world.requests.length;
  await wait(59 * SECOND);
  assert.ok(world.requests.length - before <= 1, 'a minute at least when the IPX asks to wait');
  app.stop();

  const refused = await setup({
    world: fakeIpx({ user: USER, password: PASSWORD }),
    config: { ...PROTECTED, password: 'wrong-pass' },
  });
  await refused.start();
  assert.match(message(refused.gladys), /refused the user or the password/);
  assert.ok(refused.store.data.refused);
  assert.doesNotMatch(JSON.stringify(refused.store.data), /wrong-pass/);
  const count = refused.world.requests.length;
  await refused.wait(10 * 60 * SECOND);
  assert.equal(refused.world.requests.length, count, 'no read by itself');
  await refused.gladys.fake.configUpdated(PROTECTED);
  await refused.wait(100);
  assert.equal(refused.gladys.fake.connectionStatus.connected, true, 'new credentials read again');
  refused.app.stop();
});

test('an IPX800 that protects its pages, no credentials typed: refused, said so', async () => {
  const { app, gladys, start } = await setup({
    world: fakeIpx({ user: USER, password: PASSWORD }),
  });
  await start();
  assert.match(message(gladys), /or asks for them/);
  app.stop();
});

test('a password without a user, or the reverse: said, nothing read', async () => {
  for (const [config, text] of [
    [{ host: ADDRESS, password: 'p' }, /A password without a user/],
    [{ host: ADDRESS, username: 'u' }, /A user without a password/],
    [{ host: ADDRESS, username: 'a:b', password: 'p' }, /The user is not valid/],
  ]) {
    const { app, gladys, start, world } = await setup({ config });
    await start();
    assert.match(message(gladys), text);
    assert.equal(world.requests.length, 0);
    app.stop();
  }
});

test('getConfig failing in "connected" is tried again with a status, then the integration starts', async () => {
  let calls = 0;
  const { app, gladys, wait, world } = await setup({
    getConfig: async () => {
      calls += 1;
      if (calls === 1) throw new Error('Gladys busy');
      return CONFIG;
    },
  });
  await app.onConnected(() => gladys.getConfig());
  assert.match(message(gladys), /could not be read from Gladys: new try in 5 s/);
  assert.equal(world.requests.length, 0);
  await wait(6 * SECOND);
  assert.equal(calls, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(rounds(world).length, 1);
  // A reconnection to Gladys reads the configuration again, without a new round.
  await app.onConnected(() => gladys.getConfig());
  await wait(100);
  assert.equal(rounds(world).length, 1);
  app.stop();
});

// --- Commands --------------------------------------------------------------------

test('a relay not declared is read only: refused, nothing sent, whatever its feature', async () => {
  const device = created('relay', 'r6', { relayKind: 'switch' });
  const { app, start, cmd, world } = await setup({ config: withRelays(), devices: [device] });
  await start();
  const ack = await cmd(device, F('relay', 'r6', 'switch'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /lecture seule/);
  const off = await cmd(device, F('relay', 'r6', 'switch'), 0);
  assert.match(off.error, /lecture seule/, 'even a switch-off of an undeclared relay');
  const input = created('input', 'd1');
  const pressed = await cmd(input, F('input', 'd1', 'state'), 1);
  assert.match(pressed.error, /lecture seule/);
  assert.equal(world.writes().length, 0);
  app.stop();
});

test('a declared relay: on and off written, confirmed by a read back that left after the write', async () => {
  const device = created('relay', 'r2', { relayKind: 'light' });
  const world = fakeIpx({ user: USER, password: PASSWORD });
  const { app, start, cmd, gladys } = await setup({
    config: withRelays('R1, R2:light', { username: USER, password: PASSWORD }),
    devices: [device],
    world,
  });
  await start();
  const on = await cmd(device, F('relay', 'r2', 'light'), 1);
  assert.equal(on.success, true, on.error);
  assert.equal(led(world, 2), 1);
  const writes = world.writes();
  assert.equal(writes[0].path, '/preset.htm?set2=1');
  assert.ok(writes[0].authorization, 'the credentials go with the write too');
  const readBack = world.requests.at(-1);
  assert.match(readBack.path, /status\.xml/);
  assert.ok(readBack.sentAt > writes[0].end, 'the read back left after the answer of the write');
  await app.flush();
  assert.equal(gladys.fake.lastState(F('relay', 'r2', 'light')), 1);
  const off = await cmd(device, F('relay', 'r2', 'light'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(world.writes()[1].path, '/preset.htm?set2=0');
  const bad = await cmd(device, F('relay', 'r2', 'light'), 2);
  assert.match(bad.error, /pas valide/);
  assert.equal(world.writes().length, 2);
  app.stop();
});

test('a read back equal to the state before is "not applied yet"; a lost answer is "sent, without confirmation"', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeIpx();
  const { app, start, cmd } = await setup({ config: withRelays(), devices: [device], world });
  await start();
  world.ignoreWrites = true;
  const ack = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(ack.error, /lit éteint \(demandé : allumé\) : pas encore appliquée/);
  world.ignoreWrites = false;
  world.latency = (r) => (/preset/.test(r.path) ? 10 * SECOND : 20);
  const lost = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(lost.error, /Envoyée, sans confirmation/);
  world.latency = 20;
  world.refuseConnect = 1;
  const refused = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(refused.error, /rien n’a été envoyé/, 'refused before leaving: not sent');
  app.stop();
});

test('a scene on 5 slow relays (700 ms a request) sets the 5', async () => {
  const devices = [1, 2, 3, 4, 5].map((n) => created('relay', `r${n}`, { relayKind: 'switch' }));
  const world = fakeIpx();
  const { app, start, act, gladys } = await setup({ config: withRelays(), devices, world });
  await start();
  world.latency = 700;
  const acks = await act(
    Promise.all(devices.map((d) => gladys.fake.setValue(d, d.features[0], 1))),
  );
  for (const ack of acks) assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.state.led.slice(0, 5), [1, 1, 1, 1, 1]);
  assert.equal(world.peak, 1);
  app.stop();
});

test('a scene with one relay answering 503 sets the others', async () => {
  const devices = [1, 2, 3].map((n) => created('relay', `r${n}`, { relayKind: 'switch' }));
  const world = fakeIpx();
  const { app, start, act, gladys } = await setup({ config: withRelays(), devices, world });
  await start();
  // The answers queued go one per request, in order: the writes first (one lane).
  const fail = (r) => (r.path === '/preset.htm?set2=1' ? { status: 503, body: '' } : undefined);
  world.queue.push(fail, fail);
  const acks = await act(
    Promise.all(devices.map((d) => gladys.fake.setValue(d, d.features[0], 1))),
  );
  assert.equal(acks[0].success, true, acks[0].error);
  assert.match(acks[1].error, /répondu une erreur/);
  assert.equal(acks[2].success, true, acks[2].error);
  assert.deepEqual(world.state.led.slice(0, 3), [1, 0, 1]);
  app.stop();
});

// --- The switch-off (protective) ---------------------------------------------------

test('the switch-off goes during a pause, with the queue full, and cuts a slow read', async () => {
  const relays = [1, 2, 3, 4, 5].map((n) => created('relay', `r${n}`, { relayKind: 'switch' }));
  const stopper = created('relay', 'r6', { relayKind: 'switch' });
  const world = fakeIpx();
  world.state.led[5] = 1;
  const { app, start, cmd, act, gladys, wait, elapsed } = await setup({
    config: withRelays('R1, R2, R3, R4, R5, R6'),
    devices: [stopper, ...relays],
    world,
  });
  await start();
  // A slow read in flight (4 s): the switch-off cuts it, leaves at once, the read is no failure.
  world.latency = (r) => (/status\.xml/.test(r.path) && !world.fast ? 4 * SECOND : 20);
  await wait(10 * SECOND);
  assert.equal(world.inFlight, 1, 'a read in flight');
  const t0 = elapsed();
  world.fast = true;
  const off = await cmd(stopper, F('relay', 'r6', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  const write = world.writes()[0];
  assert.ok(write.sentAt - t0 < 50, `the switch-off left ${write.sentAt - t0} ms after the click`);
  assert.equal(world.peak, 1, 'the read was closed before the switch-off opened its connection');
  assert.equal(gladys.fake.connectionStatus.connected, true, 'a cut read is not a failure');
  assert.equal(app.pause, undefined);
  // A pause: the IPX failing its reads.
  world.state.led[5] = 1;
  world.failReads = 500;
  await wait(10 * SECOND);
  assert.ok(app.pause, 'paused');
  const on = await cmd(relays[0], F('relay', 'r1', 'switch'), 1);
  assert.match(on.error, /ne répond pas/, 'a switch-on is refused during the pause');
  const off2 = await cmd(stopper, F('relay', 'r6', 'switch'), 0);
  assert.match(off2.error, /Envoyée/, 'sent (its read back failed with the reads)');
  assert.equal(led(world, 6), 0);
  world.failReads = undefined;
  // The queue full of slow commands.
  world.state.led[5] = 1;
  app.pause = undefined;
  world.latency = 2 * SECOND;
  const many = [];
  for (let i = 0; i < 20; i += 1) {
    many.push(gladys.fake.setValue(relays[i % 5], relays[i % 5].features[0], 1));
  }
  const stop = gladys.fake.setValue(stopper, stopper.features[0], 0);
  const acks = await act(Promise.all([...many, stop]));
  assert.ok(
    acks.slice(0, 20).some((a) => /Trop de commandes/.test(a.error ?? '')),
    'the queue was full',
  );
  assert.equal(acks[20].success, true, acks[20].error);
  assert.equal(led(world, 6), 0);
  app.stop();
});

test('refused credentials: the switch-off is still tried', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeIpx({ user: USER, password: 'another' });
  const { app, start, cmd } = await setup({
    config: withRelays('R1', { username: USER, password: PASSWORD }),
    devices: [device],
    world,
  });
  await start();
  assert.ok(app.refusedApplies());
  const before = world.requests.length;
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, false);
  assert.ok(world.requests.length > before, 'tried');
  assert.match(off.error, /refusé l’utilisateur ou le mot de passe/);
  app.stop();
});

test('right after a restart, before any read: the switch-off leaves at once', async () => {
  const device = created('relay', 'r2', { relayKind: 'switch' });
  const first = await setup({ config: withRelays(), devices: [device] });
  await first.start();
  first.app.stop();
  const world = fakeIpx();
  world.state.led[1] = 1;
  // Every read hangs: the switch-off must not wait for one.
  world.latency = (r) => (/status\.xml/.test(r.path) ? 60 * SECOND : 20);
  const second = await setup({
    config: withRelays(),
    devices: [device],
    store: first.store,
    clock: first.clock,
    world,
  });
  await second.app.connected(withRelays());
  const off = await second.cmd(device, F('relay', 'r2', 'switch'), 0);
  assert.equal(led(world, 2), 0);
  assert.equal(world.writes()[0].path, '/preset.htm?set2=0');
  assert.notEqual(off.error, undefined, 'unconfirmed while the reads hang');
  second.app.stop();
});

test('nothing asked before a switch-off leaves after it: the waiting switch-on is cancelled', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const other = created('relay', 'r2', { relayKind: 'switch' });
  const world = fakeIpx();
  const { app, start, act, gladys } = await setup({
    config: withRelays(),
    devices: [device, other],
    world,
  });
  await start();
  world.latency = 1500;
  const feature = device.features[0];
  const results = await act(
    Promise.all([
      gladys.fake.setValue(other, other.features[0], 1),
      gladys.fake.setValue(device, feature, 1),
      settle(2).then(() => gladys.fake.setValue(device, feature, 0)),
    ]),
  );
  assert.equal(led(world, 1), 0, 'the switch-off is the last written');
  const r1 = world.writes().filter((w) => /set1=/.test(w.path));
  assert.deepEqual(
    r1.map((w) => w.path),
    ['/preset.htm?set1=0'],
    'the switch-on never left',
  );
  assert.match(results[1].error, /Annulée|Interrompue/);
  app.stop();
});

test('a switch-off the IPX does not apply is sent again by the reads, 3 times at most, then told; never lifted by time', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeIpx();
  world.state.led[0] = 1;
  const { app, start, cmd, wait, gladys, store } = await setup({
    config: withRelays(),
    devices: [device],
    world,
  });
  await start();
  world.ignoreWrites = true;
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.match(off.error, /pas encore appliquée/);
  for (let i = 0; i < 6; i += 1) await wait(10 * SECOND);
  const writes = world.writes().filter((w) => /set1=0/.test(w.path));
  assert.equal(writes.length, 1 + TIMINGS.resendMax);
  assert.match(message(gladys), /not applied after 3 tries.*R1/);
  assert.equal(store.data.guards[0].code, 'r1');
  await wait(3600 * SECOND);
  assert.ok(app.guards.has('r1'), 'never lifted by time');
  // Applied at last (by hand on the IPX): confirmed.
  world.state.led[0] = 0;
  await wait(10 * SECOND);
  assert.equal(app.guards.get('r1').confirmed, true);
  app.stop();
});

test('a confirmed switch-off is released by another value read twice in a row, not once', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeIpx();
  world.state.led[0] = 1;
  const { app, start, cmd, wait } = await setup({
    config: withRelays(),
    devices: [device],
    world,
  });
  await start();
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(app.guards.get('r1').confirmed, true);
  // After the follow-up reads of the command (5 s, 20 s), just after a round.
  await wait(25 * SECOND);
  world.state.led[0] = 1;
  await wait(10 * SECOND);
  assert.ok(app.guards.has('r1'), 'read once: still held');
  await wait(10 * SECOND);
  assert.ok(!app.guards.has('r1'), 'read twice: changed on the IPX');
  assert.equal(world.writes().length, 1, 'never sent again over a change made on the IPX');
  app.stop();
});

test('a later switch-on that left lifts the guard; refused by the IPX (429), it does not', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeIpx();
  world.state.led[0] = 1;
  const { app, start, cmd } = await setup({
    config: withRelays(),
    devices: [device],
    world,
  });
  await start();
  world.ignoreWrites = true;
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.ok(app.guards.has('r1'));
  world.queue.push((r) => (/preset/.test(r.path) ? { status: 429, body: '' } : undefined));
  await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.ok(app.guards.has('r1'), 'a 429 is not a newer command');
  world.ignoreWrites = false;
  const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.equal(on.success, true, on.error);
  assert.ok(!app.guards.has('r1'));
  app.stop();
});

test('the password is never in the logs, the statuses nor /data, even on failures', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeIpx({ user: USER, password: PASSWORD });
  const { app, start, cmd, wait, lines, store, gladys } = await setup({
    config: withRelays('R1', { username: USER, password: PASSWORD }),
    devices: [device],
    world,
  });
  await start();
  const basic = Buffer.from(`${USER}:${PASSWORD}`).toString('base64');
  world.queue.push(new Error(`GET http://${USER}:${PASSWORD}@${ADDRESS}/ ${basic}`));
  await wait(10 * SECOND);
  world.refuseConnect = 50;
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  await wait(30 * SECOND);
  const all = [
    ...lines,
    JSON.stringify(store.data),
    JSON.stringify(gladys.fake.connectionStatuses),
    JSON.stringify(gladys.fake.discoveredDevices),
  ].join('\n');
  assert.ok(!all.includes(PASSWORD), 'the password leaked');
  assert.ok(!all.includes(basic), 'the Basic header leaked');
  app.stop();
});

test('/data unreadable is not empty: nothing written over it, said; the switch-off still goes', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const store = memoryStore({ key: 'x', guards: [] });
  store.unreadable = true;
  const world = fakeIpx();
  world.state.led[0] = 1;
  const { app, start, cmd, gladys } = await setup({
    config: withRelays(),
    devices: [device],
    store,
    world,
  });
  await start();
  assert.equal(store.saves, 0);
  assert.match(message(gladys), /\/data/);
  const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(on.error, /on ne sait pas à quel IPX800/, 'which IPX800 is unknown: no switch-on');
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(led(world, 1), 0);
  assert.equal(store.saves, 0, 'still nothing written over it');
  app.stop();
});

test('nothing stale at "connected" nor at a device created long after the last read', async () => {
  const device = created('relay', 'r1');
  const world = fakeIpx();
  const { app, start, gladys, wait } = await setup({ world });
  await start();
  world.queue.push(new Error('down'), new Error('down'), new Error('down'));
  await wait(10 * SECOND);
  const count = gladys.fake.states.length;
  await gladys.fake.deviceCreated(device);
  await app.connected(CONFIG);
  await app.flush();
  assert.equal(gladys.fake.states.length, count, 'no old value republished');
  app.stop();
});

test('the test button reads now once due, refused credentials included, and stays paced', async () => {
  const world = fakeIpx({ user: USER, password: 'old' });
  const { app, start, wait, act } = await setup({ world, config: PROTECTED });
  await start();
  assert.ok(app.refusedApplies());
  const before = rounds(world).length;
  await wait(10 * SECOND);
  world.password = PASSWORD;
  const text = await act(app.testConnection());
  assert.match(text.en, /Connected/);
  assert.equal(rounds(world).length, before + 1);
  assert.equal(app.refusedApplies(), false);
  const again = await act(app.testConnection());
  assert.equal(rounds(world).length, before + 1, 'cooldown');
  assert.ok(again);
  app.stop();
});

test('the switch-off goes during a 429 pause (busy), a switch-on does not', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeIpx();
  world.state.led[0] = 1;
  const { app, start, cmd, wait, store } = await setup({
    config: withRelays('R1'),
    devices: [device],
    world,
  });
  await start();
  world.queue.push({ status: 429, body: '' });
  await wait(10 * SECOND);
  assert.equal(store.data.pause.code, 'busy');
  const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(on.error, /demande d’attendre/);
  assert.equal(world.writes().length, 0);
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(led(world, 1), 0);
  app.stop();
});
