// -----------------------------------------------------------------------------
// The rules the reviews of the IPX800 V4/V5 integration found unguarded,
// carried over to the V3 (its only protective command: a listed relay
// switched off): a clicked switch-off cuts any request, read backs and
// resends included; a guard put back never overwrites a newer one; a relay
// no longer listed is never driven again; a switch-off clicked before the
// configuration is read; one configuration at a time; acks within 5 s; an
// older command of ours handled late never lifts a switch-off; and one test
// per surviving mutation.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMINGS } from '../src/constants.js';
import { PRIORITY } from '../src/ipx/client.js';
import { memoryStore, normalizeMemory } from '../src/store.js';
import { fakeIpx } from './helpers/fakeIpx.js';
import { CONFIG, F, SECOND, created, settle, setup } from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const v3 = (over = {}) => ({ ...CONFIG, relays: 'R1, R2, R3, R4, R5', ...over });
const switchOf = (code) => created('relay', code, { relayKind: 'switch' });
const led = (world, n) => world.state.led[n - 1];
const setLed = (world, n, v) => {
  world.state.led[n - 1] = v;
};
const isOff = (n) => (w) => w.path === `/preset.htm?set${n}=0`;
const isOn = (n) => (w) => w.path === `/preset.htm?set${n}=1`;
const leftWrites = (world) =>
  world
    .writes()
    .filter((w) => w.sentAt !== undefined)
    .map((w) => w.path.replace('/preset.htm?', ''));

/** A promise whose settling time (virtual ms) is recorded. */
const timed = (clock, promise) => {
  const out = { at: undefined };
  out.promise = promise.then((value) => {
    out.at = clock.elapsed;
    return value;
  });
  return out;
};
test('B1: a clicked switch-off cuts the stuck read back of an earlier one and leaves at once', async () => {
  const relays = [
    created('relay', 'r1', { relayKind: 'switch' }),
    created('relay', 'r2', { relayKind: 'switch' }),
  ];
  const world = fakeIpx();
  setLed(world, 1, 1);
  setLed(world, 2, 1);
  const { app, start, act, gladys, clock } = await setup({ config: v3(), devices: relays, world });
  await start();
  // Every read hangs from now on (the IPX takes the writes).
  world.latency = (r) => (/status\.xml/.test(r.path) ? 60 * SECOND : 20);
  const first = gladys.fake.setValue(relays[0], relays[0].features[0], 0);
  await act(settle(5).then(() => new Promise((r) => clock.timers.setTimeout(r, 300))));
  const clicked = clock.elapsed;
  const acks = await act(
    Promise.all([first, gladys.fake.setValue(relays[1], relays[1].features[0], 0)]),
  );
  const write = world.writes().find(isOff(2));
  assert.ok(write, 'set2=0 written');
  assert.ok(
    write.sentAt - clicked < 50,
    `set2=0 left ${write.sentAt - clicked} ms after its click`,
  );
  assert.equal(led(world, 2), 0);
  assert.equal(world.peak, 1);
  assert.ok(acks.every((a) => a.error === undefined || /Envoyée/.test(a.error)));
  app.stop();
});

test('B1: a clicked switch-off without answer for 1 s is cut when another one waits', async () => {
  const relays = [switchOf('r1'), switchOf('r2')];
  const world = fakeIpx();
  setLed(world, 1, 1);
  setLed(world, 2, 1);
  const { app, start, act, gladys, clock } = await setup({
    config: v3({ poll_interval: 300 }),
    devices: relays,
    world,
  });
  await start();
  world.latency = (r) => (isOff(1)(r) ? 5 * SECOND : 20);
  const t0 = clock.elapsed;
  const first = gladys.fake.setValue(relays[0], relays[0].features[0], 0);
  const second = settle(3).then(() => gladys.fake.setValue(relays[1], relays[1].features[0], 0));
  const [ack1, ack2] = await act(Promise.all([first, second]));
  assert.equal(ack2.success, true, ack2.error);
  assert.match(ack1.error, /Envoyée/);
  const write = world.writes().find((w) => isOff(2)(w) && w.sentAt !== undefined);
  assert.ok(write.sentAt - t0 < 1.2 * SECOND, `left at ${write.sentAt - t0} ms`);
  assert.equal(led(world, 2), 0);
  app.stop();
});

