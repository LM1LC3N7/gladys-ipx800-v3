// -----------------------------------------------------------------------------
// Which IPX800 the devices belong to (the owner in /data: the controller key,
// address and port, as the V3 API gives no MAC): a device made for one
// IPX800 never drives another one, a switch-off kept for the old one
// neither; the Discover list shows only the IPX800 really read. The app
// against the SDK's fake Gladys, fake IPX800 V3 and the virtual clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controllerKey } from '../src/config.js';
import { TIMINGS } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { fakeIpx } from './helpers/fakeIpx.js';
import { CONFIG, F, SECOND, boundMemory, created, setup } from './helpers/app.js';

const OTHER_HOST = '192.168.1.60';
const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const discovered = (gladys) => (gladys.fake.discoveredDevices ?? []).map((d) => d.external_id);
const switchOf = (code) => created('relay', code, { relayKind: 'switch' });
const HERE = { ...CONFIG, relays: 'R1, R2' };
const THERE = { host: OTHER_HOST, relays: 'R1, R2' };

/** An IPX800 at ADDRESS and another at OTHER_HOST behind one transport (two boxes of one house). */
function twoIpx() {
  const a = fakeIpx();
  const b = fakeIpx();
  const world = {
    set clock(clock) {
      a.clock = clock;
      b.clock = clock;
    },
    transport: (options, hooks) =>
      (options.hostname === OTHER_HOST ? b : a).transport(options, hooks),
  };
  return { world, a, b };
}

test('devices of one IPX800, then the address of another typed in the same slot: nothing reaches it, not even a switch-off', async () => {
  const devices = [switchOf('r1'), switchOf('r2')];
  const { world, a, b } = twoIpx();
  const { app, gladys, start, wait, cmd, store } = await setup({ config: HERE, devices, world });
  await start();
  assert.equal((await cmd(devices[0], F('relay', 'r1', 'switch'), 1)).success, true);
  assert.deepEqual(
    a.writes().map((r) => r.path),
    ['/preset.htm?set1=1'],
  );
  // A switch-off kept for the first one (not applied there).
  a.ignoreWrites = true;
  await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.ok(app.guards.has('r1'));
  b.state.led[1] = 1;
  await gladys.fake.configUpdated(THERE);
  assert.equal(app.guards.size, 0, 'the switch-off kept for the first one is dropped');
  assert.deepEqual(store.data.guards, []);
  // Before the other one is even read: the owner is another address.
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, false);
  assert.match(off.error, /n’est pas celui pour lequel cet appareil a été créé/);
  await wait(10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    message(gladys),
    /The IPX800 V3 at this address \(or port\) is not the one the devices/,
  );
  assert.match(message(gladys), /"Attach the devices" twice/);
  assert.deepEqual(discovered(gladys), [], 'nothing of the other one under these ids');
  for (const value of [0, 1]) {
    const ack = await cmd(devices[1], F('relay', 'r2', 'switch'), value);
    assert.equal(ack.success, false);
  }
  assert.equal(b.writes().length, 0, 'not one write to the other IPX800');
  await app.flush();
  assert.notEqual(
    gladys.fake.lastState(F('relay', 'r2', 'switch')),
    1,
    'no value of the other one published onto these devices',
  );
  // The address put back: the first one again, its devices driven again.
  a.ignoreWrites = false;
  await gladys.fake.configUpdated(HERE);
  await wait(10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal((await cmd(devices[1], F('relay', 'r2', 'switch'), 1)).success, true);
  app.stop();
});

test('a switch-off kept in /data for one address never leaves for another at start', async () => {
  const device = switchOf('r1');
  const { world, a, b } = twoIpx();
  const first = await setup({ config: HERE, devices: [device], world });
  await first.start();
  a.ignoreWrites = true;
  await first.cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(first.store.data.guards[0].code, 'r1');
  first.app.stop();
  const second = await setup({
    config: THERE,
    devices: [device],
    world,
    store: first.store,
    clock: first.clock,
  });
  await second.start();
  await second.wait(30 * SECOND);
  assert.equal(b.writes().length, 0);
  second.app.stop();
});

