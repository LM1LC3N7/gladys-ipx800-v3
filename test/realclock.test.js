// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout), sped
// up 20 times, against a real local HTTP server playing an IPX800 V3: the
// rounds start at the interval, never sooner, never a cycle late; a command
// still reads back and resolves. The real clock moves between any two reads.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { IpxApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { measurePeriod, realClock, spyOn } from './kit/index.mjs';
import { httpIpx } from './helpers/httpIpx.js';

const SPEED = 20;
const INTERVAL = POLL_INTERVAL.default * 1000;

test('real clock x20: one round per interval (measured), a command confirmed', async (t) => {
  const ipx = await httpIpx({ latencyMs: 5 });
  const clock = realClock({ speed: SPEED });
  // Registered first, run last (t.after runs in reverse order).
  t.after(async () => {
    clock.close();
    await ipx.srv.close();
  });
  const gladys = createFakeGladys({ selector: 'ipx', config: {} });
  await gladys.connect();
  const quiet = () => {};
  const app = new IpxApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: memoryStore(),
  });
  registerHandlers(gladys, app);
  t.after(() => app.stop());
  const spy = spyOn(app, 'readRound', clock);
  await app.connected({ host: ipx.address, relays: 'R1' });
  const gaps = await measurePeriod(spy, { count: 4, period: INTERVAL });
  assert.equal(gaps.length, 3);
  const feature = { external_id: 'ext:ipx:relay:r1:switch' };
  const ack = await gladys.fake.setValue({ external_id: 'ext:ipx:relay:r1' }, feature, 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(ipx.state.led[0], 1);
  const off = await gladys.fake.setValue({ external_id: 'ext:ipx:relay:r1' }, feature, 0);
  assert.equal(off.success, true, off.error);
  assert.equal(ipx.state.led[0], 0);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  app.stop();
  assert.ok(clock.timersSet < 40, `${clock.timersSet} timers`);
});