test('B1: a switch-off that could not leave is sent again as soon as the lane frees, before any read', async () => {
  const device = switchOf('r1');
  const world = fakeIpx();
  setLed(world, 1, 1);
  const { app, start, act, gladys, clock } = await setup({
    config: v3({ poll_interval: 300 }),
    devices: [device],
    world,
  });
  await start();
  // Refused for longer than the 250 ms of tries, then the IPX answers again.
  world.refuseConnect = 6;
  const t0 = clock.elapsed;
  const ack = await act(gladys.fake.setValue(device, device.features[0], 0));
  assert.match(ack.error, /Pas encore envoyée.*renvoyée dès que l’IPX800 est libre/);
  await act(new Promise((r) => clock.timers.setTimeout(r, 500)));
  const write = world.writes().find((w) => isOff(1)(w) && w.sentAt !== undefined);
  assert.ok(write, 'set1=0 written');
  assert.ok(write.sentAt - t0 < SECOND, `left at ${write.sentAt - t0} ms`);
  assert.equal(led(world, 1), 0);
  app.stop();
});

test('lot 18: a switch-off that never left is never given up, whatever the time; tries count only when sent', async () => {
  const device = switchOf('r1');
  const world = fakeIpx();
  setLed(world, 1, 1);
  const { app, start, act, gladys, wait } = await setup({
    config: v3(),
    devices: [device],
    world,
  });
  await start();
  world.refuseConnect = 10_000;
  await act(gladys.fake.setValue(device, device.features[0], 0));
  await wait(10 * 60 * SECOND);
  const guard = app.guards.get('r1');
  assert.ok(guard, 'still kept');
  assert.equal(guard.resends, 0, 'nothing left: no try counted');
  world.refuseConnect = 0;
  await wait(10 * 60 * SECOND);
  assert.equal(led(world, 1), 0, 'sent once the IPX answers again');
  app.stop();
});

test('B3: a relay removed from the list is never switched again, nor after a restart', async () => {
  const relay = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeIpx();
  setLed(world, 1, 1);
  const { app, start, cmd, wait, gladys, store, clock } = await setup({
    config: v3(),
    devices: [relay],
    world,
  });
  await start();
  world.ignoreWrites = true;
  await cmd(relay, F('relay', 'r1', 'switch'), 0);
  assert.ok(app.guards.has('r1'));
  await gladys.fake.configUpdated(v3({ relays: 'R2' }));
  assert.equal(app.guards.has('r1'), false, 'dropped at once');
  assert.deepEqual(store.data.guards, [], 'and in /data');
  const count = world.writes().length;
  await wait(60 * SECOND);
  assert.equal(world.writes().length, count, 'no set1=0 once unlisted');
  assert.equal(app.guards.has('r1'), false);
  assert.deepEqual(store.data.guards, []);
  app.stop();
  // A guard of R1 in /data, R1 not listed: nothing at start.
  store.data.guards = [{ code: 'r1', kind: 'relay', value: 0, resends: 0, confirmed: false }];
  const again = await setup({ config: v3({ relays: 'R2' }), store, clock, devices: [relay] });
  await again.start();
  await again.wait(30 * SECOND);
  assert.ok(!again.world.writes().some(isOff(1)));
  assert.deepEqual(again.store.data.guards, []);
  again.app.stop();
  // Read back from /data with R1 not listed: dropped before anything can send it.
  again.app.guards.clear();
  again.app.adoptMemory(
    normalizeMemory(
      { key: again.app.config.key, guards: [{ code: 'r1', kind: 'relay', value: 0 }] },
      clock.now(),
    ),
    clock.now(),
    clock.monotonic(),
  );
  assert.equal(again.app.guards.has('r1'), false);
});

test('I1: a switch-off clicked before the configuration is read asks for it and leaves once it comes', async () => {
  let calls = 0;
  let fail = true;
  const device = switchOf('r1');
  const world = fakeIpx();
  setLed(world, 1, 1);
  const { app, gladys, wait, act } = await setup({
    config: v3(),
    devices: [device],
    world,
    getConfig: async () => {
      calls += 1;
      if (fail) throw new Error('busy');
      return v3();
    },
  });
  await app.onConnected(() => gladys.getConfig());
  await wait(SECOND);
  const before = calls;
  const ack = await act(gladys.fake.setValue(device, device.features[0], 0));
  assert.ok(calls > before, 'the click asked for the configuration');
  assert.match(ack.error, /gardée et envoyée dès sa lecture/);
  fail = false;
  await wait(6 * SECOND);
  assert.ok(world.writes().some(isOff(1)), 'sent once read');
  assert.equal(led(world, 1), 0);
  // Read in the ack when Gladys answers then.
  const second = await setup({ config: v3(), devices: [device], getConfig: async () => v3() });
  second.app.configLoader = () => second.gladys.getConfig();
  const ok = await second.act(second.gladys.fake.setValue(device, device.features[0], 0));
  assert.equal(ok.success, true, ok.error);
  app.stop();
  second.app.stop();
});

