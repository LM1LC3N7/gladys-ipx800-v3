// -----------------------------------------------------------------------------
// The client and its HTTP layer against a real local HTTP server (the shared
// kit): the credentials in the Basic header only, never in an error; the
// status page and its fallback; bounded answers; a protective request cuts a
// slow read and opens its connection once the read's is closed; one request
// at a time.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { IpxClient, PRIORITY } from '../src/ipx/client.js';
import { IpxError, errorReason } from '../src/ipx/http.js';
import { httpServer, reply } from './kit/index.mjs';

const USER = 'admin';
const PASSWORD = 'P4ss-Secret';
const XML = '<response><led0>1</led0><btn0>up</btn0></response>';

const client = (port, { user = USER, password = PASSWORD } = {}) =>
  new IpxClient({ host: '127.0.0.1', port, user, password });

test('the status page with the Basic credentials; a write is preset.htm?setN=v; an invalid one never leaves', async (t) => {
  const srv = await httpServer({
    routes: {
      'GET /globalstatus.xml': XML,
      'GET /preset.htm': (r) => (r.query.set1 === '1' ? '<html>ok</html>' : reply(500, 'x')),
    },
  });
  t.after(() => srv.close());
  const c = client(srv.port);
  const body = await c.readStatus();
  assert.equal(body.toString(), XML);
  assert.equal(
    srv.requests[0].headers.authorization,
    `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`,
  );
  assert.equal(srv.requests[0].url, '/globalstatus.xml', 'nothing secret in the URL');
  await c.write('set1=1', PRIORITY.COMMAND);
  assert.equal(srv.requests[1].url, '/preset.htm?set1=1');
  await assert.rejects(c.write('set1=0', PRIORITY.COMMAND), (err) => {
    assert.equal(err.code, 'http');
    assert.equal(err.sent, true);
    return true;
  });
  for (const bad of ['set1=1&set2=1', 'set0=0', 'set33=0', 'set1=2', 'set01=0', 'reset=1']) {
    await assert.rejects(c.write(bad, PRIORITY.COMMAND), { code: 'bad_request' });
  }
  assert.equal(srv.requests.length, 3, 'an invalid write never leaves');
  const open = new IpxClient({ host: '127.0.0.1', port: srv.port });
  await open.readStatus();
  assert.equal(srv.requests.at(-1).headers.authorization, undefined, 'no credentials: no header');
});

test('globalstatus.xml missing (404): status.xml read, and remembered', async (t) => {
  const srv = await httpServer({ routes: { 'GET /status.xml': XML } });
  t.after(() => srv.close());
  const c = client(srv.port);
  assert.equal((await c.readStatus()).toString(), XML);
  assert.equal((await c.readStatus()).toString(), XML);
  assert.deepEqual(
    srv.requests.map((r) => r.path),
    ['/globalstatus.xml', '/status.xml', '/status.xml'],
  );
});

test('statuses: 401 refused, 503 busy, 500 http, 404 on both pages; the credentials and address never in a message', async (t) => {
  const srv = await httpServer({ routes: {} });
  t.after(() => srv.close());
  const errors = [];
  srv.routes = { '/globalstatus.xml': reply(401, 'no') };
  errors.push(
    await client(srv.port)
      .readStatus()
      .catch((err) => err),
  );
  srv.routes = { '/globalstatus.xml': reply(500, 'oops') };
  errors.push(
    await client(srv.port)
      .readStatus()
      .catch((err) => err),
  );
  srv.routes = {};
  errors.push(
    await client(srv.port)
      .readStatus()
      .catch((err) => err),
  );
  srv.status5xx = 1;
  errors.push(
    await client(srv.port)
      .readStatus()
      .catch((err) => err),
  );
  assert.deepEqual(
    errors.map((e) => [e.code, e.status]),
    [
      ['refused', 401],
      ['http', 500],
      ['http', 404],
      ['busy', 503],
    ],
  );
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  errors.push(
    await client(port)
      .readStatus()
      .catch((err) => err),
  );
  assert.equal(errors.at(-1).code, 'network');
  assert.equal(errors.at(-1).sent, false);
  for (const err of errors) {
    const text = `${err.message} ${errorReason(err)} ${err.stack}`;
    assert.ok(!text.includes(PASSWORD), text);
    assert.ok(!text.includes(Buffer.from(`${USER}:${PASSWORD}`).toString('base64')), text);
    assert.ok(!text.includes('127.0.0.1'), text);
  }
});