test('the same IPX800 at a new address (or port): refused until "Attach the devices" is clicked twice', async () => {
  const device = switchOf('r1');
  const { app, gladys, store, start, wait, cmd, world } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
  });
  await start();
  const moved = { ...CONFIG, host: '192.168.1.61:8080', relays: 'R1' };
  await gladys.fake.configUpdated(moved);
  await wait(10 * SECOND);
  assert.match(message(gladys), /The IPX800 V3 at this address \(or port\) is not the one/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  const first = await gladys.fake.action('attach_devices', { ipx: '1' });
  assert.match(first.data.message.en, /Click again within a minute to attach the 1 device\(s\)/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  assert.equal(world.writes().length, 0);
  await wait(TIMINGS.attachConfirm + SECOND);
  const late = await gladys.fake.action('attach_devices', { ipx: '1' });
  assert.match(late.data.message.en, /Click again/, 'a second click after a minute asks again');
  const done = await gladys.fake.action('attach_devices', { ipx: '1' });
  assert.match(done.data.message.fr, /C’est fait : les 1 appareil\(s\) de l’IPX800 n°1/);
  assert.equal(store.data.owner.id, controllerKey('192.168.1.61', 8080));
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(discovered(gladys).includes('ext:ipx:relay:r1'));
  const again = await gladys.fake.action('attach_devices', { ipx: '1' });
  assert.match(again.data.message.en, /already belong/);
  app.stop();
});

test('Attach: nothing read yet, or the IPX800 not answering: refused', async () => {
  const world = fakeIpx();
  world.refuseConnect = 99;
  const { app, start } = await setup({ world, devices: [switchOf('r1')] });
  assert.match((await app.attach()).en, /No IPX800 read right now/);
  await start();
  assert.match((await app.attach()).en, /No IPX800 read right now/);
  app.stop();
});

test('a slot whose devices are all gone takes the IPX800 read as its owner', async () => {
  const store = memoryStore(boundMemory({ host: '10.0.0.9' }));
  const { app, gladys, start } = await setup({ store });
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(discovered(gladys).length > 0);
  assert.deepEqual(store.data.owner, boundMemory(CONFIG).owner);
  app.stop();
});

test('/data unreadable: no owner set over it, a switch-off goes, a switch-on waits for it', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  store.unreadable = true;
  const config = { ...CONFIG, relays: 'R1' };
  const { app, gladys, start, wait, cmd, world } = await setup({
    config,
    devices: [device],
    store,
    fresh: true,
  });
  await start();
  assert.match(message(gladys), /state in \/data cannot be read/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 0)).success, true);
  assert.equal(world.writes().length, 1);
  assert.equal(store.data, null, 'nothing written over it');
  store.unreadable = false;
  store.data = boundMemory(config);
  await wait(10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  app.stop();
});

test('Discover: only what was read; emptied by a failure, refused credentials, no address', async () => {
  const world = fakeIpx();
  world.latency = 2 * SECOND;
  const { app, gladys, start, wait } = await setup({ world });
  const starting = app.connected(CONFIG);
  await wait(500);
  assert.deepEqual(discovered(gladys), [], 'the targets of the configuration: not read yet');
  await starting;
  await start();
  await wait(2 * SECOND);
  assert.ok(discovered(gladys).includes('ext:ipx:relay:r1'));
  world.latency = 20;
  world.refuseConnect = 99;
  await wait(10 * SECOND);
  assert.deepEqual(discovered(gladys), [], 'unreachable');
  await gladys.fake.scanRequest();
  assert.deepEqual(discovered(gladys), []);
  world.refuseConnect = 0;
  await wait(60 * SECOND);
  assert.ok(discovered(gladys).length > 0);
  world.user = 'admin';
  world.password = 'x';
  await wait(60 * SECOND);
  assert.deepEqual(discovered(gladys), [], 'credentials refused');
  world.user = '';
  await gladys.fake.configUpdated({ ...CONFIG, host: '' });
  assert.deepEqual(discovered(gladys), [], 'no address: the old list goes');
  app.stop();
});