test('I2: two saves in a row apply one after the other, the last wins, one request at a time', async () => {
  const world = fakeIpx({ user: 'admin', password: 'last-pass' });
  world.latency = 300;
  const store = memoryStore();
  const { app, start, act, clock } = await setup({ world, store });
  await start();
  const load = store.load.bind(store);
  let loads = 0;
  store.load = async () => {
    loads += 1;
    await new Promise((r) => clock.timers.setTimeout(r, 80));
    return load();
  };
  const basic = (p) => `Basic ${Buffer.from(`admin:${p}`).toString('base64')}`;
  await act(
    Promise.all([
      app.configUpdated({ ...CONFIG, username: 'admin', password: 'other-pass' }),
      // Saved again before the first one started: it is skipped.
      app.configUpdated({ ...CONFIG, username: 'admin', password: 'last-pass' }),
    ]),
  );
  await act(new Promise((r) => clock.timers.setTimeout(r, 2000)));
  assert.equal(world.peak, 1);
  assert.equal(loads, 1, 'the superseded configuration never starts');
  assert.equal(app.config.password, 'last-pass');
  assert.ok(
    !world.requests.some((r) => r.authorization === basic('other-pass')),
    'the superseded one never reads',
  );
  app.stop();
});

test('I3: relays clicked one after the other on a slow IPX: every ack within 5 s', async () => {
  const relays = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    created('relay', `r${n}`, { relayKind: 'switch' }),
  );
  const world = fakeIpx();
  const { app, start, act, gladys, clock } = await setup({
    config: v3({ relays: 'R1,R2,R3,R4,R5,R6,R7,R8' }),
    devices: relays,
    world,
  });
  await start();
  world.latency = 700;
  const acks = [];
  for (const relay of relays) {
    const t = clock.elapsed;
    const ack = timed(clock, gladys.fake.setValue(relay, relay.features[0], 1));
    acks.push({ t, ack });
    await act(new Promise((r) => clock.timers.setTimeout(r, 600)));
  }
  await act(Promise.all(acks.map((a) => a.ack.promise)));
  for (const { t, ack } of acks) assert.ok(ack.at - t < 5000, `ack after ${ack.at - t} ms`);
  app.stop();
});

test('M2: switching off a listed relay goes during a pause; switching it on does not', async () => {
  const relay = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeIpx();
  setLed(world, 1, 1);
  const { app, start, cmd, wait } = await setup({ config: v3(), devices: [relay], world });
  await start();
  world.failReads = 500;
  await wait(10 * SECOND);
  assert.ok(app.pause);
  const on = await cmd(relay, F('relay', 'r1', 'switch'), 1);
  assert.match(on.error, /ne répond pas/);
  await cmd(relay, F('relay', 'r1', 'switch'), 0);
  assert.ok(world.writes().some(isOff(1)));
  assert.equal(led(world, 1), 0);
  app.stop();
});

test('M7: unknown reads never release a confirmed switch-off', async () => {
  const device = switchOf('r1');
  const world = fakeIpx();
  setLed(world, 1, 1);
  const { app, start, cmd, wait } = await setup({ config: v3(), devices: [device], world });
  await start();
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  await wait(25 * SECOND);
  setLed(world, 1, '???');
  await wait(30 * SECOND);
  assert.ok(app.guards.has('r1'), 'still held after unknown reads');
  app.stop();
});

test('M8: a read that left before the guard was sent never checks it', async () => {
  const { app, start } = await setup({ config: v3() });
  await start();
  app.guards.set('r1', {
    code: 'r1',
    kind: 'relay',
    value: 0,
    resends: 0,
    confirmed: true,
    other: 1,
    seq: 1,
    sentAt: 1000,
    inFlight: false,
  });
  app.model.set('r1', { ...app.model.get('r1'), value: 1, at: 500 });
  app.applyRead(500);
  assert.ok(app.guards.has('r1'), 'an older read is not the second one');
  app.stop();
});

test('M10: a switch-on waiting behind a switch-off of its relay is refused at once, not at its turn', async () => {
  const relays = [switchOf('r1'), switchOf('r2')];
  const world = fakeIpx();
  const { app, start, act, gladys, clock } = await setup({
    config: v3(),
    devices: relays,
    world,
  });
  await start();
  // A slow write of R2 holds the lane (a command does not cut another one).
  world.latency = (r) => (isOn(2)(r) ? 1000 : 20);
  const busy = gladys.fake.setValue(relays[1], relays[1].features[0], 1);
  await settle(5);
  const waiting = timed(clock, gladys.fake.setValue(relays[0], relays[0].features[0], 1));
  await settle(5);
  const clicked = clock.elapsed;
  const off = gladys.fake.setValue(relays[0], relays[0].features[0], 0);
  const [, w] = await act(Promise.all([busy, waiting.promise, off]));
  assert.match(w.error, /Annulée/);
  assert.ok(waiting.at - clicked < 100, `refused ${waiting.at - clicked} ms after the switch-off`);
  assert.ok(!world.writes().some(isOn(1)), 'the switch-on never left');
  app.stop();
});

