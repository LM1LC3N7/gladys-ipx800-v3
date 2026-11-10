// -----------------------------------------------------------------------------
// A fake IPX800 V3 behind the transport of the client (no network), on the
// virtual clock of the tests: each request takes `latency` ms of that clock
// (a timer), may take a while to connect (a cut then: nothing left), can be
// cut (onStart), times out at its deadline, applies a write when it is
// received, and records everything. It also counts the requests in flight at
// once (`peak`): the lane must keep it at 1.
//
// GET /globalstatus.xml | /status.xml (the state), GET /preset.htm?setN=0|1.
// With `user` set, every request needs its Basic credentials (401 otherwise).
// -----------------------------------------------------------------------------

import { IpxError } from '../../src/ipx/http.js';
import { applyPreset, basic, v3State, v3Xml } from './xml.js';

export const USER = 'admin';
export const PASSWORD = 'S3cret pass-42';

export function fakeIpx(options = {}) {
  const world = {
    /** Credentials the IPX asks for (none when user is ''). */
    user: options.user ?? '',
    password: options.password ?? '',
    /** false: `globalstatus.xml` answers 404 (only `status.xml`). */
    global: options.global ?? true,
    state: v3State(),
    /** The XML of the state (a real capture can stand in: test/fixtures). */
    statusXml: options.statusXml ?? v3Xml,
    requests: [],
    inFlight: 0,
    peak: 0,
    /** ms of the virtual clock per request, or a function of the request. */
    latency: 20,
    /** Answers to give first: an IpxError | { status, body } | (req) => answer | undefined. */
    queue: [],
    /** Writes accepted but not applied (the IPX answers 200, nothing changes). */
    ignoreWrites: false,
    /** Connections refused before anything leaves, for this many requests. */
    refuseConnect: 0,
    /** ms (or a function of the request) to connect: a cut meanwhile means nothing left. */
    connectDelay: 0,
    clock: undefined,
    /** Every read (not the writes) answers this status when set. */
    failReads: undefined,
    sleep(ms) {
      return new Promise((resolve) => world.clock.timers.setTimeout(resolve, ms));
    },
    transport: (opts, hooks) => transport(world, opts, hooks),
    writes() {
      return world.requests.filter((r) => r.path.startsWith('/preset.htm'));
    },
    reads() {
      return world.requests.filter((r) => !r.path.startsWith('/preset.htm'));
    },
  };
  return world;
}

const text = (body, status = 200) => ({ status, body: Buffer.from(body, 'latin1') });

async function transport(world, options, { monotonic, deadline, beforeSend, onSent, onStart }) {
  const record = {
    method: options.method,
    path: options.path,
    authorization: options.authorization,
    at: monotonic(),
  };
  world.requests.push(record);
  world.inFlight += 1;
  world.peak = Math.max(world.peak, world.inFlight);
  let sent = false;
  let cut;
  const cutPromise = new Promise((_, reject) => {
    cut = () => reject(new IpxError('cut', 'cut by a protective command', { sent }));
  });
  cutPromise.catch(() => {});
  onStart?.(() => cut());
  try {
    const connect =
      typeof world.connectDelay === 'function' ? world.connectDelay(record) : world.connectDelay;
    if (connect > 0) await Promise.race([world.sleep(connect), cutPromise]);
    if (deadline !== undefined && monotonic() >= deadline) {
      throw new IpxError('late', 'no time left to send');
    }
    if (world.refuseConnect > 0) {
      world.refuseConnect -= 1;
      throw new IpxError('network', 'connection refused', { reason: 'ECONNREFUSED' });
    }
    beforeSend?.();
    if (deadline !== undefined && monotonic() >= deadline) {
      throw new IpxError('late', 'no time left to send');
    }
    sent = true;
    onSent?.();
    record.sentAt = monotonic();
    const latency = typeof world.latency === 'function' ? world.latency(record) : world.latency;
    const left = deadline === undefined ? Infinity : deadline - monotonic();
    const answer = respond(world, record);
    if (latency > 0 || left < Infinity) {
      const outcome = await Promise.race([
        world.sleep(Math.min(latency, left)).then(() => (latency >= left ? 'timeout' : 'ok')),
        cutPromise,
      ]);
      if (outcome === 'timeout') {
        throw new IpxError('timeout', 'no answer in time', { sent: true });
      }
    }
    record.end = monotonic();
    if (answer instanceof Error) throw answer;
    return answer;
  } finally {
    world.inFlight -= 1;
  }
}

function respond(world, record) {
  let next = world.queue.shift();
  if (typeof next === 'function') next = next(record);
  if (next instanceof Error) return next;
  if (next) return text(next.body ?? '', next.status ?? 200);
  const url = new URL(record.path, 'http://ipx');
  const write = url.pathname === '/preset.htm';
  if (world.user !== '' && record.authorization !== basic(world.user, world.password)) {
    return text('<html>401 Unauthorized</html>', 401);
  }
  if (world.failReads && !write) return text('', world.failReads);
  if (url.pathname === '/globalstatus.xml' && world.global) {
    return text(world.statusXml(world.state));
  }
  if (url.pathname === '/status.xml') return text(world.statusXml(world.state));
  if (write) {
    if (!world.ignoreWrites && !applyPreset(world.state, url.searchParams)) {
      return text('<html>bad</html>', 400);
    }
    return text('<html><body>IPX800 V3</body></html>');
  }
  return text('Not found', 404);
}
