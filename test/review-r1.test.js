// -----------------------------------------------------------------------------
// The points of the review r1 of this integration (1bd921d): a frozen /data
// never stops the switch-off nor the reads (B1); an owner not known never
// refuses it, and /data reading again works the verdict out again (I1); a
// switch-off held in memory survives new credentials (I2); the "not ready"
// answer is no reading (I3); the same IPX800 in two slots, ids of an unknown
// slot, a damaged /data (m1-m3); the texts (m4); the order guards the mutants
// left untested (P12, P19, I11).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMINGS } from '../src/constants.js';
import { v3WriteQuery } from '../src/ipx/model.js';
import { memoryStore } from '../src/store.js';
import { PASSWORD, USER, fakeIpx } from './helpers/fakeIpx.js';
import { v3Xml } from './helpers/xml.js';
import { ADDRESS, CONFIG, F, SECOND, boundMemory, created, setup } from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const switchOf = (code) => created('relay', code, { relayKind: 'switch' });
const R123 = { ...CONFIG, relays: 'R1, R2, R3' };
const rounds = (world) => world.requests.filter((r) => /status\.xml/.test(r.path)).length;
const never = () => new Promise(() => {});

// --- B1: a frozen /data ---------------------------------------------------------------

test('B1: a frozen save never stops the rounds; the status says it, not "Connected"; the test button answers', async () => {
  const store = memoryStore();
  const { app, gladys, start, wait, act, world } = await setup({ config: R123, store });
  await start();
  store.save = never;
  const before = rounds(world);
  await wait(35 * SECOND);
  assert.ok(rounds(world) - before >= 3, `${rounds(world) - before} rounds`);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys), /cannot be written to \/data/);
  await wait(10 * SECOND);
  const text = await act(app.testConnection());
  assert.doesNotMatch(text.en, /already running/);
  app.stop();
});

test('B1: a frozen save: several switch-offs in a row leave, and one kept during an outage leaves once the box is back', async () => {
  const devices = [switchOf('r1'), switchOf('r2'), switchOf('r3')];
  const world = fakeIpx();
  world.state.led[0] = 1;
  world.state.led[1] = 1;
  world.state.led[2] = 1;
  const store = memoryStore();
  const { app, start, cmd, wait } = await setup({ config: R123, devices, world, store });
  await start();
  store.save = never;
  const a = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  const b = await cmd(devices[1], F('relay', 'r2', 'switch'), 0);
  assert.equal(a.success, true, a.error);
  assert.equal(b.success, true, b.error);
  world.refuseConnect = 1_000_000;
  const c = await cmd(devices[2], F('relay', 'r3', 'switch'), 0);
  assert.match(c.error, /Pas encore envoyée/);
  await wait(3 * SECOND);
  world.refuseConnect = 0;
  await wait(60 * SECOND);
  assert.deepEqual(world.state.led.slice(0, 3), [0, 0, 0]);
  app.stop();
});

test('B1: a frozen load at a new session: the start goes on (owner unknown), a switch-off clicked then leaves', async () => {
  const device = switchOf('r1');
  const world = fakeIpx({ user: USER, password: PASSWORD });
  world.state.led[0] = 1;
  const store = memoryStore();
  const { app, gladys, start, cmd, act } = await setup({
    config: { ...R123, username: USER, password: 'old' },
    devices: [device],
    world,
    store,
  });
  await start();
  store.load = never;
  const saving = app.configUpdated({ ...R123, username: USER, password: PASSWORD });
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  await act(saving);
  assert.equal(world.state.led[0], 0, JSON.stringify(off));
  assert.match(message(gladys), /cannot be read now/);
  assert.doesNotMatch(off.error ?? '', /configuration/);
  app.stop();
});

test('B1: a save frozen from the container start: a status and the rounds all the same', async () => {
  const store = memoryStore(boundMemory(R123));
  store.save = never;
  const { app, gladys, act, wait, world } = await setup({ config: R123, store });
  // The start waits for /data 1.5 s at most (the virtual clock moves meanwhile).
  await act(app.connected(R123));
  await wait(25 * SECOND);
  assert.ok(rounds(world) >= 2);
  assert.match(message(gladys), /Connected to the IPX800 V3.*cannot be written to \/data/);
  app.stop();
});