test('M11: a read back that left before a write is never shared with it', async () => {
  const world = fakeIpx();
  world.latency = 1000;
  const { app, start, clock, wait } = await setup({ config: v3(), world });
  await start();
  await wait(2000);
  const first = app.readBack(PRIORITY.CONFIRM, clock.monotonic() + 5000);
  first.catch(() => {});
  await wait(20);
  assert.ok(app.readBackJob.started, 'the first read back left');
  const written = clock.monotonic();
  const second = app.readBack(PRIORITY.CONFIRM, clock.monotonic() + 5000, { after: written });
  second.catch(() => {});
  assert.notEqual(second, first);
  const third = app.readBack(PRIORITY.CONFIRM, clock.monotonic() + 5000, { after: written });
  assert.equal(third, second, 'one not left yet is shared');
  app.stop();
});

test('M17: a command the reads contradict is told in the status', async () => {
  const relay = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeIpx();
  const { app, start, cmd, wait, gladys } = await setup({ config: v3(), devices: [relay], world });
  await start();
  world.ignoreWrites = true;
  await cmd(relay, F('relay', 'r1', 'switch'), 1);
  await wait(10 * SECOND);
  assert.match(message(gladys), /Last command not applied.*R1/);
  app.stop();
});

test('M19: a guard kept in /data leaves at start, before any read', async () => {
  const store = memoryStore();
  const first = await setup({ config: v3(), store });
  await first.start();
  first.app.stop();
  store.data.guards = [{ code: 'r1', kind: 'relay', value: 0, resends: 0, confirmed: false }];
  const world = fakeIpx();
  setLed(world, 1, 1);
  const second = await setup({ config: v3(), store, clock: first.clock, world });
  await second.start();
  assert.ok(world.writes().some(isOff(1)));
  assert.equal(world.reads().length, 0, 'read less than an interval ago: no round yet');
  second.app.stop();
});

test('M22: a command cuts a slow read of the polling', async () => {
  const relay = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeIpx();
  const { app, start, wait, act, gladys, clock, elapsed } = await setup({
    config: v3(),
    devices: [relay],
    world,
  });
  await start();
  world.latency = (r) => (/status\.xml/.test(r.path) && !world.fast ? 4 * SECOND : 20);
  await wait(10 * SECOND);
  assert.equal(world.inFlight, 1);
  const t0 = elapsed();
  world.fast = true;
  await act(gladys.fake.setValue(relay, relay.features[0], 1));
  const write = world.writes()[0];
  assert.ok(write.sentAt - t0 < 50, `left ${write.sentAt - t0} ms after the click`);
  app.stop();
  void clock;
});

test('a switch-on answered 500 (or 429) does not lift the switch-off guard', async () => {
  const device = switchOf('r1');
  const world = fakeIpx();
  setLed(world, 1, 1);
  const { app, start, cmd } = await setup({ config: v3(), devices: [device], world });
  await start();
  world.ignoreWrites = true;
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  for (const status of [500, 429]) {
    world.queue.push((r) => (/preset/.test(r.path) ? { status, body: '' } : undefined));
    await cmd(device, F('relay', 'r1', 'switch'), 1);
    assert.ok(app.guards.has('r1'), `${status}: not a newer command`);
  }
  assert.ok(TIMINGS.resendMax >= 1);
  app.stop();
});

// --- Review r2 ----------------------------------------------------------------------

/** Gladys slow to take the status and the Discovery list (4 s each, virtual). */
const slowGladys = (gladys, clock) => {
  for (const name of ['publishDiscoveredDevices', 'setConnectionStatus']) {
    const original = gladys[name].bind(gladys);
    gladys[name] = async (...args) => {
      await new Promise((r) => clock.timers.setTimeout(r, 4 * SECOND));
      return original(...args);
    };
  }
};

