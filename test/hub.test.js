// -----------------------------------------------------------------------------
// Several IPX800 V3 in one integration (src/hub.js): each slot its own ids,
// devices, lane and /data; one status, one Discover list, one publisher.
// Virtual clock with fake IPX800 behind one transport (dispatched by
// address), then a real clock (x20) against two real local HTTP IPX800.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { IpxHub } from '../src/hub.js';
import { registerHandlers } from '../src/handlers.js';
import { parseExternalId, slotOf } from '../src/devices.js';
import { slotConfig, slotTyped } from '../src/config.js';
import { POLL_MS } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { measurePeriod, realClock, spyOn, testClock } from './kit/index.mjs';
import { PASSWORD, USER, fakeIpx } from './helpers/fakeIpx.js';
import { httpIpx } from './helpers/httpIpx.js';
import { START, SALT, settle } from './helpers/app.js';

const HOST_1 = '192.168.1.50';
const HOST_2 = '192.168.1.60';
const CONFIG = {
  host: HOST_1,
  relays: 'R1',
  host_2: HOST_2,
  username_2: USER,
  password_2: PASSWORD,
  relays_2: 'R1, R2',
};

async function hubSetup({ config = CONFIG, devices = [] } = {}) {
  const clock = testClock({ start: START });
  const w5 = fakeIpx();
  const w4 = fakeIpx({ user: USER, password: PASSWORD });
  w5.clock = clock;
  w4.clock = clock;
  const gladys = createFakeGladys({ selector: 'ipx', config, devices });
  await gladys.connect();
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const stores = new Map([1, 2, 3].map((s) => [s, memoryStore()]));
  const hub = new IpxHub({
    gladys,
    logger: { info: log, warn: log, error: log, debug: log },
    transport: (o, h) => (o.hostname === HOST_2 ? w4 : w5).transport(o, h),
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    storeOf: (slot) => stores.get(slot),
    random: () => SALT,
  });
  registerHandlers(gladys, hub);
  const wait = async (ms) => {
    await clock.advance(ms);
    await settle();
  };
  const act = async (promise) => {
    let done = false;
    const out = promise.then(
      (v) => ((done = true), v),
      (e) => ((done = true), { error: e }),
    );
    for (let t = 0; !done && t < 30_000; t += 10) {
      await clock.advance(10);
      await settle(3);
    }
    return out;
  };
  const start = async () => {
    await act(hub.onConnected(() => gladys.getConfig()));
    await wait(1000);
  };
  const ids = () => (gladys.fake.discoveredDevices ?? []).map((d) => d.external_id);
  const create = async (id) => {
    const d = gladys.fake.discoveredDevices.find((x) => x.external_id === `ext:ipx:${id}`);
    await gladys.fake.deviceCreated(d);
    return gladys.devices.find((x) => x.external_id === d.external_id);
  };
  const set = (device, key, value) =>
    act(
      gladys.fake.setValue(
        device,
        device.features.find((f) => f.external_id.endsWith(`:${key}`)),
        value,
      ),
    );
  return { hub, gladys, w5, w4, stores, start, wait, act, ids, create, set, lines };
}

test('slots: ids, routing of the external ids, configuration of each slot', () => {
  assert.equal(slotOf('ext:ipx:relay:r1', 'ipx'), 1);
  assert.equal(slotOf('ext:ipx:ipx2:relay:r1:switch', 'ipx'), 2);
  assert.equal(slotOf('ext:other:ipx2:relay:r1', 'ipx'), 1);
  assert.deepEqual(parseExternalId('ext:ipx:ipx2:relay:r1:switch', 'ipx', 2), {
    kind: 'relay',
    code: 'r1',
    key: 'switch',
  });
  assert.equal(parseExternalId('ext:ipx:ipx2:relay:r1:switch', 'ipx', 1), undefined);
  assert.equal(parseExternalId('ext:ipx:relay:r1:switch', 'ipx', 2), undefined);
  assert.deepEqual(slotConfig(CONFIG, 2), {
    host: HOST_2,
    username: USER,
    password: PASSWORD,
    relays: 'R1, R2',
    extensions: undefined,
    poll_interval: undefined,
    inputs_poll_ms: undefined,
    language: undefined,
  });
  assert.equal(slotConfig(CONFIG, 1), CONFIG);
  assert.equal(slotTyped(CONFIG, 2), true);
  assert.equal(slotTyped(CONFIG, 3), false);
  assert.equal(slotTyped({ username_3: ' u ' }, 3), true);
});