test('an answer over the limit is cut before it is read whole', async (t) => {
  const srv = await httpServer({ routes: { '/globalstatus.xml': XML }, bigBody: 200_000 });
  t.after(() => srv.close());
  await assert.rejects(client(srv.port).readStatus(), { code: 'size' });
});

test('a silent IPX: timeout at the deadline, "sent"', async (t) => {
  const srv = await httpServer({ routes: { '/globalstatus.xml': 'silent' } });
  t.after(() => srv.close());
  const c = client(srv.port);
  const started = performance.now();
  const err = await c
    .readStatus(PRIORITY.READ, () => ({ deadline: performance.now() + 300 }))
    .catch((e) => e);
  assert.equal(err.code, 'timeout');
  assert.equal(err.sent, true);
  assert.ok(performance.now() - started < 1500);
});

test('a protective request cuts a slow read, after its connection is closed; one request at a time', async (t) => {
  let open = 0;
  let peak = 0;
  const srv = await httpServer({
    latencyMs: (r) => (r.path === '/globalstatus.xml' ? 5000 : 10),
    routes: { '/globalstatus.xml': XML, '/preset.htm': '<html>ok</html>' },
  });
  t.after(() => srv.close());
  const c = new IpxClient({
    host: '127.0.0.1',
    port: srv.port,
    // Counts the requests open at once, from the client side (open -> settled).
    transport: async (options, hooks) => {
      const { request } = await import('../src/ipx/http.js');
      open += 1;
      peak = Math.max(peak, open);
      try {
        return await request(options, hooks);
      } finally {
        open -= 1;
      }
    },
  });
  const read = c
    .readStatus(PRIORITY.READ, () => ({ deadline: performance.now() + 10_000 }))
    .catch((e) => e);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const started = performance.now();
  await c.write('set1=0', PRIORITY.PROTECTIVE);
  const took = performance.now() - started;
  const err = await read;
  assert.ok(err instanceof IpxError);
  assert.equal(err.code, 'cut');
  assert.ok(took < 1000, `the protective write took ${Math.round(took)} ms`);
  assert.equal(peak, 1, 'never two requests open at once');
  assert.equal(srv.requests.length, 2);
});

test('a server keeping the connection open: one connection at a time, the next opened after', async (t) => {
  const { tcpServer } = await import('./kit/index.mjs');
  const dev = await tcpServer({
    onData: (c) =>
      c.toString('latin1').startsWith('GET')
        ? `HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\nContent-Length: ${XML.length}\r\n\r\n${XML}`
        : undefined,
  });
  t.after(() => dev.close());
  const c = client(dev.port);
  await c.readStatus();
  await c.readStatus();
  await Promise.all([
    c.write('set1=0', PRIORITY.PROTECTIVE).catch(() => {}),
    c.write('set2=0', PRIORITY.PROTECTIVE).catch(() => {}),
    c.readStatus().catch(() => {}),
  ]);
  assert.equal(dev.connections, 5);
  assert.equal(dev.peak, 1, 'never two connections open at once');
});

test('the lane waits a little after a request before opening the next connection', async () => {
  const { testClock } = await import('./kit/index.mjs');
  const { TIMINGS } = await import('../src/constants.js');
  const clock = testClock();
  const started = [];
  const c = new IpxClient({
    host: '127.0.0.1',
    port: 1,
    monotonic: clock.monotonic,
    timers: clock.timers,
    transport: async () => {
      started.push(clock.elapsed);
      return { status: 200, body: Buffer.from(XML) };
    },
  });
  const both = Promise.all([c.readStatus(), c.readStatus()]);
  await clock.advance(1);
  await clock.advance(TIMINGS.laneGap / 2);
  assert.equal(started.length, 1, 'the second waits');
  await clock.advance(TIMINGS.laneGap);
  await both;
  assert.equal(started.length, 2);
  assert.ok(started[1] - started[0] >= TIMINGS.laneGap);
});