test('r2 B1: a switch-off clicked during a slow start (Gladys slow) is sent in that start', async () => {
  let calls = 0;
  const device = switchOf('r1');
  const world = fakeIpx();
  setLed(world, 1, 1);
  const { app, gladys, wait, act, clock } = await setup({
    config: v3(),
    devices: [device],
    world,
    getConfig: async () => {
      calls += 1;
      if (calls === 1) throw new Error('busy');
      return v3();
    },
  });
  slowGladys(gladys, clock);
  app.onConnected(() => gladys.getConfig());
  await wait(SECOND);
  const t0 = clock.elapsed;
  const ack = await act(gladys.fake.setValue(device, device.features[0], 0));
  const write = world.writes().find((w) => isOff(1)(w) && w.sentAt !== undefined);
  assert.ok(write, `sent (ack: ${JSON.stringify(ack)})`);
  assert.ok(write.sentAt - t0 < 3.5 * SECOND, `left ${write.sentAt - t0} ms after the click`);
  assert.equal(app.pendingProtectives.size, 0, 'nothing left for a later start');
  app.stop();
  app.clearConfigTimer();
});

test('r2 B1: a switch-off kept in /data leaves within a second of the start, whatever Gladys does', async () => {
  const store = memoryStore();
  const first = await setup({ config: v3(), store });
  await first.start();
  first.app.stop();
  store.data.guards = [{ code: 'r1', kind: 'relay', value: 0, resends: 0, confirmed: false }];
  const world = fakeIpx();
  setLed(world, 1, 1);
  const second = await setup({ config: v3(), store, clock: first.clock, world });
  slowGladys(second.gladys, second.clock);
  const t0 = second.clock.elapsed;
  second.app.connected(v3());
  // No time moves: everything up to the write happens without waiting for Gladys.
  await settle(50);
  const write = world.writes().find((w) => isOff(1)(w) && w.sentAt !== undefined);
  assert.ok(write, 'sent before Gladys answered');
  assert.ok(write.sentAt - t0 < SECOND, `left ${write.sentAt - t0} ms after the start`);
  await second.wait(10 * SECOND);
  second.app.stop();
});

test('WARP r4: a /data that never answers holds neither the switch-offs nor the clicks after them', async () => {
  const relays = [switchOf('r1'), switchOf('r2'), switchOf('r3')];
  const world = fakeIpx();
  for (const n of [1, 2, 3]) setLed(world, n, 1);
  const store = memoryStore();
  const { app, start, act, gladys } = await setup({
    config: v3(),
    devices: relays,
    world,
    store,
  });
  await start();
  // Every save from now on hangs for ever.
  store.save = () => new Promise(() => {});
  const acks = await act(Promise.all(relays.map((d) => gladys.fake.setValue(d, d.features[0], 0))));
  for (const ack of acks) assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.state.led.slice(0, 3), [0, 0, 0]);
  const on = await act(gladys.fake.setValue(relays[0], relays[0].features[0], 1));
  assert.equal(on.success, true, on.error);
  app.stop();
});

test('r2 B1: a switch-off waiting for the configuration that is then unknown is told, not dropped silently', async () => {
  let calls = 0;
  const device = created('relay', 'r7', { relayKind: 'switch' });
  const { app, gladys, wait, act } = await setup({
    config: v3(),
    devices: [device],
    getConfig: async () => {
      calls += 1;
      if (calls <= 2) throw new Error('busy');
      return v3();
    },
  });
  await app.onConnected(() => gladys.getConfig());
  await act(gladys.fake.setValue(device, device.features[0], 0));
  await wait(10 * SECOND);
  assert.match(message(gladys), /clicked before the configuration was read, not sent.*R7/);
  app.stop();
  app.clearConfigTimer();
});

test('r2 I1: a round left in the queue past its deadline is no failure of the IPX', async () => {
  const relays = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    created('relay', `r${n}`, { relayKind: 'switch' }),
  );
  const world = fakeIpx();
  const { app, start, act, gladys, clock, wait } = await setup({
    config: v3({ relays: 'R1,R2,R3,R4,R5,R6,R7,R8', poll_interval: 5 }),
    devices: relays,
    world,
  });
  await start();
  await wait(3500);
  world.latency = 700;
  const acks = [];
  for (const relay of relays) {
    acks.push(gladys.fake.setValue(relay, relay.features[0], 1));
    await act(new Promise((r) => clock.timers.setTimeout(r, 250)));
  }
  await act(Promise.all(acks));
  assert.equal(app.failures, 0);
  assert.equal(app.pause, undefined);
  assert.doesNotMatch(message(gladys), /does not answer/);
  const after = await act(gladys.fake.setValue(relays[0], relays[0].features[0], 0));
  assert.ok(after.success || /Envoyée/.test(after.error), after.error);
  app.stop();
});