test('B1: a clicked switch-off before the start ends says the start, not Gladys, when the configuration is read', async () => {
  const device = switchOf('r1');
  const store = memoryStore(boundMemory(R123));
  const { app, start, act, gladys } = await setup({ config: R123, devices: [device], store });
  await start();
  // The next start hangs on /data for longer than the click waits (bounded later).
  const slowLoad = store.load.bind(store);
  store.load = () => new Promise((resolve) => setTimeout(() => resolve(slowLoad()), 0));
  const restarting = app.configUpdated({ ...R123, host: '192.168.1.51' });
  const ack = await act(gladys.fake.setValue(device, device.features[0], 0));
  await act(restarting);
  assert.ok(ack.success === true || !/configuration/.test(ack.error), JSON.stringify(ack));
  app.stop();
});

// --- I1: the owner not known ------------------------------------------------------------

test('I1: /data never writable, devices there: after a restart the switch-off goes, a switch-on waits; Attach refused, said', async () => {
  const device = switchOf('r1');
  const world = fakeIpx();
  world.state.led[0] = 1;
  const store = memoryStore();
  store.fail = true;
  const { app, gladys, start, cmd } = await setup({
    config: R123,
    devices: [device],
    world,
    store,
    fresh: true,
  });
  await start();
  assert.match(message(gladys), /cannot be written to \/data and holds nothing yet/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(world.state.led[0], 0);
  await gladys.fake.action('attach_devices', { ipx: '1' });
  const second = await gladys.fake.action('attach_devices', { ipx: '1' });
  assert.match(second.data.message.en, /would be forgotten at the next restart/);
  assert.equal(app.verdict, 'unbound');
  app.stop();
});

test('I1: /data unreadable at start, then readable (owner = this address): verdict worked out again, switch-off and switch-on go', async () => {
  const device = switchOf('r1');
  const world = fakeIpx();
  world.state.led[0] = 1;
  const store = memoryStore(boundMemory(R123));
  store.unreadable = true;
  const { app, start, cmd } = await setup({ config: R123, devices: [device], world, store });
  await start();
  assert.equal(app.verdict, 'unbound');
  store.unreadable = false;
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(world.state.led[0], 0);
  assert.equal(app.verdict, 'same', 'the owner of /data, read again');
  const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.equal(on.success, true, on.error);
  app.stop();
});

test('I1: /data readable again naming another address: the verdict turns "different", nothing more sent', async () => {
  const device = switchOf('r1');
  const world = fakeIpx();
  const store = memoryStore(boundMemory({ host: '10.0.0.9' }));
  store.unreadable = true;
  const { app, start, cmd } = await setup({ config: R123, devices: [device], world, store });
  await start();
  store.unreadable = false;
  await app.saveMemory();
  assert.equal(app.verdict, 'different');
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 0)).success, false);
  assert.equal(world.writes().length, 0);
  app.stop();
});

test('I1: "Attach the devices" survives a restart (written to /data)', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  const first = await setup({ config: R123, devices: [device], store, fresh: true });
  await first.start();
  await first.gladys.fake.action('attach_devices', { ipx: '1' });
  await first.gladys.fake.action('attach_devices', { ipx: '1' });
  first.app.stop();
  const second = await setup({
    config: R123,
    devices: [device],
    store,
    clock: first.clock,
  });
  await second.start();
  await second.wait(10 * SECOND);
  assert.equal(second.app.verdict, 'same');
  assert.equal((await second.cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  second.app.stop();
});

// --- I2: a held switch-off and new credentials -----------------------------------------------

test('I2: a switch-off held during a 401 leaves once new credentials are saved, /data not writable', async () => {
  const device = switchOf('r1');
  const world = fakeIpx({ user: USER, password: PASSWORD });
  world.state.led[0] = 1;
  const store = memoryStore();
  const { app, start, cmd, wait, gladys } = await setup({
    config: { ...R123, username: USER, password: PASSWORD },
    devices: [device],
    world,
    store,
  });
  await start();
  store.fail = true;
  world.password = 'changed';
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, false);
  assert.equal(world.state.led[0], 1);
  assert.ok(app.guards.has('r1'));
  await gladys.fake.configUpdated({ ...R123, username: USER, password: 'changed' });
  await wait(2 * SECOND);
  assert.equal(world.state.led[0], 0, 'sent with the new credentials');
  app.stop();
});