test('a device deleted: the Discover list again at once, without the switch of the deleted one', async () => {
  const device = switchOf('r2');
  const { app, gladys, start } = await setup({
    config: { ...CONFIG, relays: 'R1, R2' },
    devices: [device],
  });
  await start();
  await gladys.fake.configUpdated({ ...CONFIG, relays: 'R1' });
  const before = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:ipx:relay:r2');
  assert.deepEqual(
    before.features.map((f) => f.external_id.split(':').pop()),
    ['readonly', 'switch'],
  );
  await gladys.fake.deviceDeleted(gladys.devices.find((d) => d.external_id === device.external_id));
  const after = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:ipx:relay:r2');
  assert.deepEqual(
    after.features.map((f) => f.external_id.split(':').pop()),
    ['readonly'],
  );
  app.stop();
});

test('/data lost (a fresh file) with devices there: not bound to whatever answers; the switch-off still goes, Attach asked', async () => {
  const device = switchOf('r1');
  const world = fakeIpx();
  world.state.led[0] = 1;
  const { app, gladys, store, start, cmd } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
    fresh: true,
    world,
  });
  await start();
  assert.equal(store.data.owner, null);
  assert.match(message(gladys), /not known to belong to the IPX800 read/);
  const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.equal(on.success, false, 'no switch-on until attached');
  assert.equal(world.writes().length, 0);
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, 'the switch-off goes to the address typed');
  assert.equal(world.state.led[0], 0);
  await gladys.fake.action('attach_devices', { ipx: '1' });
  await gladys.fake.action('attach_devices', { ipx: '1' });
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  app.stop();
});

test('a command waiting in the queue is refused right before it leaves when another IPX800 is configured', async () => {
  const r1 = switchOf('r1');
  const r2 = switchOf('r2');
  const { world, a, b } = twoIpx();
  const { app, start, act, gladys } = await setup({ config: HERE, devices: [r1, r2], world });
  await start();
  a.latency = (r) => (/preset/.test(r.path) ? 1000 : 20);
  const first = gladys.fake.setValue(r1, { external_id: F('relay', 'r1', 'switch') }, 1);
  const second = gladys.fake.setValue(r2, { external_id: F('relay', 'r2', 'switch') }, 1);
  const flip = (async () => {
    while (a.writes().length === 0) await new Promise((r) => setImmediate(r));
    // The configuration changes to another address while the first write is in flight.
    await gladys.fake.configUpdated(THERE);
  })();
  const [one, two] = await act(Promise.all([first, second, flip]));
  assert.ok(one);
  assert.equal(two.success, false);
  assert.equal(a.writes().length, 1, 'the second never left');
  assert.equal(b.writes().length, 0);
  app.stop();
});

test('/data holding switch-offs for this address but devices of another: dropped at start, never sent', async () => {
  const device = switchOf('r1');
  const { world, a, b } = twoIpx();
  b.state.led[0] = 1;
  // The owner is the first address; the guards were kept for the second one (a switch-off
  // that went while /data could not be read, say).
  const memory = boundMemory(HERE);
  memory.key = boundMemory(THERE).key;
  memory.guards = [{ code: 'r1', kind: 'relay', value: 0, resends: 0, confirmed: false }];
  const store = memoryStore(memory);
  // The second one does not answer: no round tells anything, the start alone decides.
  b.refuseConnect = 99;
  const { app, start, wait } = await setup({ config: THERE, devices: [device], world, store });
  await start();
  assert.equal(app.round, undefined, 'nothing read');
  assert.equal(app.guards.size, 0, 'dropped');
  assert.deepEqual(store.data.guards, []);
  b.refuseConnect = 0;
  await wait(30 * SECOND);
  assert.equal(b.writes().length, 0);
  assert.equal(a.writes().length, 0);
  app.stop();
});