test('r2: a switch-on clicked while a switch-off of its relay is still being tried is refused, nothing sent', async () => {
  const device = switchOf('r1');
  const world = fakeIpx();
  setLed(world, 1, 1);
  const { app, start, act, gladys } = await setup({ config: v3(), devices: [device], world });
  await start();
  world.refuseConnect = 1;
  const feature = device.features[0];
  const [off, on] = await act(
    Promise.all([
      gladys.fake.setValue(device, feature, 0),
      settle(1).then(() => gladys.fake.setValue(device, feature, 1)),
    ]),
  );
  await act(new Promise((r) => setImmediate(r)));
  assert.equal(off.success, true, off.error);
  assert.match(on.error, /extinction est en cours d’envoi/);
  assert.deepEqual(leftWrites(world), ['set1=0']);
  assert.equal(led(world, 1), 0);
  app.stop();
});

test('r2: switch-offs in a scene of 5 on a slow IPX: the one not sent in time goes before the read backs', async () => {
  const relays = [1, 2, 3, 4, 5].map((n) => switchOf(`r${n}`));
  const world = fakeIpx();
  for (let n = 1; n <= 5; n += 1) setLed(world, n, 1);
  const { app, start, act, gladys, wait } = await setup({
    config: v3({ poll_interval: 300 }),
    devices: relays,
    world,
  });
  await start();
  world.latency = 900;
  await act(Promise.all(relays.map((d) => gladys.fake.setValue(d, d.features[0], 0))));
  await wait(3000);
  const sent = world.requests.filter((r) => r.sentAt !== undefined);
  const fifth = sent.findIndex(isOff(5));
  const readBack = sent.findIndex((r, i) => i > 0 && /status\.xml/.test(r.path));
  assert.ok(fifth !== -1 && fifth < readBack, 'the 5th switch-off before the read backs');
  assert.deepEqual(world.state.led.slice(0, 5), [0, 0, 0, 0, 0]);
  app.stop();
});

test('r2: /data is never written between the reset of a start and its read of /data', async () => {
  const store = memoryStore();
  const first = await setup({ config: v3(), store });
  await first.start();
  first.app.stop();
  store.data.guards = [{ code: 'r1', kind: 'relay', value: 0, resends: 0, confirmed: false }];
  const second = await setup({ config: v3(), store, clock: first.clock });
  const load = store.load.bind(store);
  store.load = async () => {
    await new Promise((r) => second.clock.timers.setTimeout(r, 80));
    return load();
  };
  const started = second.app.connected(v3());
  await settle(5);
  await second.app.saveMemory();
  assert.equal(store.data.guards.length, 1, 'the kept switch-off is still in /data');
  await second.act(started);
  assert.ok(second.app.guards.has('r1'));
  second.app.stop();
});

// --- Review r3 ----------------------------------------------------------------------

test('r3 B1: a retry already queued is checked again right before it leaves', async () => {
  const relays = [switchOf('r1'), switchOf('r2')];
  const world = fakeIpx();
  setLed(world, 1, 1);
  setLed(world, 2, 1);
  const { app, start, act, gladys, clock } = await setup({
    config: v3({ poll_interval: 300 }),
    devices: relays,
    world,
  });
  await start();
  // A switch-off of R1 refused at its first try; one of R2 holds the lane 500 ms, so the
  // retry of R1 waits in the queue when a newer switch-on of R1 is clicked, then another
  // switch-off.
  world.refuseConnect = 1;
  world.latency = (r) => (isOff(2)(r) ? 500 : 20);
  const later = (ms, relay, value) =>
    new Promise((r) => clock.timers.setTimeout(r, ms)).then(() =>
      gladys.fake.setValue(relay, relay.features[0], value),
    );
  const first = gladys.fake.setValue(relays[0], relays[0].features[0], 0);
  const [f, , o] = await act(
    Promise.all([first, later(10, relays[1], 0), later(120, relays[0], 0)]),
  );
  await act(new Promise((r) => clock.timers.setTimeout(r, 500)));
  assert.deepEqual(leftWrites(world), ['set2=0', 'set1=0'], 'the older retry never left');
  assert.equal(led(world, 1), 0);
  assert.match(f.error, /Annulée/);
  assert.equal(o.success, true, o.error);
  app.stop();
});