// --- I3: the "not ready" answer -------------------------------------------------------------

test('I3: an answer with every analog 0 and dnsstatus "pending" is no reading: nothing published, the switch-off kept', async () => {
  const devices = [switchOf('r1'), created('input', 'd1')];
  const world = fakeIpx();
  world.state.led[0] = 1;
  world.state.btn[0] = 'dn';
  const { app, gladys, start, cmd, wait } = await setup({ config: R123, devices, world });
  await start();
  await app.flush();
  world.ignoreWrites = true;
  await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  world.ignoreWrites = false;
  const pending = () => ({
    body: v3Xml({
      led: Array(32).fill(0),
      btn: Array(32).fill('up'),
      analog: [0, 0, 0, 0],
      anselect: ['2', '5', '0', '0'],
    }).replace('<dnsstatus>ok</dnsstatus>', '<dnsstatus>Pending</dnsstatus>'),
  });
  const failRead = (r) => (/status\.xml/.test(r.path) ? pending() : undefined);
  // The follow-up reads (5 s, 20 s) and the next rounds see it.
  for (let i = 0; i < 6; i += 1) world.queue.push(failRead);
  world.ignoreWrites = true;
  await wait(12 * SECOND);
  await app.flush();
  const d1 = gladys.fake.states
    .filter((s) => s.device_feature_external_id === F('input', 'd1', 'state'))
    .map((s) => s.state);
  assert.ok(!d1.includes(0), `D1 published ${d1}`);
  assert.equal(app.guards.get('r1')?.confirmed, false, 'not confirmed by it');
  assert.match(message(gladys), /not ready yet/);
  world.ignoreWrites = false;
  world.queue.length = 0;
  await wait(60 * SECOND);
  assert.equal(world.state.led[0], 0, 'sent again once real readings come');
  app.stop();
});

// --- I4: the write of a switch-off --------------------------------------------------------

test('I4: a switch-off is set<N>=0, a switch-on set<N>=1 (ha_ipx800v3 async_set_relay, pyipx800v3 on/off)', () => {
  // cce66's Api-Deck sends the index of its option ("1 - On" is index 0): never a source for this.
  assert.equal(v3WriteQuery({ kind: 'relay', n: 1 }, 0), 'set1=0');
  assert.equal(v3WriteQuery({ kind: 'relay', n: 1 }, 1), 'set1=1');
});

// --- m3: a damaged /data -------------------------------------------------------------------

test('m3: a damaged /data: the switch-off goes; Attach (two clicks) writes the file again and the switch-on works', async () => {
  const device = switchOf('r1');
  const world = fakeIpx();
  world.state.led[0] = 1;
  const store = memoryStore();
  store.load = async () => JSON.parse('{"format":1,"owner":{');
  const { app, gladys, start, cmd, wait } = await setup({
    config: R123,
    devices: [device],
    world,
    store,
    fresh: true,
  });
  await start();
  await wait(SECOND);
  assert.match(message(gladys), /damaged/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 0)).success, true);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  assert.equal(store.saves, 0, 'never written over without the user');
  const first = await gladys.fake.action('attach_devices', { ipx: '1' });
  assert.match(first.data.message.en, /written again/);
  assert.doesNotMatch(first.data.message.en, /cannot be written/);
  const done = await gladys.fake.action('attach_devices', { ipx: '1' });
  assert.match(done.data.message.en, /Done/);
  assert.equal(store.data.owner.kind, 'address');
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  app.stop();
});

test('m3: /data that cannot be read now (EIO): Attach refused, said so, never written over', async () => {
  const device = switchOf('r1');
  const store = memoryStore(boundMemory({ host: '10.0.0.9' }));
  store.unreadable = true;
  const { app, gladys, start } = await setup({ config: R123, devices: [device], store });
  await start();
  const answer = await gladys.fake.action('attach_devices', { ipx: '1' });
  assert.match(answer.data.message.en, /cannot be read right now/);
  assert.equal(store.saves, 0);
  app.stop();
});