test('two IPX800 V3: their own devices, each command to its own IPX800 only, its own credentials', async () => {
  const { hub, gladys, w5, w4, start, ids, create, set } = await hubSetup();
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const message = gladys.fake.connectionStatus.message;
  assert.match(
    message.en,
    /^IPX800 #1: Connected to the IPX800 V3.* \| IPX800 #2: Connected to the IPX800 V3/s,
  );
  assert.match(message.fr, /IPX800 n°2 : Connecté à l’IPX800 V3/);
  assert.ok(
    w4.requests.every((r) => r.authorization),
    'slot 2 sends its credentials',
  );
  assert.ok(
    w5.requests.every((r) => !r.authorization),
    'slot 1 has none',
  );
  assert.ok(ids().includes('ext:ipx:relay:r1'));
  assert.ok(ids().includes('ext:ipx:ipx2:relay:r1'));
  const v4Name = gladys.fake.discoveredDevices.find(
    (d) => d.external_id === 'ext:ipx:ipx2:relay:r2',
  ).name;
  assert.equal(v4Name, 'IPX800V3-2-R2');
  const r1 = await create('relay:r1');
  const v4r1 = await create('ipx2:relay:r1');
  assert.equal((await set(v4r1, 'switch', 1)).success, true);
  assert.deepEqual(
    w4.writes().map((r) => r.path),
    ['/preset.htm?set1=1'],
  );
  assert.equal(w5.writes().length, 0);
  assert.equal((await set(r1, 'switch', 0)).success, true);
  assert.equal(w5.writes().length, 1);
  assert.equal(w4.writes().length, 1);
  // One publisher for the 300 states a minute of Gladys.
  const publishers = new Set([...hub.controllers.values()].map((a) => a.publisher));
  assert.equal(publishers.size, 1);
  hub.stop();
});

test('one slot used: its status as is; a failing slot leaves the others and the list', async () => {
  const one = await hubSetup({ config: { host: HOST_1 } });
  await one.start();
  assert.match(one.gladys.fake.connectionStatus.message.en, /^Connected to the IPX800 V3/);
  one.hub.stop();

  const { gladys, w4, start, wait, ids, hub } = await hubSetup();
  await start();
  w4.refuseConnect = 99;
  await wait(10_000);
  assert.equal(gladys.fake.connectionStatus.connected, false, 'not all connected');
  assert.match(gladys.fake.connectionStatus.message.en, /IPX800 #2: The IPX800 V3 does not answer/);
  assert.ok(!ids().some((id) => id.includes(':ipx2:')), 'the devices of #2 leave Discover');
  assert.ok(ids().includes('ext:ipx:relay:r1'), 'those of #1 stay');
  await gladys.fake.scanRequest();
  assert.ok(!ids().some((id) => id.includes(':ipx2:')));
  hub.stop();
});

test('a slot with devices but no address is shown; an unused slot is not', async () => {
  const { gladys, start, hub } = await hubSetup({
    config: { host: HOST_1 },
    devices: [
      {
        name: 'x',
        external_id: 'ext:ipx:ipx2:relay:r1',
        features: [],
      },
    ],
  });
  await start();
  const message = gladys.fake.connectionStatus.message.en;
  assert.match(message, /IPX800 #2: Enter the address of the IPX800 V3/);
  assert.doesNotMatch(message, /IPX800 #3/);
  hub.stop();
});

test('the test button answers for each IPX800; Attach goes to the slot chosen', async () => {
  const { gladys, start, wait, hub } = await hubSetup();
  await start();
  await wait(10_000);
  const answer = await gladys.fake.action('test_connection', {});
  assert.match(answer.data.message.en, /IPX800 #1: .* \| IPX800 #2: /s);
  const attach = await gladys.fake.action('attach_devices', { ipx: '2' });
  assert.match(attach.data.message.en, /devices of IPX800 #2 already belong/);
  const none = await gladys.fake.action('attach_devices', { ipx: '7' });
  assert.match(none.data.message.en, /Choose an IPX800/);
  hub.stop();
});

test('real clock x20: two IPX800 V3 over HTTP, each read at the interval, each command to its own', async (t) => {
  const one = await httpIpx();
  const two = await httpIpx({ user: 'admin', password: 'pw 2', global: false });
  const clock = realClock({ speed: 20 });
  t.after(async () => {
    clock.close();
    await one.srv.close();
    await two.srv.close();
  });
  const config = {
    host: one.address,
    relays: 'R1',
    host_2: two.address,
    username_2: 'admin',
    password_2: 'pw 2',
    relays_2: 'R1',
  };
  const gladys = createFakeGladys({ selector: 'ipx', config });
  await gladys.connect();
  const quiet = () => {};
  const hub = new IpxHub({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    storeOf: () => memoryStore(),
  });
  registerHandlers(gladys, hub);
  t.after(() => hub.stop());
  const spy1 = spyOn(hub.controllers.get(1), 'readRound', clock);
  const spy2 = spyOn(hub.controllers.get(2), 'readRound', clock);
  await hub.onConnected(() => gladys.getConfig());
  const period = POLL_MS.default;
  await Promise.all([
    measurePeriod(spy1, { count: 3, period }),
    measurePeriod(spy2, { count: 3, period }),
  ]);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const ack2 = await gladys.fake.setValue(
    { external_id: 'ext:ipx:ipx2:relay:r1' },
    { external_id: 'ext:ipx:ipx2:relay:r1:switch' },
    1,
  );
  assert.equal(ack2.success, true, ack2.error);
  const ack1 = await gladys.fake.setValue(
    { external_id: 'ext:ipx:relay:r1' },
    { external_id: 'ext:ipx:relay:r1:switch' },
    0,
  );
  assert.equal(ack1.success, true, ack1.error);
  assert.deepEqual(two.writes(), ['set1=1']);
  assert.deepEqual(one.writes(), ['set1=0']);
});