test('r3: an older switch-on cut by the switch-off, then handled late by the IPX, never lifts it', async () => {
  const device = switchOf('r1');
  const world = fakeIpx();
  const { app, start, act, wait, gladys, clock, lines } = await setup({
    config: v3({ poll_interval: 300 }),
    devices: [device],
    world,
  });
  await start();
  // This IPX takes the switch-on 2 s after it came, though its request was cut by the Off.
  world.latency = (r) => (isOn(1)(r) ? 2 * SECOND : 20);
  world.queue.push((r) => {
    if (!isOn(1)(r)) return undefined;
    clock.timers.setTimeout(() => setLed(world, 1, 1), 2 * SECOND);
    return { body: '<html>ok</html>' };
  });
  const feature = device.features[0];
  const on = gladys.fake.setValue(device, feature, 1);
  const off = new Promise((r) => clock.timers.setTimeout(r, 200)).then(() =>
    gladys.fake.setValue(device, feature, 0),
  );
  const [c, o] = await act(Promise.all([on, off]));
  assert.match(c.error, /Envoyée, sans confirmation/);
  assert.equal(o.success, true, o.error);
  await wait(30 * SECOND);
  assert.equal(led(world, 1), 0, 'the switch-off sent again over the late switch-on');
  assert.equal(app.guards.get('r1')?.value, 0, 'still held');
  assert.ok(lines.some((l) => /R1 shows an older command of the integration/.test(l)));
  app.stop();
});

/** Relays R1-R3; `at(ms, n, value)` clicks relay n `ms` from now (its ack). */
const scripted = async (poll) => {
  const relays = [1, 2, 3].map((n) => switchOf(`r${n}`));
  const world = fakeIpx();
  const ctx = await setup({ config: v3({ poll_interval: poll }), devices: relays, world });
  await ctx.start();
  const at = (ms, n, value) =>
    new Promise((r) => ctx.clock.timers.setTimeout(r, ms)).then(() =>
      ctx.gladys.fake.setValue(relays[n - 1], relays[n - 1].features[0], value),
    );
  const later = (ms, fn) => ctx.clock.timers.setTimeout(fn, ms);
  return { ...ctx, at, later };
};

test('r3: a command of ours answered before the switch-off is no reason to keep it over a change on the IPX', async () => {
  const { app, world, act, wait, at, later } = await scripted(300);
  // R1: a switch-on answered, a switch-off 1 s later, then switched on at the IPX itself.
  await act(Promise.all([at(0, 1, 1), at(SECOND, 1, 0)]));
  later(SECOND, () => setLed(world, 1, 1));
  await wait(30 * SECOND);
  assert.equal(app.guards.has('r1'), false, 'released: changed on the IPX');
  assert.equal(led(world, 1), 1);
  // R3: a switch-on the IPX refuses (500), a switch-off 1 s later, then switched on at the IPX.
  world.queue.push((r) => (isOn(3)(r) ? { status: 500, body: '' } : undefined));
  const [refused] = await act(Promise.all([at(0, 3, 1), at(SECOND, 3, 0)]));
  assert.match(refused.error, /répondu une erreur/);
  later(SECOND, () => setLed(world, 3, 1));
  await wait(30 * SECOND);
  assert.equal(app.guards.has('r3'), false, 'released: changed on the IPX');
  assert.equal(led(world, 3), 1);
  app.stop();
});

test('r3: a command of ours left unanswered more than 5 s before the switch-off is no reason either', async () => {
  const { app, world, act, wait, at, later } = await scripted(300);
  // The switch-on is taken, its answer never comes (4.3 s); the switch-off 6 s after it left.
  world.latency = (r) => (isOn(1)(r) ? 10 * SECOND : 20);
  const [c, o] = await act(Promise.all([at(0, 1, 1), at(6 * SECOND, 1, 0)]));
  assert.match(c.error, /Envoyée, sans confirmation/);
  assert.equal(o.success, true, o.error);
  later(SECOND, () => setLed(world, 1, 1));
  await wait(30 * SECOND);
  assert.equal(app.guards.has('r1'), false, 'released: changed on the IPX');
  assert.equal(led(world, 1), 1);
  app.stop();
});

test('r3: an unanswered write of ours may land for one request time after it left, no longer', async () => {
  const { app } = await setup({ config: v3() });
  app.lastWrites.set('r1', { value: 1, sentAt: 1000, answered: false });
  assert.ok(app.mayLand('r1', 0, 1000 + TIMINGS.requestTimeout - 1));
  assert.equal(app.mayLand('r1', 0, 1000 + TIMINGS.requestTimeout), undefined);
  assert.equal(app.mayLand('r1', 1, 1001), undefined, 'same value: not older');
  assert.equal(app.mayLand('r2', 0, 1001), undefined);
  app.stop();
});

/** A first start that read the IPX (the pace kept in /data), then these guards in /data. */
const keptGuards = async (guards) => {
  const store = memoryStore();
  const first = await setup({ config: v3({ poll_interval: 300 }), store });
  await first.start();
  first.app.stop();
  store.data.guards = guards.map((code) => ({
    code,
    kind: 'relay',
    value: 0,
    resends: 0,
    confirmed: false,
  }));
  return { store, clock: first.clock };
};