// --- m4: texts -------------------------------------------------------------------------------

test('m4: a write that left and got a 401 says "nothing was applied", not "nothing was sent"', async () => {
  const device = switchOf('r1');
  const world = fakeIpx({ user: USER, password: PASSWORD });
  const { app, start, cmd } = await setup({
    config: { ...R123, username: USER, password: PASSWORD },
    devices: [device],
    world,
  });
  await start();
  world.password = 'changed';
  const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(on.error, /rien n’a été appliqué/);
  app.stop();
});

// --- m6: the mutants left alive ------------------------------------------------------------

/** R2 switched on, its read back slow (1.5 s); R1 switched on behind it; then `then`. */
const behindAReadBack = async (then) => {
  const devices = [switchOf('r1'), switchOf('r2')];
  const world = fakeIpx();
  const ctx = await setup({ config: { ...CONFIG, relays: 'R1, R2' }, devices, world });
  await ctx.start();
  await ctx.wait(5300);
  world.latency = (r) => (/status\.xml/.test(r.path) ? 1500 : 20);
  const later = (ms, fn) => new Promise((r) => ctx.clock.timers.setTimeout(r, ms)).then(fn);
  const set = (d, v) => ctx.gladys.fake.setValue(d, d.features[0], v);
  const acks = await ctx.act(
    Promise.all([
      set(devices[1], 1),
      later(150, () => set(devices[0], 1)),
      later(300, () => then(ctx, devices)),
    ]),
  );
  return { ...ctx, acks };
};

test('P12: a switch-on waiting in the lane never leaves after a newer switch-off of its relay', async () => {
  const { app, world, wait } = await behindAReadBack((ctx, devices) =>
    ctx.gladys.fake.setValue(devices[0], devices[0].features[0], 0),
  );
  await wait(SECOND);
  const writes = world
    .writes()
    .filter((w) => w.sentAt !== undefined)
    .map((w) => w.path.replace('/preset.htm?', ''));
  const off = writes.lastIndexOf('set1=0');
  assert.ok(off !== -1, writes.join(' '));
  assert.ok(!writes.slice(off + 1).includes('set1=1'), writes.join(' '));
  assert.equal(world.state.led[0], 0);
  app.stop();
});

test('P19: a switch-on waiting in the lane never leaves once its relay is taken out of the list', async () => {
  const { app, world, wait } = await behindAReadBack((ctx) =>
    ctx.gladys.fake.configUpdated({ ...CONFIG, relays: 'R2' }),
  );
  await wait(SECOND);
  assert.ok(!world.writes().some((w) => w.path === '/preset.htm?set1=1' && w.sentAt !== undefined));
  assert.equal(world.state.led[0], 0);
  app.stop();
});

test('I11: a device updated (renamed) while another address is typed gets no value of that box', async () => {
  const devices = [switchOf('r1'), created('input', 'd1')];
  const a = fakeIpx();
  const b = fakeIpx();
  b.state.led[0] = 1;
  b.state.btn[0] = 'dn';
  const world = {
    set clock(clock) {
      a.clock = clock;
      b.clock = clock;
    },
    transport: (o, h) => (o.hostname === '192.168.1.60' ? b : a).transport(o, h),
  };
  const { app, gladys, start, wait } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices,
    world,
  });
  await start();
  await app.flush();
  await gladys.fake.configUpdated({ host: '192.168.1.60', relays: 'R1' });
  await wait(10 * SECOND);
  const count = gladys.fake.states.length;
  for (const d of devices) await gladys.fake.deviceUpdated({ ...d, name: 'Renamed' });
  await app.flush();
  assert.equal(gladys.fake.states.length, count, 'nothing of the other box published');
  app.stop();
});

test('the bound on /data is short enough for a switch-off and a command ack', () => {
  assert.ok(TIMINGS.storeWait < TIMINGS.commandSendBy);
  assert.equal(ADDRESS, CONFIG.host);
});