test('r3 R5: switch-offs clicked before the configuration leave first at start, never cut by a later click', async () => {
  const { store, clock } = await keptGuards(['r3']);
  const relays = [switchOf('r1'), switchOf('r2')];
  const world = fakeIpx();
  for (let n = 1; n <= 3; n += 1) setLed(world, n, 1);
  let calls = 0;
  const { app, gladys, wait, act } = await setup({
    config: v3({ poll_interval: 300 }),
    devices: relays,
    world,
    store,
    clock,
    getConfig: async () => {
      calls += 1;
      if (calls <= 2) throw new Error('busy');
      return v3({ poll_interval: 300 });
    },
  });
  // The switch-off of R1 takes 500 ms on the IPX; 100 ms into it, one is clicked on R2.
  let second;
  world.latency = (r) => {
    if (isOff(1)(r) && !second) {
      second = new Promise((res) => clock.timers.setTimeout(res, 100)).then(() =>
        gladys.fake.setValue(relays[1], relays[1].features[0], 0),
      );
    }
    return isOff(1)(r) ? 500 : 20;
  };
  await app.onConnected(() => gladys.getConfig());
  const kept = await act(gladys.fake.setValue(relays[0], relays[0].features[0], 0));
  assert.match(kept.error, /envoyée dès sa lecture/);
  await wait(10 * SECOND);
  const ack = await act(second);
  const sent = world.writes().filter((w) => w.sentAt !== undefined);
  // The clicks first (the one adopted by the start, then the later one), then the /data guard.
  assert.deepEqual(leftWrites(world), ['set1=0', 'set2=0', 'set3=0']);
  assert.ok(
    sent.every((w) => w.end !== undefined),
    'none cut',
  );
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.state.led.slice(0, 3), [0, 0, 0]);
  app.stop();
  app.clearConfigTimer();
});

test('r3: a guard sent again and cut by a click before it left goes right behind that click', async () => {
  const { store, clock } = await keptGuards(['r2']);
  const relays = [switchOf('r1'), switchOf('r2')];
  const world = fakeIpx();
  setLed(world, 1, 1);
  setLed(world, 2, 1);
  // The first connection for R2 takes 200 ms: the click on R1 cuts it before it leaves.
  let slow = true;
  world.connectDelay = (r) => (isOff(2)(r) && slow ? ((slow = false), 200) : 0);
  const { app, gladys, act } = await setup({
    config: v3({ poll_interval: 300 }),
    devices: relays,
    world,
    store,
    clock,
  });
  const t0 = clock.elapsed;
  app.connected(v3({ poll_interval: 300 }));
  const ack = await act(
    new Promise((r) => clock.timers.setTimeout(r, 50)).then(() =>
      gladys.fake.setValue(relays[0], relays[0].features[0], 0),
    ),
  );
  await act(new Promise((r) => clock.timers.setTimeout(r, 500)));
  assert.equal(world.writes()[0].sentAt, undefined, 'the first try of R2 never left');
  const r2 = world.writes().find((w) => isOff(2)(w) && w.sentAt !== undefined);
  assert.ok(r2, 'the guard of R2 left');
  assert.ok(r2.sentAt - t0 < SECOND, `left ${r2.sentAt - t0} ms after the start`);
  assert.equal(led(world, 2), 0);
  assert.equal(ack.success, true, ack.error);
  app.stop();
});

test('r3: a guard cut before it left by a newer click on its own relay is not tried again', async () => {
  const { store, clock } = await keptGuards(['r2']);
  const relay = switchOf('r2');
  const world = fakeIpx();
  setLed(world, 2, 1);
  world.connectDelay = (r) => (isOff(2)(r) ? 200 : 0);
  const { app, gladys, act } = await setup({
    config: v3({ poll_interval: 300 }),
    devices: [relay],
    world,
    store,
    clock,
  });
  app.connected(v3({ poll_interval: 300 }));
  const ack = await act(
    new Promise((r) => clock.timers.setTimeout(r, 50)).then(() =>
      gladys.fake.setValue(relay, relay.features[0], 0),
    ),
  );
  await act(new Promise((r) => clock.timers.setTimeout(r, 500)));
  // The kept guard's try (cut before it left) and the click's own write: one left.
  assert.deepEqual(leftWrites(world), ['set2=0']);
  assert.equal(led(world, 2), 0);
  assert.equal(ack.success, true, ack.error);
  app.stop();
});
